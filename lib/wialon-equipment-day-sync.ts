/**
 * Денні агрегати флоту: один прохід по Wialon на сервері → БД,
 * UI читає одним запитом замість N× /api/wialon/track.
 */

import { EMPTY_DAY_ANALYTICS } from "@/lib/equipment-day-analytics";
import type { DayAnalyticsPayload } from "@/lib/equipment-day-analytics";
import { hoursOnFieldFromGpsSamples } from "@/lib/equipment-field-hours";
import { resolvePlausibleDayFuelConsumed } from "@/lib/equipment-fuel-consumed";
import { resolveWialonUnitDisplayNames } from "@/lib/wialon-unit-names";
import {
  isFuelDeliveryUnit,
  isPlausibleTractorDayBurn,
  resolveFuelTankVolumeLiters,
} from "@/lib/equipment-fuel-tanks";
import {
  kyivDayBoundsUnix,
  shiftKyivYmd,
  todayKyivYmd,
} from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  resolveFieldFuelPeriodBounds,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import {
  getWialonGeofences,
  getWialonUnitTrackBundle,
  listWialonUnitBasics,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
} from "@/lib/wialon";

const MAX_UNITS = 120;
/** Wialon рве паралельні запити (LIMIT api_concurrent) — тримаємо низько */
const CONCURRENCY = 2;
const MIN_ACTIVE_KM = 0.05;
const MIN_ACTIVE_WORK_H = 0.05;

export type EquipmentDayStatRow = {
  equipment_id: string | null;
  wialon_unit_id: number;
  date: string;
  season: string;
  distance_km: number;
  work_hours: number;
  hours_idling: number;
  hours_on_field: number;
  drain_events: number;
  fuel_start: number | null;
  fuel_end: number | null;
  fuel_delta: number | null;
  fuel_filled: number;
  fuel_consumed: number | null;
  has_fuel_sensor: boolean;
  sync_time: string;
};

export type SyncEquipmentDayResult = {
  ok: true;
  date: string;
  unitsProcessed: number;
  upserted: number;
  errors: string[];
  truncated: boolean;
};

/** Сьогоднішні KPI вважаємо застарілими після цього інтервалу */
export const FLEET_DAY_STALE_MS = 2 * 60 * 1000;
/** Бюджет user-request sync (Hobby ~60с) */
export const FLEET_DAY_SYNC_BUDGET_MS = 50_000;

export function isFleetDayStatsStale(
  dateYmd: string,
  syncedAt: string | null,
  now = new Date()
): boolean {
  if (dateYmd !== todayKyivYmd(now)) return false;
  if (!syncedAt) return true;
  const t = Date.parse(syncedAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= FLEET_DAY_STALE_MS;
}

const inflightSync = new Map<string, Promise<SyncEquipmentDayResult>>();

async function persistDayStatRows(
  supabase: ReturnType<typeof createServiceSupabase>,
  upserts: EquipmentDayStatRow[]
): Promise<number> {
  if (upserts.length === 0) return 0;
  const { error, count } = await supabase
    .from("wialon_equipment_day_stats")
    .upsert(upserts, {
      onConflict: "wialon_unit_id,date,season",
      count: "exact",
    });
  if (error) {
    if (
      error.message?.includes("wialon_equipment_day_stats") ||
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      throw new Error(
        "Таблиця wialon_equipment_day_stats відсутня. Виконай міграцію 026."
      );
    }
    // Міграція 036 ще не накатана — пишемо без нових колонок витрати
    if (
      error.message?.includes("fuel_filled") ||
      error.message?.includes("fuel_consumed")
    ) {
      const rows = upserts.map(
        ({ fuel_filled: _ff, fuel_consumed: _fc, ...rest }) => rest
      );
      const retry = await supabase.from("wialon_equipment_day_stats").upsert(
        rows,
        { onConflict: "wialon_unit_id,date,season", count: "exact" }
      );
      if (retry.error) throw new Error(retry.error.message);
      return retry.count ?? rows.length;
    }
    // Міграція 032 ще не накатана — пишемо без fuel_* колонок
    if (
      error.message?.includes("fuel_start") ||
      error.message?.includes("fuel_end") ||
      error.message?.includes("fuel_delta") ||
      error.message?.includes("has_fuel_sensor") ||
      error.code === "42703"
    ) {
      const legacyRows = upserts.map(
        ({
          fuel_start: _fs,
          fuel_end: _fe,
          fuel_delta: _fd,
          fuel_filled: _ff,
          fuel_consumed: _fc,
          has_fuel_sensor: _hs,
          ...rest
        }) => rest
      );
      const retry = await supabase.from("wialon_equipment_day_stats").upsert(
        legacyRows,
        {
          onConflict: "wialon_unit_id,date,season",
          count: "exact",
        }
      );
      if (retry.error) throw new Error(retry.error.message);
      return retry.count ?? legacyRows.length;
    }
    if (
      error.message?.includes("onConflict") ||
      error.code === "42P10" ||
      error.message?.includes("wialon_equipment_day_stats_unique")
    ) {
      const mappedOnly = upserts.filter((r) => r.equipment_id != null);
      if (mappedOnly.length === 0) return 0;
      const legacy = await supabase
        .from("wialon_equipment_day_stats")
        .upsert(mappedOnly, {
          onConflict: "equipment_id,date,season",
          count: "exact",
        });
      if (legacy.error) throw new Error(legacy.error.message);
      return legacy.count ?? mappedOnly.length;
    }
    throw new Error(error.message);
  }
  return count ?? upserts.length;
}

/**
 * Синхронізує денну статистику для всього Wialon-флоту
 * (equipment_id опційний — поки немає зіставлення з BAS AGRO).
 */
export async function syncWialonEquipmentDayStats(
  dateYmd: string = todayKyivYmd(),
  options?: { budgetMs?: number }
): Promise<SyncEquipmentDayResult> {
  const existing = inflightSync.get(dateYmd);
  if (existing) return existing;
  const pending = runEquipmentDaySync(dateYmd, options).finally(() => {
    if (inflightSync.get(dateYmd) === pending) inflightSync.delete(dateYmd);
  });
  inflightSync.set(dateYmd, pending);
  return pending;
}

async function runEquipmentDaySync(
  dateYmd: string,
  options?: { budgetMs?: number }
): Promise<SyncEquipmentDayResult> {
  const season = currentAgroSeason();
  const { fromUnix, toUnix } = kyivDayBoundsUnix(dateYmd);
  const supabase = createServiceSupabase();
  const syncTime = new Date().toISOString();
  const errors: string[] = [];
  const budgetMs = options?.budgetMs ?? FLEET_DAY_SYNC_BUDGET_MS;
  const startedAt = Date.now();

  const eid = await wialonLogin();
  let geofences = wialonResourcesToGeofenceGeoJSON([]);
  try {
    const resources = await getWialonGeofences(eid);
    geofences = wialonResourcesToGeofenceGeoJSON(resources);
  } catch (err) {
    errors.push(
      err instanceof Error
        ? `Геозони Wialon: ${err.message}`
        : "Не вдалося завантажити геозони Wialon"
    );
  }

  const [wialonUnits, eqResult] = await Promise.all([
    listWialonUnitBasics(eid),
    supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("is_active", true)
      .not("wialon_id", "is", null)
      .limit(MAX_UNITS),
  ]);

  if (eqResult.error) throw new Error(eqResult.error.message);

  const eqByWialon = new Map<number, { id: string; name: string }>();
  for (const row of eqResult.data ?? []) {
    const wid = Number(row.wialon_id);
    if (Number.isFinite(wid) && wid > 0) {
      eqByWialon.set(wid, {
        id: String(row.id),
        name: String(row.name ?? ""),
      });
    }
  }

  const units = wialonUnits.slice(0, MAX_UNITS).map((u) => ({
    wialon_id: u.id,
    name: u.nm,
    equipment_id: eqByWialon.get(u.id)?.id ?? null,
    equipment_name: eqByWialon.get(u.id)?.name ?? "",
  }));

  if (units.length === 0) {
    return {
      ok: true,
      date: dateYmd,
      unitsProcessed: 0,
      upserted: 0,
      errors: [],
      truncated: false,
    };
  }

  let upserted = 0;
  let truncated = false;
  let processed = 0;

  for (let i = 0; i < units.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > budgetMs) {
      truncated = true;
      errors.push(
        `Час вичерпано, лишилось ${units.length - i} одиниць — натисніть оновлення ще раз`
      );
      break;
    }

    const batch = units.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (unit) => {
        try {
          const bundle = await getWialonUnitTrackBundle(
            eid,
            unit.wialon_id,
            fromUnix,
            toUnix
          );
          const analytics = bundle.analytics ?? EMPTY_DAY_ANALYTICS;
          const workHours = analytics.summary.workHours;
          const hoursOnField = hoursOnFieldFromGpsSamples(
            analytics.samples ?? [],
            geofences,
            workHours > 0 ? workHours : undefined
          );

          const delivery = isFuelDeliveryUnit(unit.name, unit.equipment_name);
          const hasFuel = analytics.summary.hasFuelSensor;
          const rawConsumed =
            hasFuel && !delivery ? analytics.summary.fuelConsumed : null;
          const burnOk =
            rawConsumed != null &&
            isPlausibleTractorDayBurn({
              fuelConsumed: rawConsumed,
              fuelStart: analytics.summary.fuelStart,
              fuelEnd: analytics.summary.fuelEnd,
              fuelFilled: analytics.summary.fuelFilled,
              workHours: analytics.summary.workHours,
              hoursOnField: hoursOnField,
            });

          return {
            equipment_id: unit.equipment_id,
            wialon_unit_id: unit.wialon_id,
            date: dateYmd,
            season,
            distance_km: analytics.summary.distanceKm,
            work_hours: analytics.summary.workHours,
            hours_idling: analytics.summary.hoursIdling,
            hours_on_field: hoursOnField,
            drain_events: delivery ? 0 : analytics.fuelEvents.length,
            fuel_start: hasFuel ? analytics.summary.fuelStart : null,
            fuel_end: hasFuel ? analytics.summary.fuelEnd : null,
            fuel_delta: hasFuel ? analytics.summary.fuelDelta : null,
            fuel_filled:
              hasFuel && !delivery && burnOk
                ? analytics.summary.fuelFilled
                : 0,
            // Цистерна / роздача — не «спалено двигуном»
            fuel_consumed: burnOk ? rawConsumed : null,
            has_fuel_sensor: hasFuel,
            sync_time: syncTime,
          } satisfies EquipmentDayStatRow;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "помилка Wialon";
          errors.push(`${unit.name} (${unit.wialon_id}): ${msg}`);
          return null;
        }
      })
    );
    const rows = results.filter((row): row is EquipmentDayStatRow => row != null);
    processed += batch.length;
    upserted += await persistDayStatRows(supabase, rows);
  }

  return {
    ok: true,
    date: dateYmd,
    unitsProcessed: processed,
    upserted,
    errors,
    truncated,
  };
}

export type FleetDaySummaryDto = {
  unitsActive: number;
  unitsTotal: number;
  distanceKm: number;
  hoursOnField: number;
  hoursIdling: number;
  drainEvents: number;
  byMetric: {
    active: number[];
    onField: number[];
    distance: number[];
    idling: number[];
    drain: number[];
  };
  syncedAt: string | null;
  source: "db" | "empty";
  unitStats?: Array<{
    wialonUnitId: number;
    hoursIdling: number;
    drainEvents: number;
  }>;
};

/**
 * Спалено самохідною технікою за період (л) — з денного кешу.
 * Бензовози / цистерни не входять: падіння бака — роздача, не ДВЗ.
 */
export async function sumFleetFuelConsumedForPeriod(
  fromDate: string,
  toDate: string
): Promise<{ liters: number; hasData: boolean }> {
  const supabase = createServiceSupabase();

  const [{ data, error }, eqRes] = await Promise.all([
    supabase
      .from("wialon_equipment_day_stats")
      .select(
        "fuel_consumed, fuel_start, fuel_end, fuel_filled, work_hours, hours_on_field, wialon_unit_id, equipment_id"
      )
      .gte("date", fromDate)
      .lte("date", toDate)
      .not("fuel_consumed", "is", null),
    supabase.from("equipment").select("id, wialon_id, name"),
  ]);

  // Міграція 036 ще не накатана
  if (error) return { liters: 0, hasData: false };

  const deliveryWialonIds = new Set<number>();
  const deliveryEquipmentIds = new Set<string>();
  for (const row of eqRes.data ?? []) {
    if (!isFuelDeliveryUnit(row.name)) continue;
    const wid = Number(row.wialon_id);
    if (Number.isFinite(wid) && wid > 0) deliveryWialonIds.add(wid);
    if (row.id) deliveryEquipmentIds.add(String(row.id));
  }

  const eqNameByWid = new Map<number, string>();
  for (const row of eqRes.data ?? []) {
    const wid = Number(row.wialon_id);
    if (Number.isFinite(wid) && wid > 0 && row.name) {
      eqNameByWid.set(wid, String(row.name));
    }
  }

  const liters = (data ?? []).reduce((acc, row) => {
    const wid = Number(row.wialon_unit_id);
    const eid = row.equipment_id != null ? String(row.equipment_id) : null;
    if (Number.isFinite(wid) && deliveryWialonIds.has(wid)) return acc;
    if (eid && deliveryEquipmentIds.has(eid)) return acc;

    const recalc = resolvePlausibleDayFuelConsumed({
      start: row.fuel_start,
      end: row.fuel_end,
      filled: row.fuel_filled,
      tankVolumeLiters: resolveFuelTankVolumeLiters(eqNameByWid.get(wid)),
      workHours: row.work_hours,
    });

    if (
      recalc == null ||
      !isPlausibleTractorDayBurn({
        fuelConsumed: recalc,
        fuelStart: row.fuel_start,
        fuelEnd: row.fuel_end,
        fuelFilled: row.fuel_filled,
        workHours: row.work_hours,
        hoursOnField: row.hours_on_field,
      })
    ) {
      return acc;
    }

    return acc + recalc;
  }, 0);

  return {
    liters: Math.round(liters * 10) / 10,
    hasData: (data?.length ?? 0) > 0,
  };
}

export type FleetFuelFilledBreakdownRow = {
  wialonUnitId: number;
  equipmentName: string;
  liters: number;
};

/**
 * Заправлено за період — сума fuel_filled з денного кешу (після syncWialonEquipmentDayStats).
 * Бензовози / цистерни не входять.
 */
export async function sumFleetFuelFilledForPeriod(
  fromDate: string,
  toDate: string
): Promise<{
  liters: number;
  hasData: boolean;
  rows: FleetFuelFilledBreakdownRow[];
  dutUnitIds: Set<number>;
}> {
  const supabase = createServiceSupabase();

  const [{ data, error }, eqRes] = await Promise.all([
    supabase
      .from("wialon_equipment_day_stats")
      .select(
        "fuel_filled, wialon_unit_id, equipment_id, has_fuel_sensor"
      )
      .gte("date", fromDate)
      .lte("date", toDate)
      .gt("fuel_filled", 0),
    supabase.from("equipment").select("id, wialon_id, name"),
  ]);

  if (error) {
    return { liters: 0, hasData: false, rows: [], dutUnitIds: new Set() };
  }

  const deliveryWialonIds = new Set<number>();
  const deliveryEquipmentIds = new Set<string>();
  const eqNameByWid = new Map<number, string>();
  for (const row of eqRes.data ?? []) {
    const wid = Number(row.wialon_id);
    const nm = String(row.name ?? "").trim();
    if (Number.isFinite(wid) && wid > 0 && nm) eqNameByWid.set(wid, nm);
    if (!isFuelDeliveryUnit(nm)) continue;
    if (Number.isFinite(wid) && wid > 0) deliveryWialonIds.add(wid);
    if (row.id) deliveryEquipmentIds.add(String(row.id));
  }

  const dataWialonIds = [
    ...new Set(
      (data ?? [])
        .map((row) => Number(row.wialon_unit_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const displayNames = await resolveWialonUnitDisplayNames(dataWialonIds);

  const byUnit = new Map<number, number>();
  const dutUnitIds = new Set<number>();
  for (const row of data ?? []) {
    const wid = Number(row.wialon_unit_id);
    const filled = Number(row.fuel_filled) || 0;
    if (!Number.isFinite(wid) || wid <= 0 || filled <= 0) continue;
    const eid = row.equipment_id != null ? String(row.equipment_id) : null;
    if (deliveryWialonIds.has(wid)) continue;
    if (eid && deliveryEquipmentIds.has(eid)) continue;

    const name = displayNames.get(wid) ?? eqNameByWid.get(wid) ?? "";
    if (isFuelDeliveryUnit(name)) continue;

    const tankVol = resolveFuelTankVolumeLiters(name);
    const maxFill = tankVol != null ? tankVol * 1.15 : 1_200;
    if (filled > maxFill) continue;

    byUnit.set(wid, (byUnit.get(wid) ?? 0) + filled);
    if (row.has_fuel_sensor === true) dutUnitIds.add(wid);
  }

  const rowDisplayNames = await resolveWialonUnitDisplayNames([...byUnit.keys()]);

  const rows: FleetFuelFilledBreakdownRow[] = [...byUnit.entries()]
    .map(([wialonUnitId, liters]) => ({
      wialonUnitId,
      equipmentName:
        rowDisplayNames.get(wialonUnitId) ??
        eqNameByWid.get(wialonUnitId) ??
        `Wialon #${wialonUnitId}`,
      liters: Math.round(liters * 10) / 10,
    }))
    .filter((row) => !isFuelDeliveryUnit(row.equipmentName))
    .sort((a, b) => b.liters - a.liters);

  const liters = Math.round(
    rows.reduce((acc, row) => acc + row.liters, 0) * 10
  ) / 10;

  return {
    liters,
    hasData: rows.length > 0,
    rows,
    dutUnitIds,
  };
}

/** Дати в діапазоні без жодного рядка wialon_equipment_day_stats. */
export async function listUnsyncedEquipmentDayDates(
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const all: string[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    all.push(cursor);
    cursor = shiftKyivYmd(cursor, 1);
  }
  if (all.length === 0) return [];

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select("date")
    .gte("date", fromDate)
    .lte("date", toDate);

  if (error) return all;

  const synced = new Set<string>();
  const today = todayKyivYmd();
  for (const row of data ?? []) {
    if (!row.date) continue;
    const d = String(row.date).slice(0, 10);
    // Поточний день не вважаємо повністю синхронізованим — intraday tick оновлює дані.
    if (d !== today) synced.add(d);
  }
  return all.filter((d) => !synced.has(d));
}

async function equipmentDayStatsStale(
  dateYmd: string,
  maxAgeMs: number,
  now = new Date()
): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("wialon_equipment_day_stats")
    .select("sync_time")
    .eq("date", dateYmd)
    .order("sync_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.sync_time) return true;
  const t = Date.parse(String(data.sync_time));
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > maxAgeMs;
}

/**
 * Перед KPI палива: дотягнути wialon_equipment_day_stats (fuel_consumed + fuel_filled).
 */
export async function ensureEquipmentDayStatsCoverage(
  period: FieldFuelPeriod,
  options?: { maxDays?: number; budgetMs?: number; now?: Date }
): Promise<{ daysSyncedNow: number; truncated: boolean }> {
  const now = options?.now ?? new Date();
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(period, now);
  const budgetMs = Math.max(5_000, options?.budgetMs ?? 50_000);
  const started = Date.now();
  let daysSyncedNow = 0;
  let truncated = false;

  if (period === "today" || period === "yesterday") {
    const date = period === "today" ? toDate : fromDate;
    const maxAgeMs = period === "today" ? 5 * 60 * 1000 : 30 * 60 * 1000;
    const stale = await equipmentDayStatsStale(date, maxAgeMs, now);
    if (stale) {
      await syncWialonEquipmentDayStats(date, {
        budgetMs: Math.min(budgetMs, 12_000),
      });
      daysSyncedNow = 1;
    }
    return { daysSyncedNow, truncated: false };
  }

  const missing = await listUnsyncedEquipmentDayDates(fromDate, toDate);
  const maxDays =
    options?.maxDays ??
    (period === "season" ? 6 : period === "month" ? 4 : 3);
  const toSync = missing.slice(0, maxDays);

  for (const date of toSync) {
    if (Date.now() - started > budgetMs) {
      truncated = true;
      break;
    }
    const remaining = Math.max(5_000, budgetMs - (Date.now() - started));
    await syncWialonEquipmentDayStats(date, { budgetMs: remaining });
    daysSyncedNow += 1;
  }

  if (missing.length > toSync.length) truncated = true;
  return { daysSyncedNow, truncated };
}

export async function loadFleetDaySummaryFromDb(
  dateYmd: string,
  trackedWialonIds?: number[],
  options?: { ignoreDrainUnitIds?: number[] }
): Promise<FleetDaySummaryDto> {
  const season = currentAgroSeason();
  const supabase = createServiceSupabase();
  const emptyMetric = {
    active: [] as number[],
    onField: [] as number[],
    distance: [] as number[],
    idling: [] as number[],
    drain: [] as number[],
  };
  const ignoreDrain =
    options?.ignoreDrainUnitIds && options.ignoreDrainUnitIds.length > 0
      ? new Set(options.ignoreDrainUnitIds)
      : null;

  let { data, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select(
      "wialon_unit_id, distance_km, work_hours, hours_idling, hours_on_field, drain_events, sync_time"
    )
    .eq("date", dateYmd)
    .eq("season", season);

  if (error) {
    if (error.message?.includes("season") || error.code === "42703") {
      const legacy = await supabase
        .from("wialon_equipment_day_stats")
        .select(
          "wialon_unit_id, distance_km, work_hours, hours_idling, hours_on_field, drain_events, sync_time"
        )
        .eq("date", dateYmd);
      data = legacy.data;
      error = legacy.error;
    }
    if (
      error &&
      (error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("wialon_equipment_day_stats"))
    ) {
      return {
        unitsActive: 0,
        unitsTotal: trackedWialonIds?.length ?? 0,
        distanceKm: 0,
        hoursOnField: 0,
        hoursIdling: 0,
        drainEvents: 0,
        byMetric: emptyMetric,
        syncedAt: null,
        source: "empty",
        unitStats: [],
      };
    }
    if (error) throw new Error(error.message);
  }

  const rows = data ?? [];
  const trackedSet =
    trackedWialonIds && trackedWialonIds.length > 0
      ? new Set(trackedWialonIds)
      : null;
  const byMetric = emptyMetric;
  const unitStats: FleetDaySummaryDto["unitStats"] = [];
  let distanceKm = 0;
  let hoursOnField = 0;
  let hoursIdling = 0;
  let drainEvents = 0;
  let unitsActive = 0;
  let syncedAt: string | null = null;
  const seenUnitIds = new Set<number>();

  for (const row of rows) {
    const unitId = Number(row.wialon_unit_id);
    if (!Number.isFinite(unitId)) continue;
    if (trackedSet && !trackedSet.has(unitId)) continue;

    seenUnitIds.add(unitId);
    const dist = Number(row.distance_km) || 0;
    const work = Number(row.work_hours) || 0;
    const idle = Number(row.hours_idling) || 0;
    const onField = Number(row.hours_on_field) || 0;
    const drainsRaw = Number(row.drain_events) || 0;
    const drains =
      ignoreDrain?.has(unitId) || drainsRaw <= 0 ? 0 : drainsRaw;

    distanceKm += dist;
    hoursIdling += idle;
    hoursOnField += onField;
    drainEvents += drains;

    if (dist > MIN_ACTIVE_KM || work > MIN_ACTIVE_WORK_H) {
      unitsActive += 1;
      byMetric.active.push(unitId);
    }
    if (dist > MIN_ACTIVE_KM) byMetric.distance.push(unitId);
    if (idle > 0) byMetric.idling.push(unitId);
    if (drains > 0) byMetric.drain.push(unitId);
    if (onField > 0) byMetric.onField.push(unitId);

    unitStats.push({
      wialonUnitId: unitId,
      hoursIdling: idle,
      drainEvents: drains,
    });

    const st = row.sync_time ? String(row.sync_time) : null;
    if (st && (!syncedAt || st > syncedAt)) syncedAt = st;
  }

  const unitsTotal =
    trackedSet != null ? trackedSet.size : Math.max(seenUnitIds.size, unitsActive);

  return {
    unitsActive,
    unitsTotal,
    distanceKm: Math.round(distanceKm * 10) / 10,
    hoursOnField: Math.round(hoursOnField * 10) / 10,
    hoursIdling: Math.round(hoursIdling * 10) / 10,
    drainEvents,
    byMetric,
    syncedAt,
    source: rows.length > 0 ? "db" : "empty",
    unitStats,
  };
}

export type UnitDayStatsDto = {
  wialonUnitId: number;
  date: string;
  distanceKm: number;
  workHours: number;
  hoursIdling: number;
  hoursOnField: number;
  drainEvents: number;
  fuelStart: number | null;
  fuelEnd: number | null;
  fuelDelta: number | null;
  hasFuelSensor: boolean;
  syncTime: string | null;
  source: "db" | "empty";
};

/**
 * Денні метрики одного юніта з БД (після CRON / fleet sync).
 * Використовується як fallback для «Зміна за день», якщо live-трек без палива.
 */
export async function loadUnitDayStatsFromDb(
  wialonUnitId: number,
  dateYmd: string
): Promise<UnitDayStatsDto> {
  const empty: UnitDayStatsDto = {
    wialonUnitId,
    date: dateYmd,
    distanceKm: 0,
    workHours: 0,
    hoursIdling: 0,
    hoursOnField: 0,
    drainEvents: 0,
    fuelStart: null,
    fuelEnd: null,
    fuelDelta: null,
    hasFuelSensor: false,
    syncTime: null,
    source: "empty",
  };

  if (!Number.isFinite(wialonUnitId) || wialonUnitId <= 0) return empty;

  const season = currentAgroSeason();
  const supabase = createServiceSupabase();

  let { data, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select(
      "distance_km, work_hours, hours_idling, hours_on_field, drain_events, fuel_start, fuel_end, fuel_delta, has_fuel_sensor, sync_time"
    )
    .eq("wialon_unit_id", wialonUnitId)
    .eq("date", dateYmd)
    .eq("season", season)
    .maybeSingle();

  if (error) {
    // Колонки fuel_* ще немає — читаємо базові поля
    if (
      error.message?.includes("fuel_") ||
      error.message?.includes("has_fuel_sensor") ||
      (error.code === "42703" &&
        /fuel_|has_fuel_sensor/i.test(error.message ?? ""))
    ) {
      const legacy = await supabase
        .from("wialon_equipment_day_stats")
        .select(
          "distance_km, work_hours, hours_idling, hours_on_field, drain_events, sync_time"
        )
        .eq("wialon_unit_id", wialonUnitId)
        .eq("date", dateYmd)
        .eq("season", season)
        .maybeSingle();
      data = legacy.data
        ? {
            ...legacy.data,
            fuel_start: null,
            fuel_end: null,
            fuel_delta: null,
            has_fuel_sensor: false,
          }
        : null;
      error = legacy.error;
    } else if (
      error.message?.includes("season") ||
      error.code === "42703"
    ) {
      const noSeason = await supabase
        .from("wialon_equipment_day_stats")
        .select(
          "distance_km, work_hours, hours_idling, hours_on_field, drain_events, sync_time"
        )
        .eq("wialon_unit_id", wialonUnitId)
        .eq("date", dateYmd)
        .maybeSingle();
      data = noSeason.data
        ? {
            ...noSeason.data,
            fuel_start: null,
            fuel_end: null,
            fuel_delta: null,
            has_fuel_sensor: false,
          }
        : null;
      error = noSeason.error;
    }
    if (
      error &&
      (error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("wialon_equipment_day_stats"))
    ) {
      return empty;
    }
    if (error) throw new Error(error.message);
  }

  if (!data) return empty;

  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    wialonUnitId,
    date: dateYmd,
    distanceKm: Number(data.distance_km) || 0,
    workHours: Number(data.work_hours) || 0,
    hoursIdling: Number(data.hours_idling) || 0,
    hoursOnField: Number(data.hours_on_field) || 0,
    drainEvents: Number(data.drain_events) || 0,
    fuelStart: numOrNull(data.fuel_start),
    fuelEnd: numOrNull(data.fuel_end),
    fuelDelta: numOrNull(data.fuel_delta),
    hasFuelSensor: Boolean(data.has_fuel_sensor),
    syncTime: data.sync_time ? String(data.sync_time) : null,
    source: "db",
  };
}

export function enrichDayAnalyticsFromDbStats(
  analytics: DayAnalyticsPayload,
  db: UnitDayStatsDto
): DayAnalyticsPayload {
  if (db.source !== "db") return analytics;

  const summary = { ...analytics.summary };
  let changed = false;

  if (db.hasFuelSensor && !summary.hasFuelSensor) {
    summary.hasFuelSensor = true;
    changed = true;
  }

  // Не підмішуємо 0/0 з БД, якщо ДУТ немає
  if (!summary.hasFuelSensor && !db.hasFuelSensor) {
    if (summary.sampleCount === 0 && db.distanceKm > 0) {
      summary.distanceKm = db.distanceKm;
      summary.workHours = db.workHours;
      summary.hoursIdling = db.hoursIdling;
      return { ...analytics, summary };
    }
    return analytics;
  }

  if (summary.fuelStart == null && db.fuelStart != null && db.fuelStart > 0) {
    summary.fuelStart = db.fuelStart;
    changed = true;
  }
  if (summary.fuelEnd == null && db.fuelEnd != null && db.fuelEnd > 0) {
    summary.fuelEnd = db.fuelEnd;
    changed = true;
  }
  if (
    summary.fuelDelta == null &&
    db.fuelDelta != null &&
    (summary.fuelStart != null || db.fuelStart != null) &&
    (summary.fuelEnd != null || db.fuelEnd != null)
  ) {
    summary.fuelDelta = db.fuelDelta;
    changed = true;
  }

  // Порожній live-день, але в БД вже є пробіг/мотогодини з попереднього sync
  if (summary.sampleCount === 0 && db.distanceKm > 0) {
    summary.distanceKm = db.distanceKm;
    summary.workHours = db.workHours;
    summary.hoursIdling = db.hoursIdling;
    changed = true;
  }

  if (!changed) return analytics;
  return { ...analytics, summary };
}

export { todayKyivYmd };

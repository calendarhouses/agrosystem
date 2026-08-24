/**
 * Денні агрегати флоту: один прохід по Wialon на сервері → БД,
 * UI читає одним запитом замість N× /api/wialon/track.
 */

import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { EMPTY_DAY_ANALYTICS } from "@/lib/equipment-day-analytics";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  kyivDayBoundsUnix,
  todayKyivYmd,
} from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  getWialonUnitTrackBundle,
  listWialonUnitBasics,
  wialonLogin,
} from "@/lib/wialon";

const MAX_UNITS = 120;
const CONCURRENCY = 5;
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
export const FLEET_DAY_STALE_MS = 15 * 60 * 1000;
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

function toPolygonFeature(
  geometry: FieldGeometry
): Feature<Polygon | MultiPolygon> | null {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }
  return { type: "Feature", properties: {}, geometry };
}

function hoursOnFarmFieldsFromSamples(
  samples: { lng: number; lat: number; t: number }[],
  polygons: Feature<Polygon | MultiPolygon>[]
): number {
  if (samples.length < 2 || polygons.length === 0) return 0;

  let insideSec = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (!prev || !cur || cur.t <= prev.t) continue;
    if (!Number.isFinite(cur.lng) || !Number.isFinite(cur.lat)) continue;
    let inside = false;
    try {
      const pt = point([cur.lng, cur.lat]);
      inside = polygons.some((poly) => booleanPointInPolygon(pt, poly));
    } catch {
      inside = false;
    }
    if (inside) insideSec += cur.t - prev.t;
  }
  return Math.round((insideSec / 3600) * 100) / 100;
}

async function loadFieldPolygons(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<Feature<Polygon | MultiPolygon>[]> {
  const { data, error } = await supabase
    .from("farm_fields")
    .select("geometry")
    .not("geometry", "is", null);
  if (error || !data) return [];
  const out: Feature<Polygon | MultiPolygon>[] = [];
  for (const row of data) {
    const feature = toPolygonFeature(row.geometry as FieldGeometry);
    if (feature) out.push(feature);
  }
  return out;
}

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
 * (equipment_id опційний — поки немає зіставлення з 1С).
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
  const [wialonUnits, eqResult, polygons] = await Promise.all([
    listWialonUnitBasics(eid),
    supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("is_active", true)
      .not("wialon_id", "is", null)
      .limit(MAX_UNITS),
    loadFieldPolygons(supabase),
  ]);

  if (eqResult.error) throw new Error(eqResult.error.message);

  const eqByWialon = new Map<number, string>();
  for (const row of eqResult.data ?? []) {
    const wid = Number(row.wialon_id);
    if (Number.isFinite(wid) && wid > 0) {
      eqByWialon.set(wid, String(row.id));
    }
  }

  const units = wialonUnits.slice(0, MAX_UNITS).map((u) => ({
    wialon_id: u.id,
    name: u.nm,
    equipment_id: eqByWialon.get(u.id) ?? null,
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
          const hoursOnField = hoursOnFarmFieldsFromSamples(
            analytics.samples ?? [],
            polygons
          );

          return {
            equipment_id: unit.equipment_id,
            wialon_unit_id: unit.wialon_id,
            date: dateYmd,
            season,
            distance_km: analytics.summary.distanceKm,
            work_hours: analytics.summary.workHours,
            hours_idling: analytics.summary.hoursIdling,
            hours_on_field: hoursOnField,
            drain_events: isFuelDeliveryUnit(unit.name)
              ? 0
              : analytics.fuelEvents.length,
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

export { todayKyivYmd };

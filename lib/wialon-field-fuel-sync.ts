/**
 * Фонова синхронізація: візити в геозонах полів + витрата палива за ДРП.
 * Ціну дизеля — lib/fuel-price.ts
 */

import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { booleanPointInPolygon, point } from "@turf/turf";

import type { FieldGeometry } from "@/lib/farm-fields";
import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  estimateFuelConsumedByFls,
} from "@/lib/wialon-fuel";
import { extractTimedFuelSamples } from "@/lib/wialon-fuel-decode";
import {
  getWialonUnitSensors,
  listUnitSensors,
  listWialonUnitBasics,
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";

export {
  getLatestFuelPurchasePriceUah,
  resolveDieselPriceUah,
} from "@/lib/fuel-price";

/** Мін. тривалість візиту (сек) — відсікає GPS-шум */
const MIN_VISIT_SEC = 10 * 60;
/** Ліміт юнітів за один CRON-прогін (зовнішній cron може ганяти частіше) */
const MAX_UNITS = 80;

export type WialonFieldFuelLogUpsert = {
  field_id: string;
  /** null якщо техніка ще не зіставлена в equipment */
  equipment_id: string | null;
  wialon_unit_id: number;
  date: string;
  fuel_consumed: number;
  sync_time: string;
  season: string;
};

export type SyncWialonFieldFuelResult = {
  ok: true;
  date: string;
  fromUnix: number;
  toUnix: number;
  unitsProcessed: number;
  upserted: number;
  skipped: number;
  errors: string[];
};

type SyncUnit = {
  wialon_id: number;
  name: string;
  equipment_id: string | null;
};

type FieldRow = {
  id: string;
  name: string;
  wialon_zone_id: string | null;
  geometry: FieldGeometry | null;
};

type VisitWindow = { startUnix: number; endUnix: number };

type FuelSample = { t: number; liters: number };

function kyivTodayParts(now = new Date()): {
  date: string;
  fromUnix: number;
  toUnix: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = fmt.format(now); // YYYY-MM-DD

  // Межі доби Києва → UNIX
  const startLocal = new Date(`${date}T00:00:00+03:00`);
  // DST: Europe/Kyiv — використовуємо Intl offset через Date в зоні
  const fromUnix = Math.floor(kyivDayStartMs(date) / 1000);
  const toUnix = Math.min(
    Math.floor(now.getTime() / 1000),
    fromUnix + 24 * 60 * 60 - 1
  );

  void startLocal;
  return { date, fromUnix, toUnix };
}

/** Початок доби Europe/Kyiv у ms (UTC). */
function kyivDayStartMs(dateYmd: string): number {
  // mid-day probe to resolve offset for that calendar day
  const probe = new Date(`${dateYmd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    timeZoneName: "shortOffset",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+3";
  const match = tzName.match(/GMT([+-]\d+)(?::(\d+))?/i);
  const hours = match ? Number(match[1]) : 3;
  const mins = match?.[2] ? Number(match[2]) : 0;
  const offsetMin = hours * 60 + Math.sign(hours || 1) * mins;
  // YYYY-MM-DD 00:00 in Kyiv = UTC − offset
  const [y, m, d] = dateYmd.split("-").map(Number);
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0) - offsetMin * 60_000;
  return utcGuess;
}

function toPolygonFeature(
  geometry: FieldGeometry
): Feature<Polygon | MultiPolygon> | null {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }
  return { type: "Feature", properties: {}, geometry };
}

function readMsgTime(msg: WialonTrackMessage): number | null {
  if (typeof msg.t === "number" && Number.isFinite(msg.t) && msg.t > 0) {
    return msg.t;
  }
  return null;
}

function readPosition(msg: WialonTrackMessage): Position | null {
  const pos = msg.pos;
  if (!pos) return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
    return null;
  }
  return [x, y];
}

function extractFuelSamples(
  messages: WialonTrackMessage[],
  sensors: ReturnType<typeof listUnitSensors> = []
) {
  return extractTimedFuelSamples(messages, sensors).map((s) => ({
    t: s.t,
    liters: s.liters,
  }));
}

/**
 * Візити юніта в полігоні поля за повідомленнями з координатами
 * (аналог звіту «Посещения геозон»).
 */
export function detectGeofenceVisits(
  messages: WialonTrackMessage[],
  geometry: FieldGeometry
): VisitWindow[] {
  const polygon = toPolygonFeature(geometry);
  if (!polygon) return [];

  type Point = { t: number; inside: boolean };
  const points: Point[] = [];

  for (const msg of messages) {
    const t = readMsgTime(msg);
    const coord = readPosition(msg);
    if (t == null || !coord) continue;
    let inside = false;
    try {
      inside = booleanPointInPolygon(point(coord), polygon);
    } catch {
      inside = false;
    }
    points.push({ t, inside });
  }

  points.sort((a, b) => a.t - b.t);
  if (points.length < 2) return [];

  const raw: VisitWindow[] = [];
  let current: VisitWindow | null = null;

  for (const p of points) {
    if (p.inside) {
      if (!current) current = { startUnix: p.t, endUnix: p.t };
      else current.endUnix = p.t;
    } else if (current) {
      raw.push(current);
      current = null;
    }
  }
  if (current) raw.push(current);

  return raw.filter((v) => v.endUnix - v.startUnix >= MIN_VISIT_SEC);
}

function fuelConsumedInWindows(
  samples: FuelSample[],
  windows: VisitWindow[]
): number {
  if (samples.length < 2 || windows.length === 0) return 0;

  let total = 0;
  for (const win of windows) {
    const inWin = samples.filter(
      (s) => s.t >= win.startUnix && s.t <= win.endUnix
    );
    const { consumedLiters } = estimateFuelConsumedByFls(inWin);
    if (consumedLiters == null || consumedLiters <= 0) continue;

    // Анти-шум: під час заправки ДУТ «скаче» і FLS малює тисячі літрів
    const hours = Math.max((win.endUnix - win.startUnix) / 3600, 1 / 60);
    const maxPlausible = Math.min(600, hours * 90 + 40);
    if (consumedLiters > maxPlausible) {
      console.warn("[field-fuel] відхилено неправдоподібну витрату", {
        consumedLiters,
        maxPlausible,
        hours: Math.round(hours * 100) / 100,
      });
      continue;
    }
    total += consumedLiters;
  }
  return Math.round(total * 10) / 10;
}

async function loadMappings(): Promise<{
  units: SyncUnit[];
  fields: FieldRow[];
}> {
  const supabase = createServiceSupabase();

  const [eqRes, fieldRes] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("is_active", true),
    supabase
      .from("farm_fields")
      .select("id, name, wialon_zone_id, geometry")
      .not("geometry", "is", null),
  ]);

  if (eqRes.error) throw new Error(`equipment: ${eqRes.error.message}`);
  if (fieldRes.error) throw new Error(`farm_fields: ${fieldRes.error.message}`);

  const eqByWialon = new Map<number, { id: string; name: string }>();
  for (const row of eqRes.data ?? []) {
    const wid = Number(row.wialon_id);
    if (!Number.isFinite(wid) || wid <= 0) continue;
    eqByWialon.set(wid, {
      id: String(row.id),
      name: String(row.name ?? ""),
    });
  }

  // Флот = усі юніти Wialon (як у Техніці), не лише 1 mapped equipment
  const eid = await wialonLogin();
  const wialonUnits = await listWialonUnitBasics(eid);
  const units: SyncUnit[] = wialonUnits
    .slice(0, MAX_UNITS)
    .filter((u) => !isFuelDeliveryUnit(u.nm))
    .map((u) => {
      const eq = eqByWialon.get(u.id);
      return {
        wialon_id: u.id,
        name: u.nm,
        equipment_id: eq?.id ?? null,
      };
    });

  const fields: FieldRow[] = [];
  for (const row of fieldRes.data ?? []) {
    const geometry = row.geometry as FieldGeometry | null;
    if (
      !geometry ||
      (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
    ) {
      continue;
    }
    fields.push({
      id: String(row.id),
      name: String(row.name ?? ""),
      wialon_zone_id:
        row.wialon_zone_id != null && String(row.wialon_zone_id).trim()
          ? String(row.wialon_zone_id)
          : null,
      geometry,
    });
  }

  return { units, fields };
}

/**
 * Основний прогін: зібрати витрату за календарний день Europe/Kyiv
 * і upsert у wialon_field_fuel_logs. Для «сьогодні» toUnix = зараз.
 */
export async function syncWialonFieldFuelForDate(
  dateYmd: string,
  now = new Date()
): Promise<SyncWialonFieldFuelResult> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateYmd)
    ? dateYmd
    : todayKyivYmd(now);
  const bounds = kyivDayBoundsUnix(date);
  const fromUnix = bounds.fromUnix;
  const today = todayKyivYmd(now);
  const toUnix =
    date === today
      ? Math.min(Math.floor(now.getTime() / 1000), bounds.toUnix)
      : bounds.toUnix;

  const errors: string[] = [];
  const { units, fields } = await loadMappings();

  if (units.length === 0 || fields.length === 0) {
    return {
      ok: true,
      date,
      fromUnix,
      toUnix,
      unitsProcessed: 0,
      upserted: 0,
      skipped: 0,
      errors: [
        units.length === 0
          ? "Немає юнітів Wialon"
          : "Немає полів з geometry",
      ],
    };
  }

  const eid = await wialonLogin();
  const syncTime = new Date().toISOString();
  const season = currentAgroSeason(now);
  const upserts: WialonFieldFuelLogUpsert[] = [];
  let skipped = 0;

  for (const unit of units) {
    try {
      const [messagesRaw, unitWithSensors] = await Promise.all([
        loadWialonUnitMessages(eid, unit.wialon_id, fromUnix, toUnix),
        getWialonUnitSensors(eid, unit.wialon_id),
      ]);
      let messages = messagesRaw;
      if (!messages.length) {
        messages = await loadWialonUnitMessages(
          eid,
          unit.wialon_id,
          fromUnix,
          toUnix,
          { flags: 1, flagsMask: 0 }
        );
      }

      if (messages.length < 2) {
        skipped += 1;
        continue;
      }

      const sensors = unitWithSensors
        ? listUnitSensors(unitWithSensors)
        : [];
      const fuelSamples = extractFuelSamples(messages, sensors);

      for (const field of fields) {
        if (!field.geometry) continue;
        const visits = detectGeofenceVisits(messages, field.geometry);
        if (visits.length === 0) continue;

        const fuel = fuelConsumedInWindows(fuelSamples, visits);
        upserts.push({
          field_id: field.id,
          equipment_id: unit.equipment_id,
          wialon_unit_id: unit.wialon_id,
          date,
          fuel_consumed: Math.max(0, fuel),
          sync_time: syncTime,
          season,
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "невідома помилка Wialon";
      errors.push(`${unit.name} (${unit.wialon_id}): ${msg}`);
      console.error("[sync-wialon-fuel] unit failed", unit.wialon_id, err);
    }
  }

  let upserted = 0;
  if (upserts.length > 0) {
    upserted = await persistFieldFuelLogs(upserts);
  }

  return {
    ok: true,
    date,
    fromUnix,
    toUnix,
    unitsProcessed: units.length,
    upserted,
    skipped,
    errors,
  };
}

async function persistFieldFuelLogs(
  upserts: WialonFieldFuelLogUpsert[]
): Promise<number> {
  const supabase = createServiceSupabase();

  // Новий ключ (міграція 033): field + wialon_unit + date + season
  let { error, count } = await supabase.from("wialon_field_fuel_logs").upsert(
    upserts,
    {
      onConflict: "field_id,wialon_unit_id,date,season",
      count: "exact",
    }
  );

  // Міграція 033 ще не накатана — лише mapped equipment (старий unique)
  if (
    error &&
    (error.message?.includes("wialon_unit_id") ||
      error.message?.includes("onConflict") ||
      error.code === "42703" ||
      error.code === "42P10")
  ) {
    const legacy = upserts
      .filter((r) => r.equipment_id != null)
      .map(({ wialon_unit_id: _w, ...rest }) => rest);
    if (legacy.length === 0) {
      throw new Error(
        "Потрібна міграція 033 (wialon_unit_id). Зараз зіставлено 0 одиниць у equipment."
      );
    }
    const retry = await supabase.from("wialon_field_fuel_logs").upsert(legacy, {
      onConflict: "field_id,equipment_id,date,season",
      count: "exact",
    });
    if (retry.error && retry.error.message?.includes("season")) {
      const noSeason = legacy.map(({ season: _s, ...r }) => r);
      const r2 = await supabase.from("wialon_field_fuel_logs").upsert(noSeason, {
        onConflict: "field_id,equipment_id,date",
        count: "exact",
      });
      if (r2.error) throw new Error(`upsert wialon_field_fuel_logs: ${r2.error.message}`);
      return r2.count ?? noSeason.length;
    }
    if (retry.error) {
      throw new Error(`upsert wialon_field_fuel_logs: ${retry.error.message}`);
    }
    return retry.count ?? legacy.length;
  }

  if (error && error.message?.includes("season")) {
    const legacy = upserts.map(({ season: _s, ...rest }) => rest);
    const retry = await supabase.from("wialon_field_fuel_logs").upsert(legacy, {
      onConflict: "field_id,wialon_unit_id,date",
      count: "exact",
    });
    error = retry.error;
    count = retry.count;
  }

  if (error) {
    throw new Error(`upsert wialon_field_fuel_logs: ${error.message}`);
  }
  return count ?? upserts.length;
}

/**
 * CRON / live: витрата за сьогодні (Europe/Kyiv).
 */
export async function syncWialonFieldFuelForToday(
  now = new Date()
): Promise<SyncWialonFieldFuelResult> {
  return syncWialonFieldFuelForDate(todayKyivYmd(now), now);
}

/**
 * Закритий вчорашній день Києва (повний інтервал) — для нічного CRON.
 */
export async function syncWialonFieldFuelForYesterday(
  now = new Date()
): Promise<SyncWialonFieldFuelResult> {
  return syncWialonFieldFuelForDate(shiftKyivYmd(todayKyivYmd(now), -1), now);
}

/**
 * Якщо останній sync_time за дату свіжіший за maxAgeMs — пропускаємо.
 * Інакше тягнемо Wialon → БД (однакові цифри в Паливі та на Карті полів).
 */
export async function ensureWialonFieldFuelFresh(
  dateYmd?: string,
  maxAgeMs = 5 * 60 * 1000,
  now = new Date()
): Promise<{ synced: boolean; result?: SyncWialonFieldFuelResult }> {
  const date = dateYmd && /^\d{4}-\d{2}-\d{2}$/.test(dateYmd)
    ? dateYmd
    : todayKyivYmd(now);
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("wialon_field_fuel_logs")
    .select("sync_time")
    .eq("date", date)
    .order("sync_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  const syncTime = data?.sync_time ? Date.parse(String(data.sync_time)) : NaN;
  if (
    Number.isFinite(syncTime) &&
    now.getTime() - syncTime < maxAgeMs
  ) {
    return { synced: false };
  }

  const result = await syncWialonFieldFuelForDate(date, now);
  return { synced: true, result };
}

export type FieldFuelDaySum = {
  /** YYYY-MM-DD Europe/Kyiv */
  date: string;
  /** Початок доби Києва (unix, включно) */
  fromUnix: number;
  /** Кінець доби Києва (unix, включно) */
  toUnix: number;
  /** Сума fuel_consumed, л */
  liters: number;
  /**
   * false = CRON ще не записав жодного рядка за цей день
   * (не плутати з реальною нульовою витратою).
   */
  hasData: boolean;
};

/**
 * Сума спаленого на полях за календарний день Europe/Kyiv.
 * Інтервал [00:00, 23:59:59] Києва; колонка `date` — фермерський день CRON.
 */
export async function sumFieldFuelConsumedForDate(
  dateYmd: string
): Promise<FieldFuelDaySum> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateYmd) ? dateYmd : todayKyivYmd();
  const { fromUnix, toUnix } = kyivDayBoundsUnix(date);
  const fromIso = new Date(fromUnix * 1000).toISOString();
  const toIso = new Date(toUnix * 1000).toISOString();

  const supabase = createServiceSupabase();

  // 1) Основний ключ CRON: date = YYYY-MM-DD у Києві
  let { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select("fuel_consumed")
    .eq("date", date);

  // 2) Fallback: sync_time в межах доби Києва (якщо date зсунуто TZ)
  if (!error && (data?.length ?? 0) === 0) {
    const bySync = await supabase
      .from("wialon_field_fuel_logs")
      .select("fuel_consumed")
      .gte("sync_time", fromIso)
      .lte("sync_time", toIso);
    if (!bySync.error) {
      data = bySync.data;
      error = bySync.error;
    }
  }

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { date, fromUnix, toUnix, liters: 0, hasData: false };
    }
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const sum = rows.reduce(
    (acc, row) => acc + (Number(row.fuel_consumed) || 0),
    0
  );

  return {
    date,
    fromUnix,
    toUnix,
    liters: Math.round(sum * 10) / 10,
    hasData: rows.length > 0,
  };
}

export function todayKyivDateString(now = new Date()): string {
  return todayKyivYmd(now);
}

export type FieldFuelPeriod = "today" | "yesterday" | "week" | "month";

export function resolveFieldFuelPeriodBounds(
  period: FieldFuelPeriod,
  now = new Date()
): { fromDate: string; toDate: string } {
  const today = todayKyivYmd(now);
  if (period === "yesterday") {
    const d = shiftKyivYmd(today, -1);
    return { fromDate: d, toDate: d };
  }
  if (period === "week") {
    return { fromDate: shiftKyivYmd(today, -6), toDate: today };
  }
  if (period === "month") {
    return { fromDate: shiftKyivYmd(today, -29), toDate: today };
  }
  return { fromDate: today, toDate: today };
}

/**
 * Сума спаленого за період Europe/Kyiv:
 * today / yesterday / week (7 днів) / month (30 днів).
 */
export async function sumFieldFuelConsumedForPeriod(
  period: FieldFuelPeriod,
  now = new Date()
): Promise<{
  period: FieldFuelPeriod;
  fromDate: string;
  toDate: string;
  liters: number;
  hasData: boolean;
}> {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(period, now);

  const supabase = createServiceSupabase();
  const { fromUnix } = kyivDayBoundsUnix(fromDate);
  const { toUnix } = kyivDayBoundsUnix(toDate);
  const fromIso = new Date(fromUnix * 1000).toISOString();
  const toIso = new Date(toUnix * 1000).toISOString();

  let { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select("fuel_consumed")
    .gte("date", fromDate)
    .lte("date", toDate);

  if (!error && (data?.length ?? 0) === 0) {
    const bySync = await supabase
      .from("wialon_field_fuel_logs")
      .select("fuel_consumed")
      .gte("sync_time", fromIso)
      .lte("sync_time", toIso);
    if (!bySync.error) {
      data = bySync.data;
      error = bySync.error;
    }
  }

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { period, fromDate, toDate, liters: 0, hasData: false };
    }
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const sum = rows.reduce(
    (acc, row) => acc + (Number(row.fuel_consumed) || 0),
    0
  );

  return {
    period,
    fromDate,
    toDate,
    liters: Math.round(sum * 10) / 10,
    hasData: rows.length > 0,
  };
}

export type FieldFuelBreakdownRow = {
  equipmentName: string;
  fieldName: string;
  liters: number;
  wialonUnitId: number | null;
  equipmentId: string | null;
  fieldId: string;
};

/**
 * Розшифровка: хто × на якому полі спалив за період.
 */
export async function listFieldFuelBreakdownForPeriod(
  period: FieldFuelPeriod,
  now = new Date()
): Promise<{
  period: FieldFuelPeriod;
  fromDate: string;
  toDate: string;
  rows: FieldFuelBreakdownRow[];
}> {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(period, now);
  const supabase = createServiceSupabase();

  let { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select(
      "fuel_consumed, wialon_unit_id, equipment_id, field_id, farm_fields(name), equipment(name)"
    )
    .gte("date", fromDate)
    .lte("date", toDate)
    .gt("fuel_consumed", 0);

  if (error && (error.message?.includes("wialon_unit_id") || error.code === "42703")) {
    const legacy = await supabase
      .from("wialon_field_fuel_logs")
      .select(
        "fuel_consumed, equipment_id, field_id, farm_fields(name), equipment(name)"
      )
      .gte("date", fromDate)
      .lte("date", toDate)
      .gt("fuel_consumed", 0);
    data = (legacy.data ?? []).map((row) => ({
      ...row,
      wialon_unit_id: null,
    }));
    error = legacy.error;
  }

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { period, fromDate, toDate, rows: [] };
    }
    throw new Error(error.message);
  }

  const relationName = (value: unknown): string | null => {
    if (value == null) return null;
    if (Array.isArray(value)) {
      const first = value[0] as { name?: unknown } | undefined;
      return first?.name != null ? String(first.name) : null;
    }
    if (typeof value === "object" && "name" in value) {
      const name = (value as { name?: unknown }).name;
      return name != null ? String(name) : null;
    }
    return null;
  };

  type Agg = FieldFuelBreakdownRow;
  const map = new Map<string, Agg>();

  for (const row of data ?? []) {
    const liters = Number(row.fuel_consumed) || 0;
    if (liters <= 0) continue;
    const fieldId = String(row.field_id);
    const equipmentId =
      row.equipment_id != null ? String(row.equipment_id) : null;
    const wialonUnitId =
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : null;
    const fieldName = relationName(row.farm_fields) || "Поле";
    const equipmentName =
      relationName(row.equipment) ||
      (wialonUnitId != null ? `Wialon #${wialonUnitId}` : "Техніка");
    const key = `${equipmentId ?? wialonUnitId ?? "x"}|${fieldId}`;
    const prev = map.get(key);
    if (prev) {
      prev.liters = Math.round((prev.liters + liters) * 10) / 10;
    } else {
      map.set(key, {
        equipmentName,
        fieldName,
        liters: Math.round(liters * 10) / 10,
        wialonUnitId,
        equipmentId,
        fieldId,
      });
    }
  }

  const rows = [...map.values()].sort((a, b) => b.liters - a.liters);
  return { period, fromDate, toDate, rows };
}

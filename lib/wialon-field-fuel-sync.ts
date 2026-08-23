/**
 * Фонова синхронізація: візити в геозонах полів + витрата палива за ДРП.
 * Ціну дизеля — lib/fuel-price.ts
 */

import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { booleanPointInPolygon, point } from "@turf/turf";

import type { FieldGeometry } from "@/lib/farm-fields";
import { currentAgroSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  estimateFuelConsumedByFls,
} from "@/lib/wialon-fuel";
import {
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

export {
  getLatestFuelPurchasePriceUah,
  resolveDieselPriceUah,
} from "@/lib/fuel-price";

/** Мін. тривалість візиту (сек) — відсікає GPS-шум */
const MIN_VISIT_SEC = 10 * 60;
/** Ліміт юнітів за один CRON-прогін */
const MAX_UNITS = 40;

export type WialonFieldFuelLogUpsert = {
  field_id: string;
  equipment_id: string;
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

type EquipmentRow = {
  id: string;
  name: string;
  wialon_id: number;
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

function readMsgParams(msg: WialonTrackMessage): Record<string, unknown> {
  const p = msg.p;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

function readFuelLiters(params: Record<string, unknown>): number | null {
  for (const key of [
    "fuel",
    "fuel_level",
    "rs",
    "rs485fuel",
    "adc1",
    "lls",
    "io_201",
  ] as const) {
    if (!(key in params)) continue;
    const raw = Number(params[key]);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
  }
  for (const [key, value] of Object.entries(params)) {
    if (!/fuel|палив|топлив|lls|^rs$/i.test(key)) continue;
    const raw = Number(value);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
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

function extractFuelSamples(messages: WialonTrackMessage[]): FuelSample[] {
  const out: FuelSample[] = [];
  for (const msg of messages) {
    const t = readMsgTime(msg);
    if (t == null) continue;
    const liters = readFuelLiters(readMsgParams(msg));
    if (liters == null) continue;
    out.push({ t, liters });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
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
    if (consumedLiters != null && consumedLiters > 0) {
      total += consumedLiters;
    }
  }
  return Math.round(total * 10) / 10;
}

async function loadMappings(): Promise<{
  equipment: EquipmentRow[];
  fields: FieldRow[];
}> {
  const supabase = createServiceSupabase();

  const [eqRes, fieldRes] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("is_active", true)
      .not("wialon_id", "is", null)
      .limit(MAX_UNITS),
    supabase
      .from("farm_fields")
      .select("id, name, wialon_zone_id, geometry")
      .not("geometry", "is", null),
  ]);

  if (eqRes.error) throw new Error(`equipment: ${eqRes.error.message}`);
  if (fieldRes.error) throw new Error(`farm_fields: ${fieldRes.error.message}`);

  const equipment: EquipmentRow[] = (eqRes.data ?? [])
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      wialon_id: Number(row.wialon_id),
    }))
    .filter((row) => Number.isFinite(row.wialon_id) && row.wialon_id > 0);

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

  return { equipment, fields };
}

/**
 * Основний прогін CRON: зібрати витрату за сьогодні й upsert у БД.
 */
export async function syncWialonFieldFuelForToday(
  now = new Date()
): Promise<SyncWialonFieldFuelResult> {
  const { date, fromUnix, toUnix } = kyivTodayParts(now);
  const errors: string[] = [];
  const { equipment, fields } = await loadMappings();

  if (equipment.length === 0 || fields.length === 0) {
    return {
      ok: true,
      date,
      fromUnix,
      toUnix,
      unitsProcessed: 0,
      upserted: 0,
      skipped: 0,
      errors: [
        equipment.length === 0
          ? "Немає активної техніки з wialon_id"
          : "Немає полів з geometry",
      ],
    };
  }

  const eid = await wialonLogin();
  const syncTime = new Date().toISOString();
  const season = currentAgroSeason(now);
  const upserts: WialonFieldFuelLogUpsert[] = [];
  let skipped = 0;

  for (const unit of equipment) {
    try {
      let messages = await loadWialonUnitMessages(
        eid,
        unit.wialon_id,
        fromUnix,
        toUnix
      );
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

      const fuelSamples = extractFuelSamples(messages);

      for (const field of fields) {
        if (!field.geometry) continue;
        const visits = detectGeofenceVisits(messages, field.geometry);
        if (visits.length === 0) continue;

        const fuel = fuelConsumedInWindows(fuelSamples, visits);
        if (fuel <= 0) {
          // Візит був, але ДРП не віддав рівні — пишемо 0, щоб бачити sync
          upserts.push({
            field_id: field.id,
            equipment_id: unit.id,
            date,
            fuel_consumed: 0,
            sync_time: syncTime,
            season,
          });
          continue;
        }

        upserts.push({
          field_id: field.id,
          equipment_id: unit.id,
          date,
          fuel_consumed: fuel,
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
    const supabase = createServiceSupabase();
    let { error, count } = await supabase
      .from("wialon_field_fuel_logs")
      .upsert(upserts, {
        onConflict: "field_id,equipment_id,date,season",
        count: "exact",
      });

    // До міграції season — upsert без колонки
    if (error && error.message?.includes("season")) {
      const legacy = upserts.map(({ season: _s, ...rest }) => rest);
      const retry = await supabase.from("wialon_field_fuel_logs").upsert(legacy, {
        onConflict: "field_id,equipment_id,date",
        count: "exact",
      });
      error = retry.error;
      count = retry.count;
    }

    if (error) {
      throw new Error(`upsert wialon_field_fuel_logs: ${error.message}`);
    }
    upserted = count ?? upserts.length;
  }

  return {
    ok: true,
    date,
    fromUnix,
    toUnix,
    unitsProcessed: equipment.length,
    upserted,
    skipped,
    errors,
  };
}

/** Сума спаленого на полях за календарний день (Київ). */
export async function sumFieldFuelConsumedForDate(
  dateYmd: string
): Promise<number> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select("fuel_consumed")
    .eq("date", dateYmd);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return 0;
    throw new Error(error.message);
  }

  const sum = (data ?? []).reduce(
    (acc, row) => acc + (Number(row.fuel_consumed) || 0),
    0
  );
  return Math.round(sum * 10) / 10;
}

export function todayKyivDateString(now = new Date()): string {
  return kyivTodayParts(now).date;
}

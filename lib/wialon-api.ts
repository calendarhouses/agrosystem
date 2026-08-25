/**
 * Wialon API helpers для Zero-Data Entry (заправки).
 * READ-ONLY: messages/load_interval + зіставлення з equipment.
 *
 * Алгоритм «Заправки / fuel_fillings»: стрибки рівня ДУТ у повідомленнях
 * (той самий принцип, що таблиця unit_fillings у звітах Wialon).
 */

import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

/** Мін. стрибок рівня (л) = заправка, не шум датчика */
const MIN_FILLING_JUMP_L = 15;
/** Паралельних запитів messages/load_interval */
const UNIT_CONCURRENCY = 4;
/** Макс. юнітів за один прохід (захист від timeout) */
const MAX_UNITS = 40;

export type WialonRefuelingLocation = {
  lat: number | null;
  lng: number | null;
  /** Текстова мітка (геозона / «GPS»), якщо є */
  label: string | null;
};

export type WialonRefuelingEvent = {
  /** Wialon unit id */
  unitId: number;
  /** UUID equipment, якщо є мапінг */
  equipmentId: string | null;
  /** Зрозуміла назва (equipment.name або Wialon nm) */
  equipmentName: string;
  /** Unix time (сек) моменту заправки */
  time: number;
  /** Обʼєм залитого палива, л */
  volume: number;
  location: WialonRefuelingLocation;
};

type EquipmentMapRow = {
  id: string;
  name: string;
  wialonId: number;
};

type FuelSample = {
  t: number;
  liters: number;
  lat: number | null;
  lng: number | null;
};

function readMessageParams(
  msg: WialonTrackMessage
): Record<string, unknown> {
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

function readMessagePos(
  msg: WialonTrackMessage
): { lat: number; lng: number } | null {
  const pos = msg.pos;
  if (!pos || typeof pos !== "object") return null;
  const lng = Number((pos as { x?: unknown }).x);
  const lat = Number((pos as { y?: unknown }).y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng <= 0 || lat <= 0) return null;
  return { lat, lng };
}

function samplesFromMessages(messages: WialonTrackMessage[]): FuelSample[] {
  const out: FuelSample[] = [];
  for (const msg of messages) {
    const t = typeof msg.t === "number" && Number.isFinite(msg.t) ? msg.t : null;
    if (t == null || t <= 0) continue;
    const liters = readFuelLiters(readMessageParams(msg));
    if (liters == null) continue;
    const pos = readMessagePos(msg);
    out.push({
      t,
      liters,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Детекція заправок (fuel_fillings): стрибок рівня ≥ MIN_FILLING_JUMP_L.
 */
export function detectFillingsFromSamples(
  samples: FuelSample[],
  unitId: number,
  equipment: EquipmentMapRow | null,
  fallbackName: string
): WialonRefuelingEvent[] {
  if (samples.length < 2) return [];

  const events: WialonRefuelingEvent[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    const delta = curr.liters - prev.liters;
    if (delta < MIN_FILLING_JUMP_L) continue;

    const volume = Math.round(delta * 10) / 10;
    const hasCoords = curr.lat != null && curr.lng != null;
    events.push({
      unitId,
      equipmentId: equipment?.id ?? null,
      equipmentName: (equipment?.name ?? fallbackName).trim() || `Unit ${unitId}`,
      time: curr.t,
      volume,
      location: {
        lat: curr.lat,
        lng: curr.lng,
        label: hasCoords ? "GPS" : null,
      },
    });
  }
  return events;
}

async function loadEquipmentByWialonId(): Promise<Map<number, EquipmentMapRow>> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("equipment")
    .select("id, name, wialon_id")
    .not("wialon_id", "is", null)
    .eq("is_active", true);

  const map = new Map<number, EquipmentMapRow>();
  if (error) {
    // is_active може відсутній — fallback без фільтра
    const { data: fallback, error: fallbackError } = await supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .not("wialon_id", "is", null);
    if (fallbackError || !fallback) {
      console.error("[wialon-api] equipment load:", error.message);
      return map;
    }
    for (const row of fallback) {
      const wid = Number(row.wialon_id);
      if (!Number.isFinite(wid) || wid <= 0) continue;
      const name = String(row.name ?? "").trim();
      if (isFuelDeliveryUnit(name)) continue;
      map.set(wid, {
        id: String(row.id),
        name: name || `Unit ${wid}`,
        wialonId: wid,
      });
    }
    return map;
  }

  for (const row of data ?? []) {
    const wid = Number(row.wialon_id);
    if (!Number.isFinite(wid) || wid <= 0) continue;
    const name = String(row.name ?? "").trim();
    if (isFuelDeliveryUnit(name)) continue;
    map.set(wid, {
      id: String(row.id),
      name: name || `Unit ${wid}`,
      wialonId: wid,
    });
  }
  return map;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]!);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => run()
  );
  await Promise.all(runners);
  return results;
}

/**
 * Заправки з Wialon за інтервал (Unix sec).
 * Обходить активну техніку з `equipment.wialon_id` (без бензовозів).
 */
export async function getWialonRefuelings(
  startTime: number,
  endTime: number
): Promise<WialonRefuelingEvent[]> {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime <= startTime
  ) {
    throw new Error("Некоректний інтервал getWialonRefuelings");
  }

  const equipmentByWialon = await loadEquipmentByWialonId();
  const unitIds = Array.from(equipmentByWialon.keys())
    .sort((a, b) => a - b)
    .slice(0, MAX_UNITS);

  if (unitIds.length === 0) {
    return [];
  }

  const eid = await wialonLogin();

  const perUnit = await mapPool(unitIds, UNIT_CONCURRENCY, async (unitId) => {
    const equipment = equipmentByWialon.get(unitId) ?? null;
    try {
      let messages = await loadWialonUnitMessages(
        eid,
        unitId,
        startTime,
        endTime
      );
      if (messages.length === 0) {
        messages = await loadWialonUnitMessages(eid, unitId, startTime, endTime, {
          flags: 1,
          flagsMask: 0,
        });
      }
      const samples = samplesFromMessages(messages);
      return detectFillingsFromSamples(
        samples,
        unitId,
        equipment,
        equipment?.name ?? `Unit ${unitId}`
      );
    } catch (err) {
      console.error("[wialon-api] fillings unit failed", unitId, err);
      return [] as WialonRefuelingEvent[];
    }
  });

  return perUnit
    .flat()
    .filter((e) => e.time >= startTime && e.time <= endTime)
    .sort((a, b) => b.time - a.time);
}

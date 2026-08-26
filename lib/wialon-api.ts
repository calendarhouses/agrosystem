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
  detectFuelFills,
  extractTimedFuelSamples,
} from "@/lib/wialon-fuel-decode";
import {
  getWialonUnitSensors,
  listUnitSensors,
  listWialonUnitBasics,
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

/** Паралельних юнітів (Wialon LIMIT api_concurrent) */
const UNIT_CONCURRENCY = 2;
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

function samplesFromMessages(
  messages: WialonTrackMessage[],
  sensors: ReturnType<typeof listUnitSensors> = []
): FuelSample[] {
  return extractTimedFuelSamples(messages, sensors, {
    includePosition: true,
  }).map((s) => ({
    t: s.t,
    liters: s.liters,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  }));
}

/** Заправки юніта як події журналу (спільний детектор з технікою/полями). */
export function detectFillingsFromSamples(
  samples: FuelSample[],
  unitId: number,
  equipment: EquipmentMapRow | null,
  fallbackName: string
): WialonRefuelingEvent[] {
  const name = (equipment?.name ?? fallbackName).trim() || `Unit ${unitId}`;

  return detectFuelFills(samples).map((fill) => {
    const at = samples[fill.index]!;
    const hasCoords = at.lat != null && at.lng != null;
    return {
      unitId,
      equipmentId: equipment?.id ?? null,
      equipmentName: name,
      time: at.t,
      volume: fill.volume,
      location: {
        lat: at.lat ?? null,
        lng: at.lng ?? null,
        label: hasCoords ? "GPS" : null,
      },
    };
  });
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
 * Усі юніти флоту (крім бензовозів), не лише mapped equipment.
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
  const eid = await wialonLogin();
  const basics = await listWialonUnitBasics(eid);
  const units = basics
    .filter((u) => !isFuelDeliveryUnit(u.nm))
    .slice(0, MAX_UNITS);

  if (units.length === 0) {
    return [];
  }

  const perUnit = await mapPool(units, UNIT_CONCURRENCY, async (unit) => {
    const equipment = equipmentByWialon.get(unit.id) ?? null;
    try {
      // Послідовно — менше api_concurrent від Wialon
      let messages = await loadWialonUnitMessages(
        eid,
        unit.id,
        startTime,
        endTime
      );
      if (messages.length === 0) {
        messages = await loadWialonUnitMessages(eid, unit.id, startTime, endTime, {
          flags: 1,
          flagsMask: 0,
        });
      }
      const unitWithSensors = await getWialonUnitSensors(eid, unit.id);
      const sensors = unitWithSensors
        ? listUnitSensors(unitWithSensors)
        : [];
      const samples = samplesFromMessages(messages, sensors);
      return detectFillingsFromSamples(
        samples,
        unit.id,
        equipment,
        equipment?.name ??
          (String(unit.nm ?? "").trim() || `Unit ${unit.id}`)
      );
    } catch (err) {
      console.error("[wialon-api] fillings unit failed", unit.id, err);
      return [] as WialonRefuelingEvent[];
    }
  });

  return perUnit
    .flat()
    .filter((e) => e.time >= startTime && e.time <= endTime)
    .sort((a, b) => b.time - a.time);
}

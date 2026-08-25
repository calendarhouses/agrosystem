/**
 * Wialon API helpers для Zero-Data Entry (заправки).
 * READ-ONLY: messages/load_interval + зіставлення з equipment.
 *
 * Алгоритм «Заправки / fuel_fillings»: стрибки рівня ДУТ у повідомленнях
 * (той самий принцип, що таблиця unit_fillings у звітах Wialon).
 */

import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import { createServiceSupabase } from "@/lib/supabase/server";
import { extractTimedFuelSamples } from "@/lib/wialon-fuel-decode";
import {
  getWialonUnitSensors,
  listUnitSensors,
  listWialonUnitBasics,
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

/** Мін. стрибок рівня (л) = заправка, не шум датчика */
const MIN_FILLING_JUMP_L = 25;
/** Один стрибок більше — сміття датчика, не заправка */
const MAX_FILLING_JUMP_L = 400;
/** Зшивати стрибки однієї заправки (сек) */
const FILL_CLUSTER_SEC = 25 * 60;
/** Після заправки рівень має втриматись (сек) */
const FILL_CONFIRM_SEC = 8 * 60;
/** Допуск падіння після заправки (л) — інакше це спайк ДУТ */
const FILL_CONFIRM_DROP_L = 20;
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

/**
 * Детекція заправок: кластер стрибків ДУТ + підтвердження, що рівень утримався.
 * Сирі «+15 л» між повідомленнями без confirm — шум, не заправка.
 */
export function detectFillingsFromSamples(
  samples: FuelSample[],
  unitId: number,
  equipment: EquipmentMapRow | null,
  fallbackName: string
): WialonRefuelingEvent[] {
  if (samples.length < 3) return [];

  type Jump = { index: number; delta: number };
  const jumps: Jump[] = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i]!.liters - samples[i - 1]!.liters;
    if (delta >= MIN_FILLING_JUMP_L && delta <= MAX_FILLING_JUMP_L) {
      jumps.push({ index: i, delta });
    }
  }
  if (jumps.length === 0) return [];

  const clusters: Array<{ startIdx: number; endIdx: number }> = [];
  let clusterStart = jumps[0]!.index;
  let clusterEnd = jumps[0]!.index;
  let prevJumpT = samples[jumps[0]!.index]!.t;

  for (let j = 1; j < jumps.length; j++) {
    const jump = jumps[j]!;
    const t = samples[jump.index]!.t;
    if (t - prevJumpT <= FILL_CLUSTER_SEC) {
      clusterEnd = jump.index;
      prevJumpT = t;
      continue;
    }
    clusters.push({ startIdx: clusterStart, endIdx: clusterEnd });
    clusterStart = jump.index;
    clusterEnd = jump.index;
    prevJumpT = t;
  }
  clusters.push({ startIdx: clusterStart, endIdx: clusterEnd });

  const events: WialonRefuelingEvent[] = [];
  const name =
    (equipment?.name ?? fallbackName).trim() || `Unit ${unitId}`;

  for (const cluster of clusters) {
    const beforeIdx = Math.max(0, cluster.startIdx - 1);
    const baseline = samples[beforeIdx]!.liters;
    const peakSample = samples[cluster.endIdx]!;
    // Макс. у вікні кластера (інколи пік раніше за останній стрибок)
    let peak = peakSample.liters;
    let peakIdx = cluster.endIdx;
    for (let i = cluster.startIdx; i <= cluster.endIdx; i++) {
      if (samples[i]!.liters > peak) {
        peak = samples[i]!.liters;
        peakIdx = i;
      }
    }
    const volume = Math.round((peak - baseline) * 10) / 10;
    if (volume < MIN_FILLING_JUMP_L || volume > MAX_FILLING_JUMP_L * 1.5) {
      continue;
    }

    // Підтвердження: після піку рівень не відкотився назад
    const peakT = samples[peakIdx]!.t;
    const confirmUntil = peakT + FILL_CONFIRM_SEC;
    const after: number[] = [];
    for (let i = peakIdx + 1; i < samples.length; i++) {
      const s = samples[i]!;
      if (s.t > confirmUntil) break;
      after.push(s.liters);
    }
    if (after.length === 0) {
      // Кінець доби / мало точок — беремо лише великі заправки
      if (volume < 40) continue;
    } else {
      const held = after.reduce((a, b) => a + b, 0) / after.length;
      if (peak - held > FILL_CONFIRM_DROP_L) continue;
    }

    const at = samples[peakIdx]!;
    const hasCoords = at.lat != null && at.lng != null;
    events.push({
      unitId,
      equipmentId: equipment?.id ?? null,
      equipmentName: name,
      time: at.t,
      volume,
      location: {
        lat: at.lat,
        lng: at.lng,
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

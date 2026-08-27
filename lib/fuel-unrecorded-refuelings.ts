/**
 * Smart Matcher: Wialon-заправки, яких ще немає в fuel_transactions (outbound).
 */

import {
  getWialonRefuelings,
  type WialonRefuelingEvent,
} from "@/lib/wialon-api";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Вікно зіставлення з ручним outbound */
export const REFUEL_MATCH_WINDOW_SEC = 45 * 60;
/** Допуск обʼєму (±10%) */
export const REFUEL_MATCH_VOLUME_TOLERANCE = 0.1;
/** За замовчуванням дивимось 7 днів (168 год) */
export const UNRECORDED_LOOKBACK_HOURS = 168;

export type UnrecordedRefueling = WialonRefuelingEvent & {
  /** ISO час для UI */
  timeIso: string;
};

type OutboundRow = {
  wialonUnitId: number;
  amountLiters: number;
  timeUnix: number;
};

function volumesMatch(a: number, b: number): boolean {
  const base = Math.max(a, b, 1);
  return Math.abs(a - b) / base <= REFUEL_MATCH_VOLUME_TOLERANCE;
}

function isMatchedByManual(
  event: WialonRefuelingEvent,
  outbound: OutboundRow[]
): boolean {
  for (const tx of outbound) {
    if (tx.wialonUnitId !== event.unitId) continue;
    if (Math.abs(tx.timeUnix - event.time) > REFUEL_MATCH_WINDOW_SEC) {
      continue;
    }
    if (!volumesMatch(tx.amountLiters, event.volume)) continue;
    return true;
  }
  return false;
}

/** Відхилені оператором події (таблиця 037); без міграції — порожньо */
async function loadDismissedInRange(
  fromIso: string,
  toIso: string
): Promise<Array<{ unitId: number; timeUnix: number }>> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_radar_dismissed")
    .select("wialon_unit_id, event_time")
    .gte("event_time", fromIso)
    .lte("event_time", toIso);

  if (error || !data) return [];

  const rows: Array<{ unitId: number; timeUnix: number }> = [];
  for (const row of data) {
    const unitId = Number(row.wialon_unit_id);
    const at = new Date(String(row.event_time));
    if (!Number.isFinite(unitId) || Number.isNaN(at.getTime())) continue;
    rows.push({ unitId, timeUnix: Math.floor(at.getTime() / 1000) });
  }
  return rows;
}

/** Позначити подію ДУТ як хибну — радар більше її не покаже. */
export async function dismissRefueling(input: {
  unitId: number;
  timeIso: string;
  volumeLiters: number;
  reason?: string;
}): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("fuel_radar_dismissed").upsert(
    {
      wialon_unit_id: input.unitId,
      event_time: input.timeIso,
      volume_liters: Math.max(0, input.volumeLiters),
      reason: input.reason?.trim() || null,
    },
    { onConflict: "wialon_unit_id,event_time" }
  );
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      throw new Error(
        "Таблиця fuel_radar_dismissed відсутня. Виконай міграцію 037."
      );
    }
    throw new Error(error.message);
  }
}

async function loadOutboundInRange(
  fromIso: string,
  toIso: string
): Promise<OutboundRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select("wialon_unit_id, equipment_id, amount_liters, transaction_date")
    .eq("transaction_type", "outbound")
    .gte("transaction_date", fromIso)
    .lte("transaction_date", toIso);

  if (error) {
    // До 040 — без equipment_id
    if (error.message?.includes("equipment_id") || error.code === "42703") {
      const legacy = await supabase
        .from("fuel_transactions")
        .select("wialon_unit_id, amount_liters, transaction_date")
        .eq("transaction_type", "outbound")
        .not("wialon_unit_id", "is", null)
        .gte("transaction_date", fromIso)
        .lte("transaction_date", toIso);
      if (legacy.error) throw new Error(legacy.error.message);
      return mapOutboundRows(legacy.data ?? [], new Map());
    }
    throw new Error(error.message);
  }

  const eqIds = [
    ...new Set(
      (data ?? [])
        .map((r) => (r.equipment_id != null ? String(r.equipment_id) : ""))
        .filter(Boolean)
    ),
  ];
  const wialonByEquipment = new Map<string, number>();
  if (eqIds.length > 0) {
    const { data: eqRows } = await supabase
      .from("equipment")
      .select("id, wialon_id")
      .in("id", eqIds);
    for (const row of eqRows ?? []) {
      const wid = Number(row.wialon_id);
      if (Number.isFinite(wid) && wid > 0) {
        wialonByEquipment.set(String(row.id), wid);
      }
    }
  }

  return mapOutboundRows(data ?? [], wialonByEquipment);
}

function mapOutboundRows(
  data: Array<Record<string, unknown>>,
  wialonByEquipment: Map<string, number>
): OutboundRow[] {
  const rows: OutboundRow[] = [];
  for (const row of data) {
    const liters = Number(row.amount_liters);
    const at = new Date(String(row.transaction_date));
    if (!Number.isFinite(liters) || liters <= 0) continue;
    if (Number.isNaN(at.getTime())) continue;
    let unitId =
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : 0;
    if (unitId <= 0 && row.equipment_id != null) {
      unitId = wialonByEquipment.get(String(row.equipment_id)) ?? 0;
    }
    if (unitId <= 0) continue;
    rows.push({
      wialonUnitId: unitId,
      amountLiters: liters,
      timeUnix: Math.floor(at.getTime() / 1000),
    });
  }
  return rows;
}

/**
 * Необліковані заправки Wialon за lookback годин
 * (немає outbound на ту ж техніку ±45 хв і ±10% обʼєму).
 */
export async function findUnrecordedRefuelings(options?: {
  lookbackHours?: number;
  now?: Date;
}): Promise<UnrecordedRefueling[]> {
  const lookbackHours = options?.lookbackHours ?? UNRECORDED_LOOKBACK_HOURS;
  const now = options?.now ?? new Date();
  const endMs = now.getTime();
  const startMs = endMs - lookbackHours * 60 * 60 * 1000;

  const startUnix = Math.floor(startMs / 1000);
  const endUnix = Math.floor(endMs / 1000);
  const fromIso = new Date(startMs).toISOString();
  const toIso = new Date(endMs).toISOString();

  const [wialonEvents, outbound, dismissed] = await Promise.all([
    getWialonRefuelings(startUnix, endUnix),
    loadOutboundInRange(fromIso, toIso),
    loadDismissedInRange(fromIso, toIso),
  ]);

  const isDismissed = (event: WialonRefuelingEvent) =>
    dismissed.some(
      (d) =>
        d.unitId === event.unitId &&
        Math.abs(d.timeUnix - event.time) <= REFUEL_MATCH_WINDOW_SEC
    );

  return wialonEvents
    .filter((event) => !isMatchedByManual(event, outbound))
    .filter((event) => !isDismissed(event))
    .map((event) => ({
      ...event,
      timeIso: new Date(event.time * 1000).toISOString(),
    }));
}

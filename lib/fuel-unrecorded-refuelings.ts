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
/** За замовчуванням дивимось 48 год */
export const UNRECORDED_LOOKBACK_HOURS = 48;

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

async function loadOutboundInRange(
  fromIso: string,
  toIso: string
): Promise<OutboundRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select("wialon_unit_id, amount_liters, transaction_date")
    .eq("transaction_type", "outbound")
    .not("wialon_unit_id", "is", null)
    .gte("transaction_date", fromIso)
    .lte("transaction_date", toIso);

  if (error) {
    throw new Error(error.message);
  }

  const rows: OutboundRow[] = [];
  for (const row of data ?? []) {
    const unitId = Number(row.wialon_unit_id);
    const liters = Number(row.amount_liters);
    const at = new Date(String(row.transaction_date));
    if (!Number.isFinite(unitId) || unitId <= 0) continue;
    if (!Number.isFinite(liters) || liters <= 0) continue;
    if (Number.isNaN(at.getTime())) continue;
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

  const [wialonEvents, outbound] = await Promise.all([
    getWialonRefuelings(startUnix, endUnix),
    loadOutboundInRange(fromIso, toIso),
  ]);

  return wialonEvents
    .filter((event) => !isMatchedByManual(event, outbound))
    .map((event) => ({
      ...event,
      timeIso: new Date(event.time * 1000).toISOString(),
    }));
}

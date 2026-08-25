/**
 * Суми заправок (outbound) з нашого журналу fuel_transactions.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import {
  resolveFieldFuelPeriodBounds,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";

export type RefuelBreakdownRow = {
  equipmentName: string;
  liters: number;
  wialonUnitId: number | null;
};

export async function sumOutboundRefueledForPeriod(
  period: FieldFuelPeriod,
  now = new Date()
): Promise<{
  period: FieldFuelPeriod;
  fromDate: string;
  toDate: string;
  liters: number;
  hasData: boolean;
  rows: RefuelBreakdownRow[];
}> {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(period, now);
  const { fromUnix } = kyivDayBoundsUnix(fromDate);
  const { toUnix } = kyivDayBoundsUnix(toDate);
  const fromIso = new Date(fromUnix * 1000).toISOString();
  const toIso = new Date(toUnix * 1000).toISOString();

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select("amount_liters, wialon_unit_id, operator_name")
    .eq("transaction_type", "outbound")
    .gte("transaction_date", fromIso)
    .lte("transaction_date", toIso);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return {
        period,
        fromDate,
        toDate,
        liters: 0,
        hasData: false,
        rows: [],
      };
    }
    throw new Error(error.message);
  }

  const rowsRaw = data ?? [];
  const liters = Math.round(
    rowsRaw.reduce((acc, row) => acc + (Number(row.amount_liters) || 0), 0) * 10
  ) / 10;

  // Імена техніки з equipment за wialon_id
  const wialonIds = [
    ...new Set(
      rowsRaw
        .map((r) => Number(r.wialon_unit_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const nameByWialon = new Map<number, string>();
  if (wialonIds.length > 0) {
    const { data: eqRows } = await supabase
      .from("equipment")
      .select("name, wialon_id")
      .in("wialon_id", wialonIds);
    for (const row of eqRows ?? []) {
      const wid = Number(row.wialon_id);
      if (Number.isFinite(wid)) {
        nameByWialon.set(wid, String(row.name ?? "").trim() || `Wialon #${wid}`);
      }
    }
  }

  const byKey = new Map<string, RefuelBreakdownRow>();
  for (const row of rowsRaw) {
    const amount = Number(row.amount_liters) || 0;
    if (amount <= 0) continue;
    const wid =
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : null;
    const equipmentName =
      (wid != null ? nameByWialon.get(wid) : null) ||
      (row.operator_name != null && String(row.operator_name).trim()
        ? String(row.operator_name).trim()
        : null) ||
      (wid != null ? `Wialon #${wid}` : "Техніка");
    const key = wid != null ? `w:${wid}` : `n:${equipmentName}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.liters = Math.round((prev.liters + amount) * 10) / 10;
    } else {
      byKey.set(key, {
        equipmentName,
        liters: Math.round(amount * 10) / 10,
        wialonUnitId: wid,
      });
    }
  }

  const rows = [...byKey.values()].sort((a, b) => b.liters - a.liters);

  return {
    period,
    fromDate,
    toDate,
    liters,
    hasData: rowsRaw.length > 0,
    rows,
  };
}

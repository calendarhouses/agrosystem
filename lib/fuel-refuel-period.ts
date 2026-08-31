/**
 * KPI «Заправлено»: fuel_filled з денного кешу + ручні outbound без ДУТ.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getWialonRefuelings } from "@/lib/wialon-api";
import {
  resolveFieldFuelPeriodBounds,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { sumFleetFuelFilledForPeriod } from "@/lib/wialon-equipment-day-sync";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";

export type RefuelBreakdownRow = {
  equipmentName: string;
  liters: number;
  wialonUnitId: number | null;
  /** Джерело в розшифровці */
  source: "wialon" | "manual" | "mixed";
};

type ManualRow = {
  wialonUnitId: number | null;
  amountLiters: number;
  timeUnix: number;
  operatorName: string | null;
};

/**
 * Заправлено за період =
 *   Σ fuel_filled з wialon_equipment_day_stats (після sync)
 * + ручні outbound для техніки без ДУТ або без wialon_unit_id
 * Live Wialon — лише fallback для today/yesterday, якщо БД порожня.
 */
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
  wialonLiters: number;
  manualOnlyLiters: number;
}> {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(period, now);
  const { fromUnix } = kyivDayBoundsUnix(fromDate);
  const { toUnix } = kyivDayBoundsUnix(toDate);
  const fromIso = new Date(fromUnix * 1000).toISOString();
  const toIso = new Date(toUnix * 1000).toISOString();
  const spanSec = toUnix - fromUnix;

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(
      "amount_liters, wialon_unit_id, equipment_id, operator_name, transaction_date"
    )
    .eq("transaction_type", "outbound")
    .gte("transaction_date", fromIso)
    .lte("transaction_date", toIso);

  if (error && error.code !== "PGRST205" && error.code !== "42P01") {
    if (error.message?.includes("equipment_id") || error.code === "42703") {
      // fall through with legacy select below
    } else {
      throw new Error(error.message);
    }
  }

  let txRows: Array<{
    amount_liters: unknown;
    wialon_unit_id: unknown;
    equipment_id?: unknown;
    operator_name: unknown;
    transaction_date: unknown;
  }> = data ?? [];
  if (error && (error.message?.includes("equipment_id") || error.code === "42703")) {
    const legacy = await supabase
      .from("fuel_transactions")
      .select("amount_liters, wialon_unit_id, operator_name, transaction_date")
      .eq("transaction_type", "outbound")
      .gte("transaction_date", fromIso)
      .lte("transaction_date", toIso);
    if (legacy.error && legacy.error.code !== "PGRST205" && legacy.error.code !== "42P01") {
      throw new Error(legacy.error.message);
    }
    txRows = legacy.data ?? [];
  }

  const eqIds = [
    ...new Set(
      txRows
        .map((r) =>
          "equipment_id" in r && r.equipment_id != null
            ? String(r.equipment_id)
            : ""
        )
        .filter(Boolean)
    ),
  ];
  const wialonByEquipment = new Map<string, number>();
  const nameByWialon = new Map<number, string>();
  if (eqIds.length > 0) {
    const { data: eqRows } = await supabase
      .from("equipment")
      .select("id, wialon_id, name")
      .in("id", eqIds);
    for (const row of eqRows ?? []) {
      const wid = Number(row.wialon_id);
      if (Number.isFinite(wid) && wid > 0) {
        wialonByEquipment.set(String(row.id), wid);
        const nm = String(row.name ?? "").trim();
        if (nm) nameByWialon.set(wid, nm);
      }
    }
  }

  const manual: ManualRow[] = [];
  for (const row of txRows) {
    const liters = Number(row.amount_liters) || 0;
    if (liters <= 0) continue;
    const at = new Date(String(row.transaction_date));
    if (Number.isNaN(at.getTime())) continue;
    let wid =
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : null;
    if ((wid == null || wid <= 0) && "equipment_id" in row && row.equipment_id) {
      wid = wialonByEquipment.get(String(row.equipment_id)) ?? null;
    }
    manual.push({
      wialonUnitId: wid != null && wid > 0 ? wid : null,
      amountLiters: liters,
      timeUnix: Math.floor(at.getTime() / 1000),
      operatorName:
        row.operator_name != null && String(row.operator_name).trim()
          ? String(row.operator_name).trim()
          : null,
    });
  }

  const dbFilled = await sumFleetFuelFilledForPeriod(fromDate, toDate);
  const byKey = new Map<string, RefuelBreakdownRow>();

  const bump = (
    key: string,
    equipmentName: string,
    wialonUnitId: number | null,
    amount: number,
    source: RefuelBreakdownRow["source"]
  ) => {
    const prev = byKey.get(key);
    if (prev) {
      prev.liters = Math.round((prev.liters + amount) * 10) / 10;
      if (prev.source !== source) prev.source = "mixed";
    } else {
      byKey.set(key, {
        equipmentName,
        liters: Math.round(amount * 10) / 10,
        wialonUnitId,
        source,
      });
    }
  };

  let wialonLiters = dbFilled.liters;

  // Fallback: today/yesterday без даних у БД — live ДУТ
  if (
    wialonLiters <= 0 &&
    spanSec <= 2 * 86_400 &&
    period !== "week" &&
    period !== "month" &&
    period !== "season"
  ) {
    try {
      const live = await getWialonRefuelings(fromUnix, toUnix);
      wialonLiters = live.reduce((acc, e) => acc + (e.volume > 0 ? e.volume : 0), 0);
      wialonLiters = Math.round(wialonLiters * 10) / 10;
      for (const event of live) {
        if (event.volume <= 0) continue;
        bump(
          `w:${event.unitId}`,
          event.equipmentName,
          event.unitId,
          event.volume,
          "wialon"
        );
      }
    } catch (err) {
      console.error(
        "[fuel-refuel-period] Wialon fallback",
        err instanceof Error ? err.message : err
      );
    }
  } else {
    for (const row of dbFilled.rows) {
      bump(`w:${row.wialonUnitId}`, row.equipmentName, row.wialonUnitId, row.liters, "wialon");
    }
  }

  // Ручні outbound: лише без ДУТ (щоб не дублювати journal ↔ fuel_filled)
  let manualOnlyLiters = 0;
  for (let i = 0; i < manual.length; i++) {
    const tx = manual[i]!;
    if (tx.wialonUnitId != null && dbFilled.dutUnitIds.has(tx.wialonUnitId)) {
      continue;
    }
    manualOnlyLiters += tx.amountLiters;
    const name =
      (tx.wialonUnitId != null ? nameByWialon.get(tx.wialonUnitId) : null) ||
      tx.operatorName ||
      (tx.wialonUnitId != null ? `Wialon #${tx.wialonUnitId}` : "Техніка");
    const key =
      tx.wialonUnitId != null ? `m:${tx.wialonUnitId}` : `m:${name}:${i}`;
    bump(key, name, tx.wialonUnitId, tx.amountLiters, "manual");
  }

  const liters = Math.round((wialonLiters + manualOnlyLiters) * 10) / 10;
  const rows = [...byKey.values()].sort((a, b) => b.liters - a.liters);

  return {
    period,
    fromDate,
    toDate,
    liters,
    hasData: liters > 0 || manual.length > 0 || dbFilled.hasData,
    rows,
    wialonLiters,
    manualOnlyLiters: Math.round(manualOnlyLiters * 10) / 10,
  };
}

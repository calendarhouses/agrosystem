/**
 * KPI «Заправлено»: стрибки ДУТ з Wialon + ручні outbound без дубля.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getWialonRefuelings } from "@/lib/wialon-api";
import {
  resolveFieldFuelPeriodBounds,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";

/** Вікно зіставлення з ручним outbound */
const REFUEL_MATCH_WINDOW_SEC = 45 * 60;
/** Допуск обʼєму (±10%) */
const REFUEL_MATCH_VOLUME_TOLERANCE = 0.1;

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

function volumesMatch(a: number, b: number): boolean {
  const base = Math.max(a, b, 1);
  return Math.abs(a - b) / base <= REFUEL_MATCH_VOLUME_TOLERANCE;
}

/**
 * Заправлено за період =
 *   усі заправки ДУТ (стрибок бака ≥15 л)
 * + ручні outbound, які не збігаються з ДУТ (без датчика / не знайдено пару).
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

  let wialonEvents: Awaited<ReturnType<typeof getWialonRefuelings>> = [];
  try {
    wialonEvents = await getWialonRefuelings(fromUnix, toUnix);
  } catch (err) {
    console.error(
      "[fuel-refuel-period] Wialon fillings",
      err instanceof Error ? err.message : err
    );
  }

  const manualUsed = new Set<number>();
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

  let wialonLiters = 0;
  for (const event of wialonEvents) {
    const volume = event.volume;
    if (volume <= 0) continue;
    wialonLiters += volume;

    // Позначити збіг з ручним — щоб не додати вдруге
    for (let i = 0; i < manual.length; i++) {
      if (manualUsed.has(i)) continue;
      const tx = manual[i]!;
      if (tx.wialonUnitId == null || tx.wialonUnitId !== event.unitId) continue;
      if (Math.abs(tx.timeUnix - event.time) > REFUEL_MATCH_WINDOW_SEC) continue;
      if (!volumesMatch(tx.amountLiters, volume)) continue;
      manualUsed.add(i);
      break;
    }

    bump(
      `w:${event.unitId}`,
      event.equipmentName,
      event.unitId,
      volume,
      "wialon"
    );
  }

  let manualOnlyLiters = 0;
  for (let i = 0; i < manual.length; i++) {
    if (manualUsed.has(i)) continue;
    const tx = manual[i]!;
    manualOnlyLiters += tx.amountLiters;
    const name =
      (tx.wialonUnitId != null
        ? wialonEvents.find((e) => e.unitId === tx.wialonUnitId)?.equipmentName
        : null) ||
      tx.operatorName ||
      (tx.wialonUnitId != null ? `Wialon #${tx.wialonUnitId}` : "Техніка");
    const key =
      tx.wialonUnitId != null ? `w:${tx.wialonUnitId}` : `m:${name}:${i}`;
    bump(key, name, tx.wialonUnitId, tx.amountLiters, "manual");
  }

  // Імена: equipment → Wialon nm
  const needNames = [...byKey.values()]
    .filter((r) => r.wialonUnitId != null && /^Wialon #/.test(r.equipmentName))
    .map((r) => r.wialonUnitId!);
  if (needNames.length > 0) {
    const unique = [...new Set(needNames)];
    const nameBy = new Map<number, string>();
    const { data: eqRows } = await supabase
      .from("equipment")
      .select("name, wialon_id")
      .in("wialon_id", unique);
    for (const row of eqRows ?? []) {
      const wid = Number(row.wialon_id);
      const nm = String(row.name ?? "").trim();
      if (Number.isFinite(wid) && nm) nameBy.set(wid, nm);
    }
    const still = unique.filter((id) => !nameBy.has(id));
    if (still.length > 0) {
      try {
        const { listWialonUnitBasics, wialonLogin } = await import(
          "@/lib/wialon"
        );
        const eid = await wialonLogin();
        const basics = await listWialonUnitBasics(eid);
        const want = new Set(still);
        for (const u of basics) {
          if (!want.has(u.id)) continue;
          const nm = String(u.nm ?? "").trim();
          if (nm) nameBy.set(u.id, nm);
        }
      } catch {
        /* імена не критичні */
      }
    }
    for (const row of byKey.values()) {
      if (row.wialonUnitId == null) continue;
      const nm = nameBy.get(row.wialonUnitId);
      if (nm) row.equipmentName = nm;
    }
  }

  const liters =
    Math.round((wialonLiters + manualOnlyLiters) * 10) / 10;
  const rows = [...byKey.values()].sort((a, b) => b.liters - a.liters);

  return {
    period,
    fromDate,
    toDate,
    liters,
    hasData: wialonEvents.length > 0 || manual.length > 0,
    rows,
    wialonLiters: Math.round(wialonLiters * 10) / 10,
    manualOnlyLiters: Math.round(manualOnlyLiters * 10) / 10,
  };
}

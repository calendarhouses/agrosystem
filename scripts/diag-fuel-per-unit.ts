import { config } from "dotenv";
config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";
import { resolveFieldFuelPeriodBounds } from "../lib/wialon-field-fuel-sync";
import { isFuelDeliveryUnit } from "../lib/equipment-fuel-tanks";
import { resolveWialonUnitDisplayNames } from "../lib/wialon-unit-names";

const OVERNIGHT_FILL_JUMP_L = 15;

type Row = {
  date: string;
  fuel_consumed: number | null;
  fuel_start: number | null;
  fuel_end: number | null;
  fuel_filled: number | null;
  wialon_unit_id: number;
};

function massBalance(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let dut = 0;
  let overnight = 0;
  let stored = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    dut += Number(row.fuel_filled) || 0;
    stored += Number(row.fuel_consumed) || 0;
    if (i > 0) {
      const prevEnd = Number(sorted[i - 1]!.fuel_end);
      const curStart = Number(row.fuel_start);
      const dayFilled = Number(row.fuel_filled) || 0;
      if (
        Number.isFinite(prevEnd) &&
        Number.isFinite(curStart) &&
        curStart > prevEnd + OVERNIGHT_FILL_JUMP_L
      ) {
        const jump = curStart - prevEnd;
        const uncaptured = Math.max(0, jump - dayFilled);
        if (uncaptured > OVERNIGHT_FILL_JUMP_L) overnight += uncaptured;
      }
    }
  }
  const opening = Number(sorted[0]?.fuel_start);
  const closing = Number(sorted[sorted.length - 1]?.fuel_end);
  const massOk =
    Number.isFinite(opening) &&
    opening > 0 &&
    Number.isFinite(closing) &&
    closing >= 0;
  const burn = massOk
    ? Math.max(0, opening + dut + overnight - closing)
    : stored;
  return {
    burn,
    dut,
    overnight,
    stored,
    massOk,
    opening,
    closing,
    refuel: dut + overnight,
    gap: burn - (dut + overnight),
    tankDelta: massOk ? opening - closing : null,
  };
}

async function main() {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds("season");
  const sb = createServiceSupabase();
  const [{ data }, { data: eq }] = await Promise.all([
    sb
      .from("wialon_equipment_day_stats")
      .select(
        "date,fuel_consumed,fuel_start,fuel_end,fuel_filled,wialon_unit_id,equipment_id"
      )
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date"),
    sb.from("equipment").select("id,wialon_id,name"),
  ]);

  const delivery = new Set<number>();
  for (const r of eq ?? []) {
    if (isFuelDeliveryUnit(r.name)) {
      const w = Number(r.wialon_id);
      if (w > 0) delivery.add(w);
    }
  }

  const byUnit = new Map<number, Row[]>();
  for (const r of data ?? []) {
    const w = Number(r.wialon_unit_id);
    if (!w || delivery.has(w)) continue;
    const bucket = byUnit.get(w) ?? [];
    bucket.push(r as Row);
    byUnit.set(w, bucket);
  }

  const names = await resolveWialonUnitDisplayNames([...byUnit.keys()]);

  let sumBurn = 0;
  let sumRefuel = 0;
  let sumGap = 0;
  let sumTankDelta = 0;
  let fallbackUnits = 0;
  const bad: Array<{ w: number; name: string; gap: number; massOk: boolean }> =
    [];

  for (const [w, rows] of byUnit) {
    const b = massBalance(rows);
    const burnKpi = b.burn > 0 ? b.burn : 0;
    sumBurn += burnKpi;
    sumRefuel += b.refuel;
    sumGap += burnKpi - b.refuel;
    if (b.massOk && b.tankDelta != null) sumTankDelta += b.tankDelta;
    if (!b.massOk) fallbackUnits++;
    if (Math.abs(burnKpi - b.refuel) > 300) {
      bad.push({
        w,
        name: names.get(w) ?? `#${w}`,
        gap: Math.round((burnKpi - b.refuel) * 10) / 10,
        massOk: b.massOk,
      });
    }
  }

  bad.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  console.log("units", byUnit.size, "fallback", fallbackUnits);
  console.log("sum burn (kpi style)", Math.round(sumBurn * 10) / 10);
  console.log("sum refuel", Math.round(sumRefuel * 10) / 10);
  console.log("sum gap", Math.round(sumGap * 10) / 10);
  console.log("sum tank delta (massOk only)", Math.round(sumTankDelta * 10) / 10);
  console.log("top gaps", bad.slice(0, 10));
}

main().catch(console.error);

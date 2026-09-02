import { config } from "dotenv";
config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";
import { resolveFieldFuelPeriodBounds } from "../lib/wialon-field-fuel-sync";
import {
  isFuelDeliveryUnit,
  resolveFuelTankVolumeLiters,
} from "../lib/equipment-fuel-tanks";
import {
  sumFleetFuelConsumedForPeriod,
  sumFleetFuelFilledForPeriod,
} from "../lib/wialon-equipment-day-sync";
import { sumOutboundRefueledForPeriod } from "../lib/fuel-refuel-period";

async function main() {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds("season");
  const sb = createServiceSupabase();
  const { data: eq } = await sb.from("equipment").select("id,wialon_id,name");
  const deliveryW = new Set<number>();
  const deliveryE = new Set<string>();
  const eqName = new Map<number, string>();
  for (const r of eq ?? []) {
    const wid = Number(r.wialon_id);
    if (Number.isFinite(wid) && wid > 0) eqName.set(wid, String(r.name ?? ""));
    if (isFuelDeliveryUnit(r.name)) {
      if (wid > 0) deliveryW.add(wid);
      if (r.id) deliveryE.add(String(r.id));
    }
  }

  const { data } = await sb
    .from("wialon_equipment_day_stats")
    .select("*")
    .gte("date", fromDate)
    .lte("date", toDate);

  let storedConsumed = 0;
  let storedFilled = 0;
  let consumedNoSensor = 0;
  for (const r of data ?? []) {
    const wid = Number(r.wialon_unit_id);
    const eid = r.equipment_id ? String(r.equipment_id) : null;
    if (deliveryW.has(wid) || (eid && deliveryE.has(eid))) continue;
    const name = eqName.get(wid) ?? "";
    if (isFuelDeliveryUnit(name)) continue;
    const c = Number(r.fuel_consumed) || 0;
    const f = Number(r.fuel_filled) || 0;
    storedConsumed += c;
    storedFilled += f;
    if (!r.has_fuel_sensor) consumedNoSensor += c;
  }

  const { data: fillRows } = await sb
    .from("wialon_equipment_day_stats")
    .select("fuel_filled,wialon_unit_id,equipment_id")
    .gte("date", fromDate)
    .lte("date", toDate)
    .gt("fuel_filled", 0);

  let uncappedFill = 0;
  let cappedOut = 0;
  for (const r of fillRows ?? []) {
    const wid = Number(r.wialon_unit_id);
    const eid = r.equipment_id ? String(r.equipment_id) : null;
    if (deliveryW.has(wid) || (eid && deliveryE.has(eid))) continue;
    const name = eqName.get(wid) ?? "";
    if (isFuelDeliveryUnit(name)) continue;
    const filled = Number(r.fuel_filled) || 0;
    uncappedFill += filled;
    const tankVol = resolveFuelTankVolumeLiters(name);
    const maxFill = tankVol != null ? tankVol * 1.15 : 1_200;
    if (filled > maxFill) cappedOut += filled;
  }

  const { data: txs } = await sb
    .from("fuel_transactions")
    .select("amount_liters,transaction_type,transaction_date,wialon_unit_id,has_fuel_sensor")
    .eq("transaction_type", "outbound")
    .gte("transaction_date", `${fromDate}T00:00:00`)
    .lte("transaction_date", `${toDate}T23:59:59`);

  let journalOutbound = 0;
  let journalWithDut = 0;
  let journalNoDut = 0;
  for (const r of txs ?? []) {
    const l = Number(r.amount_liters) || 0;
    journalOutbound += l;
    if (r.has_fuel_sensor === true) journalWithDut += l;
    else journalNoDut += l;
  }

  const fleet = await sumFleetFuelConsumedForPeriod(fromDate, toDate);
  const filled = await sumFleetFuelFilledForPeriod(fromDate, toDate);
  const refuel = await sumOutboundRefueledForPeriod("season");

  console.log("period:", fromDate, "to", toDate);
  console.log("stat rows:", data?.length);
  console.log("stored consumed:", Math.round(storedConsumed));
  console.log("stored filled (DB):", Math.round(storedFilled));
  console.log("uncapped fill in DB:", Math.round(uncappedFill));
  console.log("capped out by maxFill:", Math.round(cappedOut));
  console.log("KPI burn:", fleet.liters);
  console.log("KPI filled fn:", filled.liters);
  console.log("KPI refuel:", refuel.liters, "wialon:", refuel.wialonLiters, "manual:", refuel.manualOnlyLiters);
  console.log("journal outbound:", Math.round(journalOutbound), "dut:", Math.round(journalWithDut), "no dut:", Math.round(journalNoDut));
  console.log("gap burn - refuel:", Math.round(fleet.liters - refuel.liters));
  console.log("gap burn - journal:", Math.round(fleet.liters - journalOutbound));
  console.log("gap burn - (filled+manual):", Math.round(fleet.liters - filled.liters - refuel.manualOnlyLiters));
}

main().catch(console.error);

import { config } from "dotenv";
config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";
import { shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import {
  isFuelDeliveryUnit,
  isPlausibleTractorDayBurn,
} from "../lib/equipment-fuel-tanks";

async function main() {
  const supabase = createServiceSupabase();
  const today = todayKyivYmd();
  const yesterday = shiftKyivYmd(today, -1);

  const { data: eq } = await supabase
    .from("equipment")
    .select("id, name, wialon_id");
  const eqByWid = new Map(
    (eq ?? []).map((r) => [Number(r.wialon_id), String(r.name ?? "")])
  );
  const deliveryIds = new Set(
    (eq ?? [])
      .filter((r) => isFuelDeliveryUnit(r.name))
      .map((r) => Number(r.wialon_id))
  );

  for (const date of [today, yesterday]) {
    const { data: stats } = await supabase
      .from("wialon_equipment_day_stats")
      .select(
        "wialon_unit_id, fuel_consumed, fuel_start, fuel_end, fuel_filled, work_hours, hours_on_field, equipment_id"
      )
      .eq("date", date)
      .order("fuel_consumed", { ascending: false, nullsFirst: false });

    const { data: fieldLogs } = await supabase
      .from("wialon_field_fuel_logs")
      .select("wialon_unit_id, fuel_consumed, field_id, farm_fields(name)")
      .eq("date", date);

    const fieldByUnit = new Map<number, number>();
    for (const r of fieldLogs ?? []) {
      const k = Number(r.wialon_unit_id);
      fieldByUnit.set(k, (fieldByUnit.get(k) ?? 0) + (Number(r.fuel_consumed) || 0));
    }
    const fieldTotal = [...fieldByUnit.values()].reduce((a, b) => a + b, 0);

    let fleetTotal = 0;
    let rejectedTotal = 0;
    console.log("\n===", date, "===");
    console.log("Units with fuel_consumed in DB:");
    for (const r of stats ?? []) {
      const wid = Number(r.wialon_unit_id);
      const consumed = Number(r.fuel_consumed);
      if (!Number.isFinite(consumed) || consumed <= 0) continue;
      if (deliveryIds.has(wid)) {
        console.log(
          "  DELIVERY",
          wid,
          eqByWid.get(wid) ?? "?",
          "consumed=",
          consumed
        );
        continue;
      }
      const ok = isPlausibleTractorDayBurn({
        fuelConsumed: consumed,
        fuelStart: r.fuel_start,
        fuelEnd: r.fuel_end,
        workHours: r.work_hours,
        hoursOnField: r.hours_on_field,
      });
      if (!ok) {
        rejectedTotal += consumed;
        console.log(
          "  REJECT",
          wid,
          (eqByWid.get(wid) ?? "?").slice(0, 45),
          "consumed=",
          consumed,
          "start/end=",
          r.fuel_start,
          "/",
          r.fuel_end,
          "work=",
          r.work_hours,
          "field_h=",
          r.hours_on_field
        );
        continue;
      }
      fleetTotal += consumed;
      const onField = fieldByUnit.get(wid) ?? 0;
      console.log(
        " ",
        wid,
        (eqByWid.get(wid) ?? "?").slice(0, 45),
        "day=",
        consumed,
        "field=",
        Math.round(onField * 10) / 10,
        "work=",
        Number(r.work_hours ?? 0).toFixed(1),
        "onField=",
        Number(r.hours_on_field ?? 0).toFixed(1),
        "filled=",
        r.fuel_filled
      );
    }
    console.log(
      "Fleet total:",
      Math.round(fleetTotal * 10) / 10,
      "| Field total:",
      Math.round(fieldTotal * 10) / 10,
      "| Off-field:",
      Math.round((fleetTotal - fieldTotal) * 10) / 10,
      "| Rejected:",
      Math.round(rejectedTotal * 10) / 10
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

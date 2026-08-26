import { config } from "dotenv";
config({ path: ".env.local" });

import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import { createServiceSupabase } from "../lib/supabase/server";
import { extractTimedFuelSamples } from "../lib/wialon-fuel-decode";
import { detectFillingsFromSamples } from "../lib/wialon-api";
import {
  getWialonUnitSensors,
  getWialonUnitTrackBundle,
  listUnitSensors,
  loadWialonUnitMessages,
  wialonLogin,
} from "../lib/wialon";
import { detectGeofenceVisits } from "../lib/wialon-field-fuel-sync";

const UNIT = Number(process.argv[2] || 601301822);
const DAYS = Number(process.argv[3] || 3);

async function main() {
  const supabase = createServiceSupabase();
  const { data: fieldRows } = await supabase
    .from("farm_fields")
    .select("id, name, geometry")
    .not("geometry", "is", null);

  const eid = await wialonLogin();
  const today = todayKyivYmd();

  for (let d = 0; d < DAYS; d++) {
    const date = shiftKyivYmd(today, -d);
    const { fromUnix, toUnix: dayEnd } = kyivDayBoundsUnix(date);
    const toUnix =
      date === today ? Math.min(Math.floor(Date.now() / 1000), dayEnd) : dayEnd;

    const bundle = await getWialonUnitTrackBundle(eid, UNIT, fromUnix, toUnix);
    const messages = await loadWialonUnitMessages(eid, UNIT, fromUnix, toUnix);
    const unit = await getWialonUnitSensors(eid, UNIT);
    const sensors = unit ? listUnitSensors(unit) : [];

    const fuelSamples = extractTimedFuelSamples(messages, sensors, {
      includePosition: true,
    }).map((s) => ({
      t: s.t,
      liters: s.liters,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    }));

    const fills = detectFillingsFromSamples(fuelSamples, UNIT, null, "unit");
    const filled = Math.round(fills.reduce((a, f) => a + f.volume, 0) * 10) / 10;

    const summary = bundle.analytics?.summary;
    const fuelStart = summary?.fuelStart ?? null;
    const fuelEnd = summary?.fuelEnd ?? null;
    const consumption =
      fuelStart != null && fuelEnd != null
        ? Math.round((fuelStart - fuelEnd + filled) * 10) / 10
        : null;

    let secInFields = 0;
    const perField: Array<{ name: string; sec: number }> = [];
    for (const f of fieldRows ?? []) {
      const visits = detectGeofenceVisits(messages, f.geometry as never);
      if (visits.length === 0) continue;
      const sec = visits.reduce((a, v) => a + (v.endUnix - v.startUnix), 0);
      secInFields += sec;
      perField.push({ name: String(f.name), sec });
    }

    const { data: dbLogs } = await supabase
      .from("wialon_field_fuel_logs")
      .select("fuel_consumed, farm_fields(name)")
      .eq("date", date)
      .eq("wialon_unit_id", UNIT);
    const dbBurn =
      Math.round(
        (dbLogs ?? []).reduce((a, r) => a + (Number(r.fuel_consumed) || 0), 0) * 10
      ) / 10;

    console.log("=".repeat(72));
    console.log(
      date,
      "unit",
      UNIT,
      "msgs",
      messages.length,
      "fuelSamples",
      fuelSamples.length
    );
    console.log("  day:", {
      fuelStart,
      fuelEnd,
      delta: summary?.fuelDelta ?? null,
      workHours: summary?.workHours ?? null,
    });
    console.log(
      "  fills:",
      filled,
      fills.map(
        (f) =>
          `${f.volume}л @${new Date(f.time * 1000).toISOString().slice(11, 16)}`
      )
    );
    console.log("  → consumption (start-end+fills):", consumption);
    console.log(
      "  time in geofences:",
      Math.round(secInFields / 60),
      "min",
      perField.map((p) => `${p.name}:${Math.round(p.sec / 60)}m`)
    );
    console.log("  DB field burn:", dbBurn);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

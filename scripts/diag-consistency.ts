import { config } from "dotenv";
config({ path: ".env.local" });

import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import { createServiceSupabase } from "../lib/supabase/server";
import { isFuelDeliveryUnit } from "../lib/equipment-fuel-tanks";
import {
  getWialonUnitTrackBundle,
  listWialonUnitBasics,
  wialonLogin,
} from "../lib/wialon";

const DAYS = Number(process.argv[2] || 30);

async function main() {
  const supabase = createServiceSupabase();
  const eid = await wialonLogin();
  const units = (await listWialonUnitBasics(eid)).filter(
    (u) => !isFuelDeliveryUnit(u.nm)
  );
  const today = todayKyivYmd();
  const from = shiftKyivYmd(today, -(DAYS - 1));

  const { data: logs } = await supabase
    .from("wialon_field_fuel_logs")
    .select("date, wialon_unit_id, fuel_consumed")
    .gte("date", from)
    .lte("date", today)
    .gt("wialon_unit_id", 0);

  const fieldByKey = new Map<string, number>();
  for (const r of logs ?? []) {
    const key = `${r.date}|${r.wialon_unit_id}`;
    fieldByKey.set(
      key,
      (fieldByKey.get(key) ?? 0) + (Number(r.fuel_consumed) || 0)
    );
  }

  let totalDay = 0;
  let totalField = 0;
  let totalFill = 0;
  const problems: string[] = [];

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = shiftKyivYmd(today, -i);
    const { fromUnix, toUnix: dayEnd } = kyivDayBoundsUnix(date);
    const toUnix =
      date === today ? Math.min(Math.floor(Date.now() / 1000), dayEnd) : dayEnd;

    for (const u of units) {
      let day = 0;
      let fill = 0;
      try {
        const s = (await getWialonUnitTrackBundle(eid, u.id, fromUnix, toUnix))
          .analytics?.summary;
        if (!s?.hasFuelSensor) continue;
        day = s.fuelConsumed ?? 0;
        fill = s.fuelFilled ?? 0;
      } catch {
        continue;
      }
      const field = fieldByKey.get(`${date}|${u.id}`) ?? 0;
      totalDay += day;
      totalFill += fill;
      totalField += field;
      if (field > day + 1) {
        problems.push(
          `${date} ${u.nm}: поля ${field.toFixed(1)} > день ${day.toFixed(1)}`
        );
      }
    }
    process.stdout.write(".");
  }

  console.log("\n\n=== ПІДСУМОК ЗА", DAYS, "ДНІВ ===");
  console.log("  спалено технікою:", Math.round(totalDay), "л");
  console.log("  з них на полях:  ", Math.round(totalField), "л");
  console.log("  заправлено:      ", Math.round(totalFill), "л");
  console.log(
    "  баланс (заправлено − спалено):",
    Math.round(totalFill - totalDay),
    "л"
  );
  console.log("\n=== РОЗБІЖНОСТІ (поля > день) ===");
  if (problems.length === 0) console.log("  немає");
  else problems.slice(0, 15).forEach((p) => console.log("  " + p));
  console.log(`  всього: ${problems.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { config } from "dotenv";
config({ path: ".env.local" });

import { shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import { syncWialonFieldFuelForDate } from "../lib/wialon-field-fuel-sync";
import { syncWialonEquipmentDayStats } from "../lib/wialon-equipment-day-sync";

const DAYS = Number(process.argv[2] || 30);

async function main() {
  const today = todayKyivYmd();

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = shiftKyivYmd(today, -i);
    const started = Date.now();
    try {
      const field = await syncWialonFieldFuelForDate(date);
      const stats = await syncWialonEquipmentDayStats(date, {
        budgetMs: 120_000,
      });
      console.log(
        `${date}  поля: up=${field.upserted} skip=${field.skipped} err=${field.errors.length}  ` +
          `техніка: up=${stats.upserted} err=${stats.errors.length}  (${
            Math.round((Date.now() - started) / 100) / 10
          }s)`
      );
      if (field.errors.length) console.log("   ", field.errors.slice(0, 2));
      if (stats.errors.length) console.log("   ", stats.errors.slice(0, 2));
    } catch (err) {
      console.error(date, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

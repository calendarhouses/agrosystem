import { config } from "dotenv";
config({ path: ".env.local" });

import { shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import {
  backfillWialonFieldFuelRange,
  listFieldFuelBreakdownForPeriod,
  sumFieldFuelConsumedForPeriod,
} from "../lib/wialon-field-fuel-sync";

async function main() {
  const today = todayKyivYmd();
  const from = shiftKyivYmd(today, -29);
  console.log("Backfill", from, "→", today);

  let pass = 0;
  while (pass < 8) {
    pass += 1;
    const r = await backfillWialonFieldFuelRange(from, today, {
      maxDays: 8,
      budgetMs: 120_000,
    });
    console.log("pass", pass, {
      syncedNow: r.daysSyncedNow,
      stillMissing: r.daysStillMissing,
      before: r.daysSyncedBefore,
      dates: r.results.map(
        (x) =>
          `${x.date}:up=${x.upserted},skip=${x.skipped},err=${x.errors.length}`
      ),
    });
    if (r.daysStillMissing === 0) break;
  }

  const sum = await sumFieldFuelConsumedForPeriod("month");
  const br = await listFieldFuelBreakdownForPeriod("month");
  console.log("MONTH SUM", sum);
  console.log(
    "BREAKDOWN",
    br.rows.map((r) => `${r.equipmentName} @ ${r.fieldName}: ${r.liters}L`)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

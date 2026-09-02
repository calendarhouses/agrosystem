import { config } from "dotenv";
config({ path: ".env.local" });

import { resolveFieldFuelPeriodBounds } from "../lib/wialon-field-fuel-sync";
import {
  sumFleetFuelConsumedForPeriod,
  sumFleetOvernightFillsForPeriod,
  sumFleetFuelFilledForPeriod,
  sumFleetTankBalanceForPeriod,
} from "../lib/wialon-equipment-day-sync";
import { sumOutboundRefueledForPeriod } from "../lib/fuel-refuel-period";

async function main() {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds("season");
  const [burn, refuel, tanks, overnight, filled] = await Promise.all([
    sumFleetFuelConsumedForPeriod(fromDate, toDate),
    sumOutboundRefueledForPeriod("season"),
    sumFleetTankBalanceForPeriod(fromDate, toDate),
    sumFleetOvernightFillsForPeriod(fromDate, toDate),
    sumFleetFuelFilledForPeriod(fromDate, toDate),
  ]);

  console.log("period:", fromDate, "→", toDate);
  console.log("burn (mass balance):", burn.liters);
  console.log("refuel KPI:", refuel.liters);
  console.log("  dut:", refuel.dutLiters);
  console.log("  overnight:", refuel.overnightLiters);
  console.log("  overnight fn:", overnight.liters);
  console.log("  filled fn:", filled.liters);
  console.log("opening tanks:", tanks.openingLiters);
  console.log("closing tanks:", tanks.closingLiters);
  console.log("opening − closing:", tanks.openingLiters - tanks.closingLiters);
  console.log("gap burn − refuel:", Math.round((burn.liters - refuel.liters) * 10) / 10);
  console.log("top overnight:", overnight.rows.slice(0, 5));
}

main().catch(console.error);

/**
 * Радар заправок: Wialon-події без рішення оператора (корекція KPI).
 */

import { loadRefuelCorrectionsInRange } from "@/lib/fuel-refuel-corrections";
import {
  UNRECORDED_LOOKBACK_HOURS,
  type UnrecordedRefueling,
} from "@/lib/fuel-radar-constants";
import { getWialonRefuelings } from "@/lib/wialon-api";

export { UNRECORDED_LOOKBACK_HOURS, type UnrecordedRefueling };

function isReviewed(
  event: import("@/lib/wialon-api").WialonRefuelingEvent,
  corrections: Awaited<ReturnType<typeof loadRefuelCorrectionsInRange>>
): boolean {
  return corrections.some(
    (row) =>
      row.wialonUnitId === event.unitId &&
      Math.abs(
        Math.floor(new Date(row.eventTimeIso).getTime() / 1000) - event.time
      ) <= 2
  );
}

/**
 * Заправки Wialon, які оператор ще не підтвердив і не відхилив.
 * Після рішення — корекція потрапляє в KPI «Заправлено».
 */
export async function findUnrecordedRefuelings(options?: {
  lookbackHours?: number;
  now?: Date;
}): Promise<UnrecordedRefueling[]> {
  const lookbackHours = options?.lookbackHours ?? UNRECORDED_LOOKBACK_HOURS;
  const now = options?.now ?? new Date();
  const endMs = now.getTime();
  const startMs = endMs - lookbackHours * 60 * 60 * 1000;

  const startUnix = Math.floor(startMs / 1000);
  const endUnix = Math.floor(endMs / 1000);
  const fromIso = new Date(startMs).toISOString();
  const toIso = new Date(endMs).toISOString();

  const [wialonEvents, corrections] = await Promise.all([
    getWialonRefuelings(startUnix, endUnix),
    loadRefuelCorrectionsInRange(fromIso, toIso),
  ]);

  return wialonEvents
    .filter((event) => !isReviewed(event, corrections))
    .map((event) => ({
      ...event,
      timeIso: new Date(event.time * 1000).toISOString(),
    }));
}

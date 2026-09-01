import type { DateRange } from "react-day-picker";

import {
  computeCostPerHectare,
  isFutureTimelineOperation,
  type FieldWithTimeline,
  timelineEventDateIso,
} from "@/lib/field-timeline";
import {
  getFinancePeriodRange,
  getFullSeasonIsoRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";

function sumFactTimelineCost(events: FieldWithTimeline["events"]): number {
  return events.reduce(
    (sum, event) =>
      sum + (isFutureTimelineOperation(event) ? 0 : event.cost),
    0
  );
}

/**
 * Діапазон для хронології: у режимі «Сезон» показуємо весь агросезон,
 * включно з майбутніми запланованими нарядами (на відміну від фінансів).
 */
export function getChroniclePeriodIsoRange(
  period: FinancePeriod,
  seasonYear: number,
  customRange?: DateRange,
  now = new Date()
): { startIso: string; endIso: string } {
  if (period === "Сезон") {
    return getFullSeasonIsoRange(seasonYear);
  }
  return toIsoRange(getFinancePeriodRange(period, seasonYear, customRange, now));
}

export function filterTimelineByIsoRange(
  fields: FieldWithTimeline[],
  startIso: string,
  endIso: string
): FieldWithTimeline[] {
  return fields.map((item) => {
    const events = item.events.filter((event) => {
      const iso = timelineEventDateIso(event.date);
      return iso >= startIso && iso <= endIso;
    });
    const totalCost = sumFactTimelineCost(events);
    return {
      ...item,
      events,
      totalCost,
      costPerHectare: computeCostPerHectare(totalCost, item.area),
    };
  });
}

export function countTimelineEvents(fields: FieldWithTimeline[]): number {
  return fields.reduce((sum, item) => sum + item.events.length, 0);
}

import {
  computeCostPerHectare,
  type FieldWithTimeline,
  timelineEventDateIso,
} from "@/lib/field-timeline";

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
    const totalCost = events.reduce((sum, event) => sum + event.cost, 0);
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

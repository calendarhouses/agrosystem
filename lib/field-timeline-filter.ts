import type { FieldWithTimeline } from "@/lib/field-timeline";

export function filterTimelineByIsoRange(
  fields: FieldWithTimeline[],
  startIso: string,
  endIso: string
): FieldWithTimeline[] {
  return fields.map((item) => ({
    ...item,
    events: item.events.filter(
      (event) => event.date >= startIso && event.date <= endIso
    ),
  }));
}

export function countTimelineEvents(fields: FieldWithTimeline[]): number {
  return fields.reduce((sum, item) => sum + item.events.length, 0);
}

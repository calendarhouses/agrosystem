/**
 * Операційна хронологія поля — публічний API (типи + серверний entry).
 */

import { loadFieldTimeline } from "@/lib/field-timeline-data";
import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON } from "@/lib/season";

export type {
  FieldTimelineField,
  FieldWithTimeline,
  FieldWithTimelineWire,
  UnifiedTimelineEvent,
  UnifiedTimelineEventType,
  UnifiedTimelineEventWire,
  UnifiedTimelineIcon,
  WeatherContext,
} from "@/lib/field-timeline-types";

export {
  deriveTimelineIcon,
  mapWeatherContext,
  parseTimelineDate,
  reviveFieldWithTimeline,
  reviveUnifiedTimelineEvent,
  timelineEventDateIso,
  toTimelineField,
} from "@/lib/field-timeline-types";

export {
  computeCostPerHectare,
  computeEquipmentTimelineCost,
  computeInventoryTimelineCost,
  equipmentFuelLiters,
  equipmentWageUah,
  sumTimelineEventsCost,
  type TimelineEquipmentSourceRow,
  type TimelineInventorySourceRow,
  type TimelineScoutingSourceRow,
} from "@/lib/field-timeline-cost";

export {
  TIMELINE_EVENTS_PER_FIELD,
  aggregateFieldTimeline,
  buildFieldKeyResolver,
  fetchTimelineRawBundle,
  groupFieldsWithTimeline,
  loadFieldTimeline,
  mapInventoryMoveToTimelineEvent,
  mapOperationToTimelineEvent,
  mapRawBundleToEvents,
  mapScoutingReportToTimelineEvent,
  mapTimelineFields,
  type GroupFieldsOptions,
  type TimelineFieldRow,
  type TimelineInventoryRow,
  type TimelineOperationRow,
  type TimelineRawBundle,
} from "@/lib/field-timeline-data";

export type {
  Database,
  FieldOperationRow,
  InventoryLocalMoveRow,
  ScoutingReportRow,
  WeatherContextJson,
} from "@/lib/database.types";

/** Серверна агрегація для API route. */
export async function fetchFieldTimeline(
  activeSeason: string = DEFAULT_SEASON
) {
  const supabase = createServiceSupabase();
  return loadFieldTimeline(supabase, activeSeason);
}

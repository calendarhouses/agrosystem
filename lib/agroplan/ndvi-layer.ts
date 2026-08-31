import type { AgroNdviAlert } from "@/lib/agronomy-engine";
import { msToTimelineX, type SeasonWindow } from "@/lib/agroplan/timeline";

const STICKY_LABEL_W = 168;

export type NdviTimelineMarker = {
  id: string;
  fieldId: string;
  fieldName: string;
  x: number;
  width: number;
  dropPercent: number;
  ymd: string;
};

export type NdviFieldFlag = {
  fieldId: string;
  dropPercent: number;
  zoneNote: string | null;
};

/** Поля з активними NDVI-алертами */
export function buildNdviFieldFlags(
  alerts: readonly AgroNdviAlert[]
): Map<string, NdviFieldFlag> {
  const map = new Map<string, NdviFieldFlag>();
  for (const alert of alerts) {
    const prev = map.get(alert.fieldId);
    if (!prev || alert.dropPercent > prev.dropPercent) {
      map.set(alert.fieldId, {
        fieldId: alert.fieldId,
        dropPercent: alert.dropPercent,
        zoneNote: alert.zoneNote,
      });
    }
  }
  return map;
}

/** Вертикальні маркери NDVI на шапці таймлайну */
export function buildNdviTimelineMarkers(
  alerts: readonly AgroNdviAlert[],
  season: SeasonWindow,
  pxPerHour: number
): NdviTimelineMarker[] {
  return alerts.map((alert) => {
    const ms = new Date(alert.detectedAt).getTime();
    return {
      id: alert.id,
      fieldId: alert.fieldId,
      fieldName: alert.fieldName,
      x: STICKY_LABEL_W + msToTimelineX(ms, season.originMs, pxPerHour),
      width: 1,
      dropPercent: alert.dropPercent,
      ymd: alert.detectedAt.slice(0, 10),
    };
  });
}

/** Кліматичні колонки лише у видимому вікні (+ буфер) */
export function filterClimateColumnsByViewport<T extends { x: number; width: number }>(
  columns: readonly T[],
  scrollLeft: number,
  viewportWidth: number,
  bufferPx = 120
): T[] {
  const minX = scrollLeft - bufferPx;
  const maxX = scrollLeft + viewportWidth + bufferPx;
  return columns.filter((col) => col.x + col.width >= minX && col.x <= maxX);
}

export { STICKY_LABEL_W as AGROPLAN_STICKY_LABEL_W };

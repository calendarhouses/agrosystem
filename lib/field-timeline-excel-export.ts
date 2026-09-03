import { format } from "date-fns";
import * as XLSX from "xlsx";

import type {
  TimelineExcelFieldSummary,
  TimelineExcelRow,
  TimelineExcelStationInput,
} from "@/app/operations/timeline-export-actions";
import type { FieldWithTimeline } from "@/lib/field-timeline-types";
import { timelineEventDateIso } from "@/lib/field-timeline-types";

function appendSheet(
  book: XLSX.WorkBook,
  name: string,
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0) return;
  const sheet = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0] ?? {});
  sheet["!cols"] = keys.map((k) => ({
    wch: Math.min(42, Math.max(10, k.length + 4)),
  }));
  XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
}

export function stationsFromVisibleFields(
  fields: FieldWithTimeline[]
): TimelineExcelStationInput[] {
  const stations: TimelineExcelStationInput[] = [];
  for (const field of fields) {
    for (const event of field.events) {
      stations.push({
        eventId: event.id,
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        cropName: field.cropName,
        areaHa: field.area,
        dateIso: timelineEventDateIso(event.date),
        type: event.type,
        title: event.title,
        subtitle: event.subtitle,
        metric: event.metric,
        cost: event.cost,
        notes: event.notes,
        imageUrl: event.imageUrl,
        operationStatus: event.operationStatus ?? null,
        weatherContext: event.weatherContext,
      });
    }
  }
  return stations;
}

export function downloadFieldTimelineExcel(payload: {
  rows: TimelineExcelRow[];
  fieldSummary: TimelineExcelFieldSummary[];
  periodLabel?: string;
}): string {
  const book = XLSX.utils.book_new();
  appendSheet(book, "Станції", payload.rows);
  appendSheet(book, "Поля", payload.fieldSummary);

  if ((book.SheetNames?.length ?? 0) === 0) {
    const sheet = XLSX.utils.aoa_to_sheet([["Немає станцій для експорту"]]);
    XLSX.utils.book_append_sheet(book, sheet, "Станції");
  }

  const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
  const periodPart = payload.periodLabel
    ? `_${payload.periodLabel.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 24)}`
    : "";
  const filename = `AgroSystem_chronologiya${periodPart}_${stamp}.xlsx`;
  XLSX.writeFile(book, filename);
  return filename;
}

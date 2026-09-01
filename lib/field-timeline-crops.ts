import type { FieldWithTimeline } from "@/lib/field-timeline";

export const TIMELINE_PRIMARY_CROPS = [
  "Кукурудза",
  "Пшениця",
  "Ріпак",
  "Соняшник",
] as const;

export const TIMELINE_NO_CROP_LABEL = "Без культури";

const CROP_DEFAULT_COLORS: Record<string, string> = {
  Кукурудза: "#D69E2E",
  Пшениця: "#4D7C0F",
  Ріпак: "#CA8A04",
  Соняшник: "#C05621",
  [TIMELINE_NO_CROP_LABEL]: "#475569",
};

export const DEFAULT_FIELD_LINE_COLOR = "#276749";

function normalizeCropLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const match = TIMELINE_PRIMARY_CROPS.find(
    (crop) => crop.toLowerCase() === trimmed.toLowerCase()
  );
  if (match) return match;
  const catalog = [
    "Ріпак",
    "Соняшник",
    "Соя",
    "Ячмінь",
    "Цукровий буряк",
    "Гречка",
  ] as const;
  const catalogMatch = catalog.find(
    (crop) => crop.toLowerCase() === trimmed.toLowerCase()
  );
  return catalogMatch ?? trimmed;
}

export function timelineCropCategoryKey(crop: string): string {
  const normalized = normalizeCropLabel(crop);
  return normalized || TIMELINE_NO_CROP_LABEL;
}

export type TimelineCropGroup = {
  id: string;
  label: string;
  fields: FieldWithTimeline[];
  fieldCount: number;
  stationCount: number;
  totalAreaHa: number;
  accentColor: string;
};

export function defaultCropAccentColor(label: string): string {
  return CROP_DEFAULT_COLORS[label] ?? DEFAULT_FIELD_LINE_COLOR;
}

export function normalizeFieldLineColor(color: string | null | undefined): string {
  const raw = color?.trim();
  if (!raw) return DEFAULT_FIELD_LINE_COLOR;
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1]!;
    const g = raw[2]!;
    const b = raw[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_FIELD_LINE_COLOR;
}

export function fieldLineGlowShadow(color: string): string {
  return `0 0 14px ${color}55`;
}

export function groupTimelineByCrop(
  fields: FieldWithTimeline[]
): TimelineCropGroup[] {
  const buckets = new Map<string, FieldWithTimeline[]>();

  for (const item of fields) {
    const key = timelineCropCategoryKey(item.field.crop);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groups: TimelineCropGroup[] = [];

  for (const label of TIMELINE_PRIMARY_CROPS) {
    const items = buckets.get(label);
    if (!items?.length) continue;
    buckets.delete(label);
    groups.push(buildTimelineCropGroup(label, items));
  }

  const noCrop = buckets.get(TIMELINE_NO_CROP_LABEL);
  if (noCrop?.length) {
    buckets.delete(TIMELINE_NO_CROP_LABEL);
    groups.push(buildTimelineCropGroup(TIMELINE_NO_CROP_LABEL, noCrop));
  }

  for (const [label, items] of [...buckets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "uk")
  )) {
    groups.push(buildTimelineCropGroup(label, items));
  }

  return groups;
}

function buildTimelineCropGroup(
  label: string,
  fields: FieldWithTimeline[]
): TimelineCropGroup {
  const sorted = [...fields].sort((a, b) =>
    a.field.name.localeCompare(b.field.name, "uk")
  );
  const stationCount = sorted.reduce((sum, item) => sum + item.events.length, 0);
  const totalAreaHa = sorted.reduce((sum, item) => sum + item.field.areaHa, 0);
  const accentColor =
    normalizeFieldLineColor(sorted[0]?.field.color) ||
    defaultCropAccentColor(label);

  return {
    id: label,
    label,
    fields: sorted,
    fieldCount: sorted.length,
    stationCount,
    totalAreaHa,
    accentColor,
  };
}

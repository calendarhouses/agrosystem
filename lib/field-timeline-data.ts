/**
 * Завантаження та агрегація даних хронології (клієнт + сервер).
 * Таблиці: farm_fields, field_operations, inventory_local_moves, scouting_reports.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeCostPerHectare,
  computeEquipmentTimelineCost,
  computeInventoryTimelineCost,
  equipmentFuelLiters,
  type TimelineScoutingSourceRow,
} from "@/lib/field-timeline-cost";
import { isFutureTimelineOperation } from "@/lib/field-timeline-types";
import {
  mapWeatherContext,
  parseTimelineDate,
  type FieldTimelineField,
  type FieldWithTimeline,
  type UnifiedTimelineEvent,
  type WeatherContext,
} from "@/lib/field-timeline-types";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";
import { OPERATION_DOCS_BUCKET } from "@/lib/operation-attachments";

export const TIMELINE_EVENTS_PER_FIELD = 20;

const MATERIAL_LABEL: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  other: "ТМЦ",
};

export type TimelineFieldRow = {
  id: string;
  name: string;
  crop: string;
  area_ha: number | string;
  color?: string | null;
  wialon_zone_id?: string | null;
};

export type TimelineOperationRow = {
  id: string;
  client_key?: string | null;
  field_id: string | null;
  field_key: string | null;
  work_type: string | null;
  crop: string | null;
  machinery: string | null;
  implement: string | null;
  occurred_at: string | null;
  closed_at: string | null;
  created_at?: string | null;
  fuel_fact: number | string | null;
  fuel_plan: number | string | null;
  wage_fact?: number | string | null;
  wage_plan?: number | string | null;
  total_cost?: number | string | null;
  agronomist_comment?: string | null;
  status: string | null;
  actor_name?: string | null;
  closed_by_name?: string | null;
  weather_context?: WeatherContext | null;
};

export type TimelineInventoryRow = {
  id: string;
  field_id: string | null;
  date: string;
  qty: number | string;
  unit_price_uah?: number | string | null;
  total_cost?: number | string | null;
  weather_context?: WeatherContext | null;
  inventory_items_cache:
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah?: number | null;
        unit_cost?: number | null;
      }
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah?: number | null;
        unit_cost?: number | null;
      }[]
    | null;
};

export type TimelineRawBundle = {
  fieldRows: TimelineFieldRow[];
  operations: TimelineOperationRow[];
  inventoryMoves: TimelineInventoryRow[];
  scoutingReports: TimelineScoutingSourceRow[];
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function eventDateMs(date: Date): number {
  return date.getTime();
}

function formatQty(qty: number, unit: string): string | null {
  if (qty <= 0) return null;
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  const u = unit.trim();
  return u ? `${n} ${u}` : n;
}

function formatLiters(value: number): string | null {
  if (value <= 0) return null;
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} л`;
}

function materialCategoryLabel(category: string | null | undefined): string {
  if (category && MATERIAL_LABEL[category]) return MATERIAL_LABEL[category];
  return MATERIAL_LABEL.other;
}

function cleanMachinery(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text && text !== "—" ? text : "";
}

function equipmentSubtitle(row: TimelineOperationRow): string {
  const machinery = cleanMachinery(row.machinery);
  const implement = cleanMachinery(row.implement);
  const parts = [machinery, implement].filter(Boolean);
  return parts.join(" · ") || "—";
}

function scoutingTitle(notes: string): string {
  const trimmed = notes.trim();
  if (!trimmed) return "Скаутинг";
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 45)}…`;
}

/** field_operations (work orders) → UnifiedTimelineEvent */
export function mapOperationToTimelineEvent(
  row: TimelineOperationRow,
  fieldId: string
): UnifiedTimelineEvent | null {
  const statusRaw = String(row.status ?? "planned").trim();
  if (statusRaw === "cancelled") return null;

  const status: "planned" | "in_progress" | "completed" =
    statusRaw === "completed" || statusRaw === "in_progress"
      ? statusRaw
      : "planned";

  const workType = String(row.work_type ?? "").trim();
  const machinery = cleanMachinery(row.machinery);
  const title = workType || machinery || "Наряд";
  const fuelLiters =
    status === "completed"
      ? equipmentFuelLiters(row)
      : Math.max(0, num(row.fuel_plan)) || equipmentFuelLiters(row);

  const dateRaw =
    String(row.occurred_at ?? "").slice(0, 10) ||
    String(row.closed_at ?? "").slice(0, 10) ||
    String(row.created_at ?? "").slice(0, 10);
  if (!dateRaw) return null;

  const notes = String(row.agronomist_comment ?? "").trim() || null;
  const equipmentLine = equipmentSubtitle(row);
  const statusLabel =
    status === "planned"
      ? "Заплановано"
      : status === "in_progress"
        ? "В роботі"
        : null;

  return {
    id: `equipment:${String(row.client_key ?? row.id)}`,
    fieldId,
    date: parseTimelineDate(dateRaw),
    type: "equipment",
    title,
    subtitle: statusLabel ? `${statusLabel} · ${equipmentLine}` : equipmentLine,
    metric: formatLiters(fuelLiters),
    cost: computeEquipmentTimelineCost(row),
    imageUrl: null,
    notes,
    weatherContext: mapWeatherContext(row.weather_context),
    operationStatus: status,
  };
}

/** inventory_local_moves (outbound) → UnifiedTimelineEvent */
export function mapInventoryMoveToTimelineEvent(
  row: TimelineInventoryRow
): UnifiedTimelineEvent | null {
  const fieldId = String(row.field_id ?? "").trim();
  if (!fieldId) return null;

  const qty = num(row.qty);
  if (qty <= 0) return null;

  const cache = unwrapJoin(row.inventory_items_cache);
  const category = cache?.category ?? "other";
  const unit = String(cache?.unit ?? "").trim();
  const title =
    String(cache?.custom_name ?? "").trim() ||
    String(cache?.name ?? "").trim() ||
    "ТМЦ";

  const dateRaw = String(row.date ?? "").slice(0, 10);
  if (!dateRaw) return null;

  return {
    id: `inventory:${String(row.id)}`,
    fieldId,
    date: parseTimelineDate(dateRaw),
    type: "inventory",
    title,
    subtitle: materialCategoryLabel(category),
    metric: formatQty(qty, unit),
    cost: computeInventoryTimelineCost(row),
    imageUrl: null,
    notes: null,
    weatherContext: mapWeatherContext(row.weather_context),
  };
}

/** scouting_reports → UnifiedTimelineEvent */
export function mapScoutingReportToTimelineEvent(
  row: TimelineScoutingSourceRow
): UnifiedTimelineEvent | null {
  const fieldId = String(row.field_id ?? "").trim();
  if (!fieldId) return null;

  const notes = String(row.notes ?? "").trim();
  const dateRaw = String(row.date ?? "").slice(0, 10);
  if (!dateRaw) return null;

  const imageUrl = String(row.image_url ?? "").trim() || null;

  return {
    id: `scouting:${String(row.id)}`,
    fieldId,
    date: parseTimelineDate(dateRaw),
    type: "scouting",
    title: scoutingTitle(notes),
    subtitle: imageUrl ? "Фото звіт" : "Польовий огляд",
    metric: null,
    cost: 0,
    imageUrl,
    notes: notes || null,
    weatherContext: mapWeatherContext(row.weather_context),
  };
}

export function mapTimelineFields(rows: TimelineFieldRow[]): FieldTimelineField[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    crop: String(row.crop),
    areaHa: num(row.area_ha),
    color: String(row.color ?? "").trim() || "#276749",
  }));
}

function parseFarmFieldId(fieldKey: string | null | undefined): string | null {
  const key = String(fieldKey ?? "").trim();
  if (!key.startsWith("farm:")) return null;
  const id = key.slice(5);
  return isUuid(id) ? id : null;
}

export function buildFieldKeyResolver(fields: TimelineFieldRow[]) {
  const wialonToFieldId = new Map<string, string>();
  for (const field of fields) {
    const zoneId = String(field.wialon_zone_id ?? "").trim();
    if (zoneId) wialonToFieldId.set(zoneId, field.id);
  }

  return (row: TimelineOperationRow): string | null => {
    const direct = String(row.field_id ?? "").trim();
    if (direct && isUuid(direct)) return direct;

    const fromFarmKey = parseFarmFieldId(row.field_key);
    if (fromFarmKey) return fromFarmKey;

    const fieldKey = String(row.field_key ?? "").trim();
    if (fieldKey.startsWith("wialon:")) {
      const zoneId = fieldKey.slice(7);
      return wialonToFieldId.get(zoneId) ?? null;
    }

    return null;
  };
}

/** Мапінг сирих рядків у плоский список подій. */
export function mapRawBundleToEvents(bundle: TimelineRawBundle): UnifiedTimelineEvent[] {
  const resolveFieldId = buildFieldKeyResolver(bundle.fieldRows);
  const events: UnifiedTimelineEvent[] = [];

  for (const row of bundle.operations) {
    const fieldId = resolveFieldId(row);
    if (!fieldId) continue;
    const event = mapOperationToTimelineEvent(row, fieldId);
    if (event) events.push(event);
  }

  for (const row of bundle.inventoryMoves) {
    const event = mapInventoryMoveToTimelineEvent(row);
    if (event) events.push(event);
  }

  for (const row of bundle.scoutingReports) {
    const event = mapScoutingReportToTimelineEvent(row);
    if (event) events.push(event);
  }

  return events;
}

export type GroupFieldsOptions = {
  limitPerField?: number;
  /** last_activity — за датою останньої події; name — за назвою поля */
  fieldSort?: "last_activity" | "name";
};

export function groupFieldsWithTimeline(
  fields: FieldTimelineField[],
  events: UnifiedTimelineEvent[],
  options: GroupFieldsOptions = {}
): FieldWithTimeline[] {
  const {
    limitPerField = TIMELINE_EVENTS_PER_FIELD,
    fieldSort = "last_activity",
  } = options;

  const activeIds = new Set(fields.map((f) => f.id));
  const byField = new Map<string, UnifiedTimelineEvent[]>();

  for (const event of events) {
    if (!activeIds.has(event.fieldId)) continue;
    const bucket = byField.get(event.fieldId) ?? [];
    bucket.push(event);
    byField.set(event.fieldId, bucket);
  }

  const grouped = fields.map((field) => {
    const fieldEvents = (byField.get(field.id) ?? []).sort((a, b) => {
      const byDate = eventDateMs(b.date) - eventDateMs(a.date);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });

    const sliced = fieldEvents.slice(0, limitPerField);
    const totalCost = sliced.reduce(
      (sum, event) =>
        sum + (isFutureTimelineOperation(event) ? 0 : num(event.cost)),
      0
    );

    return {
      fieldId: field.id,
      fieldName: field.name,
      area: field.areaHa,
      cropName: field.crop,
      color: field.color,
      events: sliced,
      totalCost,
      costPerHectare: computeCostPerHectare(totalCost, field.areaHa),
    };
  });

  if (fieldSort === "name") {
    return grouped.sort((a, b) => a.fieldName.localeCompare(b.fieldName, "uk"));
  }

  return grouped.sort((a, b) => {
    const aLast = a.events[0]?.date.getTime() ?? 0;
    const bLast = b.events[0]?.date.getTime() ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return a.fieldName.localeCompare(b.fieldName, "uk");
  });
}

export function aggregateFieldTimeline(
  bundle: TimelineRawBundle,
  options?: GroupFieldsOptions
): FieldWithTimeline[] {
  const fields = mapTimelineFields(bundle.fieldRows);
  const events = mapRawBundleToEvents(bundle);
  return groupFieldsWithTimeline(fields, events, options);
}

const FIELD_SELECT = "id, name, crop, area_ha, color, wialon_zone_id";

const OP_SELECT = `
  id,
  client_key,
  field_id,
  field_key,
  work_type,
  crop,
  machinery,
  implement,
  occurred_at,
  closed_at,
  created_at,
  fuel_fact,
  fuel_plan,
  wage_fact,
  wage_plan,
  agronomist_comment,
  status,
  actor_name,
  closed_by_name,
  weather_context
`;

const MOVE_SELECT = `
  id,
  field_id,
  date,
  qty,
  unit_price_uah,
  weather_context,
  inventory_items_cache (
    category,
    name,
    custom_name,
    unit,
    planned_price_uah,
    unit_cost
  )
`;

const SCOUTING_SELECT = `
  id,
  field_id,
  date,
  image_url,
  notes,
  weather_context
`;

async function fetchActiveFields(
  supabase: SupabaseClient
): Promise<TimelineFieldRow[]> {
  const withFlag = await supabase
    .from("farm_fields")
    .select(FIELD_SELECT)
    .eq("is_field", true)
    .order("name", { ascending: true });

  if (!withFlag.error) return (withFlag.data ?? []) as TimelineFieldRow[];

  if (
    withFlag.error.message?.includes("is_field") ||
    withFlag.error.code === "42703"
  ) {
    const fallback = await supabase
      .from("farm_fields")
      .select(FIELD_SELECT)
      .order("name", { ascending: true });
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data ?? []) as TimelineFieldRow[];
  }

  throw new Error(withFlag.error.message);
}

async function fetchTimelineOperations(
  supabase: SupabaseClient,
  season: string
): Promise<TimelineOperationRow[]> {
  const statuses = ["planned", "in_progress", "completed"] as const;

  const { data, error } = await supabase
    .from("field_operations")
    .select(OP_SELECT)
    .in("status", [...statuses])
    .eq("season", season)
    .order("occurred_at", { ascending: false });

  if (!error) return (data ?? []) as unknown as TimelineOperationRow[];

  if (error.message?.includes("season") || error.code === "42703") {
    const legacy = await supabase
      .from("field_operations")
      .select(OP_SELECT.replace(/\s+/g, " ").trim())
      .in("status", [...statuses])
      .order("occurred_at", { ascending: false });
    if (legacy.error) {
      if (legacy.error.code === "PGRST205" || legacy.error.code === "42P01") {
        return [];
      }
      throw new Error(legacy.error.message);
    }
    return (legacy.data ?? []) as unknown as TimelineOperationRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];

  if (
    error.message?.includes("actor_name") ||
    error.message?.includes("closed_by_name") ||
    error.message?.includes("wage_fact") ||
    error.message?.includes("agronomist_comment") ||
    error.message?.includes("weather_context")
  ) {
    const legacySelect = OP_SELECT.replace(
      /,\s*(actor_name|closed_by_name|wage_fact|wage_plan|agronomist_comment|weather_context)/g,
      ""
    );
    const legacy = await supabase
      .from("field_operations")
      .select(legacySelect)
      .in("status", [...statuses])
      .eq("season", season)
      .order("occurred_at", { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as unknown as TimelineOperationRow[];
  }

  throw new Error(error.message);
}

async function fetchOutboundMoves(
  supabase: SupabaseClient,
  season: string
): Promise<TimelineInventoryRow[]> {
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(MOVE_SELECT)
    .eq("type", "outbound")
    .not("field_id", "is", null)
    .eq("season", season)
    .order("date", { ascending: false });

  if (!error) return (data ?? []) as unknown as TimelineInventoryRow[];

  if (error.message?.includes("season") || error.code === "42703") {
    const legacy = await supabase
      .from("inventory_local_moves")
      .select(MOVE_SELECT)
      .eq("type", "outbound")
      .not("field_id", "is", null)
      .order("date", { ascending: false });
    if (legacy.error) {
      if (legacy.error.code === "PGRST205" || legacy.error.code === "42P01") {
        return [];
      }
      throw new Error(legacy.error.message);
    }
    return (legacy.data ?? []) as unknown as TimelineInventoryRow[];
  }

  if (
    error.message?.includes("unit_price_uah") ||
    error.message?.includes("planned_price_uah") ||
    error.message?.includes("unit_cost") ||
    error.message?.includes("weather_context")
  ) {
    const legacySelect = `
      id,
      field_id,
      date,
      qty,
      inventory_items_cache (
        category,
        name,
        custom_name,
        unit
      )
    `;
    const legacy = await supabase
      .from("inventory_local_moves")
      .select(legacySelect)
      .eq("type", "outbound")
      .not("field_id", "is", null)
      .eq("season", season)
      .order("date", { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as unknown as TimelineInventoryRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

async function resolveScoutingImageUrl(
  supabase: SupabaseClient,
  imageUrl: string | null | undefined
): Promise<string | null> {
  const raw = String(imageUrl ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (!raw.startsWith("scouting/")) return raw;

  const { data, error } = await supabase.storage
    .from(OPERATION_DOCS_BUCKET)
    .createSignedUrl(raw, 60 * 60 * 24);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function enrichScoutingReports(
  supabase: SupabaseClient,
  rows: TimelineScoutingSourceRow[]
): Promise<TimelineScoutingSourceRow[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      image_url: await resolveScoutingImageUrl(supabase, row.image_url),
    }))
  );
}

async function fetchScoutingReports(
  supabase: SupabaseClient,
  season: string
): Promise<TimelineScoutingSourceRow[]> {
  const year = Number(season);
  const start = `${season}-01-01T00:00:00.000Z`;
  const end = Number.isFinite(year)
    ? `${year + 1}-01-01T00:00:00.000Z`
    : `${season}-12-31T23:59:59.999Z`;

  const { data, error } = await supabase
    .from("scouting_reports")
    .select(SCOUTING_SELECT)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });

  if (!error) {
    return enrichScoutingReports(
      supabase,
      (data ?? []) as TimelineScoutingSourceRow[]
    );
  }

  if (error.message?.includes("weather_context") || error.code === "42703") {
    const legacy = await supabase
      .from("scouting_reports")
      .select(
        `
  id,
  field_id,
  date,
  image_url,
  notes
`
      )
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false });
    if (!legacy.error) {
      return enrichScoutingReports(
        supabase,
        (legacy.data ?? []) as TimelineScoutingSourceRow[]
      );
    }
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

/** Паралельне завантаження 4 джерел (Promise.all). */
export async function fetchTimelineRawBundle(
  supabase: SupabaseClient,
  activeSeason: string = DEFAULT_SEASON
): Promise<TimelineRawBundle> {
  const season = normalizeSeason(activeSeason);

  const [fieldRows, operations, inventoryMoves, scoutingReports] =
    await Promise.all([
      fetchActiveFields(supabase),
      fetchTimelineOperations(supabase, season),
      fetchOutboundMoves(supabase, season),
      fetchScoutingReports(supabase, season),
    ]);

  return { fieldRows, operations, inventoryMoves, scoutingReports };
}

/** Завантаження + агрегація в FieldWithTimeline[]. */
export async function loadFieldTimeline(
  supabase: SupabaseClient,
  activeSeason: string = DEFAULT_SEASON,
  options?: GroupFieldsOptions
): Promise<FieldWithTimeline[]> {
  const bundle = await fetchTimelineRawBundle(supabase, activeSeason);
  return aggregateFieldTimeline(bundle, options);
}

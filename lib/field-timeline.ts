/**
 * Операційна хронологія поля: наряди (техніка) + списання ТМЦ.
 * Для мобільного розділу Field Operations Matrix.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";

export type UnifiedTimelineEventType = "equipment" | "inventory";

export type UnifiedTimelineIcon =
  | "tractor"
  | "package"
  | "flask"
  | "wheat"
  | "fuel";

export type UnifiedTimelineEvent = {
  id: string;
  fieldId: string;
  /** YYYY-MM-DD */
  date: string;
  type: UnifiedTimelineEventType;
  title: string;
  subtitle: string;
  /** Відформатована метрика: «142 л», «5.2 т», «48 га» */
  metric: string;
  icon: UnifiedTimelineIcon;
};

export type FieldTimelineField = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
};

export type FieldWithTimeline = {
  field: FieldTimelineField;
  events: UnifiedTimelineEvent[];
};

export const TIMELINE_EVENTS_PER_FIELD = 20;

const MATERIAL_LABEL: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  other: "ТМЦ",
};

type TimelineFieldRow = {
  id: string;
  name: string;
  crop: string;
  area_ha: number | string;
  wialon_zone_id?: string | null;
};

type RawMoveRow = {
  id: string;
  field_id: string | null;
  date: string;
  qty: number | string;
  inventory_items_cache:
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
      }
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
      }[]
    | null;
};

type RawOpRow = {
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
  status: string | null;
  actor_name?: string | null;
  closed_by_name?: string | null;
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

function eventDateMs(date: string): number {
  const t = new Date(`${date.slice(0, 10)}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  const u = unit.trim();
  return u ? `${n} ${u}` : n;
}

function formatLiters(value: number): string {
  if (value <= 0) return "—";
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} л`;
}

function inventoryIcon(category: string | null | undefined): UnifiedTimelineIcon {
  if (category === "seed") return "wheat";
  if (category === "fertilizer") return "flask";
  if (category === "zzr") return "package";
  return "package";
}

function materialCategoryLabel(category: string | null | undefined): string {
  if (category && MATERIAL_LABEL[category]) return MATERIAL_LABEL[category];
  return MATERIAL_LABEL.other;
}

function cleanMachinery(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text && text !== "—" ? text : "";
}

function equipmentSubtitle(row: RawOpRow): string {
  const driver =
    String(row.closed_by_name ?? "").trim() ||
    String(row.actor_name ?? "").trim();
  const implement = cleanMachinery(row.implement);
  const parts = [driver, implement].filter(Boolean);
  return parts.join(" · ") || "—";
}

export function mapOperationToTimelineEvent(
  row: RawOpRow,
  fieldId: string
): UnifiedTimelineEvent | null {
  if (String(row.status ?? "") !== "completed") return null;

  const workType = String(row.work_type ?? "").trim();
  const machinery = cleanMachinery(row.machinery);
  const title = workType || machinery || "Наряд";

  const fuelFact = num(row.fuel_fact);
  const fuelPlan = num(row.fuel_plan);
  const fuelUsedL = fuelFact > 0 ? fuelFact : Math.max(0, fuelPlan);

  const date =
    String(row.occurred_at ?? "").slice(0, 10) ||
    String(row.closed_at ?? "").slice(0, 10) ||
    String(row.created_at ?? "").slice(0, 10);
  if (!date) return null;

  return {
    id: `equipment:${String(row.client_key ?? row.id)}`,
    fieldId,
    date,
    type: "equipment",
    title,
    subtitle: equipmentSubtitle(row),
    metric: formatLiters(fuelUsedL),
    icon: "tractor",
  };
}

export function mapInventoryMoveToTimelineEvent(
  row: RawMoveRow
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

  const date = String(row.date ?? "").slice(0, 10);
  if (!date) return null;

  return {
    id: `inventory:${String(row.id)}`,
    fieldId,
    date,
    type: "inventory",
    title,
    subtitle: materialCategoryLabel(category),
    metric: formatQty(qty, unit),
    icon: inventoryIcon(category),
  };
}

export function groupFieldsWithTimeline(
  fields: FieldTimelineField[],
  events: UnifiedTimelineEvent[],
  limitPerField = TIMELINE_EVENTS_PER_FIELD
): FieldWithTimeline[] {
  const activeIds = new Set(fields.map((f) => f.id));
  const byField = new Map<string, UnifiedTimelineEvent[]>();

  for (const event of events) {
    if (!activeIds.has(event.fieldId)) continue;
    const bucket = byField.get(event.fieldId) ?? [];
    bucket.push(event);
    byField.set(event.fieldId, bucket);
  }

  return fields
    .map((field) => {
      const fieldEvents = (byField.get(field.id) ?? []).sort((a, b) => {
        const byDate = eventDateMs(b.date) - eventDateMs(a.date);
        if (byDate !== 0) return byDate;
        return a.id.localeCompare(b.id);
      });

      return {
        field,
        events: fieldEvents.slice(0, limitPerField),
      };
    })
    .sort((a, b) => a.field.name.localeCompare(b.field.name, "uk"));
}

function parseFarmFieldId(fieldKey: string | null | undefined): string | null {
  const key = String(fieldKey ?? "").trim();
  if (!key.startsWith("farm:")) return null;
  const id = key.slice(5);
  return isUuid(id) ? id : null;
}

function buildFieldKeyResolver(fields: TimelineFieldRow[]) {
  const wialonToFieldId = new Map<string, string>();
  for (const field of fields) {
    const zoneId = String(field.wialon_zone_id ?? "").trim();
    if (zoneId) wialonToFieldId.set(zoneId, field.id);
  }

  return (row: RawOpRow): string | null => {
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

function mapTimelineFields(rows: TimelineFieldRow[]): FieldTimelineField[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    crop: String(row.crop),
    areaHa: num(row.area_ha),
  }));
}

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
  status,
  actor_name,
  closed_by_name
`;

const MOVE_SELECT = `
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

async function fetchActiveFields(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<TimelineFieldRow[]> {
  const withFlag = await supabase
    .from("farm_fields")
    .select("id, name, crop, area_ha, wialon_zone_id")
    .eq("is_field", true)
    .order("name", { ascending: true });

  if (!withFlag.error) return (withFlag.data ?? []) as TimelineFieldRow[];

  if (
    withFlag.error.message?.includes("is_field") ||
    withFlag.error.code === "42703"
  ) {
    const fallback = await supabase
      .from("farm_fields")
      .select("id, name, crop, area_ha, wialon_zone_id")
      .order("name", { ascending: true });
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data ?? []) as TimelineFieldRow[];
  }

  throw new Error(withFlag.error.message);
}

async function fetchCompletedOperations(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<RawOpRow[]> {
  const { data, error } = await supabase
    .from("field_operations")
    .select(OP_SELECT)
    .eq("status", "completed")
    .eq("season", season)
    .order("occurred_at", { ascending: false });

  if (!error) return (data ?? []) as RawOpRow[];

  if (error.message?.includes("season") || error.code === "42703") {
    const legacy = await supabase
      .from("field_operations")
      .select(OP_SELECT.replace(/\s+/g, " ").trim())
      .eq("status", "completed")
      .order("occurred_at", { ascending: false });
    if (legacy.error) {
      if (legacy.error.code === "PGRST205" || legacy.error.code === "42P01") {
        return [];
      }
      throw new Error(legacy.error.message);
    }
    return (legacy.data ?? []) as RawOpRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  if (
    error.message?.includes("actor_name") ||
    error.message?.includes("closed_by_name")
  ) {
    const legacySelect = OP_SELECT.replace(/,\s*actor_name,\s*closed_by_name/, "");
    const legacy = await supabase
      .from("field_operations")
      .select(legacySelect)
      .eq("status", "completed")
      .eq("season", season)
      .order("occurred_at", { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as RawOpRow[];
  }

  throw new Error(error.message);
}

async function fetchOutboundMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<RawMoveRow[]> {
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(MOVE_SELECT)
    .eq("type", "outbound")
    .not("field_id", "is", null)
    .eq("season", season)
    .order("date", { ascending: false });

  if (!error) return (data ?? []) as RawMoveRow[];

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
    return (legacy.data ?? []) as RawMoveRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

/** Серверна агрегація: поля + події, згруповані та обрізані до 20 на поле. */
export async function fetchFieldTimeline(
  activeSeason: string = DEFAULT_SEASON
): Promise<FieldWithTimeline[]> {
  const season = normalizeSeason(activeSeason);
  const supabase = createServiceSupabase();

  const [fieldRows, ops, moves] = await Promise.all([
    fetchActiveFields(supabase),
    fetchCompletedOperations(supabase, season),
    fetchOutboundMoves(supabase, season),
  ]);

  const fields = mapTimelineFields(fieldRows);
  const resolveFieldId = buildFieldKeyResolver(fieldRows);
  const events: UnifiedTimelineEvent[] = [];

  for (const row of ops) {
    const fieldId = resolveFieldId(row);
    if (!fieldId) continue;
    const event = mapOperationToTimelineEvent(row, fieldId);
    if (event) events.push(event);
  }

  for (const row of moves) {
    const event = mapInventoryMoveToTimelineEvent(row);
    if (event) events.push(event);
  }

  return groupFieldsWithTimeline(fields, events);
}

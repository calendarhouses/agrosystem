/**
 * Єдина стрічка подій поля: списання ТМЦ + закриті наряди + Wialon-паливо.
 * Для вкладки «Історія» у FieldDetailSheet.
 */

import { resolveUnitPriceOrZero } from "@/lib/field-analytics";
import { DEFAULT_DIESEL_PRICE_UAH, getLatestFuelPurchasePriceUah } from "@/lib/fuel-price";
import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";

export type FieldEventMaterialCategory =
  | "zzr"
  | "fertilizer"
  | "seed"
  | "other";

export type FieldEventMaterial = {
  id: string;
  type: "material";
  /** YYYY-MM-DD */
  date: string;
  /** Назва ТМЦ */
  title: string;
  category: FieldEventMaterialCategory;
  categoryLabel: string;
  qty: number;
  unit: string;
  costUah: number;
  status: "draft" | "sent_to_1c";
  /** Хто зберіг у системі, напр. «Юрій» */
  actorName: string | null;
};

export type FieldEventOperation = {
  id: string;
  type: "operation";
  /** YYYY-MM-DD */
  date: string;
  /** Напр. «Посів · Соя» */
  title: string;
  workType: string;
  crop: string;
  machinery: string;
  /** Виконана площа, га */
  areaHa: number;
  /** Спалене паливо, л */
  fuelUsedL: number;
  /** ЗП тракториста, ₴ */
  wageUah: number;
  /** Вартість палива (л × ціна), ₴ */
  fuelCostUah: number;
  /** Паливо + ЗП, ₴ */
  costUah: number;
  status: "completed";
  actorName: string | null;
  closedByName: string | null;
};

/** Автоматичний лог витрати з ДРП Wialon */
export type FieldEventWialonFuel = {
  id: string;
  type: "wialon_fuel";
  /** YYYY-MM-DD */
  date: string;
  /** Напр. «Wialon: Спалено 142 л (МТЗ-82)» */
  title: string;
  equipmentName: string;
  fuelUsedL: number;
  fuelCostUah: number;
  status: "automatic";
};

export type FieldEvent =
  | FieldEventMaterial
  | FieldEventOperation
  | FieldEventWialonFuel;

const MATERIAL_LABEL: Record<FieldEventMaterialCategory, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  other: "ТМЦ",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asMaterialCategory(
  raw: string | null | undefined
): FieldEventMaterialCategory {
  if (raw === "zzr" || raw === "fertilizer" || raw === "seed") return raw;
  return "other";
}

function eventDateMs(date: string): number {
  const t = new Date(`${date.slice(0, 10)}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : 0;
}

type RawMoveRow = {
  id: string;
  date: string;
  qty: number | string;
  status: string | null;
  actor_name?: string | null;
  inventory_items_cache:
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }
    | {
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }[]
    | null;
};

type RawOpRow = {
  id: string;
  client_key?: string | null;
  work_type: string | null;
  crop: string | null;
  machinery: string | null;
  occurred_at: string | null;
  closed_at: string | null;
  created_at?: string | null;
  area_fact: number | string | null;
  area_plan: number | string | null;
  fuel_fact: number | string | null;
  fuel_plan: number | string | null;
  wage_fact: number | string | null;
  wage_plan: number | string | null;
  status: string | null;
  actor_name?: string | null;
  closed_by_name?: string | null;
};

function mapMaterial(row: RawMoveRow): FieldEventMaterial | null {
  const qty = num(row.qty);
  if (qty <= 0) return null;

  const cache = unwrapJoin(row.inventory_items_cache);
  const category = asMaterialCategory(cache?.category);
  const unit = (cache?.unit ?? "").trim();
  const unitPrice = resolveUnitPriceOrZero({
    planned_price_uah: cache?.planned_price_uah ?? null,
    unit_cost: cache?.unit_cost ?? null,
  });
  const title =
    cache?.custom_name?.trim() || cache?.name?.trim() || "ТМЦ";
  const date = String(row.date ?? "").slice(0, 10);
  if (!date) return null;

  return {
    id: `material:${String(row.id)}`,
    type: "material",
    date,
    title,
    category,
    categoryLabel: MATERIAL_LABEL[category],
    qty: round2(qty),
    unit,
    costUah: round2(qty * unitPrice),
    status: row.status === "sent_to_1c" ? "sent_to_1c" : "draft",
    actorName:
      row.actor_name != null && String(row.actor_name).trim()
        ? String(row.actor_name).trim()
        : null,
  };
}

function mapOperation(
  row: RawOpRow,
  dieselPriceUah: number
): FieldEventOperation | null {
  if (String(row.status ?? "") !== "completed") return null;

  const workType = (row.work_type ?? "").trim() || "Наряд";
  const crop = (row.crop ?? "").trim();
  const machinery = (row.machinery ?? "").trim();
  const title = crop ? `${workType} · ${crop}` : workType;

  const areaFact = num(row.area_fact);
  const areaPlan = num(row.area_plan);
  const areaHa = round2(areaFact > 0 ? areaFact : Math.max(0, areaPlan));

  const fuelFact = num(row.fuel_fact);
  const fuelPlan = num(row.fuel_plan);
  const fuelUsedL = round2(fuelFact > 0 ? fuelFact : Math.max(0, fuelPlan));

  const wageFact = num(row.wage_fact);
  const wagePlan = num(row.wage_plan);
  const wageUah = round2(wageFact > 0 ? wageFact : Math.max(0, wagePlan));

  const fuelCostUah = round2(fuelUsedL * dieselPriceUah);
  const date =
    String(row.occurred_at ?? "").slice(0, 10) ||
    String(row.closed_at ?? "").slice(0, 10) ||
    String(row.created_at ?? "").slice(0, 10);
  if (!date) return null;

  return {
    id: `operation:${String(row.client_key ?? row.id)}`,
    type: "operation",
    date,
    title,
    workType,
    crop,
    machinery: machinery && machinery !== "—" ? machinery : "",
    areaHa,
    fuelUsedL,
    wageUah,
    fuelCostUah,
    costUah: round2(fuelCostUah + wageUah),
    status: "completed",
    actorName:
      row.actor_name != null && String(row.actor_name).trim()
        ? String(row.actor_name).trim()
        : null,
    closedByName:
      row.closed_by_name != null && String(row.closed_by_name).trim()
        ? String(row.closed_by_name).trim()
        : null,
  };
}

/** Чиста зливка без I/O — зручно тестувати. */
export function buildFieldEvents(
  moves: RawMoveRow[],
  ops: RawOpRow[],
  wialonLogs: FieldEventWialonFuel[] = [],
  dieselPriceUah = DEFAULT_DIESEL_PRICE_UAH
): FieldEvent[] {
  const events: FieldEvent[] = [];

  for (const row of moves) {
    const event = mapMaterial(row);
    if (event) events.push(event);
  }

  for (const row of ops) {
    const event = mapOperation(row, dieselPriceUah);
    if (event) events.push(event);
  }

  for (const log of wialonLogs) {
    if (log.fuelUsedL > 0) events.push(log);
  }

  events.sort((a, b) => {
    const byDate = eventDateMs(b.date) - eventDateMs(a.date);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });

  return events;
}

async function fetchMaterialMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<RawMoveRow[]> {
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      date,
      qty,
      status,
      actor_name,
      inventory_items_cache (
        category,
        name,
        custom_name,
        unit,
        planned_price_uah,
        unit_cost
      )
    `
    )
    .eq("type", "outbound")
    .eq("field_id", fieldId)
    .eq("season", season)
    .order("date", { ascending: false });

  if (!error) return (data ?? []) as RawMoveRow[];

  if (error.message?.includes("season") || error.code === "42703") {
    const legacy = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        status,
        inventory_items_cache (
          category,
          name,
          custom_name,
          unit,
          planned_price_uah,
          unit_cost
        )
      `
      )
      .eq("type", "outbound")
      .eq("field_id", fieldId)
      .order("date", { ascending: false });
    if (!legacy.error) return (legacy.data ?? []) as RawMoveRow[];
  }

  if (
    error.message?.includes("planned_price_uah") ||
    error.message?.includes("unit_cost") ||
    error.message?.includes("custom_name")
  ) {
    const fallback = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        status,
        inventory_items_cache (
          category,
          name,
          unit
        )
      `
      )
      .eq("type", "outbound")
      .eq("field_id", fieldId)
      .eq("season", season)
      .order("date", { ascending: false });

    if (fallback.error) {
      if (
        fallback.error.code === "PGRST205" ||
        fallback.error.code === "42P01"
      ) {
        return [];
      }
      throw new Error(fallback.error.message);
    }

    return (fallback.data ?? []).map((row) => {
      const cache = unwrapJoin(row.inventory_items_cache);
      return {
        ...row,
        inventory_items_cache: cache
          ? {
              ...cache,
              custom_name: null,
              planned_price_uah: null,
              unit_cost: null,
            }
          : null,
      };
    }) as RawMoveRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

const COMPLETED_OP_SELECT = `
  id,
  client_key,
  work_type,
  crop,
  machinery,
  occurred_at,
  closed_at,
  created_at,
  area_fact,
  area_plan,
  fuel_fact,
  fuel_plan,
  wage_fact,
  wage_plan,
  status,
  actor_name,
  closed_by_name
`;

function dedupeRawOps(rows: RawOpRow[]): RawOpRow[] {
  const byId = new Map<string, RawOpRow>();
  for (const row of rows) {
    byId.set(String(row.id), row);
  }
  return Array.from(byId.values());
}

function completedOpsOrFilter(fieldId: string, fieldKeys: string[]): string {
  const keys = Array.from(
    new Set([`farm:${fieldId}`, ...fieldKeys].filter(Boolean))
  );
  return [
    `field_id.eq.${fieldId}`,
    ...keys.map((key) => `field_key.eq.${key}`),
  ].join(",");
}

async function resolveFieldOperationKeys(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string
): Promise<string[]> {
  const keys = [`farm:${fieldId}`];
  const { data, error } = await supabase
    .from("farm_fields")
    .select("wialon_zone_id")
    .eq("id", fieldId)
    .maybeSingle();

  if (!error) {
    const zoneId = String(data?.wialon_zone_id ?? "").trim();
    if (zoneId) keys.push(`wialon:${zoneId}`);
  }

  return Array.from(new Set(keys));
}

async function fetchCompletedOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string,
  fieldKeys: string[] = []
): Promise<RawOpRow[]> {
  const orFilter = completedOpsOrFilter(fieldId, fieldKeys);
  const { data, error } = await supabase
    .from("field_operations")
    .select(COMPLETED_OP_SELECT)
    .eq("status", "completed")
    .eq("season", season)
    .or(orFilter)
    .order("occurred_at", { ascending: false });

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("field_operations")
    ) {
      return [];
    }
    if (
      error.message?.includes("actor_name") ||
      error.message?.includes("closed_by_name")
    ) {
      const legacySelect = COMPLETED_OP_SELECT.replace(
        /,\s*actor_name,\s*closed_by_name/,
        ""
      );
      const legacy = await supabase
        .from("field_operations")
        .select(legacySelect)
        .eq("status", "completed")
        .eq("season", season)
        .or(orFilter)
        .order("occurred_at", { ascending: false });
      if (legacy.error) return [];
      return dedupeRawOps((legacy.data ?? []) as unknown as RawOpRow[]);
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const year = Number(season);
      let q = supabase
        .from("field_operations")
        .select(COMPLETED_OP_SELECT)
        .eq("status", "completed")
        .or(orFilter);
      if (Number.isFinite(year)) q = q.eq("season_year", year);
      const legacy = await q.order("occurred_at", { ascending: false });
      if (legacy.error) return [];
      return dedupeRawOps((legacy.data ?? []) as unknown as RawOpRow[]);
    }
    throw new Error(error.message);
  }

  return dedupeRawOps((data ?? []) as unknown as RawOpRow[]);
}

/**
 * Єдиний масив подій поля (ТМЦ + наряди + Wialon-паливо), нові → старі.
 * Порожні джерела не валять запит — повертають [].
 */
export async function fetchFieldEvents(
  fieldId: string,
  activeSeason: string = DEFAULT_SEASON
): Promise<FieldEvent[]> {
  const id = fieldId?.trim().toLowerCase();
  if (!id) return [];
  const season = normalizeSeason(activeSeason);

  const supabase = createServiceSupabase();
  const fieldKeys = await resolveFieldOperationKeys(supabase, id);
  const [moves, ops, wialonLogs, dieselPriceUah] = await Promise.all([
    fetchMaterialMoves(supabase, id, season),
    fetchCompletedOps(supabase, id, season, fieldKeys),
    fetchWialonFuelEvents(supabase, id, season),
    getLatestFuelPurchasePriceUah(DEFAULT_DIESEL_PRICE_UAH),
  ]);

  return buildFieldEvents(moves, ops, wialonLogs, dieselPriceUah);
}

async function fetchWialonFuelEvents(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<FieldEventWialonFuel[]> {
  const price = await getLatestFuelPurchasePriceUah(DEFAULT_DIESEL_PRICE_UAH);

  const { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select(
      `
      id,
      date,
      fuel_consumed,
      equipment (
        id,
        name
      )
    `
    )
    .eq("field_id", fieldId)
    .eq("season", season)
    .gt("fuel_consumed", 0)
    .order("date", { ascending: false });

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("wialon_field_fuel_logs")
    ) {
      return [];
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const legacy = await supabase
        .from("wialon_field_fuel_logs")
        .select(
          `
          id,
          date,
          fuel_consumed,
          equipment ( id, name )
        `
        )
        .eq("field_id", fieldId)
        .gt("fuel_consumed", 0)
        .order("date", { ascending: false });
      if (legacy.error) return [];
      return mapWialonFuelRows(legacy.data ?? [], price);
    }
    throw new Error(error.message);
  }

  return mapWialonFuelRows(data ?? [], price);
}

function mapWialonFuelRows(
  rows: Array<Record<string, unknown>>,
  price: number
): FieldEventWialonFuel[] {
  const events: FieldEventWialonFuel[] = [];
  for (const row of rows) {
    const liters = round2(Number(row.fuel_consumed) || 0);
    if (liters <= 0) continue;
    const eq = unwrapJoin(
      row.equipment as
        | { id: string; name: string | null }
        | { id: string; name: string | null }[]
        | null
    );
    const equipmentName = (eq?.name ?? "").trim() || "Техніка";
    const date = String(row.date ?? "").slice(0, 10);
    if (!date) continue;

    events.push({
      id: `wialon-fuel:${String(row.id)}`,
      type: "wialon_fuel",
      date,
      title: `Wialon: Спалено ${Math.round(liters)} л (${equipmentName})`,
      equipmentName,
      fuelUsedL: liters,
      fuelCostUah: round2(liters * price),
      status: "automatic",
    });
  }
  return events;
}

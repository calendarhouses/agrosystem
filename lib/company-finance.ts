/**
 * CEO-дашборд: глобальний Plan/Fact по всіх полях компанії.
 */

import {
  FUEL_PRICE_UAH,
  resolveUnitPriceOrZero,
} from "@/lib/field-analytics";
import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";

export type CompanyFieldBurnRow = {
  fieldId: string;
  name: string;
  crop: string;
  areaHa: number;
  /** Плановий бюджет поля ₴ (null якщо ₴/га не задано) */
  budgetUah: number | null;
  plannedBudgetPerHa: number | null;
  /** Факт витрат: ТМЦ + паливо + ЗП */
  spentUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
  /** (spent / budget) × 100; null якщо немає бюджету */
  burnRate: number | null;
};

export type CompanyFinancialOverview = {
  fieldsCount: number;
  fieldsWithBudget: number;
  totalAreaHa: number;
  /** Σ (planned_budget_per_ha × area) по полях із бюджетом */
  globalPlanUah: number;
  /** Σ витрат по всій компанії */
  globalFactUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
  /** globalFact / globalPlan × 100; null якщо план = 0 */
  globalBurnRate: number | null;
  /** Матриця полів, burnRate ↓ (проблемні зверху; без бюджету — внизу) */
  fields: CompanyFieldBurnRow[];
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

type FieldRow = {
  id: string;
  name: string;
  crop: string | null;
  area_ha: number | string | null;
  planned_budget_per_ha: number | string | null;
  is_field?: boolean | null;
};

type MoveRow = {
  field_id: string | null;
  qty: number | string | null;
  inventory_items_cache:
    | {
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }
    | {
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }[]
    | null;
};

type OpRow = {
  field_id: string | null;
  status: string | null;
  fuel_fact: number | string | null;
  fuel_plan: number | string | null;
  wage_fact: number | string | null;
  wage_plan: number | string | null;
};

function opFuelL(row: OpRow): number {
  const fact = num(row.fuel_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.fuel_plan));
}

function opWage(row: OpRow): number {
  const fact = num(row.wage_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.wage_plan));
}

/** Чиста зливка — зручно тестувати без I/O. */
export function buildCompanyFinancialOverview(
  fields: FieldRow[],
  moves: MoveRow[],
  ops: OpRow[]
): CompanyFinancialOverview {
  type Acc = {
    fieldId: string;
    name: string;
    crop: string;
    areaHa: number;
    plannedBudgetPerHa: number | null;
    inventorySpentUah: number;
    fuelCostUah: number;
    salaryUah: number;
  };

  const byId = new Map<string, Acc>();

  for (const f of fields) {
    const id = String(f.id).toLowerCase();
    if (!id) continue;
    const areaHa = num(f.area_ha);
    const plannedRaw = num(f.planned_budget_per_ha);
    const plannedBudgetPerHa =
      plannedRaw > 0 ? round2(plannedRaw) : null;

    byId.set(id, {
      fieldId: id,
      name: (f.name ?? "").trim() || "Поле",
      crop: (f.crop ?? "").trim() || "—",
      areaHa,
      plannedBudgetPerHa,
      inventorySpentUah: 0,
      fuelCostUah: 0,
      salaryUah: 0,
    });
  }

  for (const row of moves) {
    const fieldId = row.field_id ? String(row.field_id).toLowerCase() : "";
    if (!fieldId) continue;
    const acc = byId.get(fieldId);
    if (!acc) continue;

    const qty = num(row.qty);
    if (qty <= 0) continue;
    const cache = unwrapJoin(row.inventory_items_cache);
    const unitPrice = resolveUnitPriceOrZero({
      planned_price_uah: cache?.planned_price_uah ?? null,
      unit_cost: cache?.unit_cost ?? null,
    });
    acc.inventorySpentUah = round2(
      acc.inventorySpentUah + qty * unitPrice
    );
  }

  for (const row of ops) {
    if (String(row.status ?? "") !== "completed") continue;
    const fieldId = row.field_id ? String(row.field_id).toLowerCase() : "";
    if (!fieldId) continue;
    const acc = byId.get(fieldId);
    if (!acc) continue;

    const fuelL = opFuelL(row);
    const wage = opWage(row);
    acc.fuelCostUah = round2(acc.fuelCostUah + fuelL * FUEL_PRICE_UAH);
    acc.salaryUah = round2(acc.salaryUah + wage);
  }

  const matrix: CompanyFieldBurnRow[] = [];
  let globalPlanUah = 0;
  let globalFactUah = 0;
  let inventorySpentUah = 0;
  let fuelCostUah = 0;
  let salaryUah = 0;
  let totalAreaHa = 0;
  let fieldsWithBudget = 0;

  for (const acc of byId.values()) {
    const spentUah = Math.round(
      acc.inventorySpentUah + acc.fuelCostUah + acc.salaryUah
    );
    const budgetUah =
      acc.plannedBudgetPerHa != null && acc.areaHa > 0
        ? Math.round(acc.plannedBudgetPerHa * acc.areaHa)
        : null;
    const burnRate =
      budgetUah != null && budgetUah > 0
        ? Math.round((spentUah / budgetUah) * 1000) / 10
        : null;

    if (budgetUah != null) {
      globalPlanUah += budgetUah;
      fieldsWithBudget += 1;
    }
    globalFactUah += spentUah;
    inventorySpentUah += Math.round(acc.inventorySpentUah);
    fuelCostUah += Math.round(acc.fuelCostUah);
    salaryUah += Math.round(acc.salaryUah);
    totalAreaHa += acc.areaHa;

    matrix.push({
      fieldId: acc.fieldId,
      name: acc.name,
      crop: acc.crop,
      areaHa: round2(acc.areaHa),
      budgetUah,
      plannedBudgetPerHa: acc.plannedBudgetPerHa,
      spentUah,
      inventorySpentUah: Math.round(acc.inventorySpentUah),
      fuelCostUah: Math.round(acc.fuelCostUah),
      salaryUah: Math.round(acc.salaryUah),
      burnRate,
    });
  }

  matrix.sort((a, b) => {
    const aRate = a.burnRate;
    const bRate = b.burnRate;
    if (aRate == null && bRate == null) {
      return b.spentUah - a.spentUah || a.name.localeCompare(b.name, "uk");
    }
    if (aRate == null) return 1;
    if (bRate == null) return -1;
    return (
      bRate - aRate ||
      b.spentUah - a.spentUah ||
      a.name.localeCompare(b.name, "uk")
    );
  });

  const globalBurnRate =
    globalPlanUah > 0
      ? Math.round((globalFactUah / globalPlanUah) * 1000) / 10
      : null;

  return {
    fieldsCount: matrix.length,
    fieldsWithBudget,
    totalAreaHa: round2(totalAreaHa),
    globalPlanUah: Math.round(globalPlanUah),
    globalFactUah: Math.round(globalFactUah),
    inventorySpentUah: Math.round(inventorySpentUah),
    fuelCostUah: Math.round(fuelCostUah),
    salaryUah: Math.round(salaryUah),
    globalBurnRate,
    fields: matrix,
  };
}

async function fetchActiveFields(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<FieldRow[]> {
  const { data, error } = await supabase
    .from("farm_fields")
    .select("id, name, crop, area_ha, planned_budget_per_ha, is_field")
    .eq("is_field", true)
    .order("name", { ascending: true });

  if (!error) return (data ?? []) as FieldRow[];

  // До міграції is_field / planned_budget — деградація
  if (
    error.message?.includes("planned_budget_per_ha") ||
    error.message?.includes("is_field") ||
    error.code === "42703"
  ) {
    const fallback = await supabase
      .from("farm_fields")
      .select("id, name, crop, area_ha")
      .order("name", { ascending: true });
    if (fallback.error) {
      if (
        fallback.error.code === "PGRST205" ||
        fallback.error.code === "42P01"
      ) {
        return [];
      }
      throw new Error(fallback.error.message);
    }
    return (fallback.data ?? []).map((row) => ({
      ...row,
      planned_budget_per_ha: null,
      is_field: true,
    })) as FieldRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

async function fetchAllOutboundMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<MoveRow[]> {
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      field_id,
      qty,
      inventory_items_cache (
        planned_price_uah,
        unit_cost
      )
    `
    )
    .eq("type", "outbound")
    .eq("season", season)
    .not("field_id", "is", null);

  if (!error) return (data ?? []) as MoveRow[];

  if (error.message?.includes("season") || error.code === "42703") {
    const legacy = await supabase
      .from("inventory_local_moves")
      .select(
        `
        field_id,
        qty,
        inventory_items_cache (
          planned_price_uah,
          unit_cost
        )
      `
      )
      .eq("type", "outbound")
      .not("field_id", "is", null);
    if (!legacy.error) return (legacy.data ?? []) as MoveRow[];
  }

  if (
    error.message?.includes("planned_price_uah") ||
    error.message?.includes("unit_cost")
  ) {
    const fallback = await supabase
      .from("inventory_local_moves")
      .select(
        `
        field_id,
        qty,
        inventory_items_cache ( unit_cost )
      `
      )
      .eq("type", "outbound")
      .eq("season", season)
      .not("field_id", "is", null);

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
        field_id: row.field_id as string | null,
        qty: row.qty as number | string | null,
        inventory_items_cache: cache
          ? {
              planned_price_uah: null,
              unit_cost:
                (cache as { unit_cost?: number | null }).unit_cost ?? null,
            }
          : null,
      };
    });
  }

  if (error.code === "PGRST205" || error.code === "42P01") return [];
  throw new Error(error.message);
}

async function fetchAllCompletedOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<OpRow[]> {
  const { data, error } = await supabase
    .from("field_operations")
    .select(
      `
      field_id,
      status,
      fuel_fact,
      fuel_plan,
      wage_fact,
      wage_plan
    `
    )
    .eq("status", "completed")
    .eq("season", season)
    .not("field_id", "is", null);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("field_operations")
    ) {
      return [];
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const year = Number(season);
      let q = supabase
        .from("field_operations")
        .select(
          `
          field_id,
          status,
          fuel_fact,
          fuel_plan,
          wage_fact,
          wage_plan
        `
        )
        .eq("status", "completed")
        .not("field_id", "is", null);
      if (Number.isFinite(year)) q = q.eq("season_year", year);
      const legacy = await q;
      if (legacy.error) return [];
      return (legacy.data ?? []) as OpRow[];
    }
    throw new Error(error.message);
  }

  return (data ?? []) as OpRow[];
}

/**
 * 3 паралельні запити → єдина агрегація в памʼяті.
 * @param activeSeason — агросезон ('2026' …)
 */
export async function fetchCompanyFinancialOverview(
  activeSeason: string = DEFAULT_SEASON
): Promise<CompanyFinancialOverview> {
  const season = normalizeSeason(activeSeason);
  const supabase = createServiceSupabase();

  const [fields, moves, ops] = await Promise.all([
    fetchActiveFields(supabase),
    fetchAllOutboundMoves(supabase, season),
    fetchAllCompletedOps(supabase, season),
  ]);

  return buildCompanyFinancialOverview(fields, moves, ops);
}

/**
 * Live-економіка одного поля:
 * ТМЦ (inventory_local_moves) + ЗП (field_operations) +
 * Паливо з wialon_field_fuel_logs (авто ДРП).
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import {
  DEFAULT_DIESEL_PRICE_UAH,
  getLatestFuelPurchasePriceUah,
} from "@/lib/fuel-price";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";

/** @deprecated Використовуйте DEFAULT_DIESEL_PRICE_UAH з lib/fuel-price */
export { DEFAULT_DIESEL_PRICE_UAH as FUEL_PRICE_UAH } from "@/lib/fuel-price";

export type LiveFieldEconomicsCategoryKey =
  | "zzr"
  | "fertilizer"
  | "seed"
  | "fuel"
  | "salary";

export type LiveFieldCategoryBreakdown = {
  key: LiveFieldEconomicsCategoryKey;
  label: string;
  /** Сума кількості (од. виміру можуть змішуватись усередині категорії) */
  qty: number;
  /** Найчастіша одиниця в категорії */
  unit: string;
  /** Сума витрат ₴; null-ціни = 0 */
  costUah: number;
};

export type LiveFieldRecentMove = {
  id: string;
  date: string;
  qty: number;
  unit: string;
  itemName: string;
  category: LiveFieldEconomicsCategoryKey | "other" | "operation";
  categoryLabel: string;
  /** Витрати в ₴; null-ціна → 0 */
  costUah: number;
  status: "draft" | "sent_to_1c" | "completed";
  /** Джерело рядка таймлайну */
  source: "inventory" | "operation";
};

/** Списані на поле ТМЦ без ціни (для inline-редагування в економіці). */
export type UnpricedFieldMaterial = {
  basRefKey: string;
  name: string;
  unit: string;
  category: "zzr" | "fertilizer" | "seed";
  totalQty: number;
};

export type LiveFieldEconomics = {
  fieldId: string;
  /** Площа поля, га (з farm_fields) */
  areaHa: number;
  /** Загальні витрати: ТМЦ + паливо + ЗП */
  totalSpentUah: number;
  /** Спалене паливо, л (з wialon_field_fuel_logs) */
  totalFuelUsed: number;
  /** Вартість палива ₴ (л × ціна останньої закупки) */
  fuelCostUah: number;
  /** Нарахована ЗП ₴ */
  totalSalaryUah: number;
  /** Плановий бюджет ₴/га; null = не задано */
  plannedBudgetPerHa: number | null;
  /** plannedBudgetPerHa × areaHa; null якщо бюджет не задано */
  totalPlannedBudget: number | null;
  /** (totalSpentUah / totalPlannedBudget) × 100; null якщо немає плану */
  budgetUsedPercentage: number | null;
  moveCount: number;
  categoriesBreakdown: Record<
    LiveFieldEconomicsCategoryKey,
    LiveFieldCategoryBreakdown
  >;
  /** Останні 5 подій (ТМЦ + наряди), новіші першими */
  recentMoves: LiveFieldRecentMove[];
  /** ТМЦ без planned/unit ціни, списані на поле в сезоні */
  unpricedMaterials: UnpricedFieldMaterial[];
  /** Ціна дизеля ₴/л на момент розрахунку */
  dieselPriceUah: number;
};

const CAT_LABEL: Record<LiveFieldEconomicsCategoryKey, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  fuel: "Паливо",
  salary: "Зарплата",
};

const EMPTY_BREAKDOWN = (): Record<
  LiveFieldEconomicsCategoryKey,
  LiveFieldCategoryBreakdown
> => ({
  zzr: { key: "zzr", label: CAT_LABEL.zzr, qty: 0, unit: "", costUah: 0 },
  fertilizer: {
    key: "fertilizer",
    label: CAT_LABEL.fertilizer,
    qty: 0,
    unit: "",
    costUah: 0,
  },
  seed: { key: "seed", label: CAT_LABEL.seed, qty: 0, unit: "", costUah: 0 },
  fuel: { key: "fuel", label: CAT_LABEL.fuel, qty: 0, unit: "л", costUah: 0 },
  salary: {
    key: "salary",
    label: CAT_LABEL.salary,
    qty: 0,
    unit: "",
    costUah: 0,
  },
});

function emptyEconomics(fieldId: string): LiveFieldEconomics {
  return {
    fieldId,
    areaHa: 0,
    totalSpentUah: 0,
    totalFuelUsed: 0,
    fuelCostUah: 0,
    totalSalaryUah: 0,
    plannedBudgetPerHa: null,
    totalPlannedBudget: null,
    budgetUsedPercentage: null,
    moveCount: 0,
    categoriesBreakdown: EMPTY_BREAKDOWN(),
    recentMoves: [],
    unpricedMaterials: [],
    dieselPriceUah: 0,
  };
}

/** Plan/Fact: бюджет з planned_budget_per_ha × площа. */
export function attachFieldBudget(
  economics: LiveFieldEconomics,
  areaHa: number,
  plannedBudgetPerHa: number | null
): LiveFieldEconomics {
  const area = Number.isFinite(areaHa) && areaHa > 0 ? areaHa : 0;
  const perHaRaw = plannedBudgetPerHa != null ? Number(plannedBudgetPerHa) : NaN;
  const perHa =
    Number.isFinite(perHaRaw) && perHaRaw > 0 ? round2(perHaRaw) : null;
  const totalPlanned =
    perHa != null && area > 0 ? Math.round(perHa * area) : null;
  const budgetUsedPercentage =
    totalPlanned != null && totalPlanned > 0
      ? Math.round((economics.totalSpentUah / totalPlanned) * 1000) / 10
      : null;

  return {
    ...economics,
    areaHa: area,
    plannedBudgetPerHa: perHa,
    totalPlannedBudget: totalPlanned,
    budgetUsedPercentage,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function asCategory(
  raw: string | null | undefined
): Exclude<LiveFieldEconomicsCategoryKey, "fuel" | "salary"> | null {
  if (raw === "zzr" || raw === "fertilizer" || raw === "seed") return raw;
  return null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ціна за од.: planned_price_uah, інакше unit_cost.
 * Null / NaN / відʼємне → 0.
 */
export function resolveUnitPriceOrZero(item: {
  planned_price_uah?: number | null;
  unit_cost?: number | null;
}): number {
  const planned = Number(item.planned_price_uah);
  if (Number.isFinite(planned) && planned > 0) return planned;
  const from1c = Number(item.unit_cost);
  if (Number.isFinite(from1c) && from1c > 0) return from1c;
  return 0;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type RawMoveRow = {
  id: string;
  date: string;
  qty: number | string;
  status: string | null;
  inventory_items_cache:
    | {
        bas_ref_key?: string | null;
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }
    | {
        bas_ref_key?: string | null;
        category: string | null;
        name: string | null;
        custom_name: string | null;
        unit: string | null;
        planned_price_uah: number | null;
        unit_cost?: number | null;
      }[]
    | null;
};

export type RawOperationRow = {
  id: string;
  client_key?: string | null;
  work_type: string | null;
  machinery: string | null;
  occurred_at: string | null;
  closed_at: string | null;
  created_at?: string | null;
  fuel_fact: number | string | null;
  fuel_plan: number | string | null;
  wage_fact: number | string | null;
  wage_plan: number | string | null;
  status: string | null;
};

function opFuelLiters(row: RawOperationRow): number {
  const fact = num(row.fuel_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.fuel_plan));
}

function opWageUah(row: RawOperationRow): number {
  const fact = num(row.wage_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.wage_plan));
}

function opDate(row: RawOperationRow): string {
  const raw =
    String(row.occurred_at ?? "").slice(0, 10) ||
    String(row.closed_at ?? "").slice(0, 10) ||
    String(row.created_at ?? "").slice(0, 10);
  return raw || new Date().toISOString().slice(0, 10);
}

function opTitle(row: RawOperationRow): string {
  const work = (row.work_type ?? "").trim() || "Наряд";
  const machine = (row.machinery ?? "").trim();
  if (machine && machine !== "—") return `${work} · ${machine}`;
  return work;
}

export type AggregateLiveFieldOptions = {
  /** Сума л з wialon_field_fuel_logs (замість fuel з нарядів) */
  wialonFuelLiters?: number;
  /** ₴/л (остання закупівля); default FUEL_PRICE_UAH */
  fuelPriceUah?: number;
};

/** Чиста агрегація (без I/O). */
export function aggregateLiveFieldEconomics(
  fieldId: string,
  rows: RawMoveRow[],
  ops: RawOperationRow[] = [],
  options?: AggregateLiveFieldOptions
): LiveFieldEconomics {
  const breakdown = EMPTY_BREAKDOWN();
  const unitVotes: Record<"zzr" | "fertilizer" | "seed", Map<string, number>> =
    {
      zzr: new Map(),
      fertilizer: new Map(),
      seed: new Map(),
    };

  let inventorySpent = 0;
  const recentCandidates: LiveFieldRecentMove[] = [];
  const unpricedMap = new Map<string, UnpricedFieldMaterial>();

  for (const row of rows) {
    const qty = Number(row.qty) || 0;
    if (qty <= 0) continue;

    const cache = unwrapJoin(row.inventory_items_cache);
    const cat = asCategory(cache?.category ?? null);
    const unit = (cache?.unit ?? "").trim();
    const unitPrice = resolveUnitPriceOrZero({
      planned_price_uah: cache?.planned_price_uah ?? null,
      unit_cost: cache?.unit_cost ?? null,
    });
    const costUah = round2(qty * unitPrice);
    inventorySpent += costUah;

    const itemName =
      cache?.custom_name?.trim() || cache?.name?.trim() || "ТМЦ";
    const status =
      row.status === "sent_to_1c" ? "sent_to_1c" : ("draft" as const);

    if (cat && unitPrice <= 0) {
      const basRefKey = String(cache?.bas_ref_key ?? "").trim().toLowerCase();
      if (basRefKey) {
        const existing = unpricedMap.get(basRefKey);
        if (existing) {
          existing.totalQty = round2(existing.totalQty + qty);
        } else {
          unpricedMap.set(basRefKey, {
            basRefKey,
            name: itemName,
            unit,
            category: cat,
            totalQty: round2(qty),
          });
        }
      }
    }

    recentCandidates.push({
      id: `inv:${String(row.id)}`,
      date: String(row.date),
      qty: round2(qty),
      unit,
      itemName,
      category: cat ?? "other",
      categoryLabel: cat ? CAT_LABEL[cat] : "Інше",
      costUah,
      status,
      source: "inventory",
    });

    if (!cat) continue;

    breakdown[cat].qty = round2(breakdown[cat].qty + qty);
    breakdown[cat].costUah = round2(breakdown[cat].costUah + costUah);
    if (unit) {
      unitVotes[cat].set(unit, (unitVotes[cat].get(unit) ?? 0) + qty);
    }
  }

  for (const key of ["zzr", "fertilizer", "seed"] as const) {
    let bestUnit = "";
    let bestQty = 0;
    for (const [u, q] of unitVotes[key]) {
      if (q > bestQty) {
        bestQty = q;
        bestUnit = u;
      }
    }
    breakdown[key].unit = bestUnit;
  }

  const fuelPrice =
    options?.fuelPriceUah != null &&
    Number.isFinite(options.fuelPriceUah) &&
    options.fuelPriceUah > 0
      ? options.fuelPriceUah
      : DEFAULT_DIESEL_PRICE_UAH;

  let totalFuelUsed =
    options?.wialonFuelLiters != null &&
    Number.isFinite(options.wialonFuelLiters)
      ? round2(Math.max(0, options.wialonFuelLiters))
      : 0;

  let opsFuelTotal = 0;
  for (const op of ops) {
    if (String(op.status ?? "") !== "completed") continue;
    opsFuelTotal += opFuelLiters(op);
  }
  opsFuelTotal = round2(opsFuelTotal);

  // Якщо Wialon ще не дав літри — беремо факт/план з закритих нарядів
  if (totalFuelUsed <= 0 && opsFuelTotal > 0) {
    totalFuelUsed = opsFuelTotal;
  }

  let totalSalaryUah = 0;
  let salaryOpCount = 0;

  for (const op of ops) {
    if (String(op.status ?? "") !== "completed") continue;

    const wage = opWageUah(op);
    // Паливо в економіці — лише з Wialon-логів; у таймлайні наряду — факт/план для довідки
    const fuelL = opFuelLiters(op);
    const opCost = round2(wage);

    if (wage > 0) {
      totalSalaryUah = round2(totalSalaryUah + wage);
      salaryOpCount += 1;
    }

    recentCandidates.push({
      id: `op:${String(op.client_key ?? op.id)}`,
      date: opDate(op),
      qty: fuelL > 0 ? round2(fuelL) : 0,
      unit: fuelL > 0 ? "л" : "",
      itemName: opTitle(op),
      category: "operation",
      categoryLabel: "Наряд",
      costUah: opCost,
      status: "completed",
      source: "operation",
    });
  }

  // Legacy fallback: Wialon може бути порожнім — opsFuelTotal уже підставлено вище

  const fuelCostUah = round2(totalFuelUsed * fuelPrice);
  breakdown.fuel.qty = totalFuelUsed;
  breakdown.fuel.unit = "л";
  breakdown.fuel.costUah = fuelCostUah;
  breakdown.salary.qty = salaryOpCount;
  breakdown.salary.unit = salaryOpCount === 1 ? "наряд" : "наряди";
  breakdown.salary.costUah = totalSalaryUah;

  recentCandidates.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const totalSpentUah = Math.round(
    inventorySpent + fuelCostUah + totalSalaryUah
  );

  return {
    fieldId,
    areaHa: 0,
    totalSpentUah,
    totalFuelUsed,
    fuelCostUah,
    totalSalaryUah,
    plannedBudgetPerHa: null,
    totalPlannedBudget: null,
    budgetUsedPercentage: null,
    moveCount: recentCandidates.length,
    categoriesBreakdown: breakdown,
    recentMoves: recentCandidates.slice(0, 5),
    unpricedMaterials: [...unpricedMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "uk")
    ),
    dieselPriceUah: fuelPrice,
  };
}

async function fetchInventoryMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<RawMoveRow[]> {
  const applySeason = <T extends { eq: (c: string, v: string) => T }>(q: T) =>
    q.eq("season", season);

  let query = supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      date,
      qty,
      status,
      inventory_items_cache (
        bas_ref_key,
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
    .eq("field_id", fieldId);

  query = applySeason(query);
  const { data, error } = await query.order("date", { ascending: false });

  if (!error) return (data ?? []) as RawMoveRow[];

  // Колонка season ще не існує — без фільтра сезону
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
          bas_ref_key,
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
      // season missing
      if (fallback.error.message?.includes("season")) {
        const noSeason = await supabase
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
          .order("date", { ascending: false });
        if (noSeason.error) {
          if (
            noSeason.error.code === "PGRST205" ||
            noSeason.error.code === "42P01"
          ) {
            return [];
          }
          throw new Error(noSeason.error.message);
        }
        return (noSeason.data ?? []).map((row) => ({
          ...row,
          inventory_items_cache: unwrapJoin(row.inventory_items_cache)
            ? {
                ...unwrapJoin(row.inventory_items_cache)!,
                custom_name: null,
                planned_price_uah: null,
                unit_cost: null,
              }
            : null,
        })) as RawMoveRow[];
      }
      throw new Error(fallback.error.message);
    }

    return (fallback.data ?? []).map((row) => ({
      ...row,
      inventory_items_cache: unwrapJoin(row.inventory_items_cache)
        ? {
            ...unwrapJoin(row.inventory_items_cache)!,
            custom_name: null,
            planned_price_uah: null,
            unit_cost: null,
          }
        : null,
    })) as RawMoveRow[];
  }

  if (error.code === "PGRST205" || error.code === "42P01") {
    return [];
  }

  throw new Error(error.message);
}

async function fetchCompletedOperations(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<RawOperationRow[]> {
  const { data, error } = await supabase
    .from("field_operations")
    .select(
      `
      id,
      client_key,
      work_type,
      machinery,
      occurred_at,
      closed_at,
      created_at,
      fuel_fact,
      fuel_plan,
      wage_fact,
      wage_plan,
      status
    `
    )
    .eq("field_id", fieldId)
    .eq("status", "completed")
    .eq("season", season)
    .order("occurred_at", { ascending: false });

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("field_operations")
    ) {
      return [];
    }
    // Fallback: season_year integer або без колонки season
    if (error.message?.includes("season") || error.code === "42703") {
      const year = Number(season);
      let q = supabase
        .from("field_operations")
        .select(
          `
          id,
          client_key,
          work_type,
          machinery,
          occurred_at,
          closed_at,
          created_at,
          fuel_fact,
          fuel_plan,
          wage_fact,
          wage_plan,
          status
        `
        )
        .eq("field_id", fieldId)
        .eq("status", "completed");
      if (Number.isFinite(year)) {
        q = q.eq("season_year", year);
      }
      const legacy = await q.order("occurred_at", { ascending: false });
      if (legacy.error) {
        if (
          legacy.error.code === "PGRST205" ||
          legacy.error.code === "42P01" ||
          legacy.error.message?.includes("season_year")
        ) {
          const bare = await supabase
            .from("field_operations")
            .select(
              `
              id,
              client_key,
              work_type,
              machinery,
              occurred_at,
              closed_at,
              created_at,
              fuel_fact,
              fuel_plan,
              wage_fact,
              wage_plan,
              status
            `
            )
            .eq("field_id", fieldId)
            .eq("status", "completed")
            .order("occurred_at", { ascending: false });
          if (bare.error) return [];
          return (bare.data ?? []) as RawOperationRow[];
        }
        return [];
      }
      return (legacy.data ?? []) as RawOperationRow[];
    }
    throw new Error(error.message);
  }

  return (data ?? []) as RawOperationRow[];
}

async function fetchWialonFuelLiters(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<number> {
  const { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select("fuel_consumed")
    .eq("field_id", fieldId)
    .eq("season", season);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("wialon_field_fuel_logs")
    ) {
      return 0;
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const legacy = await supabase
        .from("wialon_field_fuel_logs")
        .select("fuel_consumed")
        .eq("field_id", fieldId);
      if (legacy.error) return 0;
      return round2(
        (legacy.data ?? []).reduce(
          (acc, row) => acc + (Number(row.fuel_consumed) || 0),
          0
        )
      );
    }
    throw new Error(error.message);
  }

  return round2(
    (data ?? []).reduce(
      (acc, row) => acc + (Number(row.fuel_consumed) || 0),
      0
    )
  );
}

/**
 * Паралельно: outbound ТМЦ + завершені наряди + Wialon-паливо + бюджет поля.
 * @param activeSeason — агросезон ('2026' …)
 */
export async function fetchLiveFieldEconomics(
  fieldId: string,
  activeSeason: string = DEFAULT_SEASON
): Promise<LiveFieldEconomics> {
  const id = fieldId?.trim().toLowerCase();
  if (!id) return emptyEconomics("");
  const season = normalizeSeason(activeSeason);

  const supabase = createServiceSupabase();

  const [moves, ops, fieldRes, wialonFuelLiters, fuelPriceUah] =
    await Promise.all([
      fetchInventoryMoves(supabase, id, season),
      fetchCompletedOperations(supabase, id, season),
      supabase
        .from("farm_fields")
        .select("id, area_ha, planned_budget_per_ha")
        .eq("id", id)
        .maybeSingle(),
      fetchWialonFuelLiters(supabase, id, season),
      getLatestFuelPurchasePriceUah(DEFAULT_DIESEL_PRICE_UAH),
    ]);

  const base = aggregateLiveFieldEconomics(id, moves, ops, {
    wialonFuelLiters,
    fuelPriceUah,
  });

  // Колонка може ще не існувати до міграції 018
  if (
    fieldRes.error &&
    (fieldRes.error.message?.includes("planned_budget_per_ha") ||
      fieldRes.error.code === "42703")
  ) {
    const fallback = await supabase
      .from("farm_fields")
      .select("id, area_ha")
      .eq("id", id)
      .maybeSingle();
    const areaHa = num(fallback.data?.area_ha);
    return attachFieldBudget(base, areaHa, null);
  }

  const areaHa = num(fieldRes.data?.area_ha);
  const plannedRaw = fieldRes.data?.planned_budget_per_ha;
  const plannedBudgetPerHa =
    plannedRaw == null || plannedRaw === ""
      ? null
      : Number(plannedRaw);

  return attachFieldBudget(
    base,
    areaHa,
    Number.isFinite(plannedBudgetPerHa as number)
      ? (plannedBudgetPerHa as number)
      : null
  );
}

/**
 * CEO / ролі: глобальний Plan/Fact по полях + локальний cashflow тіні.
 * BAS лишається read-only (агрегація на сторінці Фінансів).
 */

import {
  resolveUnitPriceOrZero,
} from "@/lib/field-analytics";
import { getSeasonRange } from "@/lib/finance-period";
import {
  DEFAULT_DIESEL_PRICE_UAH,
  resolveDieselPriceUah,
} from "@/lib/fuel-price";
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

export type FinanceAlert = {
  id: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  fieldId?: string;
};

export type FinanceExpenseSliceKey =
  | "fuel"
  | "chemicals"
  | "seed"
  | "other";

export type FinanceExpenseBreakdownItem = {
  label: string;
  amountUah: number;
};

export type FinanceExpenseSlice = {
  key: FinanceExpenseSliceKey;
  label: string;
  amountUah: number;
  /** 0–100 */
  pct: number;
  color: string;
  /** Деталізація сегмента (для «Інше» тощо) */
  breakdown?: FinanceExpenseBreakdownItem[];
};

export type CompanyFinancialOverview = {
  fieldsCount: number;
  fieldsWithBudget: number;
  totalAreaHa: number;
  /** Σ (planned_budget_per_ha × area) по полях із бюджетом (сезонний план) */
  globalPlanUah: number;
  /** Σ витрат за вибраний період */
  globalFactUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
  /** globalFact / globalPlan × 100; null якщо план = 0 */
  globalBurnRate: number | null;
  /**
   * true = факт за весь сезон (порівняння з планом коректне);
   * false = зріз «Сьогодні/Місяць/Діапазон» — % від сезонного плану, не періоду.
   */
  burnComparesToSeasonPlan: boolean;
  /** Матриця полів, burnRate ↓ */
  fields: CompanyFieldBurnRow[];
  /** Актуальна ціна ДП ₴/л */
  dieselPriceUah: number;
  /** Локальні продажі врожаю (тінь, лише draft — без дубля з BAS AGRO) */
  localSalesUah: number;
  /** Локальні приходи/закупки (тінь) за період */
  localInboundUah: number;
  /** Чернетки для Excel бухгалтеру (за сезон) */
  draftMovesCount: number;
  /** Списання ТМЦ без ціни (qty) */
  unpricedTmcQty: number;
  /** Кількість рядків ТМЦ без ціни */
  unpricedTmcLines: number;
  /** Мʼякі попередження (часткові збої джерел) */
  dataWarnings: string[];
  /** Період агрегації (yyyy-MM-dd) */
  periodStartIso: string | null;
  periodEndIso: string | null;
  alerts: FinanceAlert[];
  /** Анатомія витрат для donut */
  expenseAnatomy: FinanceExpenseSlice[];
};

export type FinanceDateRange = {
  startIso: string;
  endIso: string;
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
        category?: string | null;
        name?: string | null;
        custom_name?: string | null;
      }
    | {
        planned_price_uah: number | null;
        unit_cost?: number | null;
        category?: string | null;
        name?: string | null;
        custom_name?: string | null;
      }[]
    | null;
};

type CashMoveRow = {
  type: string | null;
  status?: string | null;
  qty: number | string | null;
  unit_price_uah?: number | string | null;
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

export type WialonFieldFuelRow = {
  field_id: string | null;
  fuel_consumed: number | string | null;
};

/** fact заданий (включно з 0) → fact; інакше plan. */
function opFuelL(row: OpRow): number {
  if (row.fuel_fact != null && row.fuel_fact !== "") {
    const fact = Number(row.fuel_fact);
    if (Number.isFinite(fact)) return Math.max(0, fact);
  }
  return Math.max(0, num(row.fuel_plan));
}

function opWage(row: OpRow): number {
  if (row.wage_fact != null && row.wage_fact !== "") {
    const fact = Number(row.wage_fact);
    if (Number.isFinite(fact)) return Math.max(0, fact);
  }
  return Math.max(0, num(row.wage_plan));
}

function nextDayIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** date / timestamptz: inclusive start, exclusive end+1day (календарні дні). */
function applyDateRange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  column: string,
  range: FinanceDateRange,
  mode: "date" | "timestamptz" = "date"
) {
  if (mode === "date") {
    return q.gte(column, range.startIso).lte(column, range.endIso);
  }
  return q.gte(column, range.startIso).lt(column, nextDayIso(range.endIso));
}

const PAGE_SIZE = 1000;

async function fetchPaged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return { rows, truncated: false };
    if (from + PAGE_SIZE >= 50_000) return { rows, truncated: true };
  }
}

/** Чиста зливка — зручно тестувати без I/O. */
export function buildCompanyFinancialOverview(
  fields: FieldRow[],
  moves: MoveRow[],
  ops: OpRow[],
  wialonFuel: WialonFieldFuelRow[] = [],
  options?: {
    fuelPriceUah?: number;
    localSalesUah?: number;
    localInboundUah?: number;
    draftMovesCount?: number;
    periodStartIso?: string | null;
    periodEndIso?: string | null;
    /** true якщо факт покриває весь сезон (не зріз днів/місяця) */
    burnComparesToSeasonPlan?: boolean;
    dataWarnings?: string[];
  }
): CompanyFinancialOverview {
  const fuelPrice =
    options?.fuelPriceUah != null && options.fuelPriceUah > 0
      ? options.fuelPriceUah
      : DEFAULT_DIESEL_PRICE_UAH;
  const burnComparesToSeasonPlan = options?.burnComparesToSeasonPlan !== false;
  const dataWarnings = [...(options?.dataWarnings ?? [])];

  type Acc = {
    fieldId: string;
    name: string;
    crop: string;
    areaHa: number;
    plannedBudgetPerHa: number | null;
    inventorySpentUah: number;
    fuelCostUah: number;
    salaryUah: number;
    opsFuelL: number;
    wialonFuelL: number;
  };

  const byId = new Map<string, Acc>();

  let chemUah = 0;
  let seedUah = 0;
  let otherInvUah = 0;
  let unallocatedFuelL = 0;
  let unallocatedSalaryUah = 0;
  let unallocatedInvUah = 0;
  let unpricedTmcQty = 0;
  let unpricedTmcLines = 0;
  const otherBreakdown = new Map<string, number>();
  const chemBreakdown = new Map<string, number>();
  const seedBreakdown = new Map<string, number>();

  const addBreakdown = (map: Map<string, number>, label: string, amount: number) => {
    if (amount <= 0) return;
    const key = label.trim() || "Без назви";
    map.set(key, round2((map.get(key) ?? 0) + amount));
  };

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
      opsFuelL: 0,
      wialonFuelL: 0,
    });
  }

  for (const row of moves) {
    const qty = num(row.qty);
    if (qty <= 0) continue;
    const cache = unwrapJoin(row.inventory_items_cache);
    const unitPrice = resolveUnitPriceOrZero({
      planned_price_uah: cache?.planned_price_uah ?? null,
      unit_cost: cache?.unit_cost ?? null,
    });
    if (unitPrice <= 0) {
      unpricedTmcQty = round2(unpricedTmcQty + qty);
      unpricedTmcLines += 1;
      continue;
    }
    const line = round2(qty * unitPrice);
    const cat = String(cache?.category ?? "").toLowerCase();
    const itemLabel =
      (cache?.custom_name ?? "").trim() ||
      (cache?.name ?? "").trim() ||
      "ТМЦ без назви";
    if (cat === "zzr" || cat === "fertilizer") {
      chemUah = round2(chemUah + line);
      addBreakdown(chemBreakdown, itemLabel, line);
    } else if (cat === "seed") {
      seedUah = round2(seedUah + line);
      addBreakdown(seedBreakdown, itemLabel, line);
    } else {
      otherInvUah = round2(otherInvUah + line);
      addBreakdown(otherBreakdown, itemLabel, line);
    }

    const fieldId = row.field_id ? String(row.field_id).toLowerCase() : "";
    const acc = fieldId ? byId.get(fieldId) : undefined;
    if (acc) {
      acc.inventorySpentUah = round2(acc.inventorySpentUah + line);
    } else {
      unallocatedInvUah = round2(unallocatedInvUah + line);
    }
  }

  for (const row of ops) {
    if (String(row.status ?? "") !== "completed") continue;
    const fieldId = row.field_id ? String(row.field_id).toLowerCase() : "";
    if (!fieldId) {
      // Наряди без поля — у загальний факт компанії (не в матрицю полів)
      unallocatedFuelL = round2(unallocatedFuelL + opFuelL(row));
      unallocatedSalaryUah = round2(unallocatedSalaryUah + opWage(row));
      continue;
    }
    const acc = byId.get(fieldId);
    if (!acc) {
      unallocatedFuelL = round2(unallocatedFuelL + opFuelL(row));
      unallocatedSalaryUah = round2(unallocatedSalaryUah + opWage(row));
      continue;
    }

    acc.opsFuelL = round2(acc.opsFuelL + opFuelL(row));
    acc.salaryUah = round2(acc.salaryUah + opWage(row));
  }

  for (const row of wialonFuel) {
    const fieldId = row.field_id ? String(row.field_id).toLowerCase() : "";
    if (!fieldId) continue;
    const acc = byId.get(fieldId);
    if (!acc) continue;
    acc.wialonFuelL = round2(
      acc.wialonFuelL + Math.max(0, num(row.fuel_consumed))
    );
  }

  for (const acc of byId.values()) {
    const liters = acc.wialonFuelL > 0 ? acc.wialonFuelL : acc.opsFuelL;
    acc.fuelCostUah = round2(liters * fuelPrice);
  }

  const unallocatedFuelCostUah = round2(unallocatedFuelL * fuelPrice);

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

  // Наряди / ТМЦ без привʼязки до поля — у корпоративний факт
  fuelCostUah += Math.round(unallocatedFuelCostUah);
  salaryUah += Math.round(unallocatedSalaryUah);
  inventorySpentUah += Math.round(unallocatedInvUah);
  globalFactUah += Math.round(
    unallocatedFuelCostUah + unallocatedSalaryUah + unallocatedInvUah
  );

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

  const localSalesUah = Math.round(options?.localSalesUah ?? 0);
  const localInboundUah = Math.round(options?.localInboundUah ?? 0);
  const draftMovesCount = Math.max(0, Math.round(options?.draftMovesCount ?? 0));

  const alerts: FinanceAlert[] = [];
  const overBudget = matrix.filter(
    (f) => f.burnRate != null && f.burnRate > 100
  );
  if (overBudget.length > 0) {
    alerts.push({
      id: "over-budget",
      tone: "danger",
      title: `${overBudget.length} пол${overBudget.length === 1 ? "е" : "ів"} понад бюджет`,
      detail: overBudget
        .slice(0, 3)
        .map((f) => `${f.name} (${Math.round(f.burnRate!)}%)`)
        .join(" · "),
      fieldId: overBudget[0]?.fieldId,
    });
  }
  const noBudgetSpend = matrix.filter(
    (f) => f.budgetUah == null && f.spentUah > 0
  );
  if (noBudgetSpend.length > 0) {
    alerts.push({
      id: "no-budget",
      tone: "warning",
      title: `${noBudgetSpend.length} без плану ₴/га`,
      detail: "Є витрати, але planned_budget_per_ha не заданий",
      fieldId: noBudgetSpend[0]?.fieldId,
    });
  }
  if (draftMovesCount > 0) {
    alerts.push({
      id: "drafts",
      tone: "info",
      title: `${draftMovesCount} чернеток для бухгалтера`,
      detail: "Експорт для бухгалтера",
    });
  }
  if (unpricedTmcLines > 0) {
    alerts.push({
      id: "unpriced-tmc",
      tone: "warning",
      title: `${unpricedTmcLines} списань ТМЦ без ціни`,
      detail: `${unpricedTmcQty} од. не увійшли у факт — задайте planned_price_uah`,
    });
  }
  if (!burnComparesToSeasonPlan) {
    alerts.push({
      id: "burn-period-slice",
      tone: "info",
      title: "% від сезонного плану",
      detail: "Факт — за вибраний зріз; план лишається на весь сезон",
    });
  }
  for (const w of dataWarnings) {
    alerts.push({
      id: `warn-${alerts.length}`,
      tone: "warning",
      title: "Часткові дані",
      detail: w,
    });
  }

  const otherUah = Math.round(otherInvUah + salaryUah);
  if (salaryUah > 0) {
    addBreakdown(otherBreakdown, "Зарплата (наряди)", Math.round(salaryUah));
  }

  const toBreakdownList = (map: Map<string, number>): FinanceExpenseBreakdownItem[] =>
    [...map.entries()]
      .map(([label, amountUah]) => ({ label, amountUah: Math.round(amountUah) }))
      .filter((r) => r.amountUah > 0)
      .sort((a, b) => b.amountUah - a.amountUah || a.label.localeCompare(b.label, "uk"))
      .slice(0, 12);

  const anatomyRaw: Array<{
    key: FinanceExpenseSliceKey;
    label: string;
    amountUah: number;
    color: string;
    breakdown?: FinanceExpenseBreakdownItem[];
  }> = [
    {
      key: "fuel",
      label: "Паливо",
      amountUah: Math.round(fuelCostUah),
      color: "#f97316",
      breakdown:
        Math.round(fuelCostUah) > 0
          ? [
              {
                label: "ДП по полях (Wialon / наряди)",
                amountUah: Math.round(fuelCostUah),
              },
            ]
          : undefined,
    },
    {
      key: "chemicals",
      label: "ТМЦ / Добрива",
      amountUah: Math.round(chemUah),
      color: "#10b981",
      breakdown: toBreakdownList(chemBreakdown),
    },
    {
      key: "seed",
      label: "Насіння",
      amountUah: Math.round(seedUah),
      color: "#eab308",
      breakdown: toBreakdownList(seedBreakdown),
    },
    {
      key: "other",
      label: "Інше",
      amountUah: otherUah,
      color: "#94a3b8",
      breakdown: toBreakdownList(otherBreakdown),
    },
  ];
  const anatomyTotal = anatomyRaw.reduce((s, r) => s + r.amountUah, 0);
  const expenseAnatomy: FinanceExpenseSlice[] = anatomyRaw
    .filter((r) => r.amountUah > 0)
    .map((r) => ({
      ...r,
      breakdown: r.breakdown && r.breakdown.length > 0 ? r.breakdown : undefined,
      pct:
        anatomyTotal > 0
          ? Math.round((r.amountUah / anatomyTotal) * 1000) / 10
          : 0,
    }));

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
    burnComparesToSeasonPlan,
    fields: matrix,
    dieselPriceUah: round2(fuelPrice),
    localSalesUah,
    localInboundUah,
    draftMovesCount,
    unpricedTmcQty: round2(unpricedTmcQty),
    unpricedTmcLines,
    dataWarnings,
    periodStartIso: options?.periodStartIso ?? null,
    periodEndIso: options?.periodEndIso ?? null,
    alerts,
    expenseAnatomy,
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

type SoftFetch<T> = { rows: T[]; warning?: string };

async function fetchAllOutboundMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string,
  range?: FinanceDateRange | null
): Promise<SoftFetch<MoveRow>> {
  const selectCols = `
      field_id,
      qty,
      inventory_items_cache (
        planned_price_uah,
        unit_cost,
        category,
        name,
        custom_name
      )
    `;

  try {
    const primary = await fetchPaged<MoveRow>(async (from, to) => {
      let q = supabase
        .from("inventory_local_moves")
        .select(selectCols)
        .eq("type", "outbound")
        .eq("season", season)
        .order("date", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "date", range, "timestamptz");
      return q;
    });
    return {
      rows: primary.rows,
      warning: primary.truncated
        ? "Списання ТМЦ обрізано (ліміт сторінок)"
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("season") && !msg.includes("42703")) {
      if (msg.includes("PGRST205") || msg.includes("42P01")) {
        return { rows: [] };
      }
      return { rows: [], warning: `ТМЦ: ${msg}` };
    }
  }

  try {
    const legacy = await fetchPaged<MoveRow>(async (from, to) => {
      let q = supabase
        .from("inventory_local_moves")
        .select(selectCols)
        .eq("type", "outbound")
        .order("date", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "date", range, "timestamptz");
      return q;
    });
    return {
      rows: legacy.rows,
      warning: legacy.truncated
        ? "Списання ТМЦ обрізано (legacy)"
        : undefined,
    };
  } catch {
    return { rows: [], warning: "Не вдалося завантажити списання ТМЦ" };
  }
}

async function fetchCashMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string,
  range?: FinanceDateRange | null
): Promise<SoftFetch<CashMoveRow>> {
  try {
    const page = await fetchPaged<CashMoveRow>(async (from, to) => {
      let q = supabase
        .from("inventory_local_moves")
        .select(
          `
      type,
      status,
      qty,
      unit_price_uah,
      inventory_items_cache (
        planned_price_uah,
        unit_cost
      )
    `
        )
        .in("type", ["sale", "inbound"])
        .eq("season", season)
        .order("date", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "date", range, "timestamptz");
      return q;
    });
    return {
      rows: page.rows,
      warning: page.truncated ? "Продажі/приходи обрізано" : undefined,
    };
  } catch {
    return { rows: [] };
  }
}

function sumLocalCash(rows: CashMoveRow[]): {
  localSalesUah: number;
  localInboundUah: number;
} {
  let localSalesUah = 0;
  let localInboundUah = 0;
  for (const row of rows) {
    const qty = num(row.qty);
    if (qty <= 0) continue;
    const type = String(row.type ?? "");
    // Лише draft-продажі: sent_to_1c уже в BAS реалізації
    if (type === "sale") {
      if (String(row.status ?? "draft") === "sent_to_1c") continue;
      const price = num(row.unit_price_uah);
      if (price > 0) localSalesUah += qty * price;
      continue;
    }
    if (type === "inbound") {
      const cache = unwrapJoin(row.inventory_items_cache);
      const unitPrice = resolveUnitPriceOrZero({
        planned_price_uah:
          num(row.unit_price_uah) > 0
            ? num(row.unit_price_uah)
            : (cache?.planned_price_uah ?? null),
        unit_cost: cache?.unit_cost ?? null,
      });
      const inboundPrice =
        num(row.unit_price_uah) > 0 ? num(row.unit_price_uah) : unitPrice;
      localInboundUah += qty * inboundPrice;
    }
  }
  return {
    localSalesUah: round2(localSalesUah),
    localInboundUah: round2(localInboundUah),
  };
}

async function fetchDraftMovesCount(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<number> {
  const { count, error } = await supabase
    .from("inventory_local_moves")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft")
    .eq("season", season);
  if (error) {
    // без колонки season — усі чернетки
    if (error.message?.includes("season") || error.code === "42703") {
      const fallback = await supabase
        .from("inventory_local_moves")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft");
      return fallback.count ?? 0;
    }
    return 0;
  }
  return count ?? 0;
}

async function fetchAllCompletedOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string,
  range?: FinanceDateRange | null
): Promise<SoftFetch<OpRow>> {
  const selectCols = `
      field_id,
      status,
      fuel_fact,
      fuel_plan,
      wage_fact,
      wage_plan
    `;

  try {
    const page = await fetchPaged<OpRow>(async (from, to) => {
      let q = supabase
        .from("field_operations")
        .select(selectCols)
        .eq("status", "completed")
        .eq("season", season)
        .order("occurred_at", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "occurred_at", range, "date");
      return q;
    });
    return {
      rows: page.rows,
      warning: page.truncated ? "Наряди обрізано (ліміт)" : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("PGRST205") ||
      msg.includes("42P01") ||
      msg.includes("field_operations")
    ) {
      return { rows: [] };
    }
    if (
      !msg.includes("occurred_at") &&
      !msg.includes("season") &&
      !msg.includes("42703")
    ) {
      return { rows: [], warning: `Наряди: ${msg}` };
    }
  }

  try {
    const year = Number(season);
    const page = await fetchPaged<OpRow>(async (from, to) => {
      let q = supabase
        .from("field_operations")
        .select(selectCols)
        .eq("status", "completed")
        .order("occurred_at", { ascending: true })
        .range(from, to);
      if (Number.isFinite(year)) q = q.eq("season_year", year);
      if (range) q = applyDateRange(q, "occurred_at", range, "date");
      return q;
    });
    return { rows: page.rows };
  } catch {
    return { rows: [], warning: "Не вдалося завантажити наряди" };
  }
}

async function fetchWialonFieldFuel(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string,
  range?: FinanceDateRange | null
): Promise<SoftFetch<WialonFieldFuelRow>> {
  try {
    const page = await fetchPaged<WialonFieldFuelRow>(async (from, to) => {
      let q = supabase
        .from("wialon_field_fuel_logs")
        .select("field_id, fuel_consumed")
        .eq("season", season)
        .gt("fuel_consumed", 0)
        .order("date", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "date", range, "date");
      return q;
    });
    return {
      rows: page.rows,
      warning: page.truncated ? "Wialon паливо обрізано" : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("season") && !msg.includes("42703")) {
      return { rows: [] };
    }
  }

  try {
    const page = await fetchPaged<WialonFieldFuelRow>(async (from, to) => {
      let q = supabase
        .from("wialon_field_fuel_logs")
        .select("field_id, fuel_consumed")
        .gt("fuel_consumed", 0)
        .order("date", { ascending: true })
        .range(from, to);
      if (range) q = applyDateRange(q, "date", range, "date");
      return q;
    });
    return { rows: page.rows };
  } catch {
    return { rows: [] };
  }
}

function isFullSeasonRange(
  season: string,
  range?: FinanceDateRange | null
): boolean {
  if (!range) return true;
  const year = Number(season);
  if (!Number.isFinite(year)) return false;
  const full = getSeasonRange(year);
  return (
    range.startIso === full.startIso && range.endIso === full.endIso
  );
}

/**
 * Паралельні запити → єдина агрегація.
 * @param activeSeason — агросезон ('2026' …)
 * @param range — зріз дат (завжди передавати для узгодження з BAS)
 */
export async function fetchCompanyFinancialOverview(
  activeSeason: string = DEFAULT_SEASON,
  range?: FinanceDateRange | null
): Promise<CompanyFinancialOverview> {
  const season = normalizeSeason(activeSeason);
  const supabase = createServiceSupabase();

  const [
    fields,
    movesRes,
    opsRes,
    wialonRes,
    cashRes,
    draftMovesCount,
    diesel,
  ] = await Promise.all([
    fetchActiveFields(supabase),
    fetchAllOutboundMoves(supabase, season, range),
    fetchAllCompletedOps(supabase, season, range),
    fetchWialonFieldFuel(supabase, season, range),
    fetchCashMoves(supabase, season, range),
    fetchDraftMovesCount(supabase, season),
    resolveDieselPriceUah(DEFAULT_DIESEL_PRICE_UAH),
  ]);

  const { localSalesUah, localInboundUah } = sumLocalCash(cashRes.rows);
  const dataWarnings = [
    movesRes.warning,
    opsRes.warning,
    wialonRes.warning,
    cashRes.warning,
  ].filter((w): w is string => Boolean(w));

  // Повний сезонний burn лише коли range починається з 1 березня (або range null)
  const burnComparesToSeasonPlan = isFullSeasonRange(season, range);
  // Для «Місяць»/«Сьогодні» start ≠ 03-01 → false. Для «Сезон» start = 03-01 → true.

  return buildCompanyFinancialOverview(
    fields,
    movesRes.rows,
    opsRes.rows,
    wialonRes.rows,
    {
      fuelPriceUah: diesel.priceUah,
      localSalesUah,
      localInboundUah,
      draftMovesCount,
      periodStartIso: range?.startIso ?? null,
      periodEndIso: range?.endIso ?? null,
      burnComparesToSeasonPlan,
      dataWarnings,
    }
  );
}

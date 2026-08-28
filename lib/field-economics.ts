/**
 * Агрегація оперативних списань → економіка полів.
 */

export type FieldEconomicsCategoryKey = "zzr" | "fertilizer" | "seed";

export type FieldEconomicsCategoryBucket = {
  key: FieldEconomicsCategoryKey;
  label: string;
  qty: number;
  /** Найчастіша одиниця серед позицій категорії */
  unit: string;
  costUah: number | null;
  /** qty / areaHa */
  perHa: number | null;
};

export type FieldEconomicsCard = {
  fieldId: string;
  fieldName: string;
  crop: string;
  areaHa: number;
  moveCount: number;
  categories: FieldEconomicsCategoryBucket[];
  /** Сума qty (не змішувати в UI) — лише внутрішні розрахунки */
  totalQtyProxy: number;
  totalCostUah: number | null;
  costPerHa: number | null;
  /**
   * Плановий бюджет поля (₴). Поки null — UI показує підготовлений статус-бар.
   * Додамо колонку / джерело пізніше.
   */
  budgetUah: number | null;
  /** Для donut: частки за ₴ (якщо є ціни), інакше за qty лише для візуалу */
  donut: { key: FieldEconomicsCategoryKey; label: string; value: number }[];
};

export type FieldEconomicsDashboardData = {
  cards: FieldEconomicsCard[];
  totals: {
    fieldsWithMoves: number;
    moveCount: number;
    totalCostUah: number | null;
  };
};

const CAT_META: Record<
  FieldEconomicsCategoryKey,
  { label: string }
> = {
  zzr: { label: "ЗЗР" },
  fertilizer: { label: "Добрива" },
  seed: { label: "Насіння" },
};

type MoveJoinRow = {
  qty: number;
  field_id: string | null;
  farm_fields: {
    id: string;
    name: string;
    crop: string;
    area_ha: number;
    planned_budget_per_ha?: number | null;
  } | null;
  inventory_items_cache: {
    category: string;
    unit: string | null;
    /** Ціна з BAS AGRO / старий unit_cost */
    unit_cost: number | null;
    /** Планова ціна, задана в UI */
    planned_price_uah: number | null;
  } | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function asCategory(raw: string): FieldEconomicsCategoryKey | null {
  if (raw === "zzr" || raw === "fertilizer" || raw === "seed") return raw;
  return null;
}

/** planned_price_uah > 0, інакше unit_cost з BAS AGRO (якщо є). */
export function resolveItemUnitPriceUah(item: {
  planned_price_uah?: number | null;
  unit_cost?: number | null;
}): number | null {
  const planned = Number(item.planned_price_uah);
  if (Number.isFinite(planned) && planned > 0) return planned;
  const from1c = item.unit_cost != null ? Number(item.unit_cost) : NaN;
  if (Number.isFinite(from1c) && from1c > 0) return from1c;
  return null;
}

export function aggregateFieldEconomics(
  rows: MoveJoinRow[]
): FieldEconomicsDashboardData {
  type Acc = {
    fieldId: string;
    fieldName: string;
    crop: string;
    areaHa: number;
    plannedBudgetPerHa: number | null;
    moveCount: number;
    byCat: Record<
      FieldEconomicsCategoryKey,
      { qty: number; cost: number; hasCost: boolean; units: Map<string, number> }
    >;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const field = row.farm_fields;
    const item = row.inventory_items_cache;
    if (!field?.id || !item) continue;
    const cat = asCategory(item.category);
    if (!cat) continue;
    const qty = Number(row.qty) || 0;
    if (qty <= 0) continue;

    let acc = map.get(field.id);
    if (!acc) {
      const plannedRaw = Number(field.planned_budget_per_ha);
      acc = {
        fieldId: field.id,
        fieldName: field.name,
        crop: field.crop || "—",
        areaHa: Number(field.area_ha) || 0,
        plannedBudgetPerHa:
          Number.isFinite(plannedRaw) && plannedRaw > 0 ? plannedRaw : null,
        moveCount: 0,
        byCat: {
          zzr: { qty: 0, cost: 0, hasCost: false, units: new Map() },
          fertilizer: { qty: 0, cost: 0, hasCost: false, units: new Map() },
          seed: { qty: 0, cost: 0, hasCost: false, units: new Map() },
        },
      };
      map.set(field.id, acc);
    }

    acc.moveCount += 1;
    const bucket = acc.byCat[cat];
    bucket.qty += qty;
    const unit = (item.unit || "").trim() || "од.";
    bucket.units.set(unit, (bucket.units.get(unit) ?? 0) + qty);
    const unitPrice = resolveItemUnitPriceUah(item);
    if (unitPrice != null) {
      bucket.cost += qty * unitPrice;
      bucket.hasCost = true;
    }
  }

  const cards: FieldEconomicsCard[] = [...map.values()]
    .map((acc) => {
      const categories: FieldEconomicsCategoryBucket[] = (
        ["zzr", "fertilizer", "seed"] as const
      ).map((key) => {
        const b = acc.byCat[key];
        let unit = "од.";
        let best = 0;
        for (const [u, q] of b.units) {
          if (q > best) {
            best = q;
            unit = u;
          }
        }
        const perHa =
          acc.areaHa > 0 && b.qty > 0 ? round2(b.qty / acc.areaHa) : null;
        return {
          key,
          label: CAT_META[key].label,
          qty: round2(b.qty),
          unit,
          costUah: b.hasCost ? Math.round(b.cost) : null,
          perHa,
        };
      });

      const totalQtyProxy = round2(
        categories.reduce((s, c) => s + c.qty, 0)
      );
      const costs = categories
        .map((c) => c.costUah)
        .filter((v): v is number => v != null);
      const totalCostUah =
        costs.length > 0 ? costs.reduce((s, v) => s + v, 0) : null;
      const costPerHa =
        totalCostUah != null && acc.areaHa > 0
          ? Math.round(totalCostUah / acc.areaHa)
          : null;

      const donut =
        totalCostUah != null
          ? categories
              .filter((c) => (c.costUah ?? 0) > 0)
              .map((c) => ({
                key: c.key,
                label: c.label,
                value: c.costUah as number,
              }))
          : categories
              .filter((c) => c.qty > 0)
              .map((c) => ({ key: c.key, label: c.label, value: c.qty }));

      const plannedPerHa =
        acc.plannedBudgetPerHa != null && acc.plannedBudgetPerHa > 0
          ? acc.plannedBudgetPerHa
          : null;
      const budgetUah =
        plannedPerHa != null && acc.areaHa > 0
          ? Math.round(plannedPerHa * acc.areaHa)
          : null;

      return {
        fieldId: acc.fieldId,
        fieldName: acc.fieldName,
        crop: acc.crop,
        areaHa: acc.areaHa,
        moveCount: acc.moveCount,
        categories,
        totalQtyProxy,
        totalCostUah,
        costPerHa,
        budgetUah,
        donut,
      };
    })
    .sort(
      (a, b) =>
        (b.totalCostUah ?? 0) - (a.totalCostUah ?? 0) ||
        b.totalQtyProxy - a.totalQtyProxy ||
        a.fieldName.localeCompare(b.fieldName, "uk")
    );

  const moveCount = cards.reduce((s, c) => s + c.moveCount, 0);
  const money = cards
    .map((c) => c.totalCostUah)
    .filter((v): v is number => v != null);
  return {
    cards,
    totals: {
      fieldsWithMoves: cards.length,
      moveCount,
      totalCostUah: money.length > 0 ? money.reduce((s, v) => s + v, 0) : null,
    },
  };
}

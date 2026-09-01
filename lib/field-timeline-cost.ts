/**
 * Розрахунок вартості подій хронології.
 *
 * Джерела в БД (немає окремих equipment_logs / inventory_transactions):
 * - Наряди → `field_operations` (fuel_plan/fuel_fact, wage_plan/wage_fact)
 * - Списання → `inventory_local_moves.qty` × ціна з `inventory_items_cache`
 *   (planned_price_uah → unit_cost) або unit_price_uah для sale
 * - Скаутинг → `scouting_reports` (без полів вартості, cost = 0)
 */

import { resolveUnitPriceOrZero } from "@/lib/field-analytics";
import { DEFAULT_DIESEL_PRICE_UAH } from "@/lib/fuel-price";

import type { UnifiedTimelineEvent } from "@/lib/field-timeline-types";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundTimelineCost(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Рядок `field_operations` — поля для розрахунку cost наряду. */
export type TimelineEquipmentSourceRow = {
  /** Якщо є в БД — пріоритет над компонентами */
  total_cost?: number | string | null;
  fuel_fact?: number | string | null;
  fuel_plan?: number | string | null;
  wage_fact?: number | string | null;
  wage_plan?: number | string | null;
};

/** Рядок `inventory_local_moves` + join cache — поля для qty × ціна. */
export type TimelineInventorySourceRow = {
  total_cost?: number | string | null;
  qty: number | string;
  unit_price_uah?: number | string | null;
  inventory_items_cache?:
    | {
        planned_price_uah?: number | null;
        unit_cost?: number | null;
      }
    | {
        planned_price_uah?: number | null;
        unit_cost?: number | null;
      }[]
    | null;
};

import type { WeatherContext } from "@/lib/field-timeline-types";

export type TimelineScoutingSourceRow = {
  id: string;
  field_id: string;
  date: string;
  image_url?: string | null;
  notes?: string | null;
  weather_context?: WeatherContext | null;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function equipmentFuelLiters(row: TimelineEquipmentSourceRow): number {
  const fact = num(row.fuel_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.fuel_plan));
}

export function equipmentWageUah(row: TimelineEquipmentSourceRow): number {
  const fact = num(row.wage_fact);
  if (fact > 0) return fact;
  return Math.max(0, num(row.wage_plan));
}

/**
 * Загальна вартість наряду: зарплата (₴) + паливо (л × ₴/л).
 * У `field_operations` немає готового total_cost — лише компоненти.
 */
export function computeEquipmentTimelineCost(
  row: TimelineEquipmentSourceRow,
  fuelPriceUah: number = DEFAULT_DIESEL_PRICE_UAH
): number {
  const total = num(row.total_cost);
  if (total > 0) return roundTimelineCost(total);

  const wage = equipmentWageUah(row);
  const fuelL = equipmentFuelLiters(row);
  const fuelCost = fuelL > 0 ? fuelL * Math.max(0, fuelPriceUah) : 0;
  return roundTimelineCost(wage + fuelCost);
}

/**
 * Вартість списання: qty × unit_price.
 * Пріоритет: unit_price_uah (sale) → planned_price_uah → unit_cost (1C).
 */
export function computeInventoryTimelineCost(row: TimelineInventorySourceRow): number {
  const total = num(row.total_cost);
  if (total > 0) return roundTimelineCost(total);

  const qty = num(row.qty);
  if (qty <= 0) return 0;

  const explicit = num(row.unit_price_uah);
  if (explicit > 0) return roundTimelineCost(qty * explicit);

  const cache = unwrapJoin(row.inventory_items_cache);
  const unitPrice = resolveUnitPriceOrZero({
    planned_price_uah: cache?.planned_price_uah,
    unit_cost: cache?.unit_cost,
  });

  return roundTimelineCost(qty * unitPrice);
}

export function sumTimelineEventsCost(events: UnifiedTimelineEvent[]): number {
  return roundTimelineCost(events.reduce((sum, event) => sum + event.cost, 0));
}

export function computeCostPerHectare(
  totalCost: number,
  areaHa: number
): number {
  if (areaHa <= 0) return 0;
  return roundTimelineCost(totalCost / areaHa);
}

import type { FieldFuelPeriod } from "@/app/fuel/actions";

/** Стартові оцінки повного циклу KPI (чанки бекенду + retry). */
export const FUEL_KPI_LOAD_SEED_MS: Record<FieldFuelPeriod, number> = {
  today: 6_000,
  yesterday: 7_000,
  week: 12_000,
  month: 40_000,
  season: 75_000,
};

export const FUEL_KPI_LOAD_PERIODS: FieldFuelPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "season",
];

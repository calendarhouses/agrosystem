import type { FieldFuelPeriod } from "@/app/fuel/actions";

/** Стартові оцінки часу KPI, поки в БД мало замірів. */
export const FUEL_KPI_LOAD_SEED_MS: Record<FieldFuelPeriod, number> = {
  today: 5_500,
  yesterday: 6_000,
  week: 9_000,
  month: 12_000,
  season: 22_000,
};

export const FUEL_KPI_LOAD_PERIODS: FieldFuelPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "season",
];

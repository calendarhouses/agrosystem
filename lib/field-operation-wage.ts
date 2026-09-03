import { WAGE_UAH_PER_HA } from "@/lib/field-operation-norms";

/** Нормалізація ключа типу робіт для памʼяті ставок */
export function normalizeWorkTypeKey(workType: string): string {
  return workType.trim().replace(/\s+/g, " ");
}

export function estimateWageFromRate(
  rateUahPerHa: number,
  areaHa: number
): number {
  if (!Number.isFinite(rateUahPerHa) || rateUahPerHa < 0) return 0;
  if (!Number.isFinite(areaHa) || areaHa <= 0) return 0;
  return Math.max(0, Math.round(rateUahPerHa * areaHa));
}

/** Дефолт, якщо в БД ще немає збереженої ставки */
export function defaultWageRateUahPerHa(workType?: string | null): number {
  void workType;
  return WAGE_UAH_PER_HA;
}

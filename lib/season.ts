/** Агро-сезон (Crop Year): березень → лютий наступного календарного року. */

export const AVAILABLE_SEASONS = ["2025", "2026"] as const;

export type SeasonId = (typeof AVAILABLE_SEASONS)[number] | string;

export const DEFAULT_SEASON: SeasonId = "2026";

export function normalizeSeason(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}$/.test(raw)) return raw;
  return DEFAULT_SEASON;
}

/** Поточний агросезон за датою (Europe/Kyiv): з березня = рік, інакше рік−1. */
export function currentAgroSeason(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return DEFAULT_SEASON;
  }
  // month >= 3 → сезон цього року
  return String(month >= 3 ? year : year - 1);
}

export function seasonLabel(season: string): string {
  return `Сезон ${normalizeSeason(season)}`;
}

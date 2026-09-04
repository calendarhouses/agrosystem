/**
 * Нормативи для планування нарядів (л/га, ₴/га) — не ціни палива.
 * Ціну дизеля беремо з resolveDieselPriceUah().
 */

export const OPERATION_TYPES = [
  "Посів",
  "Культивація",
  "Оранка",
  "Дискування",
  "Внесення ЗЗР",
  "Внесення добрив",
  "Збирання",
] as const;

export const IMPLEMENT_PRESETS: Record<string, string> = {
  Посів: "Сівалка",
  Культивація: "Культиватор",
  Оранка: "Плуг",
  Дискування: "Дискова борона",
  "Внесення ЗЗР": "Обприскувач",
  "Внесення добрив": "Розкидач добрив",
  Збирання: "Жатка",
};

export const IMPLEMENT_WIDTH_DEFAULTS: Record<string, number> = {
  Посів: 8,
  Культивація: 6,
  Оранка: 4,
  Дискування: 5,
  "Внесення ЗЗР": 24,
  "Внесення добрив": 12,
  Збирання: 9,
};

/** Орієнтовна витрата палива л/га за типом робіт */
export const FUEL_L_PER_HA: Record<string, number> = {
  Посів: 4.5,
  Культивація: 7.5,
  Оранка: 18,
  Дискування: 10,
  "Внесення ЗЗР": 1.2,
  "Внесення добрив": 3.5,
  Збирання: 12,
};

export const WAGE_UAH_PER_HA = 95;

export function isSowingOperationType(type: string): boolean {
  return type.trim().toLowerCase().includes("посів");
}

/**
 * Орієнтовна тривалість вегетації (дні) для шкали фенології.
 * Соняшник / кукурудза / соя — 120; озима пшениця / ріпак — 280; інше — 100.
 */
export function phenologyCycleDays(crop: string | null | undefined): number {
  const key = (crop ?? "").trim().toLowerCase();
  if (!key || key === "—" || key === "-") return 100;

  if (
    key.includes("соняш") ||
    key.includes("кукурудз") ||
    key.includes("соя") ||
    key.includes("соє")
  ) {
    return 120;
  }

  if (
    key.includes("пшениц") ||
    key.includes("ріпак") ||
    key.includes("рапс") ||
    key.includes("озим")
  ) {
    return 280;
  }

  return 100;
}

export function estimatePlanFuelLiters(type: string, areaHa: number): number {
  const rate = FUEL_L_PER_HA[type] ?? 5;
  return Math.max(1, Math.round(areaHa * rate));
}

export function estimatePlanWageUah(areaHa: number): number {
  return Math.max(100, Math.round(areaHa * WAGE_UAH_PER_HA));
}

export function fuelLitersPerHa(type: string): number {
  return FUEL_L_PER_HA[type] ?? 5;
}

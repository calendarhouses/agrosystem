/**
 * Спільний період для Фінансів: один часовий зріз для burn + BAS.
 * Усі межі — календар Europe/Kyiv.
 */

import { format } from "date-fns";
import type { DateRange } from "react-day-picker";

import { currentAgroSeason } from "@/lib/season";

export type FinancePeriod =
  | "Сьогодні"
  | "Вчора"
  | "Тиждень"
  | "Місяць"
  | "Сезон"
  | "Діапазон";

export const FINANCE_PERIOD_TABS: FinancePeriod[] = [
  "Сьогодні",
  "Вчора",
  "Тиждень",
  "Місяць",
  "Сезон",
  "Діапазон",
];

/** Швидкі таби під сезоном/діапазоном (як у Складі) */
export const FINANCE_QUICK_PERIODS: Array<
  Exclude<FinancePeriod, "Сезон" | "Діапазон">
> = ["Сьогодні", "Вчора", "Тиждень", "Місяць"];

const KYIV_TZ = "Europe/Kyiv";

type KyivYmd = { year: number; month: number; day: number };

/** Календарні частини дати в Europe/Kyiv. */
export function kyivYmd(now = new Date()): KyivYmd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
  };
}

function ymdToIso({ year, month, day }: KyivYmd): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return format(utc, "yyyy-MM-dd");
}

function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

function minIso(a: string, b: string): string {
  return compareIso(a, b) <= 0 ? a : b;
}

function maxIso(a: string, b: string): string {
  return compareIso(a, b) >= 0 ? a : b;
}

/** Повний агросезон без обрізання «сьогодні» — для хронології та запланованих нарядів. */
export function getFullSeasonIsoRange(seasonYear: number): {
  startIso: string;
  endIso: string;
} {
  const startIso = `${seasonYear}-03-01`;
  const febEnd = new Date(Date.UTC(seasonYear + 1, 2, 0));
  const endIso = format(febEnd, "yyyy-MM-dd");
  return { startIso, endIso };
}

/** Агросезон: 1 березня year → кінець лютого year+1 (або «сьогодні» в Києві, якщо сезон триває). */
export function getSeasonRange(
  seasonYear: number,
  now = new Date()
): { start: Date; end: Date; startIso: string; endIso: string } {
  const today = kyivYmd(now);
  const startIso = `${seasonYear}-03-01`;
  // Кінець лютого: 28/29 залежно від високосного year+1
  const febEnd = new Date(Date.UTC(seasonYear + 1, 2, 0)); // day 0 of March = last of Feb
  const endCapIso = format(febEnd, "yyyy-MM-dd");
  const todayIso = ymdToIso(today);
  const endIso = compareIso(todayIso, endCapIso) < 0 ? todayIso : endCapIso;
  return {
    start: parseIsoAsUtcNoon(startIso),
    end: parseIsoAsUtcNoon(endIso),
    startIso,
    endIso,
  };
}

/** Парсимо YYYY-MM-DD як «календарний день» (полудень UTC — щоб не з’їхала мітка). */
function parseIsoAsUtcNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

/**
 * Вікно періоду завжди всередині обраного агросезону.
 * «Місяць»/«Сьогодні» для минулого сезону → кінець того сезону, не «зараз».
 */
export function getFinancePeriodRange(
  period: FinancePeriod,
  seasonYear: number,
  customRange?: DateRange,
  now = new Date()
): { start: Date; end: Date; startIso: string; endIso: string } {
  const season = getSeasonRange(seasonYear, now);
  const todayIso = ymdToIso(kyivYmd(now));

  if (period === "Сезон") {
    return season;
  }

  if (period === "Діапазон" && customRange?.from) {
    const fromIso = toIsoDay(customRange.from);
    const toIso = toIsoDay(customRange.to ?? customRange.from);
    const startIso = maxIso(minIso(fromIso, toIso), season.startIso);
    const endIso = minIso(maxIso(fromIso, toIso), season.endIso);
    if (compareIso(startIso, endIso) > 0) {
      return {
        start: parseIsoAsUtcNoon(season.endIso),
        end: parseIsoAsUtcNoon(season.endIso),
        startIso: season.endIso,
        endIso: season.endIso,
      };
    }
    return {
      start: parseIsoAsUtcNoon(startIso),
      end: parseIsoAsUtcNoon(endIso),
      startIso,
      endIso,
    };
  }

  if (period === "Місяць") {
    const endIso = minIso(todayIso, season.endIso);
    let startIso = addDaysIso(endIso, -29);
    startIso = maxIso(startIso, season.startIso);
    return {
      start: parseIsoAsUtcNoon(startIso),
      end: parseIsoAsUtcNoon(endIso),
      startIso,
      endIso,
    };
  }

  if (period === "Тиждень") {
    const endIso = minIso(todayIso, season.endIso);
    let startIso = addDaysIso(endIso, -6);
    startIso = maxIso(startIso, season.startIso);
    return {
      start: parseIsoAsUtcNoon(startIso),
      end: parseIsoAsUtcNoon(endIso),
      startIso,
      endIso,
    };
  }

  if (period === "Вчора") {
    const yIso = addDaysIso(todayIso, -1);
    const clamped = minIso(maxIso(yIso, season.startIso), season.endIso);
    return {
      start: parseIsoAsUtcNoon(clamped),
      end: parseIsoAsUtcNoon(clamped),
      startIso: clamped,
      endIso: clamped,
    };
  }

  // Сьогодні (і Діапазон без дат)
  const dayIso = minIso(todayIso, season.endIso);
  const clamped = maxIso(dayIso, season.startIso);
  return {
    start: parseIsoAsUtcNoon(clamped),
    end: parseIsoAsUtcNoon(clamped),
    startIso: clamped,
    endIso: clamped,
  };
}

export function toIsoDay(d: Date): string {
  // Для Date з UI (date picker) — беремо UTC-дату компонентів, бо ми парсимо полуднем UTC
  if (Number.isNaN(d.getTime())) return ymdToIso(kyivYmd());
  return format(d, "yyyy-MM-dd");
}

export function toIsoRange(range: {
  start: Date;
  end: Date;
  startIso?: string;
  endIso?: string;
}): { startIso: string; endIso: string } {
  return {
    startIso: range.startIso ?? toIsoDay(range.start),
    endIso: range.endIso ?? toIsoDay(range.end),
  };
}

/** Початок сезону для SSR BAS since. */
export function seasonSinceIso(seasonYear: number, now = new Date()): string {
  return `${getSeasonRange(seasonYear, now).startIso}T00:00:00`;
}

export function defaultFinanceSeasonYear(now = new Date()): number {
  return Number(currentAgroSeason(now));
}

/**
 * Межі дня для timestamptz-фільтрів у Europe/Kyiv.
 * endExclusive = наступний календарний день 00:00 Kyiv (для `.lt`).
 */
export function kyivTimestamptzBounds(isoDay: string): {
  start: string;
  endExclusive: string;
} {
  const next = addDaysIso(isoDay, 1);
  return {
    start: `${isoDay}T00:00:00+02:00`,
    endExclusive: `${next}T00:00:00+02:00`,
  };
}

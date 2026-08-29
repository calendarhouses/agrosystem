/**
 * Календарні дати господарства — завжди Europe/Kyiv
 * (не браузерний TZ і не фіксований +03 без DST).
 */

const KYIV_TZ = "Europe/Kyiv";

/** Дата YYYY-MM-DD у Europe/Kyiv для будь-якого моменту */
export function toKyivDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Сьогоднішня дата YYYY-MM-DD у Києві */
export function todayKyivYmd(now = new Date()): string {
  return toKyivDayKey(now);
}

/**
 * Календарний день з DatePicker (локальні Y/M/D компонента Date).
 * Користувач обрав «23 серпня» → фермерський день 23.08, незалежно від TZ браузера.
 */
export function calendarDateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isKyivToday(ymd: string, now = new Date()): boolean {
  return ymd === todayKyivYmd(now);
}

function zonedWallTimeMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const read = (ms: number) => {
    const parts = dtf.formatToParts(new Date(ms));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  };

  // Старт з UTC-півночі тієї дати, далі зсуваємо доки стіна в TZ не збіжиться
  let t = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const p = read(t);
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = target - asUtc;
    if (delta === 0) break;
    t += delta;
  }
  return t;
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Зсув календарного дня YYYY-MM-DD (±N днів) */
export function shiftKyivYmd(ymd: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return todayKyivYmd();
  return addCalendarDaysYmd(ymd, days);
}

/** Межі доби YYYY-MM-DD у Europe/Kyiv → unix (включно з DST). */
export function kyivDayBoundsUnix(dateYmd: string): {
  fromUnix: number;
  toUnix: number;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    const today = todayKyivYmd();
    return kyivDayBoundsUnix(today);
  }
  const [y, m, d] = dateYmd.split("-").map(Number);
  const fromMs = zonedWallTimeMs(KYIV_TZ, y!, m!, d!, 0, 0, 0);
  const next = addCalendarDaysYmd(dateYmd, 1);
  const [ny, nm, nd] = next.split("-").map(Number);
  const nextMs = zonedWallTimeMs(KYIV_TZ, ny!, nm!, nd!, 0, 0, 0);
  return {
    fromUnix: Math.floor(fromMs / 1000),
    toUnix: Math.floor(nextMs / 1000) - 1,
  };
}

/** Мілісекунди до кінця сьогоднішнього дня в Києві (мін. 1 хв). */
export function msUntilEndOfKyivDay(now = new Date()): number {
  const tomorrow = shiftKyivYmd(todayKyivYmd(now), 1);
  const { fromUnix } = kyivDayBoundsUnix(tomorrow);
  return Math.max(60_000, fromUnix * 1000 - now.getTime());
}

export function endOfKyivDayMs(now = new Date()): number {
  return now.getTime() + msUntilEndOfKyivDay(now);
}

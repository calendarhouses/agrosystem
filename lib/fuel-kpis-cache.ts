/**
 * Серверний кеш KPI палива до кінця календарного дня (Europe/Kyiv).
 * Зменшує повторні важкі Wialon/бекфіли при F5.
 */

import { endOfKyivDayMs, todayKyivYmd } from "@/lib/kyiv-date";

type Entry = {
  data: unknown;
  expiresAt: number;
};

const store = new Map<string, Entry>();

export { endOfKyivDayMs, todayKyivYmd };

export function peekFuelKpisServerCache<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.data as T;
}

export function writeFuelKpisServerCache(
  key: string,
  data: unknown,
  expiresAt: number
): void {
  store.set(key, { data, expiresAt });
}

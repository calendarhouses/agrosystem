/**
 * In-process кеш живих позицій Wialon + single-flight.
 *
 * На Vercel / кількох інстансах кожен інстанс має свій Map — але при
 * 3–10 паралельних сесіях вони майже завжди потрапляють на той самий
 * warm instance → один запит у Wialon замість N×поллінгів.
 *
 * Без Redis: ідеально для презентацій і малих команд; при десятках
 * інстансів додати shared store (Upstash) поверх цього API.
 */

import {
  getWialonUnits,
  wialonLogin,
  type WialonUnit,
} from "@/lib/wialon";

/** Свіжі позиції — клієнти можуть поллити частіше, сервер бʼє Wialon рідше */
export const WIALON_UNITS_LIVE_TTL_MS = 12_000;
/** Віддавати stale при помилці Wialon, щоб UI не зависав */
export const WIALON_UNITS_STALE_MS = 90_000;

type UnitsCacheEntry = {
  units: WialonUnit[];
  fetchedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __agrosystemWialonUnitsCache: UnitsCacheEntry | null | undefined;
  // eslint-disable-next-line no-var
  var __agrosystemWialonUnitsInflight: Promise<WialonUnit[]> | null | undefined;
}

function getCache(): UnitsCacheEntry | null {
  return globalThis.__agrosystemWialonUnitsCache ?? null;
}

function setCache(entry: UnitsCacheEntry | null) {
  globalThis.__agrosystemWialonUnitsCache = entry;
}

function getInflight(): Promise<WialonUnit[]> | null {
  return globalThis.__agrosystemWialonUnitsInflight ?? null;
}

function setInflight(p: Promise<WialonUnit[]> | null) {
  globalThis.__agrosystemWialonUnitsInflight = p;
}

async function fetchLiveUnitsFromWialon(): Promise<WialonUnit[]> {
  const eid = await wialonLogin();
  // Позиції / швидкість з last message — без N× calc_last_message
  return getWialonUnits(eid, { withSensorCalc: false });
}

export type CachedWialonUnitsResult = {
  units: WialonUnit[];
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
};

/**
 * Живі юніти для карти / поллінгу.
 * force=true — обійти TTL (рідко; для ручного refresh).
 */
export async function getCachedWialonUnitsLive(options?: {
  force?: boolean;
}): Promise<CachedWialonUnitsResult> {
  const force = options?.force === true;
  const now = Date.now();
  const cached = getCache();

  if (
    !force &&
    cached &&
    now - cached.fetchedAt < WIALON_UNITS_LIVE_TTL_MS
  ) {
    return {
      units: cached.units,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      stale: false,
    };
  }

  const existing = getInflight();
  if (existing) {
    try {
      const units = await existing;
      const entry = getCache();
      return {
        units,
        fetchedAt: entry?.fetchedAt ?? Date.now(),
        fromCache: false,
        stale: false,
      };
    } catch (err) {
      if (cached && now - cached.fetchedAt < WIALON_UNITS_STALE_MS) {
        return {
          units: cached.units,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          stale: true,
        };
      }
      throw err;
    }
  }

  const promise = fetchLiveUnitsFromWialon()
    .then((units) => {
      setCache({ units, fetchedAt: Date.now() });
      return units;
    })
    .finally(() => {
      setInflight(null);
    });

  setInflight(promise);

  try {
    const units = await promise;
    const entry = getCache();
    return {
      units,
      fetchedAt: entry?.fetchedAt ?? Date.now(),
      fromCache: false,
      stale: false,
    };
  } catch (err) {
    if (cached && now - cached.fetchedAt < WIALON_UNITS_STALE_MS) {
      return {
        units: cached.units,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        stale: true,
      };
    }
    throw err;
  }
}

/** Скинути кеш (після рідкісних admin-дій; зазвичай не потрібно). */
export function clearWialonUnitsLiveCache(): void {
  setCache(null);
}

// --- Повний список з calc_last_message (флот / паливо) — рідше ---

const UNITS_FULL_TTL_MS = 45_000;
const UNITS_FULL_STALE_MS = 120_000;

type FullCacheEntry = {
  units: WialonUnit[];
  fetchedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __agrosystemWialonUnitsFullCache: FullCacheEntry | null | undefined;
  // eslint-disable-next-line no-var
  var __agrosystemWialonUnitsFullInflight:
    | Promise<WialonUnit[]>
    | null
    | undefined;
}

/**
 * Юніти з sensorCalc. Кеш ~45 с — 3+ логіни в техніку не ганяють N×calc паралельно.
 */
export async function getCachedWialonUnitsFull(): Promise<CachedWialonUnitsResult> {
  const now = Date.now();
  const cached = globalThis.__agrosystemWialonUnitsFullCache ?? null;
  if (cached && now - cached.fetchedAt < UNITS_FULL_TTL_MS) {
    return {
      units: cached.units,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      stale: false,
    };
  }

  const existing = globalThis.__agrosystemWialonUnitsFullInflight;
  if (existing) {
    try {
      const units = await existing;
      const entry = globalThis.__agrosystemWialonUnitsFullCache;
      return {
        units,
        fetchedAt: entry?.fetchedAt ?? Date.now(),
        fromCache: false,
        stale: false,
      };
    } catch (err) {
      if (cached && now - cached.fetchedAt < UNITS_FULL_STALE_MS) {
        return {
          units: cached.units,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          stale: true,
        };
      }
      throw err;
    }
  }

  const promise = (async () => {
    const eid = await wialonLogin();
    return getWialonUnits(eid, { withSensorCalc: true });
  })()
    .then((units) => {
      globalThis.__agrosystemWialonUnitsFullCache = {
        units,
        fetchedAt: Date.now(),
      };
      // Також оновити live-кеш позицій (без окремого login)
      setCache({ units, fetchedAt: Date.now() });
      return units;
    })
    .finally(() => {
      globalThis.__agrosystemWialonUnitsFullInflight = null;
    });

  globalThis.__agrosystemWialonUnitsFullInflight = promise;

  try {
    const units = await promise;
    const entry = globalThis.__agrosystemWialonUnitsFullCache;
    return {
      units,
      fetchedAt: entry?.fetchedAt ?? Date.now(),
      fromCache: false,
      stale: false,
    };
  } catch (err) {
    if (cached && now - cached.fetchedAt < UNITS_FULL_STALE_MS) {
      return {
        units: cached.units,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        stale: true,
      };
    }
    throw err;
  }
}

/**
 * Клієнтський кеш між переходами розділів.
 * Модульний Map живе, поки вкладка відкрита — Soft Navigation його не скидає.
 */

export const APP_DATA_TTL_MS = 2.5 * 60 * 1000; // ~2.5 хв
export const APP_FETCH_TIMEOUT_MS = 25_000;

type CacheRecord = {
  data: unknown;
  fetchedAt: number;
  /** Абсолютний expiry (напр. кінець дня Києва для сезону) */
  expiresAt?: number;
};

const store = new Map<string, CacheRecord>();
const inflight = new Map<string, Promise<unknown>>();

function isCacheFresh(hit: CacheRecord, ttlMs: number): boolean {
  const now = Date.now();
  if (hit.expiresAt != null) return now < hit.expiresAt;
  return now - hit.fetchedAt < ttlMs;
}

export function peekAppCache<T>(key: string, ttlMs = APP_DATA_TTL_MS): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (!isCacheFresh(hit, ttlMs)) return null;
  return hit.data as T;
}

export function peekAppCacheStale<T>(key: string): T | null {
  const hit = store.get(key);
  return hit ? (hit.data as T) : null;
}

export function writeAppCache(
  key: string,
  data: unknown,
  options?: { expiresAt?: number }
): void {
  store.set(key, {
    data,
    fetchedAt: Date.now(),
    expiresAt: options?.expiresAt,
  });
}

export function invalidateAppCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

type CachedFetchOptions = {
  signal?: AbortSignal;
  ttlMs?: number;
  /** Абсолютний expiry замість relative ttl (сезон до кінця дня) */
  expiresAt?: number;
  force?: boolean;
  timeoutMs?: number;
};

async function fetchJsonWithTimeout(
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
      cache: "no-store",
    });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Fetch JSON з TTL + dedupe паралельних запитів на той самий key.
 */
export async function cachedFetchJson<T>(
  key: string,
  input: string,
  init?: RequestInit,
  options?: CachedFetchOptions
): Promise<{ data: T; fromCache: boolean }> {
  const ttlMs = options?.ttlMs ?? APP_DATA_TTL_MS;
  const force = options?.force === true;

  if (!force) {
    const fresh = peekAppCache<T>(key, ttlMs);
    if (fresh != null) {
      return { data: fresh, fromCache: true };
    }
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing && !force) {
    const data = await existing;
    return { data, fromCache: false };
  }

  const request = (async () => {
    const timeoutMs = options?.timeoutMs ?? APP_FETCH_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetchJsonWithTimeout(input, init, timeoutMs);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Запит перевищив час очікування");
      }
      throw err;
    }
    const data = (await response.json()) as T;
    if (!response.ok) {
      const err = data as { error?: string };
      throw new Error(err?.error || `HTTP ${response.status}`);
    }
    writeAppCache(key, data, { expiresAt: options?.expiresAt });
    return data;
  })();

  inflight.set(key, request);
  try {
    const data = await request;
    return { data, fromCache: false };
  } finally {
    inflight.delete(key);
  }
}

/**
 * Кеш довільної async-функції (server actions тощо).
 */
export async function cachedCall<T>(
  key: string,
  fn: () => Promise<T>,
  options?: {
    ttlMs?: number;
    expiresAt?: number;
    force?: boolean;
    timeoutMs?: number;
  }
): Promise<{ data: T; fromCache: boolean }> {
  const ttlMs = options?.ttlMs ?? APP_DATA_TTL_MS;
  const force = options?.force === true;
  const timeoutMs = options?.timeoutMs ?? APP_FETCH_TIMEOUT_MS;

  if (!force) {
    const fresh = peekAppCache<T>(key, ttlMs);
    if (fresh != null) return { data: fresh, fromCache: true };
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing && !force) {
    return { data: await existing, fromCache: false };
  }

  const request = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Запит перевищив час очікування")),
            timeoutMs
          );
        }),
      ]);
      writeAppCache(key, data, { expiresAt: options?.expiresAt });
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  inflight.set(key, request);
  try {
    return { data: await request, fromCache: false };
  } finally {
    inflight.delete(key);
  }
}

export type WarmEndpoint = {
  key: string;
  url: string;
  /** Затримка перед стартом — важкі BAS не б'ємо одночасно */
  delayMs?: number;
};

/**
 * Порядок прогріву (delay від старту, паралельно): карти → паливо KPI →
 * склади/ТМЦ/фінанси/бухгалтерія. Поки на Полях/Техніці — решта вже в кеші.
 */
export const APP_WARM_ENDPOINTS: readonly WarmEndpoint[] = [
  { key: "api:wialon", url: "/api/wialon", delayMs: 0 },
  { key: "api:fields", url: "/api/fields", delayMs: 0 },
  { key: "api:equipment:fleet", url: "/api/equipment/fleet", delayMs: 200 },
  { key: "api:fuel:storages", url: "/api/fuel/storages", delayMs: 400 },
  /**
   * Важкі ендпоінти (KPI палива, finance, склад, черга) — НЕ гріємо всім на логін.
   * Інакше 3+ паралельні сесії одразу валять Wialon/BAS. Кеш зʼявиться при заході в розділ.
   */
] as const;

/** @deprecated RSC prefetch вимкнено — провокував React #412 при soft-nav */
export const APP_WARM_ROUTES = [
  "/",
  "/equipment",
  "/fuel",
  "/inventory",
  "/finance",
  "/accounting",
  "/journal",
] as const;

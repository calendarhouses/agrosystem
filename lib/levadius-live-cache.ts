/**
 * Спільний кеш live-даних LEVADIUS між віджетом, капсулою і drawer.
 * Статус у хромі (бар / сайдбар) — стабільний: не стрибає з «4» на «1 трактор».
 */

export type LevadiusProactiveCache = {
  tone: "alert" | "calm";
  headline: string;
  summary: string;
  priorities: Array<{
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
  }>;
  actions: Array<{ id: string; label: string; prompt: string }>;
  stats: {
    machinesInField: number;
    lowFuelCount: number;
    radarUnrecordedCount: number;
    weatherRiskCount: number;
  };
};

type LevadiusLiveCache = {
  /** Закріплений лічильник радара для UI-хрома */
  radarN: number;
  radarAt: number;
  /** Наратив для капсули / drawer — НЕ для постійного статусу в барі */
  sectionText: string;
  sectionFollowUp: string;
  sectionAt: number;
  proactive: LevadiusProactiveCache | null;
  proactiveAt: number;
  bootedOnce: boolean;
  /** Щоб не ганяти fuel-briefing з кількох віджетів одночасно */
  radarFetchAt: number;
};

/** Поки TTL живий — число в барі не зменшуємо і не міняємо наратив статусу */
const RADAR_PIN_TTL_MS = 150_000;
const PROACTIVE_TTL_MS = 150_000;

const cache: LevadiusLiveCache = {
  radarN: 0,
  radarAt: 0,
  sectionText: "",
  sectionFollowUp: "",
  sectionAt: 0,
  proactive: null,
  proactiveAt: 0,
  bootedOnce: false,
  radarFetchAt: 0,
};

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeLevadiusLiveCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLevadiusLiveCache(): Readonly<LevadiusLiveCache> {
  return cache;
}

function radarPinFresh(now = Date.now()): boolean {
  return cache.radarN > 0 && now - cache.radarAt < RADAR_PIN_TTL_MS;
}

/**
 * Оновити лічильник радара.
 * У межах TTL ніколи не зменшуємо — інакше UI стрибає 4→1 і плутає.
 */
export function setLevadiusRadarN(n: number) {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const now = Date.now();

  if (radarPinFresh(now)) {
    if (next <= cache.radarN) return;
    cache.radarN = next;
    cache.radarAt = now;
    emit();
    return;
  }

  if (cache.radarN === next) {
    if (next > 0) cache.radarAt = now;
    return;
  }
  cache.radarN = next;
  cache.radarAt = next > 0 ? now : 0;
  emit();
}

/** Стабільний рядок статусу для бару / сайдбару (без наративу про «той трактор»). */
export function levadiusRadarStatusLabel(count = cache.radarN): string {
  if (count <= 0) return "Диспетчер онлайн";
  const abs = Math.abs(Math.trunc(count)) % 100;
  const last = abs % 10;
  let noun = "аномалій";
  if (!(abs > 10 && abs < 20)) {
    if (last === 1) noun = "аномалія";
    else if (last >= 2 && last <= 4) noun = "аномалії";
  }
  if (count === 1) return "1 аномалія на радарі — глянь";
  return `${count} ${noun} на радарі — глянь`;
}

/**
 * Наратив секції — лише для капсули / follow-up у drawer.
 * Не чіпає закріплений radarN (окрім явного facts.radarN через setLevadiusRadarN окремо).
 */
export function setLevadiusSectionBrief(input: {
  text: string;
  followUpPrompt?: string;
}) {
  const text = input.text.trim();
  const follow = (input.followUpPrompt || "").trim();
  if (cache.sectionText === text && cache.sectionFollowUp === follow) return;
  cache.sectionText = text;
  cache.sectionFollowUp = follow;
  cache.sectionAt = Date.now();
  emit();
}

export function setLevadiusProactive(briefing: LevadiusProactiveCache) {
  cache.proactive = briefing;
  cache.proactiveAt = Date.now();
  const radar = briefing.stats?.radarUnrecordedCount;
  if (typeof radar === "number") {
    setLevadiusRadarN(radar);
  } else {
    emit();
  }
}

export function markLevadiusBooted() {
  if (cache.bootedOnce) return;
  cache.bootedOnce = true;
  emit();
}

export function hasFreshProactive(ttlMs = PROACTIVE_TTL_MS): boolean {
  return Boolean(cache.proactive) && Date.now() - cache.proactiveAt < ttlMs;
}

export function hasFreshRadarPin(ttlMs = RADAR_PIN_TTL_MS): boolean {
  return radarPinFresh(Date.now()) && Date.now() - cache.radarAt < ttlMs;
}

/** Один спільний fetch радара — сайдбар і моб-бар не б'ються між собою. */
let radarFetchInflight: Promise<void> | null = null;

export function ensureLevadiusRadarFetched(): Promise<void> {
  if (hasFreshRadarPin() && Date.now() - cache.radarFetchAt < RADAR_PIN_TTL_MS) {
    return Promise.resolve();
  }
  if (radarFetchInflight) return radarFetchInflight;

  radarFetchInflight = (async () => {
    try {
      const res = await fetch("/api/agent/section-briefing?section=fuel", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        facts?: { radarN?: number };
        text?: string;
        followUpPrompt?: string;
        skip?: boolean;
      };
      if (!data?.ok) return;
      cache.radarFetchAt = Date.now();
      const n = Number(data.facts?.radarN);
      if (Number.isFinite(n)) setLevadiusRadarN(n);
      // follow-up для drawer — так, наратив у постійний статус бару — ні
      if (!data.skip && data.followUpPrompt?.trim()) {
        if (!cache.sectionFollowUp) {
          cache.sectionFollowUp = data.followUpPrompt.trim();
        }
      }
    } catch {
      /* ignore */
    } finally {
      radarFetchInflight = null;
    }
  })();

  return radarFetchInflight;
}

/** Швидкий бриф з уже відомих фактів (віджет / капсула), без API. */
export function buildQuickBriefingFromCache(): LevadiusProactiveCache | null {
  if (cache.proactive && hasFreshProactive()) return cache.proactive;

  const radarN = cache.radarN;
  if (radarN <= 0 && !cache.sectionText) return null;

  return {
    tone: radarN > 0 || cache.sectionText ? "alert" : "calm",
    headline:
      radarN > 0
        ? "Радар уже щось зловив"
        : "Оперативне зведення зміни",
    summary:
      radarN > 0
        ? `Уже є ${radarN} ${radarN === 1 ? "підозра" : radarN < 5 ? "підозри" : "підозр"} на заправку повз облік — можна одразу розібрати.`
        : cache.sectionText,
    priorities:
      radarN > 0
        ? [
            {
              id: "radar-cached",
              severity: "warning",
              title: `Радар · ${radarN}`,
              detail: "Дані з віджета диспетчера — без повторного збору.",
            },
          ]
        : [],
    actions:
      radarN > 0
        ? [
            {
              id: "show-radar",
              label: "Показати радар",
              prompt:
                "Покажи підозри на заправку повз облік, почни з найбільшого об'єму",
            },
          ]
        : [],
    stats: {
      machinesInField: cache.proactive?.stats.machinesInField ?? 0,
      lowFuelCount: cache.proactive?.stats.lowFuelCount ?? 0,
      radarUnrecordedCount: radarN,
      weatherRiskCount: cache.proactive?.stats.weatherRiskCount ?? 0,
    },
  };
}

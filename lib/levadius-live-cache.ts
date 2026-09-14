/**
 * Спільний кеш live-даних LEVADIUS між віджетом, капсулою і drawer.
 * Щоб не ганяти аналіз заново при кожному відкритті.
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
  radarN: number;
  sectionText: string;
  sectionFollowUp: string;
  proactive: LevadiusProactiveCache | null;
  proactiveAt: number;
  bootedOnce: boolean;
};

const PROACTIVE_TTL_MS = 150_000;

const cache: LevadiusLiveCache = {
  radarN: 0,
  sectionText: "",
  sectionFollowUp: "",
  proactive: null,
  proactiveAt: 0,
  bootedOnce: false,
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

export function setLevadiusRadarN(n: number) {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (cache.radarN === next) return;
  cache.radarN = next;
  emit();
}

export function setLevadiusSectionBrief(input: {
  text: string;
  followUpPrompt?: string;
  radarN?: number;
}) {
  cache.sectionText = input.text.trim();
  cache.sectionFollowUp = (input.followUpPrompt || "").trim();
  if (input.radarN != null) setLevadiusRadarN(input.radarN);
  else emit();
}

export function setLevadiusProactive(briefing: LevadiusProactiveCache) {
  cache.proactive = briefing;
  cache.proactiveAt = Date.now();
  const radar = briefing.stats?.radarUnrecordedCount;
  if (typeof radar === "number" && radar > 0) {
    cache.radarN = Math.floor(radar);
  }
  emit();
}

export function markLevadiusBooted() {
  if (cache.bootedOnce) return;
  cache.bootedOnce = true;
  emit();
}

export function hasFreshProactive(ttlMs = PROACTIVE_TTL_MS): boolean {
  return Boolean(cache.proactive) && Date.now() - cache.proactiveAt < ttlMs;
}

/** Швидкий бриф з уже відомих фактів (віджет / капсула), без API. */
export function buildQuickBriefingFromCache(): LevadiusProactiveCache | null {
  if (cache.proactive && hasFreshProactive()) return cache.proactive;

  const radarN = cache.radarN;
  const sectionText = cache.sectionText;
  if (radarN <= 0 && !sectionText) return null;

  return {
    tone: radarN > 0 || sectionText ? "alert" : "calm",
    headline:
      radarN > 0
        ? "Радар уже щось зловив"
        : "Оперативне зведення зміни",
    summary:
      sectionText ||
      (radarN > 0
        ? `Уже є ${radarN} підозр на заправку повз облік — можна одразу розібрати.`
        : ""),
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

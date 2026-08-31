"use client";

import { useEffect, useRef } from "react";

import {
  APP_DATA_TTL_MS,
  APP_WARM_ENDPOINTS,
  cachedFetchJson,
  peekAppCache,
} from "@/lib/client-data-cache";

const WARM_SESSION_KEY = "agrosystem-api-warm-v1";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Прогрів API-кешу один раз за сесію вкладки.
 * Не привʼязуємо до pathname — інакше кожен розділ знову бʼє сервер.
 */
export function AppDataWarmer() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const warmApis = async () => {
      if (sessionStorage.getItem(WARM_SESSION_KEY) === "1") return;

      for (const endpoint of APP_WARM_ENDPOINTS) {
        if (cancelled || document.hidden) return;
        if (peekAppCache(endpoint.key)) continue;
        const delay = endpoint.delayMs ?? 0;
        if (delay) await sleep(Math.min(delay, 600));
        if (cancelled || document.hidden) return;
        try {
          await cachedFetchJson(endpoint.key, endpoint.url);
        } catch {
          /* тихий прогрів */
        }
      }
      sessionStorage.setItem(WARM_SESSION_KEY, "1");
    };

    const ric = (
      window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
      }
    ).requestIdleCallback;

    let idleId = 0;
    let startTimer = 0;

    const schedule = () => {
      if (typeof ric === "function") {
        idleId = ric(() => void warmApis(), { timeout: 4000 });
      } else {
        startTimer = window.setTimeout(() => void warmApis(), 800);
      }
    };

    startTimer = window.setTimeout(schedule, 400);

    /** Оновлюємо лише прострочений кеш — по одному endpoint, без залпу. */
    const refreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      void (async () => {
        for (const endpoint of APP_WARM_ENDPOINTS) {
          if (document.hidden) return;
          if (peekAppCache(endpoint.key, APP_DATA_TTL_MS)) continue;
          try {
            await cachedFetchJson(endpoint.key, endpoint.url);
          } catch {
            /* ignore */
          }
          await sleep(400);
        }
      })();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearInterval(refreshTimer);
      const cic = (
        window as Window & {
          cancelIdleCallback?: (id: number) => void;
        }
      ).cancelIdleCallback;
      if (idleId && typeof cic === "function") cic(idleId);
    };
  }, []);

  return null;
}

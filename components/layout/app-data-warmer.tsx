"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import {
  APP_WARM_ENDPOINTS,
  cachedFetchJson,
  peekAppCache,
} from "@/lib/client-data-cache";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Прогрів API-кешу. БЕЗ router.prefetch:
 * паралельні RSC-prefetch під час soft-nav → React #412 («Connection closed»).
 * API-warm стартує одразу (навіть під LEVADA), щоб Склад/Паливо не показували «Завантаження…».
 */
export function AppDataWarmer() {
  const pathname = usePathname();
  const runIdRef = useRef(0);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/install") return;

    const runId = ++runIdRef.current;
    let cancelled = false;
    let idleId = 0;
    let startTimer = 0;

    const warmApis = async () => {
      for (const endpoint of APP_WARM_ENDPOINTS) {
        if (cancelled || runId !== runIdRef.current) return;
        if (peekAppCache(endpoint.key)) continue;
        const delay = endpoint.delayMs ?? 0;
        if (delay) await sleep(Math.min(delay, 600));
        if (cancelled || runId !== runIdRef.current) return;
        if (document.hidden) {
          await sleep(800);
          if (cancelled || document.hidden) return;
        }
        try {
          await cachedFetchJson(endpoint.key, endpoint.url);
        } catch {
          /* тихий прогрів */
        }
      }
    };

    const schedule = () => {
      const ric = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number }
          ) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === "function") {
        idleId = ric(() => void warmApis(), { timeout: 2500 });
      } else {
        startTimer = window.setTimeout(() => void warmApis(), 400);
      }
    };

    startTimer = window.setTimeout(schedule, 200);

    const refreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      for (const endpoint of APP_WARM_ENDPOINTS) {
        void cachedFetchJson(endpoint.key, endpoint.url).catch(() => {});
      }
    }, 3 * 60 * 1000);

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
  }, [pathname]);

  return null;
}

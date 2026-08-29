"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  APP_WARM_ENDPOINTS,
  APP_WARM_ROUTES,
  cachedFetchJson,
  peekAppCache,
} from "@/lib/client-data-cache";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Поки користувач на карті — прогріває кеш усієї системи + prefetch маршрутів.
 * Не блокує UI: idle, черги з delay, без toast при помилках.
 */
export function AppDataWarmer() {
  const pathname = usePathname();
  const router = useRouter();
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
        if (endpoint.delayMs) await sleep(endpoint.delayMs);
        if (cancelled || runId !== runIdRef.current) return;
        if (document.hidden) {
          await sleep(800);
          if (cancelled || document.hidden) continue;
        }
        try {
          await cachedFetchJson(endpoint.key, endpoint.url);
        } catch {
          /* тихий прогрів */
        }
      }
    };

    const prefetchRoutes = () => {
      for (const href of APP_WARM_ROUTES) {
        if (href === pathname) continue;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
      }
    };

    const kickoff = () => {
      if (cancelled) return;
      prefetchRoutes();
      void warmApis();
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
        idleId = ric(kickoff, { timeout: 5000 });
      } else {
        startTimer = window.setTimeout(kickoff, 1600);
      }
    };

    // На карті полів — трохи довша пауза, щоб map/boot не конкурували
    const bootDelay =
      pathname === "/" || pathname === "/equipment" ? 1100 : 500;
    startTimer = window.setTimeout(schedule, bootDelay);

    const refreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      for (const endpoint of APP_WARM_ENDPOINTS) {
        void cachedFetchJson(endpoint.key, endpoint.url).catch(() => {});
      }
      prefetchRoutes();
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
  }, [pathname, router]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  APP_WARM_ENDPOINTS,
  APP_WARM_ROUTES,
  cachedFetchJson,
  peekAppCache,
} from "@/lib/client-data-cache";
import { useAppBoot } from "@/lib/app-boot";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Прогрів кешу API + prefetch маршрутів.
 * Під час LEVADA стартує одразу (паралельно з мапою), без довгої idle-паузи.
 */
export function AppDataWarmer() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAppLoading } = useAppBoot();
  const isAppLoadingRef = useRef(isAppLoading);
  isAppLoadingRef.current = isAppLoading;
  const runIdRef = useRef(0);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/install") return;

    const runId = ++runIdRef.current;
    let cancelled = false;
    let idleId = 0;
    let startTimer = 0;
    const booting = isAppLoadingRef.current;

    const warmApis = async () => {
      await Promise.all(
        APP_WARM_ENDPOINTS.map(async (endpoint) => {
          if (cancelled || runId !== runIdRef.current) return;
          if (peekAppCache(endpoint.key)) return;
          const delay = booting
            ? Math.min(endpoint.delayMs ?? 0, 200)
            : (endpoint.delayMs ?? 0);
          if (delay) await sleep(delay);
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
        })
      );
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
        idleId = ric(kickoff, { timeout: booting ? 800 : 5000 });
      } else {
        startTimer = window.setTimeout(kickoff, booting ? 0 : 1600);
      }
    };

    const bootDelay = booting
      ? 0
      : pathname === "/" || pathname === "/equipment"
        ? 1100
        : 500;

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

"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldFuelPeriod } from "@/app/fuel/actions";
import { FUEL_KPI_LOAD_SEED_MS } from "@/lib/fuel-kpi-load-constants";

const CACHE_KEY = "agrosystem-fuel-kpi-load-ms-shared-v1";

type Store = Partial<Record<FieldFuelPeriod, number>>;

function readLocalCache(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalCache(period: FieldFuelPeriod, ms: number) {
  try {
    const store = readLocalCache();
    store[period] = Math.round(ms);
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Локальний кеш спільної оцінки (щоб шкала стартувала одразу). */
export function peekSharedFuelKpiLoadMs(period: FieldFuelPeriod): number {
  const hit = readLocalCache()[period];
  if (hit != null && Number.isFinite(hit) && hit >= 2500) {
    return Math.round(hit);
  }
  return FUEL_KPI_LOAD_SEED_MS[period];
}

export function rememberSharedFuelKpiLoadMs(
  period: FieldFuelPeriod,
  ms: number
) {
  if (!Number.isFinite(ms) || ms < 2500) return;
  writeLocalCache(period, ms);
}

/** Відправити замір на сервер — оновить спільну EMA для всіх. */
export function reportFuelKpiLoadMs(
  period: FieldFuelPeriod,
  elapsedMs: number
): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 800 || elapsedMs > 180_000) {
    return;
  }
  void fetch("/api/fuel/kpi-load-ms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ period, elapsedMs: Math.round(elapsedMs) }),
    keepalive: true,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; emaMs?: number };
      if (data.ok && data.emaMs != null) {
        rememberSharedFuelKpiLoadMs(period, data.emaMs);
      }
    })
    .catch(() => {
      /* ignore */
    });
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Шкала 1% → 100% за спільною оцінкою часу (сервер).
 * Після завершення шле замір на API — усі наступні клієнти бачать оновлену EMA.
 */
export function useFuelLoadProgress(opts: {
  loading: boolean;
  incomplete: boolean;
  period: FieldFuelPeriod;
  /** З відповіді /api/fuel/kpis — спільна оцінка для всіх */
  sharedExpectedMs?: number | null;
}): number | null {
  const { loading, incomplete, period, sharedExpectedMs } = opts;
  const active = loading || incomplete;
  const [pct, setPct] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const expectedRef = useRef(peekSharedFuelKpiLoadMs(period));
  const finishFromRef = useRef(1);

  useEffect(() => {
    if (sharedExpectedMs != null && Number.isFinite(sharedExpectedMs)) {
      rememberSharedFuelKpiLoadMs(period, sharedExpectedMs);
      // Підкрутити ціль лише якщо сесія ще на початку (<40%)
      if (!sessionActiveRef.current || finishFromRef.current < 40) {
        expectedRef.current = Math.round(sharedExpectedMs);
      }
    }
  }, [sharedExpectedMs, period]);

  useEffect(() => {
    startedAtRef.current = null;
    sessionActiveRef.current = false;
    expectedRef.current = peekSharedFuelKpiLoadMs(period);
    setPct(null);
  }, [period]);

  useEffect(() => {
    if (active) {
      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        startedAtRef.current = Date.now();
        expectedRef.current =
          sharedExpectedMs != null && Number.isFinite(sharedExpectedMs)
            ? Math.round(sharedExpectedMs)
            : peekSharedFuelKpiLoadMs(period);
        setPct(1);
      }

      const id = window.setInterval(() => {
        const started = startedAtRef.current ?? Date.now();
        const elapsed = Date.now() - started;
        const expected = Math.max(2500, expectedRef.current);
        let next: number;
        if (elapsed <= expected) {
          next = 1 + easeOutCubic(elapsed / expected) * 94;
        } else {
          const over = elapsed - expected;
          next =
            95 +
            (1 - Math.exp(-over / Math.max(4_000, expected * 0.4))) * 4;
        }
        const rounded = Math.min(99, Math.max(1, Math.round(next)));
        finishFromRef.current = rounded;
        setPct(rounded);
      }, 80);

      return () => window.clearInterval(id);
    }

    if (sessionActiveRef.current) {
      sessionActiveRef.current = false;
      const started = startedAtRef.current;
      if (started != null) {
        const elapsed = Date.now() - started;
        reportFuelKpiLoadMs(period, elapsed);
        rememberSharedFuelKpiLoadMs(period, elapsed);
      }

      const from = finishFromRef.current;
      const finishStarted = Date.now();
      const finishMs = 420;
      setPct(Math.max(from, 96));

      const id = window.setInterval(() => {
        const t = (Date.now() - finishStarted) / finishMs;
        if (t >= 1) {
          setPct(100);
          window.clearInterval(id);
          window.setTimeout(() => {
            setPct(null);
            startedAtRef.current = null;
          }, 380);
          return;
        }
        setPct(Math.round(from + (100 - from) * easeOutCubic(t)));
      }, 40);

      return () => window.clearInterval(id);
    }

    return;
  }, [active, period, sharedExpectedMs]);

  return pct;
}

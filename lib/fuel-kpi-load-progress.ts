"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldFuelPeriod } from "@/app/fuel/actions";
import { FUEL_KPI_LOAD_SEED_MS } from "@/lib/fuel-kpi-load-constants";

const CACHE_KEY = "agrosystem-fuel-kpi-load-ms-shared-v2";

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

/** Локальний кеш спільної оцінки саме для цього періоду. */
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
 * Шкала 1% → 99% поки вантажиться, 100% коли готово.
 * Темп від expectedMs періоду (сезон повільніше за «сьогодні»).
 * Якщо запит довший за оцінку — розтягуємо темп, стеля лишається 99%.
 */
export function useFuelLoadProgress(opts: {
  loading: boolean;
  incomplete: boolean;
  period: FieldFuelPeriod;
  /** Оцінка саме для поточного period (з API); null = ще не прийшла */
  sharedExpectedMs?: number | null;
}): number | null {
  const { loading, incomplete, period, sharedExpectedMs } = opts;
  const active = loading || incomplete;
  const [pct, setPct] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const expectedRef = useRef(peekSharedFuelKpiLoadMs(period));
  const periodRef = useRef(period);
  const finishFromRef = useRef(1);

  // Новий період — завжди свій темп, не чужий sharedExpectedMs
  useEffect(() => {
    periodRef.current = period;
    startedAtRef.current = null;
    sessionActiveRef.current = false;
    expectedRef.current = peekSharedFuelKpiLoadMs(period);
    finishFromRef.current = 1;
    setPct(null);
  }, [period]);

  // Підхопити серверну оцінку лише для цього period і не пізно в сесії
  useEffect(() => {
    if (sharedExpectedMs == null || !Number.isFinite(sharedExpectedMs)) return;
    if (periodRef.current !== period) return;
    rememberSharedFuelKpiLoadMs(period, sharedExpectedMs);
    if (!sessionActiveRef.current || finishFromRef.current < 45) {
      expectedRef.current = Math.round(sharedExpectedMs);
    }
  }, [sharedExpectedMs, period]);

  useEffect(() => {
    if (active) {
      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        startedAtRef.current = Date.now();
        // Не брати stale sharedExpectedMs від попереднього періоду
        expectedRef.current =
          sharedExpectedMs != null && Number.isFinite(sharedExpectedMs)
            ? Math.round(sharedExpectedMs)
            : peekSharedFuelKpiLoadMs(period);
        setPct(1);
      }

      const id = window.setInterval(() => {
        const started = startedAtRef.current ?? Date.now();
        const elapsed = Date.now() - started;
        let expected = Math.max(2500, expectedRef.current);
        // Довше оцінки — розтягуємо, щоб наближатися до 99%, не зависати раніше
        if (elapsed > expected) {
          expected = Math.max(expected, elapsed / 0.99);
          expectedRef.current = expected;
        }
        const ratio = Math.min(1, elapsed / expected);
        const next = 1 + easeOutCubic(ratio) * 98;
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

      const from = Math.min(99, finishFromRef.current);
      const finishStarted = Date.now();
      const finishMs = 420;

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

"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldFuelPeriod } from "@/app/fuel/actions";

const STORAGE_KEY = "agrosystem-fuel-kpi-load-ms-v1";

/**
 * Стартові оцінки (поки немає замірів на цьому пристрої).
 * З відгуку: 7 днів ≈ готове на ~30% від 28с → ~8–9с; місяць трохи довше.
 * Далі кожне реальне завершення підтягує EMA.
 */
const SEED_MS: Record<FieldFuelPeriod, number> = {
  today: 5_500,
  yesterday: 6_000,
  week: 9_000,
  month: 12_000,
  season: 22_000,
};

const MIN_MS = 2_500;
const MAX_MS = 120_000;
/** Новий замір важить 45% — швидко підлаштовується під реальний час */
const EMA_ALPHA = 0.45;

type Store = Partial<Record<FieldFuelPeriod, number>>;

function clampMs(ms: number): number {
  return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms)));
}

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function expectedFuelKpiLoadMs(period: FieldFuelPeriod): number {
  const hit = readStore()[period];
  if (hit != null && Number.isFinite(hit) && hit > 0) {
    return clampMs(hit);
  }
  return SEED_MS[period];
}

/** Записати фактичний час повного циклу (усі чанки до кінця). */
export function recordFuelKpiLoadMs(period: FieldFuelPeriod, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 800) return;
  const prev = expectedFuelKpiLoadMs(period);
  const next = clampMs(prev * (1 - EMA_ALPHA) + elapsedMs * EMA_ALPHA);
  const store = readStore();
  store[period] = next;
  writeStore(store);
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Шкала 1% → 100% за адаптивним часом періоду.
 * Вчиться з реального завершення на цьому пристрої (localStorage).
 */
export function useFuelLoadProgress(opts: {
  loading: boolean;
  incomplete: boolean;
  period: FieldFuelPeriod;
}): number | null {
  const { loading, incomplete, period } = opts;
  const active = loading || incomplete;
  const [pct, setPct] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const expectedRef = useRef(SEED_MS.today);
  const finishFromRef = useRef(1);

  useEffect(() => {
    startedAtRef.current = null;
    sessionActiveRef.current = false;
    setPct(null);
  }, [period]);

  useEffect(() => {
    if (active) {
      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        startedAtRef.current = Date.now();
        expectedRef.current = expectedFuelKpiLoadMs(period);
        setPct(1);
      }

      const id = window.setInterval(() => {
        const started = startedAtRef.current ?? Date.now();
        const elapsed = Date.now() - started;
        const expected = expectedRef.current;
        let next: number;
        if (elapsed <= expected) {
          next = 1 + easeOutCubic(elapsed / expected) * 94;
        } else {
          const over = elapsed - expected;
          next = 95 + (1 - Math.exp(-over / Math.max(4_000, expected * 0.4))) * 4;
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
        recordFuelKpiLoadMs(period, Date.now() - started);
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
  }, [active, period]);

  return pct;
}

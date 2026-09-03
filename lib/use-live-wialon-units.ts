"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WialonUnit } from "@/lib/wialon";

const DEFAULT_INTERVAL_MS = 30_000;

type UseLiveWialonUnitsOptions = {
  /** За замовчуванням true */
  enabled?: boolean;
  /** Інтервал поллінгу (мс). Default 15s */
  intervalMs?: number;
  /**
   * Початкові юніти (один раз, до першого live-відповіді).
   * Не передавай сюди масив, який сам оновлюється з цього хука —
   * це створює цикл setState.
   */
  seedUnits?: WialonUnit[] | null;
};

type UseLiveWialonUnitsResult = {
  units: WialonUnit[];
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
};

function positionsChanged(prev: WialonUnit[], next: WialonUnit[]): boolean {
  if (prev.length !== next.length) return true;
  const prevById = new Map(prev.map((u) => [u.id, u]));
  for (const unit of next) {
    const old = prevById.get(unit.id);
    if (!old) return true;
    if (old.nm !== unit.nm) return true;
    const op = old.pos;
    const np = unit.pos;
    if (!op && !np) {
      /* same */
    } else if (!op || !np) {
      return true;
    } else if (
      op.x !== np.x ||
      op.y !== np.y ||
      (op.s ?? 0) !== (np.s ?? 0) ||
      (op.t ?? 0) !== (np.t ?? 0) ||
      (op.c ?? 0) !== (np.c ?? 0)
    ) {
      return true;
    }
    const oldCalc = (old as WialonUnit & { sensorCalc?: Record<string, number> })
      .sensorCalc;
    const nextCalc = (
      unit as WialonUnit & { sensorCalc?: Record<string, number> }
    ).sensorCalc;
    // Live без calc — ігноруємо (інакше кожен полл «змінює» юніт)
    if (
      nextCalc != null &&
      JSON.stringify(oldCalc ?? null) !== JSON.stringify(nextCalc)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Фоновий поллінг позицій техніки Wialon.
 * Пауза, коли вкладка прихована (Page Visibility).
 */
export function useLiveWialonUnits(
  options: UseLiveWialonUnitsOptions = {}
): UseLiveWialonUnitsResult {
  const {
    enabled = true,
    intervalMs = DEFAULT_INTERVAL_MS,
    seedUnits = null,
  } = options;

  const [units, setUnits] = useState<WialonUnit[]>(() => seedUnits ?? []);
  const [loading, setLoading] = useState(() => !seedUnits?.length);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inFlightRef = useRef(false);
  const hasLiveDataRef = useRef(false);
  const didApplySeedRef = useRef(Boolean(seedUnits?.length));

  // Seed лише один раз (до першого live). Не залежить від нової reference масиву.
  useEffect(() => {
    if (didApplySeedRef.current || hasLiveDataRef.current) return;
    if (!seedUnits?.length) return;
    didApplySeedRef.current = true;
    setUnits(seedUnits);
    setLoading(false);
  }, [seedUnits]);

  const fetchUnits = useCallback(async (signal?: AbortSignal) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/wialon/units", {
        cache: "no-store",
        signal,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        units?: WialonUnit[];
      };
      if (!res.ok || data.ok === false || !Array.isArray(data.units)) {
        throw new Error(data.error || "Не вдалося оновити GPS");
      }
      const next = data.units;
      hasLiveDataRef.current = true;
      setUnits((prev) => (positionsChanged(prev, next) ? next : prev));
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Помилка Wialon");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchUnits();
  }, [fetchUnits]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void fetchUnits(controller.signal);

    let timer: ReturnType<typeof setInterval> | null = null;

    const startTimer = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void fetchUnits();
      }, intervalMs);
    };

    const stopTimer = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stopTimer();
        return;
      }
      void fetchUnits();
      startTimer();
    };

    startTimer();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      controller.abort();
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, fetchUnits]);

  return { units, loading, error, lastUpdatedAt, refresh };
}

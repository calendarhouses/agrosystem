"use client";

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";

import {
  getFinancePeriodRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { currentAgroSeason } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";

/**
 * @param defaultPeriod — початковий період (за замовчуванням "Сезон")
 * @param options.isolated — якщо true, сезон зберігається локально
 *   (не торкає глобальний useSeasonStore). Завжди стартує з поточного агросезону.
 *   Використовується для Хронології, щоб не впливати на деталі поля.
 */
export function useFinancePeriodFilter(
  defaultPeriod: FinancePeriod = "Сезон",
  options?: { isolated?: boolean }
) {
  const isolated = options?.isolated ?? false;

  // Глобальний стор
  const globalSeason = useSeasonStore((s) => s.activeSeason);
  const setGlobalSeason = useSeasonStore((s) => s.setActiveSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);

  // Локальний стан (використовується лише в isolated-режимі)
  const [localSeason, setLocalSeason] = useState(() => currentAgroSeason());

  const activeSeason = isolated ? localSeason : globalSeason;
  const setActiveSeason = isolated ? setLocalSeason : setGlobalSeason;
  const seasonYear = Number(activeSeason) || 2026;

  const [period, setPeriod] = useState<FinancePeriod>(defaultPeriod);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);

  const dateRange = useMemo(
    () => getFinancePeriodRange(period, seasonYear, customRange),
    [period, seasonYear, customRange]
  );
  const isoRange = useMemo(() => toIsoRange(dateRange), [dateRange]);

  function selectSeason(year: number) {
    setActiveSeason(String(year));
    setPeriod("Сезон");
    setSeasonOpen(false);
    setRangeOpen(false);
  }

  function applyPeriod(next: FinancePeriod) {
    setSeasonOpen(false);
    if (next !== "Діапазон") setRangeOpen(false);
    setPeriod(next);
  }

  return {
    period,
    setPeriod,
    customRange,
    setCustomRange,
    seasonOpen,
    setSeasonOpen,
    rangeOpen,
    setRangeOpen,
    seasonYear,
    availableSeasons,
    dateRange,
    isoRange,
    selectSeason,
    applyPeriod,
  };
}

export type FinancePeriodFilter = ReturnType<typeof useFinancePeriodFilter>;

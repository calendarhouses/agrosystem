"use client";

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";

import {
  getFinancePeriodRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { useSeasonStore } from "@/lib/season-store";

export function useFinancePeriodFilter(defaultPeriod: FinancePeriod = "Сезон") {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);
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

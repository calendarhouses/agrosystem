"use client";

import { useCallback, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";

type Snapshot<TPeriod extends string> = {
  period: TPeriod;
  customRange: DateRange | undefined;
};

type Options<TPeriod extends string> = {
  period: TPeriod;
  setPeriod: (period: TPeriod) => void;
  customRange: DateRange | undefined;
  setCustomRange: (range: DateRange | undefined) => void;
  rangeOpen: boolean;
  setRangeOpen: (open: boolean) => void;
  rangePeriod: TPeriod;
  fallbackPeriod: TPeriod;
  onPopoverOpen?: () => void;
  /** Напр. applyHistoryPeriod — закриває інші popover і синхронізує сезон */
  onApplyPeriod?: (period: TPeriod) => void;
  onResetPeriod?: (period: TPeriod) => void;
};

/**
 * Чернетка діапазону дат у popover: період змінюється лише після «Застосувати»,
 * закриття без застосування відновлює попередній фільтр.
 */
export function useRangePopoverDraft<TPeriod extends string>({
  period,
  setPeriod,
  customRange,
  setCustomRange,
  rangeOpen,
  setRangeOpen,
  rangePeriod,
  fallbackPeriod,
  onPopoverOpen,
  onApplyPeriod,
  onResetPeriod,
}: Options<TPeriod>) {
  const snapshotRef = useRef<Snapshot<TPeriod> | null>(null);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        snapshotRef.current = { period, customRange };
        setDraft(customRange);
        onPopoverOpen?.();
        setRangeOpen(true);
        return;
      }

      setRangeOpen(false);
      const snap = snapshotRef.current;
      snapshotRef.current = null;
      if (snap) {
        setPeriod(snap.period);
        setCustomRange(snap.customRange);
      }
      setDraft(undefined);
    },
    [
      period,
      customRange,
      onPopoverOpen,
      setRangeOpen,
      setPeriod,
      setCustomRange,
    ]
  );

  const applyDraft = useCallback(() => {
    if (!draft?.from) return;
    const applied: DateRange = {
      from: draft.from,
      to: draft.to ?? draft.from,
    };
    setCustomRange(applied);
    if (onApplyPeriod) {
      onApplyPeriod(rangePeriod);
    } else {
      setPeriod(rangePeriod);
    }
    snapshotRef.current = { period: rangePeriod, customRange: applied };
    setRangeOpen(false);
    setDraft(undefined);
  }, [
    draft,
    rangePeriod,
    setCustomRange,
    setPeriod,
    setRangeOpen,
    onApplyPeriod,
  ]);

  const resetDraft = useCallback(() => {
    setCustomRange(undefined);
    if (onResetPeriod) {
      onResetPeriod(fallbackPeriod);
    } else {
      setPeriod(fallbackPeriod);
    }
    snapshotRef.current = null;
    setRangeOpen(false);
    setDraft(undefined);
  }, [fallbackPeriod, setCustomRange, setPeriod, setRangeOpen, onResetPeriod]);

  const calendarSelected = rangeOpen ? draft : customRange;

  return {
    draft,
    setDraft,
    calendarSelected,
    handleOpenChange,
    applyDraft,
    resetDraft,
  };
}

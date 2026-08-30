/**
 * Контрольований вибір DateRange для react-day-picker:
 * 1-й клік = початок, 2-й = кінець (навіть якщо picker повертає лише from).
 * Повний діапазон + новий клік = новий початок.
 */

import { startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";

export function nextDateRangeSelection(
  prev: DateRange | undefined,
  range: DateRange | undefined,
  triggerDate?: Date
): DateRange | undefined {
  if (!triggerDate && !range?.from) {
    return undefined;
  }

  const clicked = triggerDate ?? range?.from;
  if (!clicked) return undefined;

  const day = startOfDay(clicked);

  // Повний діапазон уже був — новий клік починає вибір заново
  if (prev?.from && prev?.to) {
    return { from: day, to: undefined };
  }

  // Є початок без кінця — фіксуємо кінець відносно prev.from
  if (prev?.from && !prev.to) {
    const from = startOfDay(prev.from);
    if (day.getTime() === from.getTime()) {
      return { from, to: from };
    }
    if (day.getTime() < from.getTime()) {
      return { from: day, to: from };
    }
    return { from, to: day };
  }

  // Перший клік
  return { from: day, to: undefined };
}

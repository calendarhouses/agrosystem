/**
 * Єдина валідація денної витрати з ДУТ (start − end + заправки).
 * Захист від дропаутів двобакових датчиків і фантомних «заправок».
 */

import {
  isCisternFuelLevel,
  MAX_TRACTOR_BURN_LPH,
  MAX_TRACTOR_DAY_BURN_L,
} from "@/lib/equipment-fuel-tanks";

const MIN_PHANTOM_FILL_L = 30;

export type DayFuelConsumedInput = {
  start: number | null;
  end: number | null;
  filled: number;
  tankVolumeLiters?: number | null;
  workHours?: number | null;
};

/**
 * Правдоподібна витрата за добу; null — датчик/формула ненадійні.
 */
export function resolvePlausibleDayFuelConsumed(
  input: DayFuelConsumedInput
): number | null {
  const start = input.start;
  const end = input.end;
  const filled = Math.max(0, Number(input.filled) || 0);
  if (start == null || end == null) return null;

  const tankCap =
    input.tankVolumeLiters != null &&
    Number.isFinite(input.tankVolumeLiters) &&
    input.tankVolumeLiters > 0
      ? input.tankVolumeLiters
      : null;

  const maxLevel = tankCap != null ? tankCap * 1.2 : 2500;
  const maxDelta = tankCap != null ? tankCap * 0.95 : 900;
  const maxFillDay = tankCap != null ? tankCap * 0.85 : 900;

  if (isCisternFuelLevel(start, end)) return null;
  if (start > maxLevel || end > maxLevel) return null;

  const rawDrop = start - end;

  // Рівень на кінці дня вищий — відновлення ДУТ / «заправка», не згоряння.
  if (rawDrop <= 0) {
    return filled >= MIN_PHANTOM_FILL_L ? null : 0;
  }

  // Падіння більше за обʼєм бака — один бак «зник» з сумарного каналу.
  if (rawDrop > maxDelta) return null;

  // end << start без реальної заливки — типовий дропаут другого бака.
  if (end < start * 0.35 && rawDrop > 180 && filled < rawDrop * 0.55) {
    return null;
  }

  let trustedFill = filled;
  if (filled > maxFillDay) {
    trustedFill = 0;
  } else if (
    filled >= MIN_PHANTOM_FILL_L &&
    end > start - 20 &&
    rawDrop < filled * 0.85
  ) {
    // «Заправка» на тлі загального зростання рівня — фантом.
    trustedFill = 0;
  } else if (
    filled > rawDrop * 0.5 &&
    filled < rawDrop * 1.1 &&
    rawDrop + filled > rawDrop * 1.3
  ) {
    // Частковий дропаут одного бака + «заправка» при відновленні каналу.
    trustedFill = 0;
  }

  let consumed = Math.max(0, Math.round((rawDrop + trustedFill) * 10) / 10);

  const work = Math.max(0, Number(input.workHours) || 0);
  const maxByWork = Math.max(work, 0.35) * MAX_TRACTOR_BURN_LPH + 30;

  if (consumed > maxByWork && consumed > 120) {
    const withoutFills = Math.max(0, Math.round(rawDrop * 10) / 10);
    if (withoutFills <= maxByWork && withoutFills <= maxDelta) {
      consumed = withoutFills;
    } else if (
      withoutFills > maxByWork ||
      withoutFills > MAX_TRACTOR_DAY_BURN_L
    ) {
      return null;
    } else {
      consumed = withoutFills;
    }
  }

  if (consumed > MAX_TRACTOR_DAY_BURN_L) return null;
  return consumed;
}

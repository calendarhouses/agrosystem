"use server";

import {
  findUnrecordedRefuelings,
  UNRECORDED_LOOKBACK_HOURS,
  type UnrecordedRefueling,
} from "@/lib/fuel-unrecorded-refuelings";
import {
  loadRefuelSmartContext,
  type RefuelSmartContext,
} from "@/lib/fuel-refuel-context";
import {
  resolveDieselPriceUah,
  type DieselPriceResult,
} from "@/lib/fuel-price";
import {
  sumFieldFuelConsumedForDate,
  todayKyivDateString,
} from "@/lib/wialon-field-fuel-sync";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Актуальна ціна дизеля ₴/л (fuel_storages → inventory → fallback). */
export async function getDieselPriceUah(): Promise<
  ActionResult<DieselPriceResult>
> {
  try {
    const data = await resolveDieselPriceUah();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити ціну дизеля",
    };
  }
}

/** Сума спаленого на полях сьогодні (Europe/Kyiv) з wialon_field_fuel_logs. */
export async function getTodayFieldFuelConsumed(): Promise<
  ActionResult<{
    liters: number;
    date: string;
    /** false = CRON ще не дав рядків за сьогодні */
    hasData: boolean;
  }>
> {
  try {
    const date = todayKyivDateString();
    const sum = await sumFieldFuelConsumedForDate(date);
    return {
      ok: true,
      data: {
        liters: sum.liters,
        date: sum.date,
        hasData: sum.hasData,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити витрату на полях",
    };
  }
}

/**
 * Smart Context для модалки «Заправка»: локація GPS + активний наряд.
 */
export async function getRefuelSmartContext(
  wialonUnitId: number
): Promise<ActionResult<RefuelSmartContext>> {
  try {
    const data = await loadRefuelSmartContext(wialonUnitId);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося підтягнути контекст техніки",
    };
  }
}

/**
 * Zero-Data Entry: заправки з Wialon за 24/48 год, яких немає
 * в ручних outbound (±45 хв, ±10% обʼєму).
 */
export async function getUnrecordedRefuelings(options?: {
  /** 24 або 48 (за замовчуванням 48) */
  lookbackHours?: number;
}): Promise<ActionResult<UnrecordedRefueling[]>> {
  try {
    const raw = options?.lookbackHours;
    const lookbackHours =
      raw === 24 || raw === 48 ? raw : UNRECORDED_LOOKBACK_HOURS;
    const data = await findUnrecordedRefuelings({ lookbackHours });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити необліковані заправки",
    };
  }
}

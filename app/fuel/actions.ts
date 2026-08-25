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
  ensureWialonFieldFuelFresh,
  sumFieldFuelConsumedForPeriod,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type { FieldFuelPeriod };

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

/** Сума спаленого на полях за період (live Wialon для сьогодні/вчора). */
export async function getFieldFuelConsumed(
  period: FieldFuelPeriod = "today"
): Promise<
  ActionResult<{
    liters: number;
    period: FieldFuelPeriod;
    fromDate: string;
    toDate: string;
    hasData: boolean;
    /** Чи підтягнули свіжі повідомлення з Wialon перед сумою */
    liveSynced: boolean;
  }>
> {
  try {
    const safe: FieldFuelPeriod =
      period === "yesterday" || period === "week" ? period : "today";
    const today = todayKyivYmd();
    let liveSynced = false;

    // Live з Wialon лише якщо кеш старше 5 хв (той самий шлях, що Карта полів)
    try {
      if (safe === "today") {
        const r = await ensureWialonFieldFuelFresh(today, 5 * 60 * 1000);
        liveSynced = r.synced;
      } else if (safe === "yesterday") {
        const r = await ensureWialonFieldFuelFresh(
          shiftKyivYmd(today, -1),
          30 * 60 * 1000
        );
        liveSynced = r.synced;
      } else {
        const r = await ensureWialonFieldFuelFresh(today, 5 * 60 * 1000);
        liveSynced = r.synced;
      }
    } catch (syncErr) {
      console.error(
        "[field-fuel] live Wialon sync",
        syncErr instanceof Error ? syncErr.message : syncErr
      );
    }

    const sum = await sumFieldFuelConsumedForPeriod(safe);
    return {
      ok: true,
      data: {
        liters: sum.liters,
        period: sum.period,
        fromDate: sum.fromDate,
        toDate: sum.toDate,
        hasData: sum.hasData,
        liveSynced,
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

/** @deprecated використовуйте getFieldFuelConsumed('today') */
export async function getTodayFieldFuelConsumed() {
  return getFieldFuelConsumed("today");
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
 * Zero-Data Entry: необліковані заправки з Wialon.
 * lookbackHours: 48 (за замовчуванням) або 168 (7 днів).
 */
export async function getUnrecordedRefuelings(options?: {
  lookbackHours?: number;
}): Promise<ActionResult<UnrecordedRefueling[]>> {
  try {
    const raw = options?.lookbackHours;
    const lookbackHours =
      raw === 24 || raw === 48 || raw === 168 ? raw : UNRECORDED_LOOKBACK_HOURS;
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

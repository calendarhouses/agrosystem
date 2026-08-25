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
import { sumOutboundRefueledForPeriod } from "@/lib/fuel-refuel-period";
import {
  ensureWialonFieldFuelFresh,
  listFieldFuelBreakdownForPeriod,
  sumFieldFuelConsumedForPeriod,
  type FieldFuelBreakdownRow,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type { FieldFuelPeriod, FieldFuelBreakdownRow };

function normalizePeriod(period: FieldFuelPeriod): FieldFuelPeriod {
  if (
    period === "yesterday" ||
    period === "week" ||
    period === "month"
  ) {
    return period;
  }
  return "today";
}

/** Сума спаленого на полях за період + розшифровка хто×поле. */
export async function getFieldFuelConsumed(
  period: FieldFuelPeriod = "today"
): Promise<
  ActionResult<{
    liters: number;
    period: FieldFuelPeriod;
    fromDate: string;
    toDate: string;
    hasData: boolean;
    liveSynced: boolean;
    breakdown: FieldFuelBreakdownRow[];
  }>
> {
  try {
    const safe = normalizePeriod(period);
    const today = todayKyivYmd();
    let liveSynced = false;

    try {
      if (safe === "today" || safe === "week" || safe === "month") {
        const r = await ensureWialonFieldFuelFresh(today, 5 * 60 * 1000);
        liveSynced = r.synced;
      } else if (safe === "yesterday") {
        const r = await ensureWialonFieldFuelFresh(
          shiftKyivYmd(today, -1),
          30 * 60 * 1000
        );
        liveSynced = r.synced;
      }
    } catch (syncErr) {
      console.error(
        "[field-fuel] live Wialon sync",
        syncErr instanceof Error ? syncErr.message : syncErr
      );
    }

    const [sum, breakdown] = await Promise.all([
      sumFieldFuelConsumedForPeriod(safe),
      listFieldFuelBreakdownForPeriod(safe),
    ]);

    return {
      ok: true,
      data: {
        liters: sum.liters,
        period: sum.period,
        fromDate: sum.fromDate,
        toDate: sum.toDate,
        hasData: sum.hasData,
        liveSynced,
        breakdown: breakdown.rows,
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

/** Заправлено (outbound зі складу) за той самий період, що й «Спалено». */
export async function getFuelRefueledForPeriod(
  period: FieldFuelPeriod = "today"
): Promise<
  ActionResult<{
    liters: number;
    period: FieldFuelPeriod;
    fromDate: string;
    toDate: string;
    hasData: boolean;
    breakdown: Array<{
      equipmentName: string;
      liters: number;
      wialonUnitId: number | null;
    }>;
  }>
> {
  try {
    const data = await sumOutboundRefueledForPeriod(normalizePeriod(period));
    return {
      ok: true,
      data: {
        liters: data.liters,
        period: data.period,
        fromDate: data.fromDate,
        toDate: data.toDate,
        hasData: data.hasData,
        breakdown: data.rows,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити заправки",
    };
  }
}

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

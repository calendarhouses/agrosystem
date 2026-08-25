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
  ensureFieldFuelPeriodCoverage,
  listFieldFuelBreakdownForPeriod,
  listUnsyncedFieldFuelDates,
  sumFieldFuelConsumedForPeriod,
  type FieldFuelBreakdownRow,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";

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
    /** Скільки календарних днів періоду вже є в БД */
    daysCovered: number;
    daysExpected: number;
    /** true = ще тягнемо історію з Wialon */
    coverageIncomplete: boolean;
    breakdown: FieldFuelBreakdownRow[];
  }>
> {
  try {
    const safe = normalizePeriod(period);
    let liveSynced = false;

    try {
      const coverage = await ensureFieldFuelPeriodCoverage(safe, {
        maxDays: safe === "month" ? 12 : safe === "week" ? 7 : 1,
        budgetMs: safe === "today" || safe === "yesterday" ? 20_000 : 50_000,
      });
      liveSynced = coverage.daysSyncedNow > 0 || !coverage.truncated;
    } catch (syncErr) {
      console.error(
        "[field-fuel] period coverage",
        syncErr instanceof Error ? syncErr.message : syncErr
      );
    }

    const [sum, breakdown] = await Promise.all([
      sumFieldFuelConsumedForPeriod(safe),
      listFieldFuelBreakdownForPeriod(safe),
    ]);

    const stillMissing = await listUnsyncedFieldFuelDates(
      sum.fromDate,
      sum.toDate
    );
    const daysExpected =
      Math.round(
        (Date.parse(`${sum.toDate}T12:00:00Z`) -
          Date.parse(`${sum.fromDate}T12:00:00Z`)) /
          86_400_000
      ) + 1;
    const daysCovered = Math.max(0, daysExpected - stillMissing.length);

    return {
      ok: true,
      data: {
        liters: sum.liters,
        period: sum.period,
        fromDate: sum.fromDate,
        toDate: sum.toDate,
        hasData: sum.hasData,
        liveSynced,
        daysCovered,
        daysExpected,
        coverageIncomplete: stillMissing.length > 0,
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

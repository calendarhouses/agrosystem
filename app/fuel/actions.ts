"use server";

import {
  dismissRefueling,
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
import { sumFleetFuelConsumedForPeriod } from "@/lib/wialon-equipment-day-sync";
import {
  ensureFieldFuelPeriodCoverage,
  listFieldFuelBreakdownForPeriod,
  listUnsyncedFieldFuelDates,
  resolveFieldFuelPeriodBounds,
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
    period === "month" ||
    period === "season"
  ) {
    return period;
  }
  return "today";
}

/** Сума спаленого на полях за період + розшифровка хто×поле. */
export async function getFieldFuelConsumed(
  period: FieldFuelPeriod = "today",
  options?: { backfill?: boolean }
): Promise<
  ActionResult<{
    liters: number;
    period: FieldFuelPeriod;
    fromDate: string;
    toDate: string;
    hasData: boolean;
    liveSynced: boolean;
    /** Спалено всією технікою (поля + дорога + база), л */
    totalLiters: number;
    /** Скільки календарних днів періоду вже є в БД */
    daysCovered: number;
    daysExpected: number;
    /** true = ще тягнемо історію з Wialon */
    coverageIncomplete: boolean;
    /** 0–100 за покриттям днів */
    progressPct: number;
    breakdown: FieldFuelBreakdownRow[];
  }>
> {
  try {
    const safe = normalizePeriod(period);
    let liveSynced = false;
    const allowBackfill = options?.backfill === true;

    // today/yesterday — завжди свіжий sync.
    // week/month — дотягуємо пропуски (діапазон малий).
    // season — на першому показі лише БД (як уже прогріті 7д/місяць);
    //   Wialon лише на явному backfill, інакше KPI висить хвилинами і падає в «немає даних».
    let shouldSync = safe === "today" || safe === "yesterday";
    if (!shouldSync && safe !== "season") {
      try {
        const { fromDate, toDate } = resolveFieldFuelPeriodBounds(safe);
        const missing = await listUnsyncedFieldFuelDates(fromDate, toDate);
        shouldSync = missing.length > 0;
      } catch {
        shouldSync = true;
      }
    } else if (safe === "season" && allowBackfill) {
      try {
        const { fromDate, toDate } = resolveFieldFuelPeriodBounds(safe);
        const missing = await listUnsyncedFieldFuelDates(fromDate, toDate);
        shouldSync = missing.length > 0;
      } catch {
        shouldSync = false;
      }
    }

    if (shouldSync) {
      try {
        const coverage = await ensureFieldFuelPeriodCoverage(safe, {
          maxDays:
            safe === "season"
              ? 8
              : safe === "month"
                ? 5
                : safe === "week"
                  ? 4
                  : 1,
          budgetMs:
            safe === "today" || safe === "yesterday"
              ? 12_000
              : safe === "season"
                ? 20_000
                : safe === "week"
                  ? 14_000
                  : 16_000,
        });
        liveSynced = coverage.daysSyncedNow > 0 || !coverage.truncated;
      } catch (syncErr) {
        console.error(
          "[field-fuel] period coverage",
          syncErr instanceof Error ? syncErr.message : syncErr
        );
      }
    }

    const [sum, breakdown] = await Promise.all([
      sumFieldFuelConsumedForPeriod(safe),
      listFieldFuelBreakdownForPeriod(safe),
    ]);

    const [stillMissing, fleet] = await Promise.all([
      listUnsyncedFieldFuelDates(sum.fromDate, sum.toDate),
      sumFleetFuelConsumedForPeriod(sum.fromDate, sum.toDate),
    ]);
    const daysExpected =
      Math.round(
        (Date.parse(`${sum.toDate}T12:00:00Z`) -
          Date.parse(`${sum.fromDate}T12:00:00Z`)) /
          86_400_000
      ) + 1;
    const daysCovered = Math.max(0, daysExpected - stillMissing.length);
    const progressPct =
      daysExpected <= 0
        ? 100
        : Math.min(100, Math.round((daysCovered / daysExpected) * 100));

    return {
      ok: true,
      data: {
        liters: sum.liters,
        period: sum.period,
        fromDate: sum.fromDate,
        toDate: sum.toDate,
        // Флот або поля — достатньо, щоб не показувати «немає даних» при partial sync
        hasData:
          sum.hasData ||
          fleet.hasData ||
          sum.liters > 0 ||
          fleet.liters > 0,
        liveSynced,
        // Без міграції 036 денного кешу витрати ще немає — не показуємо 0
        totalLiters: fleet.hasData
          ? Math.max(fleet.liters, sum.liters)
          : sum.liters,
        daysCovered,
        daysExpected,
        coverageIncomplete: stillMissing.length > 0,
        progressPct,
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

/** Заправлено: ДУТ (стрибки бака) + ручні outbound без дубля. */
export async function getFuelRefueledForPeriod(
  period: FieldFuelPeriod = "today"
): Promise<
  ActionResult<{
    liters: number;
    period: FieldFuelPeriod;
    fromDate: string;
    toDate: string;
    hasData: boolean;
    wialonLiters: number;
    manualOnlyLiters: number;
    breakdown: Array<{
      equipmentName: string;
      liters: number;
      wialonUnitId: number | null;
      source: "wialon" | "manual" | "mixed";
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
        wialonLiters: data.wialonLiters,
        manualOnlyLiters: data.manualOnlyLiters,
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

/** Відхилити подію радара — хибне спрацювання ДУТ. */
export async function dismissRadarRefueling(input: {
  unitId: number;
  timeIso: string;
  volumeLiters: number;
  reason?: string;
}): Promise<ActionResult> {
  try {
    await dismissRefueling(input);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося відхилити заправку",
    };
  }
}

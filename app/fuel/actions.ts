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
  ensureEquipmentDayStatsCoverage,
  listFleetFuelConsumedBreakdownForPeriod,
  listUnsyncedEquipmentDayDates,
  sumFleetFuelConsumedForPeriod,
  type FleetFuelConsumedBreakdownRow,
} from "@/lib/wialon-equipment-day-sync";
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
    fleetBreakdown: FleetFuelConsumedBreakdownRow[];
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
    let shouldSyncField = safe === "today" || safe === "yesterday";
    let shouldSyncEquipment = safe === "today" || safe === "yesterday";
    const { fromDate, toDate } = resolveFieldFuelPeriodBounds(safe);

    if (!shouldSyncField && safe !== "season") {
      try {
        const missing = await listUnsyncedFieldFuelDates(fromDate, toDate);
        shouldSyncField = missing.length > 0;
      } catch {
        shouldSyncField = true;
      }
    } else if (safe === "season" && allowBackfill) {
      try {
        const missing = await listUnsyncedFieldFuelDates(fromDate, toDate);
        shouldSyncField = missing.length > 0;
      } catch {
        shouldSyncField = false;
      }
    }

    if (!shouldSyncEquipment && safe !== "season") {
      try {
        const missingEq = await listUnsyncedEquipmentDayDates(fromDate, toDate);
        shouldSyncEquipment = missingEq.length > 0;
      } catch {
        shouldSyncEquipment = safe === "today" || safe === "yesterday";
      }
    } else if (safe === "season" && allowBackfill) {
      try {
        const missingEq = await listUnsyncedEquipmentDayDates(fromDate, toDate);
        shouldSyncEquipment = missingEq.length > 0;
      } catch {
        shouldSyncEquipment = false;
      }
    }

    if (shouldSyncField || shouldSyncEquipment) {
      try {
        const fieldOpts = {
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
        };
        const equipmentOpts = {
          maxDays:
            safe === "season"
              ? 6
              : safe === "month"
                ? 4
                : safe === "week"
                  ? 3
                  : 1,
          budgetMs:
            safe === "today" || safe === "yesterday"
              ? 14_000
              : safe === "season"
                ? 22_000
                : safe === "week"
                  ? 16_000
                  : 18_000,
        };
        const [fieldCoverage, equipmentCoverage] = await Promise.all([
          shouldSyncField
            ? ensureFieldFuelPeriodCoverage(safe, fieldOpts)
            : Promise.resolve({ daysSyncedNow: 0, truncated: false }),
          shouldSyncEquipment
            ? ensureEquipmentDayStatsCoverage(safe, equipmentOpts)
            : Promise.resolve({ daysSyncedNow: 0, truncated: false }),
        ]);
        liveSynced =
          fieldCoverage.daysSyncedNow > 0 ||
          equipmentCoverage.daysSyncedNow > 0 ||
          (!fieldCoverage.truncated && !equipmentCoverage.truncated);
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

    const [stillMissing, fleet, fleetBreakdown] = await Promise.all([
      listUnsyncedFieldFuelDates(sum.fromDate, sum.toDate),
      sumFleetFuelConsumedForPeriod(sum.fromDate, sum.toDate),
      listFleetFuelConsumedBreakdownForPeriod(sum.fromDate, sum.toDate),
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
        // Спалено самохідною (ДУТ флоту); поля — окремо в liters / breakdown
        totalLiters:
          fleet.liters > 0 ? fleet.liters : sum.liters,
        daysCovered,
        daysExpected,
        coverageIncomplete: stillMissing.length > 0,
        progressPct,
        breakdown: breakdown.rows,
        fleetBreakdown: fleetBreakdown.rows,
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

/** Заправлено: ДУТ (fuel_filled з БД) + ручні outbound без ДУТ. */
export async function getFuelRefueledForPeriod(
  period: FieldFuelPeriod = "today",
  options?: { backfill?: boolean }
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
      source: "wialon" | "manual" | "mixed" | "delivery" | "overnight" | "correction";
    }>;
    dutLiters: number;
    dispensedLiters: number;
    overnightLiters: number;
    correctionLiters: number;
    openingTankLiters: number;
    closingTankLiters: number;
  }>
> {
  try {
    const safe = normalizePeriod(period);
    const allowBackfill = options?.backfill === true;
    const { fromDate, toDate } = resolveFieldFuelPeriodBounds(safe);
    let shouldSyncEquipment = safe === "today" || safe === "yesterday";
    if (!shouldSyncEquipment && safe !== "season") {
      try {
        const missingEq = await listUnsyncedEquipmentDayDates(fromDate, toDate);
        shouldSyncEquipment = missingEq.length > 0;
      } catch {
        shouldSyncEquipment = safe === "today" || safe === "yesterday";
      }
    } else if (safe === "season" && allowBackfill) {
      try {
        const missingEq = await listUnsyncedEquipmentDayDates(fromDate, toDate);
        shouldSyncEquipment = missingEq.length > 0;
      } catch {
        shouldSyncEquipment = false;
      }
    }
    if (shouldSyncEquipment) {
      try {
        await ensureEquipmentDayStatsCoverage(safe, {
          maxDays:
            safe === "season"
              ? 6
              : safe === "month"
                ? 4
                : safe === "week"
                  ? 3
                  : 1,
          budgetMs:
            safe === "today" || safe === "yesterday"
              ? 14_000
              : safe === "season"
                ? 22_000
                : safe === "week"
                  ? 16_000
                  : 18_000,
        });
      } catch (syncErr) {
        console.error(
          "[fuel-refuel] equipment day sync",
          syncErr instanceof Error ? syncErr.message : syncErr
        );
      }
    }

    const data = await sumOutboundRefueledForPeriod(safe);
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
        dutLiters: data.dutLiters,
        dispensedLiters: data.dispensedLiters,
        overnightLiters: data.overnightLiters,
        correctionLiters: data.correctionLiters,
        openingTankLiters: data.openingTankLiters,
        closingTankLiters: data.closingTankLiters,
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

/** Відхилити подію радара — хибна заливка, прибираємо з KPI. */
export async function dismissRadarRefueling(input: {
  unitId: number;
  timeIso: string;
  volumeLiters: number;
  reason?: string;
}): Promise<ActionResult> {
  try {
    const { dismissRadarRefuelEvent } = await import("@/lib/fuel-radar-confirm");
    await dismissRadarRefuelEvent({
      unitId: input.unitId,
      timeIso: input.timeIso,
      detectedLiters: input.volumeLiters,
      reason: input.reason,
    });
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

/** Підтвердити заправку з радара — коригує KPI «Заправлено». */
export async function confirmRadarRefueling(input: {
  unitId: number;
  timeIso: string;
  detectedLiters: number;
  correctedLiters: number;
  fromStorageId?: string | null;
}): Promise<ActionResult<{ fuelTransactionId: string | null }>> {
  try {
    const { confirmRadarRefuelEvent } = await import("@/lib/fuel-radar-confirm");
    const data = await confirmRadarRefuelEvent({
      unitId: input.unitId,
      timeIso: input.timeIso,
      detectedLiters: input.detectedLiters,
      correctedLiters: input.correctedLiters,
      fromStorageId: input.fromStorageId ?? null,
    });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося підтвердити заправку",
    };
  }
}

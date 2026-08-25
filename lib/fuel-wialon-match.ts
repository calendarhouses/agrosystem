import {
  extractFuelLevelsFromMessages,
  getWialonUnitById,
  listUnitSensors,
  loadWialonUnitMessages,
  parseWialonUnitTelemetry,
  unitHasFuelSensor,
  wialonLogin,
} from "@/lib/wialon";

/** Базове вікно: −6 год … +30 хв від заправки */
const MATCH_BEFORE_MS = 6 * 60 * 60 * 1000;
const MATCH_AFTER_MS = 30 * 60 * 1000;
/** При повторній звірці («Оновити») дивимось до +24 год після операції */
const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;

export type WialonMatchResult = {
  calculatedVariance: number | null;
  realAdded: number | null;
};

/**
 * Реальна звірка приросту палива з Wialon.
 * Помилки / немає даних → null (транзакцію не ламаємо).
 */
export async function resolveWialonVariance(
  wialonUnitId: number,
  amountLiters: number,
  transactionDate: Date,
  options?: { /** true — ширше вікно після tx (для кнопки «Оновити») */ reverify?: boolean }
): Promise<WialonMatchResult> {
  const logPrefix = options?.reverify ? "[fuel/reverify]" : "[fuel/refuel]";

  try {
    const eid = await wialonLogin();

    const unit = await getWialonUnitById(eid, wialonUnitId);
    if (!unit || !unitHasFuelSensor(unit)) {
      console.error(`${logPrefix} Немає ДУТ на юніті`, { wialonUnitId });
      return { calculatedVariance: null, realAdded: null };
    }

    const txMs = transactionDate.getTime();
    const afterMs = options?.reverify ? REVERIFY_AFTER_MS : MATCH_AFTER_MS;
    const timeFrom = Math.floor((txMs - MATCH_BEFORE_MS) / 1000);
    const timeTo = Math.floor(
      Math.min(txMs + afterMs, Date.now()) / 1000
    );

    let messages = await loadWialonUnitMessages(
      eid,
      wialonUnitId,
      timeFrom,
      timeTo
    );

    if (!messages.length) {
      console.error(`${logPrefix} messages/load_interval порожній, retry`, {
        wialonUnitId,
        timeFrom,
        timeTo,
      });
      messages = await loadWialonUnitMessages(
        eid,
        wialonUnitId,
        timeFrom,
        timeTo,
        { flags: 1, flagsMask: 0 }
      );
    }

    let levels = extractFuelLevelsFromMessages(
      messages,
      listUnitSensors(unit)
    );

    if (levels.length === 0) {
      const telemetry = parseWialonUnitTelemetry(unit);
      if (
        telemetry.fuelLiters != null &&
        Number.isFinite(telemetry.fuelLiters)
      ) {
        console.error(
          `${logPrefix} Немає палива в історії — лише поточний рівень ДУТ`,
          { wialonUnitId, fuelLiters: telemetry.fuelLiters }
        );
        levels = [telemetry.fuelLiters];
      }
    }

    if (levels.length < 2) {
      console.error(`${logPrefix} Недостатньо точок палива для приросту`, {
        wialonUnitId,
        messageCount: messages.length,
        levelCount: levels.length,
      });
      return { calculatedVariance: null, realAdded: null };
    }

    const maxFuel = Math.max(...levels);
    const minFuel = Math.min(...levels);
    const realAdded = Math.round((maxFuel - minFuel) * 100) / 100;

    if (!Number.isFinite(realAdded) || realAdded < 0) {
      console.error(`${logPrefix} Некоректний приріст`, {
        wialonUnitId,
        maxFuel,
        minFuel,
      });
      return { calculatedVariance: null, realAdded: null };
    }

    if (realAdded < 1) {
      console.error(
        `${logPrefix} Приріст ≈ 0 — ДУТ ще не відобразив заправку`,
        { wialonUnitId, realAdded, amountLiters }
      );
      return { calculatedVariance: null, realAdded: null };
    }

    const calculatedVariance =
      Math.round((amountLiters - realAdded) * 100) / 100;

    return { calculatedVariance, realAdded };
  } catch (error) {
    console.error(`${logPrefix} Помилка Wialon Smart Match`, error);
    return { calculatedVariance: null, realAdded: null };
  }
}

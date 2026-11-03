import {
  detectFuelFills,
  extractTimedFuelSamples,
} from "@/lib/wialon-fuel-decode";
import {
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
/** Якщо детектор не знайшов fill — fallback у вузьке вікно ±45 хв */
const FALLBACK_WINDOW_MS = 45 * 60 * 1000;

export type WialonMatchResult = {
  calculatedVariance: number | null;
  realAdded: number | null;
};

/**
 * Реальна звірка приросту палива з Wialon.
 *
 * ВАЖЛИВО: НЕ max−min за 6+ год (то дає хибну «Нестачу 635 л», коли бак
 * спалюється, а потім заправляється). Беремо подію заправки з detectFuelFills
 * найближчу до часу операції.
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

    const sensors = listUnitSensors(unit);
    let samples = extractTimedFuelSamples(messages, sensors);

    if (samples.length < 2) {
      const telemetry = parseWialonUnitTelemetry(unit);
      if (
        telemetry.fuelLiters != null &&
        Number.isFinite(telemetry.fuelLiters)
      ) {
        console.error(
          `${logPrefix} Немає палива в історії — лише поточний рівень ДУТ`,
          { wialonUnitId, fuelLiters: telemetry.fuelLiters }
        );
      }
      console.error(`${logPrefix} Недостатньо точок палива для приросту`, {
        wialonUnitId,
        messageCount: messages.length,
        sampleCount: samples.length,
      });
      return { calculatedVariance: null, realAdded: null };
    }

    const fills = detectFuelFills(samples);
    const txUnix = Math.floor(txMs / 1000);

    let realAdded: number | null = null;

    if (fills.length > 0) {
      // Найближча заправка до часу операції (за піком / кінцем fill)
      let best = fills[0]!;
      let bestDist = Math.abs(best.endT - txUnix);
      for (const fill of fills.slice(1)) {
        const dist = Math.abs(fill.endT - txUnix);
        if (dist < bestDist) {
          best = fill;
          bestDist = dist;
        }
      }
      realAdded = Math.round(best.volume * 100) / 100;
      console.log(`${logPrefix} fill match`, {
        wialonUnitId,
        fills: fills.length,
        chosenVolume: realAdded,
        distSec: bestDist,
        amountLiters,
      });
    } else {
      // Fallback: max−min лише у вузькому вікні біля tx (не за 6 год!)
      const lo = (txMs - FALLBACK_WINDOW_MS) / 1000;
      const hi = (txMs + FALLBACK_WINDOW_MS) / 1000;
      const near = samples.filter((s) => s.t >= lo && s.t <= hi);
      if (near.length >= 2) {
        const maxFuel = Math.max(...near.map((s) => s.liters));
        const minFuel = Math.min(...near.map((s) => s.liters));
        realAdded = Math.round((maxFuel - minFuel) * 100) / 100;
        console.log(`${logPrefix} fallback narrow max-min`, {
          wialonUnitId,
          realAdded,
          nearCount: near.length,
        });
      }
    }

    if (realAdded == null || !Number.isFinite(realAdded) || realAdded < 0) {
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

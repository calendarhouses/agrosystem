/**
 * Витрата палива з ДРП (ДУТ / FLS) за інтервал — READ-ONLY Wialon.
 * Метрика близька до «Витрачене паливо за ДРП» (Fuel consumed by FLS):
 * start − end + заправки (різкі прирости рівня).
 */

import { extractTimedFuelSamples } from "@/lib/wialon-fuel-decode";
import {
  extractFuelLevelsFromMessages,
  getWialonUnitSensors,
  listUnitSensors,
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

/** Різкий приріст рівня (л) = заправка, не «відкат» датчика */
const REFILL_JUMP_L = 15;
/** Немовірна витрата за інтервал — сміття датчика */
const MAX_PLAUSIBLE_CONSUMED_L = 2500;

export type WialonFuelConsumptionResult = {
  /** Літри спаленого палива за ДРП; null — немає даних / помилка */
  consumedLiters: number | null;
  fuelStart: number | null;
  fuelEnd: number | null;
  filledLiters: number;
  sampleCount: number;
};

type FuelSample = { t: number; liters: number };

function samplesFromMessages(
  messages: WialonTrackMessage[],
  sensors: ReturnType<typeof listUnitSensors> = []
): FuelSample[] {
  return extractTimedFuelSamples(messages, sensors).map((s) => ({
    t: s.t,
    liters: s.liters,
  }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Fuel consumed by FLS ≈ (рівень_старт − рівень_фініш) + сума заправок.
 * Заправка = стрибок рівня ≥ REFILL_JUMP_L між сусідніми семплами.
 */
export function estimateFuelConsumedByFls(
  samples: FuelSample[]
): WialonFuelConsumptionResult {
  if (samples.length < 2) {
    return {
      consumedLiters: null,
      fuelStart: null,
      fuelEnd: null,
      filledLiters: 0,
      sampleCount: samples.length,
    };
  }

  const edge = Math.min(5, Math.max(1, Math.floor(samples.length / 4)));
  const fuelStart = median(samples.slice(0, edge).map((s) => s.liters));
  const fuelEnd = median(samples.slice(-edge).map((s) => s.liters));

  let filledLiters = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i]!.liters - samples[i - 1]!.liters;
    if (delta >= REFILL_JUMP_L) {
      filledLiters += delta;
    }
  }
  filledLiters = Math.round(filledLiters * 10) / 10;

  if (fuelStart == null || fuelEnd == null) {
    return {
      consumedLiters: null,
      fuelStart,
      fuelEnd,
      filledLiters,
      sampleCount: samples.length,
    };
  }

  const raw = fuelStart - fuelEnd + filledLiters;
  if (!Number.isFinite(raw) || raw < 0) {
    return {
      consumedLiters: raw < 0 ? 0 : null,
      fuelStart: Math.round(fuelStart * 10) / 10,
      fuelEnd: Math.round(fuelEnd * 10) / 10,
      filledLiters,
      sampleCount: samples.length,
    };
  }

  const consumed = Math.round(raw * 10) / 10;
  if (consumed > MAX_PLAUSIBLE_CONSUMED_L) {
    return {
      consumedLiters: null,
      fuelStart: Math.round(fuelStart * 10) / 10,
      fuelEnd: Math.round(fuelEnd * 10) / 10,
      filledLiters,
      sampleCount: samples.length,
    };
  }

  return {
    consumedLiters: consumed,
    fuelStart: Math.round(fuelStart * 10) / 10,
    fuelEnd: Math.round(fuelEnd * 10) / 10,
    filledLiters,
    sampleCount: samples.length,
  };
}

/**
 * Запит витрати палива з ДРП Wialon за період (UNIX sec).
 * Помилка / немає датчика → consumedLiters = null (не кидаємо назовні).
 */
export async function fetchWialonFuelConsumption(
  wialonUnitId: string | number,
  startTime: number,
  endTime: number
): Promise<WialonFuelConsumptionResult> {
  const empty: WialonFuelConsumptionResult = {
    consumedLiters: null,
    fuelStart: null,
    fuelEnd: null,
    filledLiters: 0,
    sampleCount: 0,
  };

  const unitId = Number(wialonUnitId);
  if (!Number.isFinite(unitId) || unitId <= 0) {
    console.error("[wialon-fuel] Некоректний wialonUnitId", wialonUnitId);
    return empty;
  }
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime < startTime
  ) {
    console.error("[wialon-fuel] Некоректний інтервал", {
      startTime,
      endTime,
    });
    return empty;
  }

  try {
    const eid = await wialonLogin();

    const [messagesRaw, unitWithSensors] = await Promise.all([
      loadWialonUnitMessages(eid, unitId, startTime, endTime),
      getWialonUnitSensors(eid, unitId),
    ]);
    let messages = messagesRaw;

    if (!messages.length) {
      messages = await loadWialonUnitMessages(
        eid,
        unitId,
        startTime,
        endTime,
        { flags: 1, flagsMask: 0 }
      );
    }

    const sensors = unitWithSensors
      ? listUnitSensors(unitWithSensors)
      : [];
    let samples = samplesFromMessages(messages, sensors);

    // Fallback: рівні без timestamp-прив’язки (рідкісний формат params)
    if (samples.length < 2) {
      const levels = extractFuelLevelsFromMessages(messages, sensors);
      if (levels.length >= 2) {
        samples = levels.map((liters, index) => ({
          t: startTime + index,
          liters,
        }));
      }
    }

    if (samples.length < 2) {
      console.error("[wialon-fuel] Немає семплів ДРП", {
        unitId,
        startTime,
        endTime,
        messageCount: messages.length,
      });
      return { ...empty, sampleCount: samples.length };
    }

    const result = estimateFuelConsumedByFls(samples);
    console.log("[wialon-fuel] FLS consumption", {
      unitId,
      startTime,
      endTime,
      ...result,
    });
    return result;
  } catch (error) {
    console.error("[wialon-fuel] Помилка запиту Wialon", error);
    return empty;
  }
}

/**
 * Зручний хелпер: лише літри (null якщо немає даних).
 */
export async function getWialonFuelConsumptionLiters(
  wialonUnitId: string | number,
  startTime: number,
  endTime: number
): Promise<number | null> {
  const { consumedLiters } = await fetchWialonFuelConsumption(
    wialonUnitId,
    startTime,
    endTime
  );
  return consumedLiters;
}

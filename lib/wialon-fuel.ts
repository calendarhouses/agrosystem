/**
 * Витрата палива з ДРП (ДУТ / FLS) за інтервал — READ-ONLY Wialon.
 * Метрика близька до «Витрачене паливо за ДРП» (Fuel consumed by FLS):
 * start − end + заправки (різкі прирости рівня).
 */

import {
  extractTimedFuelSamples,
  fuelConsumedFromSamples,
} from "@/lib/wialon-fuel-decode";
import { resolvePlausibleDayFuelConsumed } from "@/lib/equipment-fuel-consumed";
import {
  extractFuelLevelsFromMessages,
  getWialonUnitSensors,
  listUnitSensors,
  loadWialonUnitMessages,
  type WialonTrackMessage,
  wialonLogin,
} from "@/lib/wialon";

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

/**
 * Fuel consumed by FLS ≈ (рівень_старт − рівень_фініш) + сума заправок.
 * Заправки — спільний детектор `detectFuelFills`, щоб цифра збігалась
 * з журналом палива і карткою техніки.
 */
export function estimateFuelConsumedByFls(
  samples: FuelSample[],
  options?: { tankVolumeLiters?: number | null; workHours?: number | null }
): WialonFuelConsumptionResult {
  const { consumed, start, end, filled } = fuelConsumedFromSamples(samples);

  const base = {
    fuelStart: start,
    fuelEnd: end,
    filledLiters: filled,
    sampleCount: samples.length,
  };

  const plausible = resolvePlausibleDayFuelConsumed({
    start,
    end,
    filled,
    tankVolumeLiters: options?.tankVolumeLiters,
    workHours: options?.workHours,
  });

  if (plausible == null) return { ...base, consumedLiters: null };
  return { ...base, consumedLiters: plausible };
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

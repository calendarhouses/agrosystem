"use server";

import {
  fetchWialonFuelConsumption,
  type WialonFuelConsumptionResult,
} from "@/lib/wialon-fuel";

export type { WialonFuelConsumptionResult };

/**
 * Server Action: витрата палива з ДРП Wialon («Fuel consumed by FLS»)
 * за інтервал [startTime, endTime] у UNIX-секундах.
 *
 * @returns consumedLiters (число) або null, якщо датчик/дані недоступні
 */
export async function getWialonFuelConsumption(
  wialonUnitId: string,
  startTime: number,
  endTime: number
): Promise<number | null> {
  const result = await fetchWialonFuelConsumption(
    wialonUnitId,
    startTime,
    endTime
  );
  return result.consumedLiters;
}

/**
 * Розширений варіант для UI закриття наряду (старт/фініш бака, заправки).
 */
export async function getWialonFuelConsumptionDetails(
  wialonUnitId: string,
  startTime: number,
  endTime: number
): Promise<WialonFuelConsumptionResult> {
  return fetchWialonFuelConsumption(wialonUnitId, startTime, endTime);
}

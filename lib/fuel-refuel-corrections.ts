/**
 * Корекції заправок з радара → KPI «Заправлено».
 * confirmed: delta = corrected − detected (0 якщо підтвердили без змін)
 * dismissed: delta = −detected
 */

import { createServiceSupabase } from "@/lib/supabase/server";

export type RefuelCorrectionStatus = "confirmed" | "dismissed";

export type RefuelCorrectionRow = {
  wialonUnitId: number;
  eventTimeIso: string;
  wialonDetectedLiters: number;
  correctedLiters: number | null;
  status: RefuelCorrectionStatus;
  adjustmentLiters: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function adjustmentForRow(row: {
  wialon_detected_liters: unknown;
  corrected_liters: unknown;
  status: string;
}): number {
  const detected = Number(row.wialon_detected_liters) || 0;
  if (row.status === "dismissed") {
    return round1(-detected);
  }
  const corrected = Number(row.corrected_liters) || detected;
  return round1(corrected - detected);
}

export async function upsertRefuelCorrection(input: {
  wialonUnitId: number;
  eventTimeIso: string;
  wialonDetectedLiters: number;
  status: RefuelCorrectionStatus;
  correctedLiters?: number | null;
  fromStorageId?: string | null;
  fuelTransactionId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const detected = Math.max(0, input.wialonDetectedLiters);
  const corrected =
    input.status === "dismissed"
      ? null
      : Math.max(0, input.correctedLiters ?? detected);

  if (input.status === "confirmed" && !(corrected != null && corrected > 0)) {
    throw new Error("Обʼєм підтвердженої заправки має бути більше нуля");
  }

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("fuel_refuel_corrections").upsert(
    {
      wialon_unit_id: input.wialonUnitId,
      event_time: input.eventTimeIso,
      wialon_detected_liters: detected,
      corrected_liters: corrected,
      status: input.status,
      from_storage_id: input.fromStorageId ?? null,
      fuel_transaction_id: input.fuelTransactionId ?? null,
      reason: input.reason?.trim() || null,
    },
    { onConflict: "wialon_unit_id,event_time" }
  );

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      throw new Error(
        "Таблиця fuel_refuel_corrections відсутня. Виконай міграцію 055."
      );
    }
    throw new Error(error.message);
  }
}

export async function loadRefuelCorrectionsInRange(
  fromIso: string,
  toIso: string
): Promise<RefuelCorrectionRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_refuel_corrections")
    .select(
      "wialon_unit_id, event_time, wialon_detected_liters, corrected_liters, status"
    )
    .gte("event_time", fromIso)
    .lte("event_time", toIso);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }

  const rows: RefuelCorrectionRow[] = [];
  for (const row of data ?? []) {
    const wialonUnitId = Number(row.wialon_unit_id);
    if (!Number.isFinite(wialonUnitId) || wialonUnitId <= 0) continue;
    const eventTimeIso = String(row.event_time);
    rows.push({
      wialonUnitId,
      eventTimeIso,
      wialonDetectedLiters: Number(row.wialon_detected_liters) || 0,
      correctedLiters:
        row.corrected_liters != null
          ? Number(row.corrected_liters) || 0
          : null,
      status: row.status as RefuelCorrectionStatus,
      adjustmentLiters: adjustmentForRow(row),
    });
  }
  return rows;
}

export async function sumRefuelCorrectionAdjustmentsForPeriod(
  fromIso: string,
  toIso: string
): Promise<{
  adjustmentLiters: number;
  rows: RefuelCorrectionRow[];
}> {
  const rows = await loadRefuelCorrectionsInRange(fromIso, toIso);
  const adjustmentLiters = round1(
    rows.reduce((acc, row) => acc + row.adjustmentLiters, 0)
  );
  return { adjustmentLiters, rows };
}

/** Чи вже є рішення оператора по події (підтверджено / відхилено). */
export async function loadCorrectedEventKeysInRange(
  fromIso: string,
  toIso: string
): Promise<Set<string>> {
  const rows = await loadRefuelCorrectionsInRange(fromIso, toIso);
  return new Set(
    rows.map((row) => `${row.wialonUnitId}:${row.eventTimeIso}`)
  );
}

export function correctionEventKey(unitId: number, timeIso: string): string {
  return `${unitId}:${timeIso}`;
}

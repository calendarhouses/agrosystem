/**
 * Підтвердження заправки з радара: корекція KPI + опційно журнал/склад.
 */

import "server-only";

import { getCurrentActor, actorCreateColumns } from "@/lib/app-actor";
import { upsertRefuelCorrection } from "@/lib/fuel-refuel-corrections";
import { computeTotalCost, roundLiters, roundPrice } from "@/lib/fuel-wac";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function confirmRadarRefuelEvent(input: {
  unitId: number;
  timeIso: string;
  detectedLiters: number;
  correctedLiters: number;
  fromStorageId?: string | null;
  operatorName?: string;
}): Promise<{ fuelTransactionId: string | null }> {
  const amount = roundLiters(Math.max(0, input.correctedLiters));
  if (!(amount > 0)) {
    throw new Error("Обʼєм заправки має бути більше нуля");
  }

  const detected = roundLiters(Math.max(0, input.detectedLiters));
  let fuelTransactionId: string | null = null;

  if (input.fromStorageId) {
    const supabase = createServiceSupabase();
    const { data: from, error: loadErr } = await supabase
      .from("fuel_storages")
      .select("id, name, current_volume, price_per_liter")
      .eq("id", input.fromStorageId)
      .maybeSingle();

    if (loadErr) throw new Error(loadErr.message);
    if (!from) throw new Error("Склад-джерело не знайдено");

    const fromVol = Number(from.current_volume) || 0;
    const donorPrice = Number(from.price_per_liter) || 0;
    if (fromVol + 0.001 < amount) {
      throw new Error(
        `Недостатньо палива в «${from.name}» (є ${roundLiters(fromVol)} л)`
      );
    }

    const { error: volErr } = await supabase
      .from("fuel_storages")
      .update({ current_volume: roundLiters(fromVol - amount) })
      .eq("id", from.id);
    if (volErr) throw new Error(volErr.message);

    const actor = await getCurrentActor();
    const txPricePerLiter = roundPrice(donorPrice);
    const insertBase: Record<string, unknown> = {
      transaction_type: "outbound",
      amount_liters: amount,
      from_storage_id: from.id,
      to_storage_id: null,
      wialon_unit_id: input.unitId,
      operator_name: input.operatorName?.trim() || "Радар заправок",
      wialon_variance: 0,
      wialon_verified: true,
      price_per_liter: txPricePerLiter,
      total_cost: computeTotalCost(amount, txPricePerLiter),
      sync_status: "pending_1c",
      transaction_date: input.timeIso,
      ...actorCreateColumns(actor),
    };

    const { data: tx, error: txErr } = await supabase
      .from("fuel_transactions")
      .insert(insertBase)
      .select("id")
      .single();

    if (txErr || !tx?.id) {
      await supabase
        .from("fuel_storages")
        .update({ current_volume: roundLiters(fromVol) })
        .eq("id", from.id);
      throw new Error(txErr?.message ?? "Не вдалося зберегти запис у журналі");
    }

    fuelTransactionId = String(tx.id);
  }

  await upsertRefuelCorrection({
    wialonUnitId: input.unitId,
    eventTimeIso: input.timeIso,
    wialonDetectedLiters: detected,
    correctedLiters: amount,
    status: "confirmed",
    fromStorageId: input.fromStorageId ?? null,
    fuelTransactionId,
  });

  return { fuelTransactionId };
}

export async function dismissRadarRefuelEvent(input: {
  unitId: number;
  timeIso: string;
  detectedLiters: number;
  reason?: string;
}): Promise<void> {
  await upsertRefuelCorrection({
    wialonUnitId: input.unitId,
    eventTimeIso: input.timeIso,
    wialonDetectedLiters: input.detectedLiters,
    status: "dismissed",
    reason: input.reason,
  });

  // Зворотна сумісність з fuel_radar_dismissed
  const supabase = createServiceSupabase();
  await supabase.from("fuel_radar_dismissed").upsert(
    {
      wialon_unit_id: input.unitId,
      event_time: input.timeIso,
      volume_liters: Math.max(0, input.detectedLiters),
      reason: input.reason?.trim() || null,
    },
    { onConflict: "wialon_unit_id,event_time" }
  );
}

/**
 * Відкат / застосування ефекту fuel_transactions на залишках ємностей (+ WAC).
 * Спільне для API PATCH/DELETE і LEVADIUS-агента.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FuelTransactionType } from "@/lib/fuel-transactions";
import {
  computeTotalCost,
  computeWeightedAveragePrice,
  reverseWeightedAveragePrice,
  roundLiters,
  roundPrice,
} from "@/lib/fuel-wac";

export type FuelStorageVolumeRow = {
  id: string;
  name: string;
  capacity: number;
  current_volume: number;
  price_per_liter: number;
};

export type FuelTxEffectRow = {
  id: string;
  transaction_type: FuelTransactionType;
  amount_liters: number;
  from_storage_id: string | null;
  to_storage_id: string | null;
  wialon_unit_id?: number | null;
  price_per_liter: number | null;
  total_cost?: number | null;
};

export async function loadFuelStorageVolume(
  supabase: SupabaseClient,
  id: string
): Promise<FuelStorageVolumeRow | null> {
  const { data, error } = await supabase
    .from("fuel_storages")
    .select("id, name, capacity, current_volume, price_per_liter")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as FuelStorageVolumeRow;
}

/** Відкат ефекту транзакції на залишках (+ WAC для inbound/transfer-in) */
export async function reverseFuelTransactionEffect(
  supabase: SupabaseClient,
  tx: FuelTxEffectRow
): Promise<void> {
  const amount = Number(tx.amount_liters);
  const txPrice = Number(tx.price_per_liter) || 0;

  if (tx.transaction_type === "inbound" && tx.to_storage_id) {
    const to = await loadFuelStorageVolume(supabase, tx.to_storage_id);
    if (!to) return;
    const vol = Number(to.current_volume) || 0;
    const price = Number(to.price_per_liter) || 0;
    const nextVol = roundLiters(vol - amount);
    const nextPrice =
      nextVol <= 0.001
        ? 0
        : reverseWeightedAveragePrice(vol, price, amount, txPrice);
    const { error } = await supabase
      .from("fuel_storages")
      .update({
        current_volume: Math.max(0, nextVol),
        price_per_liter: nextPrice,
      })
      .eq("id", to.id);
    if (error) throw new Error(error.message);
  } else if (tx.transaction_type === "transfer") {
    if (tx.from_storage_id) {
      const from = await loadFuelStorageVolume(supabase, tx.from_storage_id);
      if (from) {
        const { error } = await supabase
          .from("fuel_storages")
          .update({
            current_volume: roundLiters(Number(from.current_volume) + amount),
          })
          .eq("id", from.id);
        if (error) throw new Error(error.message);
      }
    }
    if (tx.to_storage_id) {
      const to = await loadFuelStorageVolume(supabase, tx.to_storage_id);
      if (to) {
        const vol = Number(to.current_volume) || 0;
        const price = Number(to.price_per_liter) || 0;
        const nextVol = roundLiters(vol - amount);
        const nextPrice =
          nextVol <= 0.001
            ? 0
            : reverseWeightedAveragePrice(vol, price, amount, txPrice);
        const { error } = await supabase
          .from("fuel_storages")
          .update({
            current_volume: Math.max(0, nextVol),
            price_per_liter: nextPrice,
          })
          .eq("id", to.id);
        if (error) throw new Error(error.message);
      }
    }
  } else if (tx.transaction_type === "outbound" && tx.from_storage_id) {
    const from = await loadFuelStorageVolume(supabase, tx.from_storage_id);
    if (from) {
      const { error } = await supabase
        .from("fuel_storages")
        .update({
          current_volume: roundLiters(Number(from.current_volume) + amount),
        })
        .eq("id", from.id);
      if (error) throw new Error(error.message);
    }
  }
}

/**
 * Застосувати нову операцію. Повертає price_per_liter і total_cost для журналу.
 */
export async function applyFuelTransactionEffect(
  supabase: SupabaseClient,
  type: FuelTransactionType,
  amount: number,
  fromStorageId: string | null,
  toStorageId: string | null,
  inboundBuyPrice: number | null
): Promise<{ pricePerLiter: number; totalCost: number }> {
  if (type === "inbound") {
    if (!toStorageId) throw new Error("Оберіть ємність для приходу");
    if (inboundBuyPrice == null || inboundBuyPrice <= 0) {
      throw new Error("Вкажіть ціну за літр (₴)");
    }
    const to = await loadFuelStorageVolume(supabase, toStorageId);
    if (!to) throw new Error("Ємність не знайдена");

    const currentVol = Number(to.current_volume) || 0;
    const currentPrice = Number(to.price_per_liter) || 0;
    const nextVol = roundLiters(currentVol + amount);
    if (nextVol > Number(to.capacity) + 0.001) {
      throw new Error(
        `Переповнення «${to.name}» (місткість ${to.capacity} л)`
      );
    }
    const wac = computeWeightedAveragePrice(
      currentVol,
      currentPrice,
      amount,
      inboundBuyPrice
    );
    const { error } = await supabase
      .from("fuel_storages")
      .update({ current_volume: nextVol, price_per_liter: wac })
      .eq("id", to.id);
    if (error) throw new Error(error.message);

    const pricePerLiter = roundPrice(inboundBuyPrice);
    return {
      pricePerLiter,
      totalCost: computeTotalCost(amount, pricePerLiter),
    };
  }

  if (type === "transfer") {
    if (!fromStorageId || !toStorageId) {
      throw new Error("Оберіть ємності «звідки» і «куди»");
    }
    if (fromStorageId === toStorageId) {
      throw new Error("Ємності мають бути різними");
    }
    const from = await loadFuelStorageVolume(supabase, fromStorageId);
    const to = await loadFuelStorageVolume(supabase, toStorageId);
    if (!from || !to) throw new Error("Ємність не знайдена");

    const fromVol = Number(from.current_volume) || 0;
    const donorPrice = Number(from.price_per_liter) || 0;
    if (fromVol + 0.001 < amount) {
      throw new Error(
        `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
      );
    }
    const toVol = Number(to.current_volume) || 0;
    const toPrice = Number(to.price_per_liter) || 0;
    const nextToVol = roundLiters(toVol + amount);
    if (nextToVol > Number(to.capacity) + 0.001) {
      throw new Error(
        `Переповнення «${to.name}» (місткість ${to.capacity} л)`
      );
    }

    const receiverWac = computeWeightedAveragePrice(
      toVol,
      toPrice,
      amount,
      donorPrice
    );

    const { error: fromErr } = await supabase
      .from("fuel_storages")
      .update({ current_volume: roundLiters(fromVol - amount) })
      .eq("id", from.id);
    if (fromErr) throw new Error(fromErr.message);

    const { error: toErr } = await supabase
      .from("fuel_storages")
      .update({
        current_volume: nextToVol,
        price_per_liter: receiverWac,
      })
      .eq("id", to.id);
    if (toErr) {
      await supabase
        .from("fuel_storages")
        .update({ current_volume: fromVol })
        .eq("id", from.id);
      throw new Error(toErr.message);
    }

    const pricePerLiter = roundPrice(donorPrice);
    return {
      pricePerLiter,
      totalCost: computeTotalCost(amount, pricePerLiter),
    };
  }

  if (!fromStorageId) throw new Error("Оберіть ємність-донор");
  const from = await loadFuelStorageVolume(supabase, fromStorageId);
  if (!from) throw new Error("Ємність не знайдена");
  const fromVol = Number(from.current_volume) || 0;
  const donorPrice = Number(from.price_per_liter) || 0;
  if (fromVol + 0.001 < amount) {
    throw new Error(
      `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
    );
  }
  const { error } = await supabase
    .from("fuel_storages")
    .update({ current_volume: roundLiters(fromVol - amount) })
    .eq("id", from.id);
  if (error) throw new Error(error.message);

  const pricePerLiter = roundPrice(donorPrice);
  return {
    pricePerLiter,
    totalCost: computeTotalCost(amount, pricePerLiter),
  };
}

/**
 * Залишок на складах палива на кінець обраного періоду.
 * Сьогодні / live — поточні обʼєми; інші періоди — відкат транзакцій після toDate.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import {
  resolveFieldFuelPeriodBounds,
  type FieldFuelPeriod,
} from "@/lib/wialon-field-fuel-sync";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";

export type StoragePeriodTotal = {
  liters: number;
  valueUah: number;
  live: boolean;
  asOf: string;
};

export async function sumStorageVolumeForPeriod(
  period: FieldFuelPeriod,
  now = new Date()
): Promise<StoragePeriodTotal> {
  const { toDate } = resolveFieldFuelPeriodBounds(period, now);
  const supabase = createServiceSupabase();

  const { data: storages, error } = await supabase
    .from("fuel_storages")
    .select("id, current_volume, price_per_liter");

  if (error) {
    throw new Error(error.message);
  }

  const rows = storages ?? [];
  let liters = 0;
  let valueUah = 0;
  for (const row of rows) {
    const vol = Math.max(0, Number(row.current_volume) || 0);
    const price = Math.max(0, Number(row.price_per_liter) || 0);
    liters += vol;
    valueUah += vol * price;
  }

  if (period === "today") {
    return {
      liters: Math.round(liters * 10) / 10,
      valueUah: Math.round(valueUah),
      live: true,
      asOf: toDate,
    };
  }

  const { toUnix } = kyivDayBoundsUnix(toDate);
  const afterIso = new Date((toUnix + 1) * 1000).toISOString();

  const { data: txs, error: txErr } = await supabase
    .from("fuel_transactions")
    .select("transaction_type, amount_liters")
    .gt("transaction_date", afterIso);

  if (txErr && txErr.code !== "PGRST205" && txErr.code !== "42P01") {
    throw new Error(txErr.message);
  }

  let deltaAfter = 0;
  for (const tx of txs ?? []) {
    const amount = Number(tx.amount_liters) || 0;
    if (amount <= 0) continue;
    const type = String(tx.transaction_type);
    if (type === "inbound") deltaAfter += amount;
    else if (type === "outbound") deltaAfter -= amount;
    // transfer між нашими складами — net 0 для загального залишку
  }

  const periodLiters = Math.max(0, liters - deltaAfter);
  const avgPrice = liters > 0 ? valueUah / liters : 0;

  return {
    liters: Math.round(periodLiters * 10) / 10,
    valueUah: Math.round(periodLiters * avgPrice),
    live: false,
    asOf: toDate,
  };
}

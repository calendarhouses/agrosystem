/**
 * Повторна звірка outbound fuel_transactions з Wialon DUT.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveWialonVariance } from "@/lib/fuel-wialon-match";

export type ReverifyFuelResult = {
  checked: number;
  updated: number;
  results: Array<{
    transactionId: string;
    variance: number;
    verified: boolean;
  }>;
};

export async function reverifyFuelTransactions(params: {
  supabase: SupabaseClient;
  transactionId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<ReverifyFuelResult> {
  const transactionId = params.transactionId?.trim() || null;
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));

  let query = params.supabase
    .from("fuel_transactions")
    .select(
      "id, amount_liters, wialon_unit_id, transaction_date, wialon_variance, transaction_type"
    )
    .eq("transaction_type", "outbound")
    .not("wialon_unit_id", "is", null)
    .order("transaction_date", { ascending: false })
    .limit(transactionId ? 1 : limit);

  if (transactionId) {
    query = query.eq("id", transactionId);
  } else {
    query = query.is("wialon_variance", null);
    if (params.from) query = query.gte("transaction_date", params.from);
    if (params.to) query = query.lte("transaction_date", params.to);
  }

  const { data: pending, error } = await query;
  if (error) throw new Error(error.message);

  const rows = pending ?? [];
  const results: ReverifyFuelResult["results"] = [];

  for (const row of rows) {
    const unitId = Number(row.wialon_unit_id);
    const amount = Number(row.amount_liters);
    const txDate = new Date(String(row.transaction_date));
    if (!Number.isFinite(unitId) || unitId <= 0) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (Number.isNaN(txDate.getTime())) continue;

    const match = await resolveWialonVariance(unitId, amount, txDate, {
      reverify: true,
    });
    if (match.calculatedVariance == null) continue;

    const wialonVerified = match.calculatedVariance <= 2;
    const { error: updateError } = await params.supabase
      .from("fuel_transactions")
      .update({
        wialon_variance: match.calculatedVariance,
        wialon_verified: wialonVerified,
      })
      .eq("id", row.id);

    if (!updateError) {
      results.push({
        transactionId: String(row.id),
        variance: match.calculatedVariance,
        verified: wialonVerified,
      });
    }
  }

  return {
    checked: rows.length,
    updated: results.length,
    results,
  };
}

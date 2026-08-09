import { NextResponse } from "next/server";

import { resolveWialonVariance } from "@/lib/fuel-wialon-match";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
} from "@/lib/fuel-transactions";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type Body = {
  /** ISO — обмежити повторну звірку періодом журналу */
  from?: string;
  to?: string;
};

/**
 * POST /api/fuel/transactions/reverify
 * Повторна звірка outbound з wialon_variance = null (стан «Очікування GPS»).
 */
export async function POST(request: Request) {
  try {
    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      body = {};
    }

    const supabase = createServiceSupabase();
    let query = supabase
      .from("fuel_transactions")
      .select(
        "id, amount_liters, wialon_unit_id, transaction_date, wialon_variance, transaction_type"
      )
      .eq("transaction_type", "outbound")
      .is("wialon_variance", null)
      .not("wialon_unit_id", "is", null)
      .order("transaction_date", { ascending: false })
      .limit(50);

    if (body.from) query = query.gte("transaction_date", body.from);
    if (body.to) query = query.lte("transaction_date", body.to);

    const { data: pending, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, updated: 0 },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    const rows = pending ?? [];
    let updated = 0;

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
      const { error: updateError } = await supabase
        .from("fuel_transactions")
        .update({
          wialon_variance: match.calculatedVariance,
          wialon_verified: wialonVerified,
        })
        .eq("id", row.id);

      if (!updateError) updated += 1;
      else {
        console.error("[fuel/reverify] update failed", row.id, updateError);
      }
    }

    // Повертаємо свіжий список за тим самим фільтром дат (якщо був)
    let listQuery = supabase
      .from("fuel_transactions")
      .select(FUEL_TRANSACTIONS_SELECT)
      .order("transaction_date", { ascending: false })
      .limit(200);

    if (body.from) listQuery = listQuery.gte("transaction_date", body.from);
    if (body.to) listQuery = listQuery.lte("transaction_date", body.to);

    const { data: list } = await listQuery;

    return NextResponse.json(
      {
        ok: true,
        checked: rows.length,
        updated,
        transactions: (list ?? []).map((row) =>
          mapFuelTransactionRow(row as Record<string, unknown>)
        ),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка повторної звірки",
        updated: 0,
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

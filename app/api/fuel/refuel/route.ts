import { NextResponse } from "next/server";

import { resolveWialonVariance } from "@/lib/fuel-wialon-match";
import { mapFuelTransactionRow } from "@/lib/fuel-transactions";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type Body = {
  fromStorageId?: string;
  wialonUnitId?: number;
  amountLiters?: number;
  operatorName?: string | null;
  /** false → одразу ручний облік, без запиту звірки до Wialon */
  hasFuelSensor?: boolean | null;
};

type StorageRow = {
  id: string;
  name: string;
  capacity: number;
  current_volume: number;
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

/** POST /api/fuel/refuel — заправка техніки + реальний Wialon Smart Match */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const fromStorageId = body.fromStorageId?.trim();
    const wialonUnitId = Number(body.wialonUnitId);
    const amountLiters = Number(body.amountLiters);
    const operatorName = body.operatorName?.trim() || null;
    const clientHasFuelSensor = body.hasFuelSensor;

    if (!fromStorageId) {
      return badRequest("Оберіть ємність-донор");
    }
    if (!Number.isFinite(wialonUnitId) || wialonUnitId <= 0) {
      return badRequest("Оберіть техніку");
    }
    if (!Number.isFinite(amountLiters) || amountLiters <= 0) {
      return badRequest("Кількість літрів має бути більше 0");
    }

    const amount = Math.round(amountLiters * 100) / 100;
    const transactionDate = new Date();

    let calculatedVariance: number | null = null;
    let realAdded: number | null = null;
    if (clientHasFuelSensor !== false) {
      const match = await resolveWialonVariance(
        wialonUnitId,
        amount,
        transactionDate
      );
      calculatedVariance = match.calculatedVariance;
      realAdded = match.realAdded;
    }
    const wialonVerified =
      calculatedVariance !== null && calculatedVariance <= 2;

    const supabase = createServiceSupabase();

    const { data: storage, error: storageError } = await supabase
      .from("fuel_storages")
      .select("id, name, capacity, current_volume")
      .eq("id", fromStorageId)
      .maybeSingle();

    if (storageError || !storage) {
      return badRequest("Ємність не знайдена");
    }

    const from = storage as StorageRow;
    const nextVolume = Number(from.current_volume) - amount;
    if (nextVolume < -0.001) {
      return badRequest(
        `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
      );
    }

    const roundedVolume = Math.round(nextVolume * 100) / 100;
    const { error: updateError } = await supabase
      .from("fuel_storages")
      .update({ current_volume: roundedVolume })
      .eq("id", from.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    const { data: tx, error: txError } = await supabase
      .from("fuel_transactions")
      .insert({
        transaction_type: "outbound",
        from_storage_id: fromStorageId,
        to_storage_id: null,
        wialon_unit_id: wialonUnitId,
        amount_liters: amount,
        operator_name: operatorName,
        transaction_date: transactionDate.toISOString(),
        wialon_variance: calculatedVariance,
        wialon_verified: wialonVerified,
      })
      .select("*")
      .single();

    if (txError) {
      try {
        await supabase
          .from("fuel_storages")
          .update({ current_volume: from.current_volume })
          .eq("id", from.id);
      } catch {
        /* rollback best-effort */
      }

      return NextResponse.json(
        { ok: false, error: txError.message },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        calculatedVariance,
        wialonAdded: realAdded,
        wialonVerified,
        transaction: mapFuelTransactionRow(tx as Record<string, unknown>),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка заправки",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

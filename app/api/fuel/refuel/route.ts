import { NextResponse } from "next/server";

import { resolveWialonVariance } from "@/lib/fuel-wialon-match";
import { mapFuelTransactionRow } from "@/lib/fuel-transactions";
import { computeTotalCost, roundLiters, roundPrice } from "@/lib/fuel-wac";
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
  /** Опційно: привʼязка до активного наряду */
  fieldOperationId?: string | null;
};

type StorageRow = {
  id: string;
  name: string;
  capacity: number;
  current_volume: number;
  price_per_liter: number;
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

/** POST /api/fuel/refuel — заправка техніки + WAC-ціна донора + Wialon Smart Match */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const fromStorageId = body.fromStorageId?.trim();
    const wialonUnitId = Number(body.wialonUnitId);
    const amountLiters = Number(body.amountLiters);
    const operatorName = body.operatorName?.trim() || null;
    const clientHasFuelSensor = body.hasFuelSensor;
    const fieldOperationId = body.fieldOperationId?.trim() || null;

    if (!fromStorageId) {
      return badRequest("Оберіть ємність-донор");
    }
    if (!Number.isFinite(wialonUnitId) || wialonUnitId <= 0) {
      return badRequest("Оберіть техніку");
    }
    if (!Number.isFinite(amountLiters) || amountLiters <= 0) {
      return badRequest("Кількість літрів має бути більше 0");
    }

    const amount = roundLiters(amountLiters);
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
      .select("id, name, capacity, current_volume, price_per_liter")
      .eq("id", fromStorageId)
      .maybeSingle();

    if (storageError || !storage) {
      return badRequest("Ємність не знайдена");
    }

    const from = storage as StorageRow;
    const fromVol = Number(from.current_volume) || 0;
    const donorPrice = roundPrice(Number(from.price_per_liter) || 0);
    const nextVolume = roundLiters(fromVol - amount);
    if (nextVolume < -0.001) {
      return badRequest(
        `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
      );
    }

    const totalCost = computeTotalCost(amount, donorPrice);

    const { error: updateError } = await supabase
      .from("fuel_storages")
      .update({ current_volume: nextVolume })
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
        price_per_liter: donorPrice,
        total_cost: totalCost,
        sync_status: "pending_1c",
        ...(fieldOperationId ? { field_operation_id: fieldOperationId } : {}),
      })
      .select("*")
      .single();

    if (txError) {
      // До міграції 031 — повтор без field_operation_id
      if (
        fieldOperationId &&
        (txError.message?.includes("field_operation_id") ||
          txError.code === "42703")
      ) {
        const retry = await supabase
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
            price_per_liter: donorPrice,
            total_cost: totalCost,
            sync_status: "pending_1c",
          })
          .select("*")
          .single();

        if (!retry.error && retry.data) {
          return NextResponse.json(
            {
              ok: true,
              calculatedVariance,
              wialonAdded: realAdded,
              wialonVerified,
              pricePerLiter: donorPrice,
              totalCost,
              transaction: mapFuelTransactionRow(
                retry.data as Record<string, unknown>
              ),
            },
            { headers: JSON_UTF8 }
          );
        }
      }

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
        pricePerLiter: donorPrice,
        totalCost,
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

import { NextResponse } from "next/server";

import { enqueueFuelBasDraft } from "@/lib/fuel-bas-sync";
import { logActivity } from "@/lib/activity-log";
import { actorCreateColumns, getCurrentActor } from "@/lib/app-actor";
import { resolveWialonVariance } from "@/lib/fuel-wialon-match";
import { mapFuelTransactionRow } from "@/lib/fuel-transactions";
import { computeTotalCost, roundLiters, roundPrice } from "@/lib/fuel-wac";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  fromStorageId?: string;
  equipmentId?: string | null;
  wialonUnitId?: number | null;
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
    const equipmentId =
      typeof body.equipmentId === "string" && UUID_RE.test(body.equipmentId.trim())
        ? body.equipmentId.trim()
        : null;
    const wialonRaw = Number(body.wialonUnitId);
    const wialonUnitId =
      Number.isFinite(wialonRaw) && wialonRaw > 0 ? wialonRaw : null;
    const amountLiters = Number(body.amountLiters);
    const operatorName = body.operatorName?.trim() || null;
    const clientHasFuelSensor = body.hasFuelSensor;
    const fieldOperationId = body.fieldOperationId?.trim() || null;

    if (!fromStorageId) {
      return badRequest("Оберіть ємність-донор");
    }
    if (wialonUnitId == null && !equipmentId) {
      return badRequest("Оберіть техніку");
    }
    if (!Number.isFinite(amountLiters) || amountLiters <= 0) {
      return badRequest("Кількість літрів має бути більше 0");
    }

    const amount = roundLiters(amountLiters);
    const transactionDate = new Date();

    let calculatedVariance: number | null = null;
    let realAdded: number | null = null;
    if (wialonUnitId != null && clientHasFuelSensor !== false) {
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

    const actor = await getCurrentActor();
    const insertPayload: Record<string, unknown> = {
      transaction_type: "outbound",
      from_storage_id: fromStorageId,
      to_storage_id: null,
      wialon_unit_id: wialonUnitId,
      equipment_id: equipmentId,
      amount_liters: amount,
      operator_name: operatorName,
      transaction_date: transactionDate.toISOString(),
      wialon_variance: calculatedVariance,
      wialon_verified: wialonVerified,
      price_per_liter: donorPrice,
      total_cost: totalCost,
      sync_status: "pending_1c",
      ...actorCreateColumns(actor),
      ...(fieldOperationId ? { field_operation_id: fieldOperationId } : {}),
    };

    const { data: tx, error: txError } = await supabase
      .from("fuel_transactions")
      .insert(insertPayload)
      .select("*")
      .single();

    if (txError) {
      // До міграцій — повтор без нових колонок
      const retryPayload = { ...insertPayload };
      if (
        txError.message?.includes("equipment_id") ||
        txError.code === "42703"
      ) {
        delete retryPayload.equipment_id;
      }
      if (
        txError.message?.includes("field_operation_id") ||
        txError.code === "42703"
      ) {
        delete retryPayload.field_operation_id;
      }
      if (
        txError.message?.includes("actor_id") ||
        txError.message?.includes("actor_name") ||
        txError.code === "42703"
      ) {
        delete retryPayload.actor_id;
        delete retryPayload.actor_name;
      }

      if (
        retryPayload.equipment_id !== insertPayload.equipment_id ||
        retryPayload.field_operation_id !== insertPayload.field_operation_id ||
        retryPayload.actor_id !== insertPayload.actor_id ||
        retryPayload.actor_name !== insertPayload.actor_name
      ) {
        const retry = await supabase
          .from("fuel_transactions")
          .insert(retryPayload)
          .select("*")
          .single();

        if (!retry.error && retry.data) {
          const retryTx = retry.data as Record<string, unknown>;
          void enqueueFuelBasDraft({
            transactionId: String(retryTx.id),
            transactionType: "outbound",
            amountLiters: amount,
            pricePerLiter: donorPrice,
            totalCost,
            fromStorageId,
            toStorageId: null,
          }).catch((e) => console.error("[bas-drafts] fuel outbound", e));

          return NextResponse.json(
            {
              ok: true,
              calculatedVariance,
              wialonAdded: realAdded,
              wialonVerified,
              pricePerLiter: donorPrice,
              totalCost,
              transaction: mapFuelTransactionRow(retryTx),
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

    const saved = tx as Record<string, unknown>;
    void enqueueFuelBasDraft({
      transactionId: String(saved.id),
      transactionType: "outbound",
      amountLiters: amount,
      pricePerLiter: donorPrice,
      totalCost,
      fromStorageId,
      toStorageId: null,
    }).catch((e) => console.error("[bas-drafts] fuel outbound", e));

    void logActivity({
      actor,
      action: "create",
      entityType: "fuel_transaction",
      entityId: String(saved.id),
      summary: `${actor.label} оформив заправку техніки`,
      meta: { amountLiters: amount, equipmentId, fromStorageId },
    });

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

import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { mapFuelTransactionRow, type FuelTransactionType } from "@/lib/fuel-transactions";
import {
  applyFuelTransactionEffect,
  reverseFuelTransactionEffect,
  type FuelTxEffectRow,
} from "@/lib/fuel-transaction-mutate";
import { roundLiters, roundPrice } from "@/lib/fuel-wac";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type TxRow = FuelTxEffectRow & {
  wialon_unit_id: number | null;
  total_cost: number | null;
};

type PatchBody = {
  transactionType?: FuelTransactionType;
  amountLiters?: number;
  fromStorageId?: string | null;
  toStorageId?: string | null;
  equipmentId?: string | null;
  wialonUnitId?: number | null;
  hasFuelSensor?: boolean | null;
  /** Для inbound — ціна нової партії (WAC) */
  pricePerLiter?: number | null;
  transactionDate?: string | null;
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

/** PATCH /api/fuel/transactions/:id — редагування з перерахунком обʼємів і WAC */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) return badRequest("Немає id");

    const body = (await request.json()) as PatchBody;
    const amount = roundLiters(Number(body.amountLiters));
    const transactionType = body.transactionType;

    if (
      transactionType !== "inbound" &&
      transactionType !== "transfer" &&
      transactionType !== "outbound"
    ) {
      return badRequest("Невідомий тип транзакції");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return badRequest("Кількість літрів має бути більше 0");
    }

    const supabase = createServiceSupabase();
    const { data: existing, error: loadError } = await supabase
      .from("fuel_transactions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (loadError || !existing) {
      return NextResponse.json(
        { ok: false, error: "Транзакцію не знайдено" },
        { status: 404, headers: JSON_UTF8 }
      );
    }

    const oldTx = existing as TxRow;

    let fromStorageId: string | null = body.fromStorageId ?? null;
    let toStorageId: string | null = body.toStorageId ?? null;
    let wialonUnitId: number | null =
      body.wialonUnitId != null && Number.isFinite(Number(body.wialonUnitId))
        ? Number(body.wialonUnitId)
        : null;
    let equipmentId: string | null =
      typeof body.equipmentId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.equipmentId.trim()
      )
        ? body.equipmentId.trim()
        : null;

    let inboundBuyPrice: number | null = null;
    if (transactionType === "inbound") {
      fromStorageId = null;
      wialonUnitId = null;
      equipmentId = null;
      const price = Number(body.pricePerLiter);
      if (!Number.isFinite(price) || price <= 0) {
        return badRequest("Вкажіть ціну за літр (₴)");
      }
      inboundBuyPrice = roundPrice(price);
    } else if (transactionType === "transfer") {
      wialonUnitId = null;
      equipmentId = null;
    } else {
      toStorageId = null;
      if (wialonUnitId == null && !equipmentId) {
        return badRequest("Оберіть техніку");
      }
    }

    let transactionDateIso: string | undefined;
    if (body.transactionDate) {
      const parsed = new Date(body.transactionDate);
      if (Number.isNaN(parsed.getTime())) {
        return badRequest("Некоректна дата операції");
      }
      transactionDateIso = parsed.toISOString();
    }

    // Валідація пройшла → відкат старої + застосування нової.
    // На будь-якій помилці відновлюємо oldTx.
    await reverseFuelTransactionEffect(supabase, oldTx);

    const restoreOld = async () => {
      try {
        await applyFuelTransactionEffect(
          supabase,
          oldTx.transaction_type,
          Number(oldTx.amount_liters),
          oldTx.from_storage_id,
          oldTx.to_storage_id,
          oldTx.price_per_liter != null && Number(oldTx.price_per_liter) > 0
            ? Number(oldTx.price_per_liter)
            : null
        );
      } catch {
        /* best-effort restore */
      }
    };

    let costing: { pricePerLiter: number; totalCost: number };
    try {
      costing = await applyFuelTransactionEffect(
        supabase,
        transactionType,
        amount,
        fromStorageId,
        toStorageId,
        inboundBuyPrice
      );
    } catch (err) {
      await restoreOld();
      throw err;
    }

    const wialonVariance =
      transactionType === "outbound"
        ? body.hasFuelSensor === false
          ? null
          : ((existing as { wialon_variance?: number | null }).wialon_variance ??
            0)
        : null;

    const patchPayload = {
      transaction_type: transactionType,
      amount_liters: amount,
      from_storage_id: fromStorageId,
      to_storage_id: toStorageId,
      wialon_unit_id: wialonUnitId,
      equipment_id: equipmentId,
      wialon_variance: wialonVariance,
      price_per_liter: costing.pricePerLiter,
      total_cost: costing.totalCost,
      ...(transactionDateIso ? { transaction_date: transactionDateIso } : {}),
    };

    let { data: updated, error: updateError } = await supabase
      .from("fuel_transactions")
      .update(patchPayload)
      .eq("id", id)
      .select("*")
      .single();

    if (
      updateError &&
      equipmentId &&
      (updateError.message?.includes("equipment_id") ||
        updateError.code === "42703")
    ) {
      const { equipment_id: _drop, ...withoutEquipment } = patchPayload;
      const retry = await supabase
        .from("fuel_transactions")
        .update(withoutEquipment)
        .eq("id", id)
        .select("*")
        .single();
      updated = retry.data;
      updateError = retry.error;
    }

    if (updateError || !updated) {
      // Нові обʼєми вже застосовані — знімаємо їх і повертаємо стару tx
      try {
        await reverseFuelTransactionEffect(supabase, {
          id,
          transaction_type: transactionType,
          amount_liters: amount,
          from_storage_id: fromStorageId,
          to_storage_id: toStorageId,
          wialon_unit_id: wialonUnitId,
          price_per_liter: costing.pricePerLiter,
          total_cost: costing.totalCost,
        });
      } catch {
        /* best-effort */
      }
      await restoreOld();
      return NextResponse.json(
        { ok: false, error: updateError?.message ?? "Не вдалося оновити" },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    const actor = await getCurrentActor();
    await logActivity({
      actor,
      action: "update",
      entityType: "fuel_transaction",
      entityId: id,
      summary: `${actor.label} змінив операцію з ДП`,
      meta: { transactionType, amountLiters: amount },
    });

    return NextResponse.json(
      {
        ok: true,
        transaction: mapFuelTransactionRow(updated as Record<string, unknown>),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка оновлення",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

/** DELETE /api/fuel/transactions/:id — видалення з відкатом обʼємів і WAC */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) return badRequest("Немає id");

    const supabase = createServiceSupabase();
    const { data: existing, error: loadError } = await supabase
      .from("fuel_transactions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (loadError || !existing) {
      return NextResponse.json(
        { ok: false, error: "Транзакцію не знайдено" },
        { status: 404, headers: JSON_UTF8 }
      );
    }

    await reverseFuelTransactionEffect(supabase, existing as TxRow);

    try {
      const { deleteAttachmentsForEntity } = await import(
        "@/lib/operation-attachments"
      );
      await deleteAttachmentsForEntity("fuel_transaction", id);
    } catch {
      /* best-effort */
    }

    const { error: deleteError } = await supabase
      .from("fuel_transactions")
      .delete()
      .eq("id", id);

    if (deleteError) {
      // Відкат обʼємів уже зроблено — повертаємо ефект старої tx
      try {
        const old = existing as TxRow;
        await applyFuelTransactionEffect(
          supabase,
          old.transaction_type,
          Number(old.amount_liters),
          old.from_storage_id,
          old.to_storage_id,
          old.price_per_liter != null && Number(old.price_per_liter) > 0
            ? Number(old.price_per_liter)
            : null
        );
      } catch {
        /* best-effort */
      }
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    const actor = await getCurrentActor();
    await logActivity({
      actor,
      action: "delete",
      entityType: "fuel_transaction",
      entityId: id,
      summary: `${actor.label} видалив операцію з ДП`,
      meta: {
        transactionType: (existing as TxRow).transaction_type,
        amountLiters: Number((existing as TxRow).amount_liters),
      },
    });

    return NextResponse.json({ ok: true }, { headers: JSON_UTF8 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка видалення",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

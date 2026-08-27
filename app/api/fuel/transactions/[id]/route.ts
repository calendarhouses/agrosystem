import { NextResponse } from "next/server";

import { mapFuelTransactionRow, type FuelTransactionType } from "@/lib/fuel-transactions";
import {
  computeTotalCost,
  computeWeightedAveragePrice,
  reverseWeightedAveragePrice,
  roundLiters,
  roundPrice,
} from "@/lib/fuel-wac";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type StorageRow = {
  id: string;
  name: string;
  capacity: number;
  current_volume: number;
  price_per_liter: number;
};

type TxRow = {
  id: string;
  transaction_type: FuelTransactionType;
  amount_liters: number;
  from_storage_id: string | null;
  to_storage_id: string | null;
  wialon_unit_id: number | null;
  price_per_liter: number | null;
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
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

async function loadStorage(
  supabase: ReturnType<typeof createServiceSupabase>,
  id: string
) {
  const { data, error } = await supabase
    .from("fuel_storages")
    .select("id, name, capacity, current_volume, price_per_liter")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as StorageRow;
}

/** Відкат ефекту транзакції на залишках (+ WAC для inbound/transfer-in) */
async function reverseTx(
  supabase: ReturnType<typeof createServiceSupabase>,
  tx: TxRow
) {
  const amount = Number(tx.amount_liters);
  const txPrice = Number(tx.price_per_liter) || 0;

  if (tx.transaction_type === "inbound" && tx.to_storage_id) {
    const to = await loadStorage(supabase, tx.to_storage_id);
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
      const from = await loadStorage(supabase, tx.from_storage_id);
      if (from) {
        const { error } = await supabase
          .from("fuel_storages")
          .update({
            current_volume: roundLiters(
              Number(from.current_volume) + amount
            ),
          })
          .eq("id", from.id);
        if (error) throw new Error(error.message);
      }
    }
    if (tx.to_storage_id) {
      const to = await loadStorage(supabase, tx.to_storage_id);
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
    const from = await loadStorage(supabase, tx.from_storage_id);
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
async function applyTx(
  supabase: ReturnType<typeof createServiceSupabase>,
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
    const to = await loadStorage(supabase, toStorageId);
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
    const from = await loadStorage(supabase, fromStorageId);
    const to = await loadStorage(supabase, toStorageId);
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
  const from = await loadStorage(supabase, fromStorageId);
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

    // Валідація пройшла → відкат старої + застосування нової.
    // На будь-якій помилці відновлюємо oldTx.
    await reverseTx(supabase, oldTx);

    const restoreOld = async () => {
      try {
        await applyTx(
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
      costing = await applyTx(
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
        await reverseTx(supabase, {
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

    await reverseTx(supabase, existing as TxRow);

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
        await applyTx(
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

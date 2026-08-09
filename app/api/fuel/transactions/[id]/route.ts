import { NextResponse } from "next/server";

import type { FuelTransactionType } from "@/lib/fuel-transactions";
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
};

type TxRow = {
  id: string;
  transaction_type: FuelTransactionType;
  amount_liters: number;
  from_storage_id: string | null;
  to_storage_id: string | null;
  wialon_unit_id: number | null;
};

type PatchBody = {
  transactionType?: FuelTransactionType;
  amountLiters?: number;
  fromStorageId?: string | null;
  toStorageId?: string | null;
  wialonUnitId?: number | null;
  hasFuelSensor?: boolean | null;
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
    .select("id, name, capacity, current_volume")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as StorageRow;
}

async function bumpVolume(
  supabase: ReturnType<typeof createServiceSupabase>,
  storage: StorageRow,
  delta: number
) {
  const next = Number(storage.current_volume) + delta;
  if (next < -0.001) {
    throw new Error(
      `Недостатньо палива в «${storage.name}» (є ${storage.current_volume} л)`
    );
  }
  if (next > Number(storage.capacity) + 0.001) {
    throw new Error(
      `Переповнення «${storage.name}» (місткість ${storage.capacity} л)`
    );
  }
  const { error } = await supabase
    .from("fuel_storages")
    .update({ current_volume: Math.round(next * 100) / 100 })
    .eq("id", storage.id);
  if (error) throw new Error(error.message);
  storage.current_volume = Math.round(next * 100) / 100;
}

/** Відкат ефекту транзакції на залишках */
async function reverseTx(
  supabase: ReturnType<typeof createServiceSupabase>,
  tx: TxRow
) {
  const amount = Number(tx.amount_liters);
  if (tx.transaction_type === "inbound" && tx.to_storage_id) {
    const to = await loadStorage(supabase, tx.to_storage_id);
    if (to) await bumpVolume(supabase, to, -amount);
  } else if (tx.transaction_type === "transfer") {
    if (tx.from_storage_id) {
      const from = await loadStorage(supabase, tx.from_storage_id);
      if (from) await bumpVolume(supabase, from, amount);
    }
    if (tx.to_storage_id) {
      const to = await loadStorage(supabase, tx.to_storage_id);
      if (to) await bumpVolume(supabase, to, -amount);
    }
  } else if (tx.transaction_type === "outbound" && tx.from_storage_id) {
    const from = await loadStorage(supabase, tx.from_storage_id);
    if (from) await bumpVolume(supabase, from, amount);
  }
}

/** Застосувати нову транзакцію до залишків */
async function applyTx(
  supabase: ReturnType<typeof createServiceSupabase>,
  type: FuelTransactionType,
  amount: number,
  fromStorageId: string | null,
  toStorageId: string | null
) {
  if (type === "inbound") {
    if (!toStorageId) throw new Error("Оберіть ємність для приходу");
    const to = await loadStorage(supabase, toStorageId);
    if (!to) throw new Error("Ємність не знайдена");
    await bumpVolume(supabase, to, amount);
  } else if (type === "transfer") {
    if (!fromStorageId || !toStorageId) {
      throw new Error("Оберіть ємності «звідки» і «куди»");
    }
    if (fromStorageId === toStorageId) {
      throw new Error("Ємності мають бути різними");
    }
    const from = await loadStorage(supabase, fromStorageId);
    const to = await loadStorage(supabase, toStorageId);
    if (!from || !to) throw new Error("Ємність не знайдена");
    await bumpVolume(supabase, from, -amount);
    try {
      await bumpVolume(supabase, to, amount);
    } catch (err) {
      await bumpVolume(supabase, from, amount);
      throw err;
    }
  } else {
    if (!fromStorageId) throw new Error("Оберіть ємність-донор");
    const from = await loadStorage(supabase, fromStorageId);
    if (!from) throw new Error("Ємність не знайдена");
    await bumpVolume(supabase, from, -amount);
  }
}

/** PATCH /api/fuel/transactions/:id — редагування з перерахунком обʼємів */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) return badRequest("Немає id");

    const body = (await request.json()) as PatchBody;
    const amount = Number(body.amountLiters);
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
    await reverseTx(supabase, oldTx);

    let fromStorageId: string | null = body.fromStorageId ?? null;
    let toStorageId: string | null = body.toStorageId ?? null;
    let wialonUnitId: number | null =
      body.wialonUnitId != null && Number.isFinite(Number(body.wialonUnitId))
        ? Number(body.wialonUnitId)
        : null;

    if (transactionType === "inbound") {
      fromStorageId = null;
      wialonUnitId = null;
    } else if (transactionType === "transfer") {
      wialonUnitId = null;
    } else {
      toStorageId = null;
      if (wialonUnitId == null) return badRequest("Оберіть техніку");
    }

    try {
      await applyTx(
        supabase,
        transactionType,
        amount,
        fromStorageId,
        toStorageId
      );
    } catch (err) {
      // Відновити старий ефект, якщо новий не застосувався
      await applyTx(
        supabase,
        oldTx.transaction_type,
        Number(oldTx.amount_liters),
        oldTx.from_storage_id,
        oldTx.to_storage_id
      ).catch(() => undefined);
      throw err;
    }

    const wialonVariance =
      transactionType === "outbound"
        ? body.hasFuelSensor === false
          ? null
          : ((existing as { wialon_variance?: number | null }).wialon_variance ??
            0)
        : null;

    const { data: updated, error: updateError } = await supabase
      .from("fuel_transactions")
      .update({
        transaction_type: transactionType,
        amount_liters: amount,
        from_storage_id: fromStorageId,
        to_storage_id: toStorageId,
        wialon_unit_id: wialonUnitId,
        wialon_variance: wialonVariance,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      { ok: true, transaction: updated },
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

/** DELETE /api/fuel/transactions/:id — видалення з відкатом обʼємів */
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

    const { error: deleteError } = await supabase
      .from("fuel_transactions")
      .delete()
      .eq("id", id);

    if (deleteError) {
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

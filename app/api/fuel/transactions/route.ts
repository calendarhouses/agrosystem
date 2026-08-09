import { NextResponse } from "next/server";

import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransactionType,
} from "@/lib/fuel-transactions";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type Body = {
  transactionType?: FuelTransactionType;
  amountLiters?: number;
  fromStorageId?: string | null;
  toStorageId?: string | null;
  wialonUnitId?: number | null;
  operatorName?: string | null;
  /** false → wialon_variance = null (ручний облік без ДУТ) */
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

/** GET /api/fuel/transactions — операції з назвами складів (+ фільтр дат) */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limitRaw = params.get("limit");
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50)
    );
    const fromIso = params.get("from");
    const toIso = params.get("to");

    const supabase = createServiceSupabase();
    let query = supabase
      .from("fuel_transactions")
      .select(FUEL_TRANSACTIONS_SELECT)
      .order("transaction_date", { ascending: false })
      .limit(limit);

    if (fromIso) {
      query = query.gte("transaction_date", fromIso);
    }
    if (toIso) {
      query = query.lte("transaction_date", toIso);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, transactions: [] },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        transactions: (data ?? []).map((row) =>
          mapFuelTransactionRow(row as Record<string, unknown>)
        ),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка читання",
        transactions: [],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

/** POST /api/fuel/transactions — прихід / переміщення / заправка */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const transactionType = body.transactionType;
    const amount = Number(body.amountLiters);

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

    const loadStorage = async (id: string) => {
      const { data, error } = await supabase
        .from("fuel_storages")
        .select("id, name, capacity, current_volume")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return data as StorageRow;
    };

    const bumpVolume = async (storage: StorageRow, delta: number) => {
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
    };

    let fromStorageId: string | null = body.fromStorageId ?? null;
    let toStorageId: string | null = body.toStorageId ?? null;
    let wialonUnitId: number | null =
      body.wialonUnitId != null && Number.isFinite(Number(body.wialonUnitId))
        ? Number(body.wialonUnitId)
        : null;

    if (transactionType === "inbound") {
      if (!toStorageId) return badRequest("Оберіть ємність для приходу");
      const to = await loadStorage(toStorageId);
      if (!to) return badRequest("Ємність не знайдена");
      await bumpVolume(to, amount);
      fromStorageId = null;
      wialonUnitId = null;
    } else if (transactionType === "transfer") {
      if (!fromStorageId || !toStorageId) {
        return badRequest("Оберіть ємності «звідки» і «куди»");
      }
      if (fromStorageId === toStorageId) {
        return badRequest("Ємності мають бути різними");
      }
      const from = await loadStorage(fromStorageId);
      const to = await loadStorage(toStorageId);
      if (!from || !to) return badRequest("Ємність не знайдена");
      await bumpVolume(from, -amount);
      try {
        await bumpVolume(to, amount);
      } catch (err) {
        await bumpVolume(from, amount);
        throw err;
      }
      wialonUnitId = null;
    } else {
      if (!fromStorageId) return badRequest("Оберіть ємність-донор");
      if (wialonUnitId == null) return badRequest("Оберіть техніку");
      const from = await loadStorage(fromStorageId);
      if (!from) return badRequest("Ємність не знайдена");
      await bumpVolume(from, -amount);
      toStorageId = null;
    }

    // Без ДУТ — null (ручний облік). З ДУТ — 0 до реальної звірки Wialon.
    const wialonVariance =
      transactionType === "outbound"
        ? body.hasFuelSensor === false
          ? null
          : 0
        : null;

    const { data: tx, error: txError } = await supabase
      .from("fuel_transactions")
      .insert({
        transaction_type: transactionType,
        amount_liters: amount,
        from_storage_id: fromStorageId,
        to_storage_id: toStorageId,
        wialon_unit_id: wialonUnitId,
        operator_name: body.operatorName?.trim() || null,
        wialon_variance: wialonVariance,
        wialon_verified: transactionType === "outbound" && wialonVariance === 0,
      })
      .select("*")
      .single();

    if (txError) {
      if (transactionType === "inbound" && toStorageId) {
        const to = await loadStorage(toStorageId);
        if (to) await bumpVolume(to, -amount).catch(() => undefined);
      } else if (transactionType === "transfer" && fromStorageId && toStorageId) {
        const from = await loadStorage(fromStorageId);
        const to = await loadStorage(toStorageId);
        if (to) await bumpVolume(to, -amount).catch(() => undefined);
        if (from) await bumpVolume(from, amount).catch(() => undefined);
      } else if (transactionType === "outbound" && fromStorageId) {
        const from = await loadStorage(fromStorageId);
        if (from) await bumpVolume(from, amount).catch(() => undefined);
      }
      return NextResponse.json(
        { ok: false, error: txError.message },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      { ok: true, transaction: tx },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка транзакції",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

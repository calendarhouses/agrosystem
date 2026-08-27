import { NextResponse } from "next/server";

import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransactionType,
} from "@/lib/fuel-transactions";
import { enqueueFuelBasDraft } from "@/lib/fuel-bas-sync";
import {
  computeTotalCost,
  computeWeightedAveragePrice,
  roundLiters,
  roundPrice,
} from "@/lib/fuel-wac";
import { countAttachmentsByEntityIds } from "@/lib/operation-attachments";
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
  equipmentId?: string | null;
  wialonUnitId?: number | null;
  operatorName?: string | null;
  /** false → wialon_variance = null (ручний облік без ДУТ) */
  hasFuelSensor?: boolean | null;
  /** Обовʼязково для inbound — ціна нової партії для WAC */
  pricePerLiter?: number | null;
  /** Час операції (ISO) — для Radar / Zero-Data Entry */
  transactionDate?: string | null;
  /**
   * Створено з даних ДУТ (Радар Заправок):
   * wialon_variance = 0, wialon_verified = true.
   */
  sensorSourced?: boolean | null;
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

    const mapped = (data ?? []).map((row) =>
      mapFuelTransactionRow(row as Record<string, unknown>)
    );
    const counts = await countAttachmentsByEntityIds(
      "fuel_transaction",
      mapped.map((tx) => tx.id)
    );
    return NextResponse.json(
      {
        ok: true,
        transactions: mapped.map((tx) => ({
          ...tx,
          attachmentCount: counts[tx.id] ?? 0,
        })),
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

/** POST /api/fuel/transactions — прихід (WAC) / переміщення / заправка */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const transactionType = body.transactionType;
    const amount = roundLiters(Number(body.amountLiters));

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
        .select("id, name, capacity, current_volume, price_per_liter")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return data as StorageRow;
    };

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

    /** Ціна й сума, що потрапляють у історію транзакції */
    let txPricePerLiter = 0;
    let txTotalCost = 0;

    /** Snapshot для rollback */
    const rollback: Array<{
      id: string;
      current_volume: number;
      price_per_liter: number;
    }> = [];

    const snapshot = (s: StorageRow) => {
      rollback.push({
        id: s.id,
        current_volume: Number(s.current_volume),
        price_per_liter: Number(s.price_per_liter) || 0,
      });
    };

    const restoreAll = async () => {
      for (const row of rollback) {
        try {
          await supabase
            .from("fuel_storages")
            .update({
              current_volume: row.current_volume,
              price_per_liter: row.price_per_liter,
            })
            .eq("id", row.id);
        } catch {
          /* best-effort */
        }
      }
    };

    if (transactionType === "inbound") {
      if (!toStorageId) return badRequest("Оберіть ємність для приходу");
      const buyPrice = Number(body.pricePerLiter);
      if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
        return badRequest("Вкажіть ціну за літр (₴)");
      }
      const to = await loadStorage(toStorageId);
      if (!to) return badRequest("Ємність не знайдена");

      const currentVol = Number(to.current_volume) || 0;
      const currentPrice = Number(to.price_per_liter) || 0;
      const nextVol = roundLiters(currentVol + amount);
      if (nextVol > Number(to.capacity) + 0.001) {
        return badRequest(
          `Переповнення «${to.name}» (місткість ${to.capacity} л)`
        );
      }

      const wacPrice = computeWeightedAveragePrice(
        currentVol,
        currentPrice,
        amount,
        buyPrice
      );
      txPricePerLiter = roundPrice(buyPrice);
      txTotalCost = computeTotalCost(amount, txPricePerLiter);

      snapshot(to);
      const { error } = await supabase
        .from("fuel_storages")
        .update({
          current_volume: nextVol,
          price_per_liter: wacPrice,
        })
        .eq("id", to.id);
      if (error) throw new Error(error.message);

      fromStorageId = null;
      wialonUnitId = null;
      equipmentId = null;
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

      const fromVol = Number(from.current_volume) || 0;
      const donorPrice = Number(from.price_per_liter) || 0;
      if (fromVol + 0.001 < amount) {
        return badRequest(
          `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
        );
      }

      const toVol = Number(to.current_volume) || 0;
      const toPrice = Number(to.price_per_liter) || 0;
      const nextToVol = roundLiters(toVol + amount);
      if (nextToVol > Number(to.capacity) + 0.001) {
        return badRequest(
          `Переповнення «${to.name}» (місткість ${to.capacity} л)`
        );
      }

      const nextFromVol = roundLiters(fromVol - amount);
      const receiverWac = computeWeightedAveragePrice(
        toVol,
        toPrice,
        amount,
        donorPrice
      );

      txPricePerLiter = roundPrice(donorPrice);
      txTotalCost = computeTotalCost(amount, txPricePerLiter);

      snapshot(from);
      snapshot(to);

      const { error: fromErr } = await supabase
        .from("fuel_storages")
        .update({ current_volume: nextFromVol })
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
        await restoreAll();
        throw new Error(toErr.message);
      }

      wialonUnitId = null;
      equipmentId = null;
    } else {
      if (!fromStorageId) return badRequest("Оберіть ємність-донор");
      if (wialonUnitId == null && !equipmentId) {
        return badRequest("Оберіть техніку");
      }
      const from = await loadStorage(fromStorageId);
      if (!from) return badRequest("Ємність не знайдена");

      const fromVol = Number(from.current_volume) || 0;
      const donorPrice = Number(from.price_per_liter) || 0;
      if (fromVol + 0.001 < amount) {
        return badRequest(
          `Недостатньо палива в «${from.name}» (є ${from.current_volume} л)`
        );
      }

      txPricePerLiter = roundPrice(donorPrice);
      txTotalCost = computeTotalCost(amount, txPricePerLiter);

      snapshot(from);
      const { error } = await supabase
        .from("fuel_storages")
        .update({ current_volume: roundLiters(fromVol - amount) })
        .eq("id", from.id);
      if (error) throw new Error(error.message);

      toStorageId = null;
    }

    const sensorSourced =
      transactionType === "outbound" && body.sensorSourced === true;
    const wialonVariance =
      transactionType === "outbound"
        ? body.hasFuelSensor === false && !sensorSourced
          ? null
          : 0
        : null;
    const wialonVerified =
      sensorSourced ||
      (transactionType === "outbound" && wialonVariance === 0);

    let transactionDate: string | undefined;
    if (body.transactionDate) {
      const parsed = new Date(body.transactionDate);
      if (Number.isNaN(parsed.getTime())) {
        await restoreAll();
        return badRequest("Некоректна дата транзакції");
      }
      transactionDate = parsed.toISOString();
    }

    const { data: tx, error: txError } = await supabase
      .from("fuel_transactions")
      .insert({
        transaction_type: transactionType,
        amount_liters: amount,
        from_storage_id: fromStorageId,
        to_storage_id: toStorageId,
        wialon_unit_id: wialonUnitId,
        equipment_id: equipmentId,
        operator_name: body.operatorName?.trim() || null,
        wialon_variance: wialonVariance,
        wialon_verified: wialonVerified,
        price_per_liter: txPricePerLiter,
        total_cost: txTotalCost,
        sync_status: "pending_1c",
        ...(transactionDate ? { transaction_date: transactionDate } : {}),
      })
      .select("*")
      .single();

    let savedRow: Record<string, unknown> | null = tx
      ? (tx as Record<string, unknown>)
      : null;

    if (txError || !savedRow) {
      // До міграції 040 — без equipment_id
      if (
        equipmentId &&
        txError &&
        (txError.message?.includes("equipment_id") || txError.code === "42703")
      ) {
        const retry = await supabase
          .from("fuel_transactions")
          .insert({
            transaction_type: transactionType,
            amount_liters: amount,
            from_storage_id: fromStorageId,
            to_storage_id: toStorageId,
            wialon_unit_id: wialonUnitId,
            operator_name: body.operatorName?.trim() || null,
            wialon_variance: wialonVariance,
            wialon_verified: wialonVerified,
            price_per_liter: txPricePerLiter,
            total_cost: txTotalCost,
            sync_status: "pending_1c",
            ...(transactionDate ? { transaction_date: transactionDate } : {}),
          })
          .select("*")
          .single();
        if (retry.error || !retry.data) {
          await restoreAll();
          return NextResponse.json(
            { ok: false, error: retry.error?.message ?? txError.message },
            { status: 500, headers: JSON_UTF8 }
          );
        }
        savedRow = retry.data as Record<string, unknown>;
      } else {
        await restoreAll();
        return NextResponse.json(
          { ok: false, error: txError?.message ?? "Не вдалося зберегти" },
          { status: 500, headers: JSON_UTF8 }
        );
      }
    }

    // Закупівля / переміщення → черга на чернетку 1С (зараз stub)
    if (
      (transactionType === "inbound" || transactionType === "transfer") &&
      savedRow.id
    ) {
      const nextStatus = await enqueueFuelBasDraft({
        transactionId: String(savedRow.id),
        transactionType,
        amountLiters: amount,
        pricePerLiter: txPricePerLiter,
        totalCost: txTotalCost,
        fromStorageId,
        toStorageId,
      });
      if (nextStatus !== "pending_1c") {
        await supabase
          .from("fuel_transactions")
          .update({ sync_status: nextStatus })
          .eq("id", savedRow.id);
        savedRow.sync_status = nextStatus;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        transaction: mapFuelTransactionRow(savedRow),
        message:
          transactionType === "inbound"
            ? "Партію збережено локально. Чернетка 1С — після узгодження з бухгалтером"
            : transactionType === "transfer"
              ? "Переміщення збережено локально. Чернетка 1С — після узгодження з бухгалтером"
              : undefined,
      },
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

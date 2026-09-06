/**
 * Коригування / скасування / історія fuel_transactions для LEVADIUS (Крок C).
 * Типи в БД: inbound | transfer | outbound (= purchase | transfer | dispense).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { resolveFuelStorageByLookup } from "@/lib/agent-fuel-ops";
import {
  applyFuelTransactionEffect,
  reverseFuelTransactionEffect,
  type FuelTxEffectRow,
} from "@/lib/fuel-transaction-mutate";
import type { FuelTransactionType } from "@/lib/fuel-transactions";
import { computeTotalCost, roundLiters, roundPrice } from "@/lib/fuel-wac";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function agentTypeLabel(dbType: string): string {
  if (dbType === "inbound") return "закупівля (purchase)";
  if (dbType === "outbound") return "роздача / заправка (dispense)";
  if (dbType === "transfer") return "переміщення (transfer)";
  return dbType;
}

function mapAgentFilterToDb(
  filter: "all" | "purchase" | "dispense" | "transfer"
): FuelTransactionType | null {
  if (filter === "purchase") return "inbound";
  if (filter === "dispense") return "outbound";
  if (filter === "transfer") return "transfer";
  return null;
}

type TxFullRow = FuelTxEffectRow & {
  equipment_id: string | null;
  operator_name: string | null;
  transaction_date: string;
  total_cost: number | null;
  is_reverted?: boolean | null;
  notes?: string | null;
  actor_name?: string | null;
};

async function loadTxById(
  supabase: SupabaseClient,
  transactionId: string
): Promise<
  | { ok: true; tx: TxFullRow }
  | { ok: false; error: string; status: "not_found" | "error" }
> {
  const id = transactionId.trim();
  if (!isUuid(id)) {
    return {
      ok: false,
      status: "error",
      error: "Потрібен UUID транзакції (transactionId).",
    };
  }
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { ok: false, status: "error", error: error.message };
  }
  if (!data) {
    return {
      ok: false,
      status: "not_found",
      error: `Транзакцію «${id}» не знайдено.`,
    };
  }
  return { ok: true, tx: data as TxFullRow };
}

async function resolveStorageNames(
  supabase: SupabaseClient,
  fromId: string | null,
  toId: string | null
): Promise<{ fromName: string | null; toName: string | null }> {
  const ids = [fromId, toId].filter(Boolean) as string[];
  if (ids.length === 0) return { fromName: null, toName: null };
  const { data } = await supabase
    .from("fuel_storages")
    .select("id, name")
    .in("id", ids);
  const map = new Map(
    (data ?? []).map((r) => [String(r.id), String(r.name ?? "")])
  );
  return {
    fromName: fromId ? map.get(fromId) ?? null : null,
    toName: toId ? map.get(toId) ?? null : null,
  };
}

async function resolveEquipmentName(
  supabase: SupabaseClient,
  equipmentId: string | null
): Promise<string | null> {
  if (!equipmentId) return null;
  const { data } = await supabase
    .from("equipment")
    .select("id, name, code")
    .eq("id", equipmentId)
    .maybeSingle();
  if (!data) return null;
  const code = data.code ? String(data.code) : "";
  const name = String(data.name ?? "Техніка");
  return code ? `${name} (${code})` : name;
}

export async function updateAgentFuelTransaction(params: {
  supabase: SupabaseClient;
  transactionId: string;
  newLiters?: number | null;
  newPricePerLiter?: number | null;
  notes?: string | null;
  fromStorageIdOrName?: string | null;
  toStorageIdOrName?: string | null;
  equipmentIdOrName?: string | null;
  transactionDate?: string | null;
}): Promise<
  | {
      ok: true;
      transactionId: string;
      transactionType: string;
      oldLiters: number;
      newLiters: number;
      litersDelta: number;
      pricePerLiter: number;
      totalCost: number;
      notes: string | null;
      fromStorageId: string | null;
      toStorageId: string | null;
      equipmentId: string | null;
      transactionDate: string | null;
      message: string;
    }
  | { ok: false; error: string; status: string }
> {
  const loaded = await loadTxById(params.supabase, params.transactionId);
  if (!loaded.ok) return loaded;

  const oldTx = loaded.tx;
  if (oldTx.is_reverted === true) {
    return {
      ok: false,
      status: "error",
      error: "Транзакція вже анульована — редагування неможливе.",
    };
  }

  const oldLiters = roundLiters(Number(oldTx.amount_liters));
  const newLiters =
    params.newLiters != null && Number.isFinite(Number(params.newLiters))
      ? roundLiters(Number(params.newLiters))
      : oldLiters;
  if (!(newLiters > 0)) {
    return {
      ok: false,
      status: "error",
      error: "newLiters має бути > 0.",
    };
  }

  let fromStorageId = oldTx.from_storage_id;
  let toStorageId = oldTx.to_storage_id;
  let equipmentId =
    (oldTx as { equipment_id?: string | null }).equipment_id ?? null;
  let wialonUnitId =
    (oldTx as { wialon_unit_id?: number | null }).wialon_unit_id ?? null;

  if (params.fromStorageIdOrName?.trim()) {
    const r = await resolveFuelStorageByLookup(
      params.supabase,
      params.fromStorageIdOrName.trim()
    );
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    fromStorageId = r.storage.id;
  }
  if (params.toStorageIdOrName?.trim()) {
    const r = await resolveFuelStorageByLookup(
      params.supabase,
      params.toStorageIdOrName.trim()
    );
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    toStorageId = r.storage.id;
  }
  if (params.equipmentIdOrName?.trim()) {
    const lookup = params.equipmentIdOrName.trim();
    let eq: { id: string; wialon_id: number | null } | null = null;
    if (isUuid(lookup)) {
      const { data } = await params.supabase
        .from("equipment")
        .select("id, wialon_id")
        .eq("id", lookup)
        .maybeSingle();
      if (data) {
        eq = {
          id: String(data.id),
          wialon_id:
            data.wialon_id != null ? Number(data.wialon_id) : null,
        };
      }
    } else {
      const safe = lookup.replaceAll(",", " ");
      const { data } = await params.supabase
        .from("equipment")
        .select("id, wialon_id, name")
        .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
        .limit(5);
      if (data?.length === 1) {
        eq = {
          id: String(data[0]!.id),
          wialon_id:
            data[0]!.wialon_id != null ? Number(data[0]!.wialon_id) : null,
        };
      } else if ((data?.length ?? 0) > 1) {
        return {
          ok: false,
          status: "ambiguous",
          error: `Кілька машин для «${lookup}».`,
        };
      }
    }
    if (!eq) {
      return {
        ok: false,
        status: "not_found",
        error: `Техніку «${lookup}» не знайдено.`,
      };
    }
    equipmentId = eq.id;
    wialonUnitId = eq.wialon_id;
  }

  let transactionDateIso: string | null = null;
  if (params.transactionDate?.trim()) {
    const parsed = new Date(params.transactionDate.trim());
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: "error", error: "Некоректна transactionDate." };
    }
    transactionDateIso = parsed.toISOString();
  }

  // Нормалізація слотів за типом
  if (oldTx.transaction_type === "inbound") {
    fromStorageId = null;
    equipmentId = null;
    wialonUnitId = null;
  } else if (oldTx.transaction_type === "transfer") {
    equipmentId = null;
    wialonUnitId = null;
  } else {
    toStorageId = null;
  }

  let inboundBuyPrice: number | null = null;
  let newPrice =
    oldTx.price_per_liter != null && Number(oldTx.price_per_liter) > 0
      ? roundPrice(Number(oldTx.price_per_liter))
      : null;

  if (params.newPricePerLiter != null) {
    const p = Number(params.newPricePerLiter);
    if (!Number.isFinite(p) || p < 0) {
      return {
        ok: false,
        status: "error",
        error: "newPricePerLiter має бути ≥ 0.",
      };
    }
    newPrice = roundPrice(p);
  }

  if (oldTx.transaction_type === "inbound") {
    if (newPrice == null || newPrice <= 0) {
      return {
        ok: false,
        status: "error",
        error: "Для закупівлі потрібна ціна за літр (newPricePerLiter).",
      };
    }
    inboundBuyPrice = newPrice;
  }

  const litersDelta = roundLiters(newLiters - oldLiters);
  const storageChanged =
    fromStorageId !== oldTx.from_storage_id ||
    toStorageId !== oldTx.to_storage_id;
  const equipmentChanged =
    equipmentId !==
    ((oldTx as { equipment_id?: string | null }).equipment_id ?? null);
  if (
    litersDelta === 0 &&
    params.newPricePerLiter == null &&
    params.notes == null &&
    !storageChanged &&
    !equipmentChanged &&
    !transactionDateIso
  ) {
    return {
      ok: false,
      status: "error",
      error:
        "Немає змін: вкажи літри, ціну, notes, ємність, техніку або дату.",
    };
  }

  await reverseFuelTransactionEffect(params.supabase, oldTx);

  const restoreOld = async () => {
    try {
      await applyFuelTransactionEffect(
        params.supabase,
        oldTx.transaction_type,
        oldLiters,
        oldTx.from_storage_id,
        oldTx.to_storage_id,
        oldTx.transaction_type === "inbound" &&
          oldTx.price_per_liter != null &&
          Number(oldTx.price_per_liter) > 0
          ? Number(oldTx.price_per_liter)
          : null
      );
    } catch {
      /* best-effort */
    }
  };

  let costing: { pricePerLiter: number; totalCost: number };
  try {
    costing = await applyFuelTransactionEffect(
      params.supabase,
      oldTx.transaction_type,
      newLiters,
      fromStorageId,
      toStorageId,
      inboundBuyPrice
    );
  } catch (err) {
    await restoreOld();
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Помилка коригування залишку",
    };
  }

  const notesValue =
    params.notes != null ? String(params.notes).trim() || null : undefined;

  const patch: Record<string, unknown> = {
    amount_liters: newLiters,
    price_per_liter: costing.pricePerLiter,
    total_cost: costing.totalCost,
    from_storage_id: fromStorageId,
    to_storage_id: toStorageId,
    equipment_id: equipmentId,
    wialon_unit_id: wialonUnitId,
  };
  if (notesValue !== undefined) patch.notes = notesValue;
  if (transactionDateIso) patch.transaction_date = transactionDateIso;

  let { error: updateError } = await params.supabase
    .from("fuel_transactions")
    .update(patch)
    .eq("id", oldTx.id);

  if (
    updateError &&
    (updateError.message?.includes("notes") ||
      updateError.message?.includes("equipment_id") ||
      updateError.code === "42703")
  ) {
    const soft = { ...patch };
    delete soft.notes;
    if (updateError.message?.includes("equipment_id")) {
      delete soft.equipment_id;
    }
    const retry = await params.supabase
      .from("fuel_transactions")
      .update(soft)
      .eq("id", oldTx.id);
    updateError = retry.error;
  }

  if (updateError) {
    try {
      await reverseFuelTransactionEffect(params.supabase, {
        ...oldTx,
        amount_liters: newLiters,
        from_storage_id: fromStorageId,
        to_storage_id: toStorageId,
        price_per_liter: costing.pricePerLiter,
      });
    } catch {
      /* best-effort */
    }
    await restoreOld();
    return { ok: false, status: "error", error: updateError.message };
  }

  const actor = await getCurrentActor();
  await logActivity({
    actor,
    action: "update",
    entityType: "fuel_transaction",
    entityId: oldTx.id,
    summary: `${actor.label} скоригував операцію з ДП (${oldLiters}→${newLiters} л)`,
    meta: {
      transactionType: oldTx.transaction_type,
      oldLiters,
      newLiters,
      litersDelta,
      storageChanged,
      equipmentChanged,
    },
  });

  const deltaHint =
    litersDelta === 0
      ? "обʼєм без змін"
      : oldTx.transaction_type === "outbound"
        ? litersDelta < 0
          ? `повернуто ${Math.abs(litersDelta)} л у ємність`
          : `списано додатково ${litersDelta} л`
        : oldTx.transaction_type === "inbound"
          ? litersDelta < 0
            ? `зменшено оприбуткування на ${Math.abs(litersDelta)} л`
            : `дооприбутковано ${litersDelta} л`
          : `Δ ${litersDelta} л`;

  return {
    ok: true,
    transactionId: oldTx.id,
    transactionType: oldTx.transaction_type,
    oldLiters,
    newLiters,
    litersDelta,
    pricePerLiter: costing.pricePerLiter,
    totalCost: costing.totalCost,
    notes: notesValue !== undefined ? notesValue : oldTx.notes ?? null,
    fromStorageId,
    toStorageId,
    equipmentId,
    transactionDate: transactionDateIso,
    message: `Оновлено ${agentTypeLabel(oldTx.transaction_type)}: ${oldLiters} → ${newLiters} л (${deltaHint}).`,
  };
}

export async function deleteAgentFuelTransaction(params: {
  supabase: SupabaseClient;
  transactionId: string;
  confirmed: boolean;
}): Promise<
  | {
      ok: true;
      status: "requires_confirmation";
      transactionId: string;
      transactionType: string;
      typeLabel: string;
      amountLiters: number;
      storageName: string | null;
      equipmentName: string | null;
      warning: string;
      confirmChoice: string;
      cancelChoice: string;
      canConfirm: true;
      message: string;
    }
  | {
      ok: true;
      status: "deleted";
      transactionId: string;
      transactionType: string;
      amountLiters: number;
      softDeleted: boolean;
      message: string;
    }
  | { ok: false; error: string; status: string }
> {
  const loaded = await loadTxById(params.supabase, params.transactionId);
  if (!loaded.ok) return loaded;
  const tx = loaded.tx;

  if (tx.is_reverted === true) {
    return {
      ok: false,
      status: "error",
      error: "Транзакція вже анульована.",
    };
  }

  const names = await resolveStorageNames(
    params.supabase,
    tx.from_storage_id,
    tx.to_storage_id
  );
  const equipmentName = await resolveEquipmentName(
    params.supabase,
    tx.equipment_id
  );
  const storageName =
    tx.transaction_type === "inbound"
      ? names.toName
      : names.fromName || names.toName;
  const amount = roundLiters(Number(tx.amount_liters));
  const typeLabel = agentTypeLabel(tx.transaction_type);

  if (!params.confirmed) {
    const rollbackHint =
      tx.transaction_type === "outbound"
        ? `Поверне ${amount} л назад у ємність «${storageName ?? "?"}».`
        : tx.transaction_type === "inbound"
          ? `Спише ${amount} л з ємності «${storageName ?? "?"}» (скасування оприбуткування).`
          : `Відкотить переміщення ${amount} л між ємностями.`;

    return {
      ok: true,
      status: "requires_confirmation",
      transactionId: tx.id,
      transactionType: tx.transaction_type,
      typeLabel,
      amountLiters: amount,
      storageName,
      equipmentName,
      warning: rollbackHint,
      confirmChoice: `Так, анулюй транзакцію ${tx.id}`,
      cancelChoice: "Скасувати",
      canConfirm: true,
      message: `Анулювати ${typeLabel}: **${amount} л**${equipmentName ? `, техніка «${equipmentName}»` : ""}${storageName ? `, ємність «${storageName}»` : ""}? ${rollbackHint}`,
    };
  }

  await reverseFuelTransactionEffect(params.supabase, tx);

  let softDeleted = true;
  const { error: softErr } = await params.supabase
    .from("fuel_transactions")
    .update({ is_reverted: true })
    .eq("id", tx.id);

  if (softErr) {
    softDeleted = false;
    if (
      softErr.message?.includes("is_reverted") ||
      softErr.code === "42703"
    ) {
      try {
        const { deleteAttachmentsForEntity } = await import(
          "@/lib/operation-attachments"
        );
        await deleteAttachmentsForEntity("fuel_transaction", tx.id);
      } catch {
        /* best-effort */
      }
      const { error: delErr } = await params.supabase
        .from("fuel_transactions")
        .delete()
        .eq("id", tx.id);
      if (delErr) {
        try {
          await applyFuelTransactionEffect(
            params.supabase,
            tx.transaction_type,
            amount,
            tx.from_storage_id,
            tx.to_storage_id,
            tx.transaction_type === "inbound" &&
              tx.price_per_liter != null &&
              Number(tx.price_per_liter) > 0
              ? Number(tx.price_per_liter)
              : null
          );
        } catch {
          /* best-effort */
        }
        return { ok: false, status: "error", error: delErr.message };
      }
    } else {
      try {
        await applyFuelTransactionEffect(
          params.supabase,
          tx.transaction_type,
          amount,
          tx.from_storage_id,
          tx.to_storage_id,
          tx.transaction_type === "inbound" &&
            tx.price_per_liter != null &&
            Number(tx.price_per_liter) > 0
            ? Number(tx.price_per_liter)
            : null
        );
      } catch {
        /* best-effort */
      }
      return { ok: false, status: "error", error: softErr.message };
    }
  }

  const actor = await getCurrentActor();
  await logActivity({
    actor,
    action: "delete",
    entityType: "fuel_transaction",
    entityId: tx.id,
    summary: `${actor.label} анулював операцію з ДП (${amount} л)`,
    meta: {
      transactionType: tx.transaction_type,
      amountLiters: amount,
      softDeleted,
    },
  });

  return {
    ok: true,
    status: "deleted",
    transactionId: tx.id,
    transactionType: tx.transaction_type,
    amountLiters: amount,
    softDeleted,
    message: softDeleted
      ? `Анульовано ${typeLabel}: ${amount} л (is_reverted). Залишок відкочено.`
      : `Видалено ${typeLabel}: ${amount} л. Залишок відкочено.`,
  };
}

export async function getFuelTransactionHistory(params: {
  supabase: SupabaseClient;
  storageIdOrName?: string | null;
  equipmentIdOrName?: string | null;
  transactionType?: "all" | "purchase" | "dispense" | "transfer";
  limit?: number;
}): Promise<
  | {
      ok: true;
      count: number;
      transactions: Array<{
        id: string;
        dateTime: string;
        type: string;
        typeLabel: string;
        amountLiters: number;
        pricePerLiter: number | null;
        totalCost: number | null;
        fromStorage: string | null;
        toStorage: string | null;
        equipmentName: string | null;
        operatorName: string | null;
        balanceAfterLiters: number | null;
        notes: string | null;
        isReverted: boolean;
      }>;
      message: string;
    }
  | { ok: false; error: string; status: string }
> {
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const typeFilter = params.transactionType ?? "all";
  const dbType = mapAgentFilterToDb(typeFilter);

  let storageId: string | null = null;
  let equipmentId: string | null = null;

  if (params.storageIdOrName?.trim()) {
    const resolved = await resolveFuelStorageByLookup(
      params.supabase,
      params.storageIdOrName.trim()
    );
    if (!resolved.ok) {
      return {
        ok: false,
        status: resolved.status,
        error: resolved.error,
      };
    }
    storageId = resolved.storage.id;
  }

  if (params.equipmentIdOrName?.trim()) {
    const lookup = params.equipmentIdOrName.trim();
    if (isUuid(lookup)) {
      equipmentId = lookup;
    } else {
      const safe = lookup.replaceAll(",", " ");
      const { data, error } = await params.supabase
        .from("equipment")
        .select("id, name, code")
        .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
        .limit(5);
      if (error) {
        return { ok: false, status: "error", error: error.message };
      }
      if (!data?.length) {
        return {
          ok: false,
          status: "not_found",
          error: `Техніку «${lookup}» не знайдено.`,
        };
      }
      if (data.length > 1) {
        return {
          ok: false,
          status: "ambiguous",
          error: `Кілька машин: ${data.map((d) => d.name).join(", ")}. Уточни.`,
        };
      }
      equipmentId = String(data[0]!.id);
    }
  }

  let query = params.supabase
    .from("fuel_transactions")
    .select(
      `
      id, transaction_type, amount_liters, price_per_liter, total_cost,
      from_storage_id, to_storage_id, equipment_id, operator_name,
      transaction_date, notes, is_reverted, actor_name,
      from_storage:fuel_storages!fuel_transactions_from_storage_id_fkey ( id, name ),
      to_storage:fuel_storages!fuel_transactions_to_storage_id_fkey ( id, name ),
      equipment:equipment_id ( id, name, code )
    `
    )
    .order("transaction_date", { ascending: false })
    .limit(limit);

  if (dbType) query = query.eq("transaction_type", dbType);
  if (equipmentId) query = query.eq("equipment_id", equipmentId);
  if (storageId) {
    query = query.or(
      `from_storage_id.eq.${storageId},to_storage_id.eq.${storageId}`
    );
  }

  let { data, error } = await query;

  if (
    error &&
    (error.message?.includes("is_reverted") ||
      error.message?.includes("notes") ||
      error.code === "42703")
  ) {
    let fallback = params.supabase
      .from("fuel_transactions")
      .select(
        `
        id, transaction_type, amount_liters, price_per_liter, total_cost,
        from_storage_id, to_storage_id, equipment_id, operator_name,
        transaction_date, actor_name,
        from_storage:fuel_storages!fuel_transactions_from_storage_id_fkey ( id, name ),
        to_storage:fuel_storages!fuel_transactions_to_storage_id_fkey ( id, name ),
        equipment:equipment_id ( id, name, code )
      `
      )
      .order("transaction_date", { ascending: false })
      .limit(limit);
    if (dbType) fallback = fallback.eq("transaction_type", dbType);
    if (equipmentId) fallback = fallback.eq("equipment_id", equipmentId);
    if (storageId) {
      fallback = fallback.or(
        `from_storage_id.eq.${storageId},to_storage_id.eq.${storageId}`
      );
    }
    const retry = await fallback;
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    // join-less fallback
    let simple = params.supabase
      .from("fuel_transactions")
      .select(
        "id, transaction_type, amount_liters, price_per_liter, total_cost, from_storage_id, to_storage_id, equipment_id, operator_name, transaction_date"
      )
      .order("transaction_date", { ascending: false })
      .limit(limit);
    if (dbType) simple = simple.eq("transaction_type", dbType);
    if (equipmentId) simple = simple.eq("equipment_id", equipmentId);
    if (storageId) {
      simple = simple.or(
        `from_storage_id.eq.${storageId},to_storage_id.eq.${storageId}`
      );
    }
    const retry = await simple;
    if (retry.error) {
      return { ok: false, status: "error", error: retry.error.message };
    }
    data = retry.data as typeof data;
  }

  const rows = data ?? [];

  // Running balance for filtered storage (walk newest→oldest from current volume)
  let running: number | null = null;
  if (storageId) {
    const { data: st } = await params.supabase
      .from("fuel_storages")
      .select("current_volume")
      .eq("id", storageId)
      .maybeSingle();
    running = st ? Number(st.current_volume) || 0 : null;
  }

  const transactions = rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const type = String(row.transaction_type ?? "");
    const amount = roundLiters(Number(row.amount_liters) || 0);
    const fromRel = Array.isArray(row.from_storage)
      ? row.from_storage[0]
      : row.from_storage;
    const toRel = Array.isArray(row.to_storage)
      ? row.to_storage[0]
      : row.to_storage;
    const eqRel = Array.isArray(row.equipment)
      ? row.equipment[0]
      : row.equipment;

    let balanceAfter: number | null = null;
    if (running != null && storageId) {
      balanceAfter = Math.round(running * 100) / 100;
      // Undo this tx on the storage to get previous balance for next (older) row
      const fromId = row.from_storage_id
        ? String(row.from_storage_id)
        : null;
      const toId = row.to_storage_id ? String(row.to_storage_id) : null;
      if (type === "inbound" && toId === storageId) {
        running = roundLiters(running - amount);
      } else if (type === "outbound" && fromId === storageId) {
        running = roundLiters(running + amount);
      } else if (type === "transfer") {
        if (fromId === storageId) running = roundLiters(running + amount);
        if (toId === storageId) running = roundLiters(running - amount);
      }
    }

    const price =
      row.price_per_liter != null && Number(row.price_per_liter) > 0
        ? roundPrice(Number(row.price_per_liter))
        : null;
    const total =
      row.total_cost != null && Number.isFinite(Number(row.total_cost))
        ? Math.round(Number(row.total_cost) * 100) / 100
        : price != null
          ? computeTotalCost(amount, price)
          : null;

    const eqName = eqRel
      ? String((eqRel as { name?: string }).name ?? "")
      : null;

    return {
      id: String(row.id),
      dateTime: String(row.transaction_date ?? ""),
      type,
      typeLabel: agentTypeLabel(type),
      amountLiters: amount,
      pricePerLiter: price,
      totalCost: total,
      fromStorage: fromRel
        ? String((fromRel as { name?: string }).name ?? "")
        : null,
      toStorage: toRel
        ? String((toRel as { name?: string }).name ?? "")
        : null,
      equipmentName: eqName || null,
      operatorName: row.operator_name
        ? String(row.operator_name)
        : row.actor_name
          ? String(row.actor_name)
          : null,
      balanceAfterLiters: balanceAfter,
      notes: row.notes != null ? String(row.notes) : null,
      isReverted: row.is_reverted === true,
    };
  });

  return {
    ok: true,
    count: transactions.length,
    transactions,
    message: `Знайдено **${transactions.length}** операцій з пального.`,
  };
}

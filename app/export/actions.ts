"use server";

import { revalidatePath } from "next/cache";

import { getSeasonRange, kyivYmd } from "@/lib/finance-period";
import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Сумісність зі старим Excel / sheet */
export type DraftExportMove = {
  id: string;
  date: string;
  qty: number;
  type: "outbound" | "inbound" | "sale";
  basRefKey: string;
  itemName: string;
  unit: string;
  category: string | null;
  season: string | null;
  fieldId: string | null;
  fieldName: string | null;
  note: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  isLocalItem: boolean;
  hasAttachment: boolean;
};

export type AccountantQueueTab =
  | "all"
  | "outbound"
  | "inbound"
  | "sale"
  | "fuel";

export type AccountantQueueItem = {
  id: string;
  source: "inventory" | "fuel";
  /** UI-тип */
  kind: "outbound" | "inbound" | "sale" | "fuel_inbound" | "fuel_transfer";
  date: string;
  season: string | null;
  title: string;
  /** Поле / контрагент / склади */
  party: string | null;
  qty: number;
  unit: string;
  amountUah: number | null;
  hasAttachment: boolean;
  isLocalItem: boolean;
  category: string | null;
  note: string | null;
  /** inventory */
  basRefKey: string | null;
  fieldId: string | null;
  fieldName: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  /** fuel */
  fromStorageName: string | null;
  toStorageName: string | null;
  pricePerLiter: number | null;
};

export type AccountantQueueStats = {
  total: number;
  outbound: number;
  inbound: number;
  sale: number;
  fuel: number;
  amountUah: number;
  withoutAttachment: number;
  newItems: number;
  fuelWithoutPrice: number;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function seasonYearFromInput(season?: string | null): number {
  const n = Number(normalizeSeason(season ?? DEFAULT_SEASON));
  return Number.isFinite(n) && n >= 2020 ? n : Number(DEFAULT_SEASON);
}

function inDateRange(
  dateIso: string,
  startIso: string,
  endIso: string
): boolean {
  const d = dateIso.slice(0, 10);
  return d >= startIso && d <= endIso;
}

function mapInventoryRow(row: Record<string, unknown>): DraftExportMove {
  const field = unwrapJoin(
    row.farm_fields as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null
  );
  const cache = unwrapJoin(
    row.inventory_items_cache as
      | {
          name: string;
          custom_name: string | null;
          unit: string | null;
          bas_ref_key: string | null;
          is_local?: boolean | null;
          category?: string | null;
        }
      | {
          name: string;
          custom_name: string | null;
          unit: string | null;
          bas_ref_key: string | null;
          is_local?: boolean | null;
          category?: string | null;
        }[]
      | null
  );

  const type =
    row.type === "inbound"
      ? ("inbound" as const)
      : row.type === "sale"
        ? ("sale" as const)
        : ("outbound" as const);
  const priceRaw = row.unit_price_uah;
  const unitPriceUah =
    priceRaw != null && Number.isFinite(Number(priceRaw))
      ? Number(priceRaw)
      : null;

  return {
    id: String(row.id),
    date: String(row.date).slice(0, 10),
    qty: Number(row.qty) || 0,
    type,
    basRefKey: String(
      cache?.bas_ref_key || row.item_ref_key || ""
    ).toLowerCase(),
    itemName: String(cache?.custom_name?.trim() || cache?.name || "ТМЦ"),
    unit: String(cache?.unit ?? ""),
    category: cache?.category ? String(cache.category) : null,
    season: typeof row.season === "string" ? String(row.season) : null,
    fieldId: field?.id
      ? String(field.id)
      : row.field_id
        ? String(row.field_id)
        : null,
    fieldName: field?.name ? String(field.name) : null,
    note: typeof row.note === "string" ? String(row.note) : null,
    buyerName:
      typeof row.buyer_name === "string" ? String(row.buyer_name) : null,
    unitPriceUah,
    isLocalItem: cache?.is_local === true,
    hasAttachment: false,
  };
}

function inventoryToQueueItem(m: DraftExportMove): AccountantQueueItem {
  const amountUah =
    m.unitPriceUah != null
      ? Math.round(m.qty * m.unitPriceUah * 100) / 100
      : null;
  const party =
    m.type === "outbound"
      ? m.fieldName
      : m.type === "sale" || m.type === "inbound"
        ? m.buyerName || m.fieldName
        : null;

  return {
    id: m.id,
    source: "inventory",
    kind: m.type,
    date: m.date,
    season: m.season,
    title: m.itemName,
    party,
    qty: m.qty,
    unit: m.unit,
    amountUah,
    hasAttachment: m.hasAttachment,
    isLocalItem: m.isLocalItem,
    category: m.category,
    note: m.note,
    basRefKey: m.basRefKey,
    fieldId: m.fieldId,
    fieldName: m.fieldName,
    buyerName: m.buyerName,
    unitPriceUah: m.unitPriceUah,
    fromStorageName: null,
    toStorageName: null,
    pricePerLiter: null,
  };
}

async function attachInventoryFlags(moves: DraftExportMove[]): Promise<void> {
  if (moves.length === 0) return;
  try {
    const supabase = createServiceSupabase();
    const ids = moves.map((m) => m.id);
    const { data: atts } = await supabase
      .from("operation_attachments")
      .select("entity_id")
      .eq("entity_type", "inventory_move")
      .in("entity_id", ids);
    const withFile = new Set((atts ?? []).map((a) => String(a.entity_id)));
    for (const m of moves) {
      if (withFile.has(m.id)) m.hasAttachment = true;
    }
  } catch {
    /* ignore */
  }
}

async function fetchInventoryMoves(
  status: "draft" | "sent_to_1c",
  season: string | null
): Promise<DraftExportMove[]> {
  const supabase = createServiceSupabase();
  let q = supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      date,
      qty,
      type,
      note,
      season,
      buyer_name,
      unit_price_uah,
      item_ref_key,
      field_id,
      farm_fields ( id, name ),
      inventory_items_cache ( name, custom_name, unit, bas_ref_key, is_local, category )
    `
    )
    .eq("status", status)
    .in("type", ["outbound", "inbound", "sale"])
    .order("date", { ascending: false });

  if (season) q = q.eq("season", season);

  const { data, error } = await q;

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return [];
    // Без season / нових колонок
    if (
      error.message?.includes("season") ||
      error.message?.includes("is_local") ||
      error.message?.includes("inbound")
    ) {
      let legacy = supabase
        .from("inventory_local_moves")
        .select(
          `
          id,
          date,
          qty,
          type,
          item_ref_key,
          field_id,
          farm_fields ( id, name ),
          inventory_items_cache ( name, custom_name, unit, bas_ref_key )
        `
        )
        .eq("status", status)
        .order("date", { ascending: false });
      if (status === "draft") legacy = legacy.eq("type", "outbound");
      const res = await legacy;
      if (res.error) return [];
      const moves = (res.data ?? []).map((row) =>
        mapInventoryRow(row as Record<string, unknown>)
      );
      await attachInventoryFlags(moves);
      return moves;
    }
    throw new Error(error.message);
  }

  const moves = (data ?? []).map((row) =>
    mapInventoryRow(row as Record<string, unknown>)
  );
  await attachInventoryFlags(moves);
  return moves;
}

async function fetchFuelQueue(
  syncStatus: "pending_1c" | "synced",
  startIso: string,
  endIso: string
): Promise<AccountantQueueItem[]> {
  const supabase = createServiceSupabase();
  const startTs = `${startIso}T00:00:00.000Z`;
  const endExclusive = (() => {
    const [y, m, d] = endIso.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString();
  })();

  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(
      `
      id,
      transaction_type,
      amount_liters,
      price_per_liter,
      total_cost,
      transaction_date,
      sync_status,
      from_storage:fuel_storages!fuel_transactions_from_storage_id_fkey ( name ),
      to_storage:fuel_storages!fuel_transactions_to_storage_id_fkey ( name )
    `
    )
    .eq("sync_status", syncStatus)
    .in("transaction_type", ["inbound", "transfer"])
    .gte("transaction_date", startTs)
    .lt("transaction_date", endExclusive)
    .order("transaction_date", { ascending: false });

  if (error) {
    // Простіший join, якщо FK-імена інші
    if (
      error.message?.includes("fuel_storages") ||
      error.code === "PGRST200" ||
      error.code === "42703"
    ) {
      const simple = await supabase
        .from("fuel_transactions")
        .select(
          "id, transaction_type, amount_liters, price_per_liter, total_cost, transaction_date, sync_status, from_storage_id, to_storage_id"
        )
        .eq("sync_status", syncStatus)
        .in("transaction_type", ["inbound", "transfer"])
        .gte("transaction_date", startTs)
        .lt("transaction_date", endExclusive)
        .order("transaction_date", { ascending: false });
      if (simple.error) return [];
      const storageIds = [
        ...new Set(
          (simple.data ?? []).flatMap((r) =>
            [r.from_storage_id, r.to_storage_id]
              .filter(Boolean)
              .map((id) => String(id))
          )
        ),
      ];
      const nameById = new Map<string, string>();
      if (storageIds.length > 0) {
        const { data: storages } = await supabase
          .from("fuel_storages")
          .select("id, name")
          .in("id", storageIds);
        for (const s of storages ?? []) {
          nameById.set(String(s.id), String(s.name ?? ""));
        }
      }
      return (simple.data ?? []).map((row) => {
        const liters = Number(row.amount_liters) || 0;
        const price =
          row.price_per_liter != null && Number.isFinite(Number(row.price_per_liter))
            ? Number(row.price_per_liter)
            : null;
        const total =
          row.total_cost != null && Number.isFinite(Number(row.total_cost))
            ? Number(row.total_cost)
            : price != null
              ? Math.round(liters * price * 100) / 100
              : null;
        const kind =
          row.transaction_type === "transfer"
            ? ("fuel_transfer" as const)
            : ("fuel_inbound" as const);
        const fromName = row.from_storage_id
          ? nameById.get(String(row.from_storage_id)) ?? null
          : null;
        const toName = row.to_storage_id
          ? nameById.get(String(row.to_storage_id)) ?? null
          : null;
        return {
          id: String(row.id),
          source: "fuel" as const,
          kind,
          date: String(row.transaction_date).slice(0, 10),
          season: null,
          title: kind === "fuel_transfer" ? "Переміщення ДТ" : "Закупівля ДТ",
          party:
            kind === "fuel_transfer"
              ? [fromName, toName].filter(Boolean).join(" → ") || null
              : toName,
          qty: liters,
          unit: "л",
          amountUah: total,
          hasAttachment: false,
          isLocalItem: false,
          category: null,
          note: null,
          basRefKey: null,
          fieldId: null,
          fieldName: null,
          buyerName: null,
          unitPriceUah: price,
          fromStorageName: fromName,
          toStorageName: toName,
          pricePerLiter: price,
        };
      });
    }
    return [];
  }

  const items: AccountantQueueItem[] = (data ?? []).map((row) => {
    const liters = Number(row.amount_liters) || 0;
    const price =
      row.price_per_liter != null && Number.isFinite(Number(row.price_per_liter))
        ? Number(row.price_per_liter)
        : null;
    const total =
      row.total_cost != null && Number.isFinite(Number(row.total_cost))
        ? Number(row.total_cost)
        : price != null
          ? Math.round(liters * price * 100) / 100
          : null;
    const kind =
      row.transaction_type === "transfer"
        ? ("fuel_transfer" as const)
        : ("fuel_inbound" as const);
    const from = unwrapJoin(
      row.from_storage as { name?: string } | { name?: string }[] | null
    );
    const to = unwrapJoin(
      row.to_storage as { name?: string } | { name?: string }[] | null
    );
    const fromName = from?.name ? String(from.name) : null;
    const toName = to?.name ? String(to.name) : null;
    return {
      id: String(row.id),
      source: "fuel" as const,
      kind,
      date: String(row.transaction_date).slice(0, 10),
      season: null,
      title: kind === "fuel_transfer" ? "Переміщення ДТ" : "Закупівля ДТ",
      party:
        kind === "fuel_transfer"
          ? [fromName, toName].filter(Boolean).join(" → ") || null
          : toName,
      qty: liters,
      unit: "л",
      amountUah: total,
      hasAttachment: false,
      isLocalItem: false,
      category: null,
      note: null,
      basRefKey: null,
      fieldId: null,
      fieldName: null,
      buyerName: null,
      unitPriceUah: price,
      fromStorageName: fromName,
      toStorageName: toName,
      pricePerLiter: price,
    };
  });

  if (items.length > 0) {
    try {
      const ids = items.map((i) => i.id);
      const { data: atts } = await supabase
        .from("operation_attachments")
        .select("entity_id")
        .eq("entity_type", "fuel_transaction")
        .in("entity_id", ids);
      const withFile = new Set((atts ?? []).map((a) => String(a.entity_id)));
      for (const item of items) {
        if (withFile.has(item.id)) item.hasAttachment = true;
      }
    } catch {
      /* ignore */
    }
  }

  return items;
}

function buildStats(items: AccountantQueueItem[]): AccountantQueueStats {
  let outbound = 0;
  let inbound = 0;
  let sale = 0;
  let fuel = 0;
  let amountUah = 0;
  let withoutAttachment = 0;
  let newItems = 0;
  let fuelWithoutPrice = 0;

  for (const item of items) {
    if (item.kind === "outbound") outbound += 1;
    else if (item.kind === "inbound") inbound += 1;
    else if (item.kind === "sale") sale += 1;
    else fuel += 1;

    if (item.amountUah != null) amountUah += item.amountUah;
    if (!item.hasAttachment) withoutAttachment += 1;
    if (item.isLocalItem) newItems += 1;
    if (
      (item.kind === "fuel_inbound" || item.kind === "fuel_transfer") &&
      (item.pricePerLiter == null || item.pricePerLiter <= 0)
    ) {
      fuelWithoutPrice += 1;
    }
  }

  return {
    total: items.length,
    outbound,
    inbound,
    sale,
    fuel,
    amountUah: Math.round(amountUah),
    withoutAttachment,
    newItems,
    fuelWithoutPrice,
  };
}

/**
 * Черга бухгалтера: draft складу за сезоном + паливо pending у вікні сезону.
 */
export async function listAccountantQueue(input?: {
  season?: string;
  /** Якщо задано — додатково обрізати за датами (yyyy-MM-dd) */
  startIso?: string;
  endIso?: string;
}): Promise<
  ActionResult<{ items: AccountantQueueItem[]; stats: AccountantQueueStats }>
> {
  try {
    const year = seasonYearFromInput(input?.season);
    const season = String(year);
    const full = getSeasonRange(year);
    const startIso = input?.startIso ?? full.startIso;
    const endIso = input?.endIso ?? full.endIso;

    const [moves, fuel] = await Promise.all([
      fetchInventoryMoves("draft", season),
      fetchFuelQueue("pending_1c", startIso, endIso),
    ]);

    const inventoryItems = moves
      .filter((m) => inDateRange(m.date, startIso, endIso))
      .map(inventoryToQueueItem);

    // Паливу підставляємо сезон для відображення
    for (const f of fuel) f.season = season;

    const items = [...inventoryItems, ...fuel].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    return { ok: true, data: { items, stats: buildStats(items) } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити чергу бухгалтера",
    };
  }
}

/** Історія переданих за сезон. */
export async function listAccountantHistory(input?: {
  season?: string;
}): Promise<ActionResult<AccountantQueueItem[]>> {
  try {
    const year = seasonYearFromInput(input?.season);
    const season = String(year);
    const full = getSeasonRange(year);

    const [moves, fuel] = await Promise.all([
      fetchInventoryMoves("sent_to_1c", season),
      fetchFuelQueue("synced", full.startIso, full.endIso),
    ]);

    for (const f of fuel) f.season = season;

    const items = [
      ...moves.map(inventoryToQueueItem),
      ...fuel,
    ].sort((a, b) => b.date.localeCompare(a.date));

    return { ok: true, data: items };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити історію",
    };
  }
}

/** @deprecated — використовуй listAccountantQueue */
export async function listDraftMovesForExport(): Promise<
  ActionResult<DraftExportMove[]>
> {
  try {
    const moves = await fetchInventoryMoves("draft", null);
    return { ok: true, data: moves };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити чернетки",
    };
  }
}

/** Після Excel — позначити рухи складу як передані. */
export async function markMovesSentTo1c(
  moveIds: string[]
): Promise<ActionResult<{ updated: number }>> {
  const ids = [...new Set(moveIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { ok: false, error: "Немає рухів для оновлення" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .update({
        status: "sent_to_1c",
        updated_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("status", "draft")
      .select("id");

    if (error) return { ok: false, error: error.message };

    revalidatePath("/export");
    revalidatePath("/inventory");
    return { ok: true, data: { updated: data?.length ?? 0 } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося оновити статус рухів",
    };
  }
}

/** Паливо: локально «підготовлено / передано бухгалтеру» (без BAS). */
export async function markFuelPrepared(
  transactionIds: string[]
): Promise<ActionResult<{ updated: number }>> {
  const ids = [
    ...new Set(transactionIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "Немає операцій палива" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("fuel_transactions")
      .update({ sync_status: "synced" })
      .in("id", ids)
      .eq("sync_status", "pending_1c")
      .in("transaction_type", ["inbound", "transfer"])
      .select("id");

    if (error) return { ok: false, error: error.message };

    revalidatePath("/export");
    revalidatePath("/fuel");
    return { ok: true, data: { updated: data?.length ?? 0 } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося оновити статус палива",
    };
  }
}

/** Позначити вибрані пункти черги (склад + паливо). */
export async function markAccountantQueuePrepared(
  items: Array<{ id: string; source: "inventory" | "fuel" }>
): Promise<ActionResult<{ inventory: number; fuel: number }>> {
  const invIds = items
    .filter((i) => i.source === "inventory")
    .map((i) => i.id);
  const fuelIds = items.filter((i) => i.source === "fuel").map((i) => i.id);

  let inventory = 0;
  let fuel = 0;

  if (invIds.length > 0) {
    const res = await markMovesSentTo1c(invIds);
    if (!res.ok) return res;
    inventory = res.data.updated;
  }
  if (fuelIds.length > 0) {
    const res = await markFuelPrepared(fuelIds);
    if (!res.ok) return res;
    fuel = res.data.updated;
  }

  return { ok: true, data: { inventory, fuel } };
}

export function accountantQueueItemToDraftMove(
  item: AccountantQueueItem
): DraftExportMove | null {
  if (item.source !== "inventory") return null;
  if (
    item.kind !== "outbound" &&
    item.kind !== "inbound" &&
    item.kind !== "sale"
  ) {
    return null;
  }
  return {
    id: item.id,
    date: item.date,
    qty: item.qty,
    type: item.kind,
    basRefKey: item.basRefKey ?? "",
    itemName: item.title,
    unit: item.unit,
    category: item.category,
    season: item.season,
    fieldId: item.fieldId,
    fieldName: item.fieldName,
    note: item.note,
    buyerName: item.buyerName,
    unitPriceUah: item.unitPriceUah,
    isLocalItem: item.isLocalItem,
    hasAttachment: item.hasAttachment,
  };
}

/** Хелпер: сьогоднішня дата Kyiv як ISO. */
export async function getAccountantTodayIso(): Promise<string> {
  const { year, month, day } = kyivYmd();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

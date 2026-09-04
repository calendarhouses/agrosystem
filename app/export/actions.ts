"use server";

import { revalidatePath } from "next/cache";

import { getSeasonRange } from "@/lib/finance-period";
import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
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
  fieldBasRefKey: string | null;
  note: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  isLocalItem: boolean;
  hasAttachment: boolean;
  /** Ref_Key чернетки в BAS (окремо від Excel sent_to_1c) */
  basDraftRefKey: string | null;
};

export type AccountantQueueTab =
  | "all"
  | "outbound"
  | "inbound"
  | "sale"
  | "fuel"
  | "acts";

export type AccountantQueueItem = {
  id: string;
  source: "inventory" | "fuel" | "service_act";
  /** UI-тип */
  kind:
    | "outbound"
    | "inbound"
    | "sale"
    | "fuel_inbound"
    | "fuel_transfer"
    | "service_act";
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
  /** true якщо вже є непроведена чернетка в BAS */
  basDraftSent: boolean;
  basDraftRefKey: string | null;
  /** inventory */
  basRefKey: string | null;
  fieldId: string | null;
  fieldName: string | null;
  fieldBasRefKey: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  /** fuel */
  fromStorageName: string | null;
  toStorageName: string | null;
  fromStorageBasRefKey: string | null;
  toStorageBasRefKey: string | null;
  /** stationary = цистерна, mobile = бензовоз */
  fromStorageType: "stationary" | "mobile" | "other" | null;
  toStorageType: "stationary" | "mobile" | "other" | null;
  pricePerLiter: number | null;
};

function mapFuelStorageType(
  raw: unknown
): "stationary" | "mobile" | "other" | null {
  if (raw == null) return null;
  const t = String(raw);
  if (t === "stationary" || t === "mobile") return t;
  return "other";
}

export type AccountantQueueStats = {
  total: number;
  outbound: number;
  inbound: number;
  sale: number;
  fuel: number;
  acts: number;
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
      | { id: string; name: string; bas_ref_key?: string | null }
      | { id: string; name: string; bas_ref_key?: string | null }[]
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
    fieldBasRefKey:
      field?.bas_ref_key != null && String(field.bas_ref_key).trim()
        ? String(field.bas_ref_key).toLowerCase()
        : null,
    note: typeof row.note === "string" ? String(row.note) : null,
    buyerName:
      typeof row.buyer_name === "string" ? String(row.buyer_name) : null,
    unitPriceUah,
    isLocalItem: cache?.is_local === true,
    hasAttachment: false,
    basDraftRefKey:
      row.bas_draft_ref_key != null && String(row.bas_draft_ref_key).trim()
        ? String(row.bas_draft_ref_key).toLowerCase()
        : null,
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
    basDraftSent: Boolean(m.basDraftRefKey),
    basDraftRefKey: m.basDraftRefKey,
    basRefKey: m.basRefKey,
    fieldId: m.fieldId,
    fieldName: m.fieldName,
    fieldBasRefKey: m.fieldBasRefKey,
    buyerName: m.buyerName,
    unitPriceUah: m.unitPriceUah,
    fromStorageName: null,
    toStorageName: null,
    fromStorageBasRefKey: null,
    toStorageBasRefKey: null,
    fromStorageType: null,
    toStorageType: null,
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
      bas_draft_ref_key,
      farm_fields ( id, name, bas_ref_key ),
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
      bas_draft_ref_key,
      from_storage:fuel_storages!fuel_transactions_from_storage_id_fkey ( name, bas_ref_key, type ),
      to_storage:fuel_storages!fuel_transactions_to_storage_id_fkey ( name, bas_ref_key, type )
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
      const basById = new Map<string, string | null>();
      const typeById = new Map<
        string,
        "stationary" | "mobile" | "other" | null
      >();
      if (storageIds.length > 0) {
        const { data: storages } = await supabase
          .from("fuel_storages")
          .select("id, name, bas_ref_key, type")
          .in("id", storageIds);
        for (const s of storages ?? []) {
          nameById.set(String(s.id), String(s.name ?? ""));
          basById.set(
            String(s.id),
            s.bas_ref_key != null && String(s.bas_ref_key).trim()
              ? String(s.bas_ref_key).toLowerCase()
              : null
          );
          typeById.set(String(s.id), mapFuelStorageType(s.type));
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
          title: kind === "fuel_transfer" ? "Переміщення ДП" : "Закупівля ДП",
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
          basDraftSent: false,
          basDraftRefKey: null,
          basRefKey: null,
          fieldId: null,
          fieldName: null,
          fieldBasRefKey: null,
          buyerName: null,
          unitPriceUah: price,
          fromStorageName: fromName,
          toStorageName: toName,
          fromStorageBasRefKey: row.from_storage_id
            ? basById.get(String(row.from_storage_id)) ?? null
            : null,
          toStorageBasRefKey: row.to_storage_id
            ? basById.get(String(row.to_storage_id)) ?? null
            : null,
          fromStorageType: row.from_storage_id
            ? typeById.get(String(row.from_storage_id)) ?? null
            : null,
          toStorageType: row.to_storage_id
            ? typeById.get(String(row.to_storage_id)) ?? null
            : null,
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
      row.from_storage as
        | { name?: string; bas_ref_key?: string | null; type?: string | null }
        | {
            name?: string;
            bas_ref_key?: string | null;
            type?: string | null;
          }[]
        | null
    );
    const to = unwrapJoin(
      row.to_storage as
        | { name?: string; bas_ref_key?: string | null; type?: string | null }
        | {
            name?: string;
            bas_ref_key?: string | null;
            type?: string | null;
          }[]
        | null
    );
    const fromName = from?.name ? String(from.name) : null;
    const toName = to?.name ? String(to.name) : null;
    const draftRef =
      row.bas_draft_ref_key != null && String(row.bas_draft_ref_key).trim()
        ? String(row.bas_draft_ref_key).toLowerCase()
        : null;
    return {
      id: String(row.id),
      source: "fuel" as const,
      kind,
      date: String(row.transaction_date).slice(0, 10),
      season: null,
      title: kind === "fuel_transfer" ? "Переміщення ДП" : "Закупівля ДП",
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
      basDraftSent: Boolean(draftRef),
      basDraftRefKey: draftRef,
      basRefKey: null,
      fieldId: null,
      fieldName: null,
      fieldBasRefKey: null,
      buyerName: null,
      unitPriceUah: price,
      fromStorageName: fromName,
      toStorageName: toName,
      fromStorageBasRefKey:
        from?.bas_ref_key != null && String(from.bas_ref_key).trim()
          ? String(from.bas_ref_key).toLowerCase()
          : null,
      toStorageBasRefKey:
        to?.bas_ref_key != null && String(to.bas_ref_key).trim()
          ? String(to.bas_ref_key).toLowerCase()
          : null,
      fromStorageType: mapFuelStorageType(from?.type),
      toStorageType: mapFuelStorageType(to?.type),
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
  let acts = 0;
  let amountUah = 0;
  let withoutAttachment = 0;
  let newItems = 0;
  let fuelWithoutPrice = 0;

  for (const item of items) {
    if (item.kind === "outbound") outbound += 1;
    else if (item.kind === "inbound") inbound += 1;
    else if (item.kind === "sale") sale += 1;
    else if (item.kind === "service_act") acts += 1;
    else if (item.kind === "fuel_inbound" || item.kind === "fuel_transfer") {
      fuel += 1;
    }

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
    acts,
    amountUah: Math.round(amountUah),
    withoutAttachment,
    newItems,
    fuelWithoutPrice,
  };
}

async function fetchServiceActs(
  startIso: string,
  endIso: string,
  status: "posted" | "sent_to_1c" = "posted"
): Promise<AccountantQueueItem[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("accounting_acts")
    .select(
      "id, act_number, act_date, contractor_name, contractor_edrpou, category, total_amount, vat_amount, services, equipment_id, equipment_name_hint, status, created_at"
    )
    .eq("status", status)
    .order("act_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("accounting_acts")
    ) {
      return [];
    }
    throw new Error(error.message);
  }

  const items: AccountantQueueItem[] = [];
  for (const row of data ?? []) {
    const dateRaw =
      (typeof row.act_date === "string" && row.act_date) ||
      (typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "");
    if (!dateRaw || !inDateRange(dateRaw, startIso, endIso)) continue;

    const services = Array.isArray(row.services) ? row.services : [];
    const firstService =
      services[0] && typeof services[0] === "object"
        ? String((services[0] as { name?: unknown }).name ?? "").trim()
        : "";
    const equipmentName =
      (typeof row.equipment_name_hint === "string"
        ? row.equipment_name_hint.trim()
        : "") || null;

    const actNumber =
      typeof row.act_number === "string" && row.act_number.trim()
        ? row.act_number.trim()
        : null;
    const contractor =
      typeof row.contractor_name === "string" && row.contractor_name.trim()
        ? row.contractor_name.trim()
        : "Виконавець";
    const category =
      typeof row.category === "string" ? row.category : "Адміністративні";
    const total =
      row.total_amount != null && Number.isFinite(Number(row.total_amount))
        ? Number(row.total_amount)
        : null;

    items.push({
      id: String(row.id),
      source: "service_act",
      kind: "service_act",
      date: dateRaw.slice(0, 10),
      season: null,
      title: firstService || category,
      party: contractor,
      qty: services.length > 0 ? services.length : 1,
      unit: "послуга",
      amountUah: total,
      hasAttachment: false,
      isLocalItem: false,
      category,
      note: [
        actNumber ? `№${actNumber}` : null,
        equipmentName ? `→ ${equipmentName}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      basDraftSent: false,
      basDraftRefKey: null,
      basRefKey: null,
      fieldId: null,
      fieldName: null,
      fieldBasRefKey: null,
      buyerName: contractor,
      unitPriceUah: null,
      fromStorageName: null,
      toStorageName: null,
      fromStorageBasRefKey: null,
      toStorageBasRefKey: null,
      fromStorageType: null,
      toStorageType: null,
      pricePerLiter: null,
    });
  }

  if (items.length > 0) {
    try {
      const ids = items.map((i) => i.id);
      const { data: atts } = await supabase
        .from("operation_attachments")
        .select("entity_id")
        .eq("entity_type", "accounting_act")
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

async function fetchServiceActsArchive(
  startIso: string,
  endIso: string
): Promise<AccountantQueueItem[]> {
  return fetchServiceActs(startIso, endIso, "sent_to_1c");
}

/**
 * Черга бухгалтера: draft складу за сезоном + паливо pending у вікні сезону + акти послуг.
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

    const [moves, fuel, acts] = await Promise.all([
      fetchInventoryMoves("draft", season),
      fetchFuelQueue("pending_1c", startIso, endIso),
      fetchServiceActs(startIso, endIso),
    ]);

    const inventoryItems = moves
      .filter((m) => inDateRange(m.date, startIso, endIso))
      .map(inventoryToQueueItem);

    // Паливу й актам підставляємо сезон для відображення / архіву
    for (const f of fuel) f.season = season;
    for (const a of acts) a.season = season;

    const items = [...inventoryItems, ...fuel, ...acts].sort((a, b) =>
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

    revalidatePath("/accounting");
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

    revalidatePath("/accounting");
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

/** Позначити вибрані пункти черги (склад + паливо + акти). */
export async function markAccountantQueuePrepared(
  items: Array<{ id: string; source: "inventory" | "fuel" | "service_act" }>
): Promise<ActionResult<{ inventory: number; fuel: number; acts: number }>> {
  const invIds = items
    .filter((i) => i.source === "inventory")
    .map((i) => i.id);
  const fuelIds = items.filter((i) => i.source === "fuel").map((i) => i.id);
  const actIds = items
    .filter((i) => i.source === "service_act")
    .map((i) => i.id);

  let inventory = 0;
  let fuel = 0;
  let acts = 0;

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
  if (actIds.length > 0) {
    const res = await markServiceActsPrepared(actIds);
    if (!res.ok) return res;
    acts = res.data.updated;
  }

  const actor = await getCurrentActor();
  await logActivity({
    actor,
    action: "export",
    entityType: "accountant_queue",
    summary: `${actor.label} позначив переданими ${inventory + fuel + acts} операцій`,
    meta: { inventory, fuel, acts },
  });

  return { ok: true, data: { inventory, fuel, acts } };
}

async function markServiceActsPrepared(
  ids: string[]
): Promise<ActionResult<{ updated: number }>> {
  if (ids.length === 0) return { ok: true, data: { updated: 0 } };
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("accounting_acts")
    .update({ status: "sent_to_1c" })
    .in("id", ids)
    .eq("status", "posted")
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: data?.length ?? 0 } };
}

/** Скасувати акт послуг (прибрати з черги). */
export async function cancelServiceAct(
  id: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("accounting_acts")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { id } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося скасувати акт",
    };
  }
}

export type AccountantArchiveItem = AccountantQueueItem & {
  archiveId: string;
  eventType: "transferred" | "deleted";
  eventAt: string;
  actorName: string | null;
};

async function resolveActorName(): Promise<{
  actorId: string | null;
  actorName: string;
}> {
  const actor = await getCurrentActor();
  return {
    actorId: actor.id || null,
    actorName: actor.label,
  };
}

/** Записати видалення в архів (перед фізичним delete). */
export async function archiveAccountantDeletion(
  item: AccountantQueueItem
): Promise<ActionResult<{ archiveId: string }>> {
  try {
    const { actorId, actorName } = await resolveActorName();
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("accountant_operation_archive")
      .insert({
        season: item.season,
        source: item.source,
        original_id: item.id,
        kind: item.kind,
        event_type: "deleted",
        title: item.title,
        party: item.party,
        qty: item.qty,
        unit: item.unit,
        amount_uah: item.amountUah,
        snapshot: item,
        actor_id: actorId,
        actor_name: actorName,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { archiveId: String(data.id) } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося записати в архів",
    };
  }
}

/** Архів сезону: передані + видалені. */
export async function listAccountantArchive(input?: {
  season?: string;
}): Promise<ActionResult<AccountantArchiveItem[]>> {
  try {
    const year = seasonYearFromInput(input?.season);
    const season = String(year);
    const full = getSeasonRange(year);

    const [moves, fuel, acts, deletedRes] = await Promise.all([
      fetchInventoryMoves("sent_to_1c", season),
      fetchFuelQueue("synced", full.startIso, full.endIso),
      fetchServiceActsArchive(full.startIso, full.endIso),
      (async () => {
        try {
          const supabase = createServiceSupabase();
          return await supabase
            .from("accountant_operation_archive")
            .select("*")
            .eq("season", season)
            .eq("event_type", "deleted")
            .order("created_at", { ascending: false })
            .limit(200);
        } catch {
          return { data: null, error: { message: "skip" } };
        }
      })(),
    ]);

    for (const f of fuel) f.season = season;

    const transferred: AccountantArchiveItem[] = [
      ...moves.map(inventoryToQueueItem),
      ...fuel,
      ...acts,
    ].map((item) => ({
      ...item,
      archiveId: `t-${item.source}-${item.id}`,
      eventType: "transferred" as const,
      eventAt: item.date,
      actorName: null,
    }));

    const deleted: AccountantArchiveItem[] = [];
    if (!deletedRes.error && Array.isArray(deletedRes.data)) {
      for (const row of deletedRes.data) {
        const snap = (row.snapshot ?? {}) as Partial<AccountantQueueItem>;
        const sourceRaw = String(row.source ?? snap.source ?? "inventory");
        const source: AccountantQueueItem["source"] =
          sourceRaw === "fuel"
            ? "fuel"
            : sourceRaw === "service_act"
              ? "service_act"
              : "inventory";
        deleted.push({
          id: String(row.original_id ?? row.id),
          source,
          kind: (snap.kind as AccountantQueueItem["kind"]) ||
            (String(row.kind) as AccountantQueueItem["kind"]),
          date: String(snap.date ?? row.created_at).slice(0, 10),
          season: row.season ? String(row.season) : season,
          title: String(row.title ?? snap.title ?? "Операція"),
          party:
            (row.party as string | null) ??
            (snap.party as string | null) ??
            null,
          qty: Number(row.qty ?? snap.qty) || 0,
          unit: String(row.unit ?? snap.unit ?? ""),
          amountUah:
            row.amount_uah != null
              ? Number(row.amount_uah)
              : snap.amountUah ?? null,
          hasAttachment: false,
          isLocalItem: Boolean(snap.isLocalItem),
          category: snap.category ?? null,
          note: snap.note ?? null,
          basDraftSent: Boolean(snap.basDraftSent ?? snap.basDraftRefKey),
          basDraftRefKey: snap.basDraftRefKey ?? null,
          basRefKey: snap.basRefKey ?? null,
          fieldId: snap.fieldId ?? null,
          fieldName: snap.fieldName ?? null,
          fieldBasRefKey: snap.fieldBasRefKey ?? null,
          buyerName: snap.buyerName ?? null,
          unitPriceUah: snap.unitPriceUah ?? null,
          fromStorageName: snap.fromStorageName ?? null,
          toStorageName: snap.toStorageName ?? null,
          fromStorageBasRefKey: snap.fromStorageBasRefKey ?? null,
          toStorageBasRefKey: snap.toStorageBasRefKey ?? null,
          fromStorageType: snap.fromStorageType ?? null,
          toStorageType: snap.toStorageType ?? null,
          pricePerLiter: snap.pricePerLiter ?? null,
          archiveId: String(row.id),
          eventType: "deleted",
          eventAt: String(row.created_at),
          actorName:
            typeof row.actor_name === "string" ? row.actor_name : null,
        });
      }
    }

    const items = [...deleted, ...transferred].sort((a, b) =>
      b.eventAt.localeCompare(a.eventAt)
    );

    return { ok: true, data: items };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити архів",
    };
  }
}

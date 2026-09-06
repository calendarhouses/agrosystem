/**
 * LEVADIUS · Бухгалтерія P0: черга, статуси, Excel-пакет, реєстр актів.
 *
 * Статуси в БД:
 * - inventory_local_moves: draft | sent_to_1c
 * - fuel_transactions.sync_status: pending_1c | synced
 * - accounting_acts: posted | sent_to_1c | …
 *
 * Agent «new» / «prepared» → активна черга (draft/pending/posted).
 * «prepared» при mark — soft (документи лишаються в черзі, готові до Excel).
 * «sent_to_1c» → markAccountantQueuePrepared (як UI «Позначити переданими»).
 */

import "server-only";

import {
  listAccountantHistory,
  listAccountantQueue,
  markAccountantQueuePrepared,
  type AccountantQueueItem,
} from "@/app/export/actions";
import { getSeasonRange } from "@/lib/finance-period";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { currentAgroSeason, DEFAULT_SEASON, normalizeSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgentQueueStatus = "all" | "new" | "prepared" | "sent_to_1c";
export type AgentQueueDocType =
  | "all"
  | "inventory_write_off"
  | "fuel_dispense"
  | "service_act"
  | "inventory_sale"
  | "fuel_purchase"
  | "inventory_inbound"
  | "fuel_transfer";

export type AgentAccountantDocument = {
  id: string;
  date: string;
  docType: Exclude<AgentQueueDocType, "all">;
  title: string;
  amountOrQty: number;
  unit: string;
  priceTotalUah: number | null;
  counterpartyOrField: string | null;
  equipmentName: string | null;
  status: "new" | "prepared" | "sent_to_1c";
  basRefKey: string | null;
  source: AccountantQueueItem["source"];
  kind: AccountantQueueItem["kind"];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function periodBounds(
  period: "all" | "today" | "week" | "month" | "season" | "custom",
  customFrom?: string | null,
  customTo?: string | null
): { startIso: string; endIso: string; season: string } {
  const season = currentAgroSeason() || DEFAULT_SEASON;
  const seasonRange = getSeasonRange(Number(normalizeSeason(season)));
  const today = todayKyivYmd();

  if (period === "season" || period === "all") {
    return {
      startIso: seasonRange.startIso,
      endIso: seasonRange.endIso,
      season,
    };
  }
  if (period === "today") {
    return { startIso: today, endIso: today, season };
  }
  if (period === "week") {
    return { startIso: shiftKyivYmd(today, -6), endIso: today, season };
  }
  if (period === "month") {
    return { startIso: shiftKyivYmd(today, -29), endIso: today, season };
  }
  const from = customFrom?.slice(0, 10) || seasonRange.startIso;
  const to = customTo?.slice(0, 10) || today;
  return { startIso: from, endIso: to, season };
}

function kindToDocType(
  kind: AccountantQueueItem["kind"]
): Exclude<AgentQueueDocType, "all"> {
  if (kind === "outbound") return "inventory_write_off";
  if (kind === "sale") return "inventory_sale";
  if (kind === "inbound") return "inventory_inbound";
  if (kind === "fuel_inbound") return "fuel_purchase";
  if (kind === "fuel_outbound") return "fuel_dispense";
  if (kind === "fuel_transfer") return "fuel_transfer";
  return "service_act";
}

function mapQueueItem(
  item: AccountantQueueItem,
  queueStatus: "new" | "prepared" | "sent_to_1c"
): AgentAccountantDocument {
  const equipmentName =
    item.kind === "service_act" && item.note?.includes("→")
      ? item.note.split("→").pop()?.trim() || null
      : null;

  return {
    id: item.id,
    date: item.date,
    docType: kindToDocType(item.kind),
    title: item.title,
    amountOrQty: item.qty,
    unit: item.unit,
    priceTotalUah: item.amountUah,
    counterpartyOrField: item.party,
    equipmentName,
    status: queueStatus,
    basRefKey: item.basRefKey ?? item.basDraftRefKey,
    source: item.source,
    kind: item.kind,
  };
}

async function fetchFuelOutboundQueue(
  syncStatus: "pending_1c" | "synced",
  startIso: string,
  endIso: string
): Promise<AccountantQueueItem[]> {
  const supabase = createServiceSupabase();
  const startTs = `${startIso}T00:00:00.000Z`;
  const endExclusive = (() => {
    const [y, m, d] = endIso.split("-").map(Number);
    const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
    return next.toISOString();
  })();

  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(
      `
      id,
      amount_liters,
      price_per_liter,
      total_cost,
      transaction_date,
      sync_status,
      operator_name,
      from_storage:fuel_storages!fuel_transactions_from_storage_id_fkey ( name ),
      equipment:equipment!fuel_transactions_equipment_id_fkey ( name )
    `
    )
    .eq("sync_status", syncStatus)
    .eq("transaction_type", "outbound")
    .gte("transaction_date", startTs)
    .lt("transaction_date", endExclusive)
    .order("transaction_date", { ascending: false })
    .limit(400);

  if (error) {
    // fallback без joins
    const simple = await supabase
      .from("fuel_transactions")
      .select(
        "id, amount_liters, price_per_liter, total_cost, transaction_date, sync_status, from_storage_id, equipment_id, operator_name"
      )
      .eq("sync_status", syncStatus)
      .eq("transaction_type", "outbound")
      .gte("transaction_date", startTs)
      .lt("transaction_date", endExclusive)
      .order("transaction_date", { ascending: false })
      .limit(400);
    if (simple.error || !simple.data) return [];
    return simple.data.map((row) => {
      const liters = Number(row.amount_liters) || 0;
      const price =
        row.price_per_liter != null && Number.isFinite(Number(row.price_per_liter))
          ? Number(row.price_per_liter)
          : null;
      const total =
        row.total_cost != null && Number.isFinite(Number(row.total_cost))
          ? Number(row.total_cost)
          : price != null
            ? round2(liters * price)
            : null;
      return {
        id: String(row.id),
        source: "fuel" as const,
        kind: "fuel_outbound" as const,
        date: String(row.transaction_date).slice(0, 10),
        season: null,
        title: "Роздача ДП",
        party: null,
        qty: liters,
        unit: "л",
        amountUah: total,
        hasAttachment: false,
        isLocalItem: false,
        category: null,
        note: typeof row.operator_name === "string" ? row.operator_name : null,
        basDraftSent: false,
        basDraftRefKey: null,
        basRefKey: null,
        fieldId: null,
        fieldName: null,
        fieldBasRefKey: null,
        buyerName: null,
        unitPriceUah: price,
        fromStorageName: null,
        toStorageName: null,
        fromStorageBasRefKey: null,
        toStorageBasRefKey: null,
        fromStorageType: null,
        toStorageType: null,
        pricePerLiter: price,
      };
    });
  }

  return (data ?? []).map((row) => {
    const liters = Number(row.amount_liters) || 0;
    const price =
      row.price_per_liter != null && Number.isFinite(Number(row.price_per_liter))
        ? Number(row.price_per_liter)
        : null;
    const total =
      row.total_cost != null && Number.isFinite(Number(row.total_cost))
        ? Number(row.total_cost)
        : price != null
          ? round2(liters * price)
          : null;
    const from = Array.isArray(row.from_storage)
      ? row.from_storage[0]
      : row.from_storage;
    const eq = Array.isArray(row.equipment) ? row.equipment[0] : row.equipment;
    const fromName =
      from && typeof from === "object" && "name" in from
        ? String((from as { name?: unknown }).name ?? "") || null
        : null;
    const eqName =
      eq && typeof eq === "object" && "name" in eq
        ? String((eq as { name?: unknown }).name ?? "") || null
        : null;

    return {
      id: String(row.id),
      source: "fuel" as const,
      kind: "fuel_outbound" as const,
      date: String(row.transaction_date).slice(0, 10),
      season: null,
      title: eqName ? `Заправка · ${eqName}` : "Роздача ДП",
      party: [fromName, eqName].filter(Boolean).join(" → ") || fromName,
      qty: liters,
      unit: "л",
      amountUah: total,
      hasAttachment: false,
      isLocalItem: false,
      category: null,
      note: eqName,
      basDraftSent: false,
      basDraftRefKey: null,
      basRefKey: null,
      fieldId: null,
      fieldName: null,
      fieldBasRefKey: null,
      buyerName: null,
      unitPriceUah: price,
      fromStorageName: fromName,
      toStorageName: null,
      fromStorageBasRefKey: null,
      toStorageBasRefKey: null,
      fromStorageType: null,
      toStorageType: null,
      pricePerLiter: price,
    };
  });
}

function filterByDocType(
  items: AccountantQueueItem[],
  documentType: AgentQueueDocType
): AccountantQueueItem[] {
  if (documentType === "all") return items;
  return items.filter((i) => kindToDocType(i.kind) === documentType);
}

export async function listAgentAccountantQueue(params: {
  status?: AgentQueueStatus;
  documentType?: AgentQueueDocType;
  period?: "all" | "today" | "week" | "month" | "season";
  limit?: number;
}): Promise<
  | {
      ok: true;
      count: number;
      totalMatched: number;
      totalSumUah: number;
      documents: AgentAccountantDocument[];
    }
  | { ok: false; error: string }
> {
  const status = params.status ?? "new";
  const documentType = params.documentType ?? "all";
  const period = params.period ?? "all";
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 25)));
  const { startIso, endIso, season } = periodBounds(period);

  try {
    let raw: AccountantQueueItem[] = [];
    let queueStatus: "new" | "prepared" | "sent_to_1c" = "new";

    if (status === "sent_to_1c") {
      queueStatus = "sent_to_1c";
      const hist = await listAccountantHistory({ season });
      if (!hist.ok) return hist;
      raw = hist.data.filter(
        (i) => i.date >= startIso && i.date <= endIso
      );
      const fuelOut = await fetchFuelOutboundQueue(
        "synced",
        startIso,
        endIso
      );
      raw = [...raw, ...fuelOut];
    } else {
      // new + prepared + all → активна черга
      queueStatus = status === "prepared" ? "prepared" : "new";
      const queue = await listAccountantQueue({
        season,
        startIso,
        endIso,
      });
      if (!queue.ok) return queue;
      raw = queue.data.items;
      const fuelOut = await fetchFuelOutboundQueue(
        "pending_1c",
        startIso,
        endIso
      );
      raw = [...raw, ...fuelOut];

      if (status === "prepared") {
        // «Підготовлені» = у черзі з вкладенням або вже з BAS draft
        raw = raw.filter((i) => i.hasAttachment || i.basDraftSent);
      }
    }

    if (status === "all") {
      const hist = await listAccountantHistory({ season });
      const sent = hist.ok
        ? hist.data.filter((i) => i.date >= startIso && i.date <= endIso)
        : [];
      const fuelSynced = await fetchFuelOutboundQueue(
        "synced",
        startIso,
        endIso
      );
      const activeMapped = raw.map((i) =>
        mapQueueItem(i, i.basDraftSent || i.hasAttachment ? "prepared" : "new")
      );
      const sentMapped = [...sent, ...fuelSynced].map((i) =>
        mapQueueItem(i, "sent_to_1c")
      );
      let docs = [...activeMapped, ...sentMapped];
      if (documentType !== "all") {
        docs = docs.filter((d) => d.docType === documentType);
      }
      docs.sort((a, b) => b.date.localeCompare(a.date));
      const totalMatched = docs.length;
      const sliced = docs.slice(0, limit);
      const totalSumUah = round2(
        sliced.reduce((s, d) => s + (d.priceTotalUah ?? 0), 0)
      );
      return {
        ok: true,
        count: sliced.length,
        totalMatched,
        totalSumUah,
        documents: sliced,
      };
    }

    raw = filterByDocType(raw, documentType);
    raw.sort((a, b) => b.date.localeCompare(a.date));
    const totalMatched = raw.length;
    const sliced = raw.slice(0, limit);
    const documents = sliced.map((i) => mapQueueItem(i, queueStatus));
    const totalSumUah = round2(
      documents.reduce((s, d) => s + (d.priceTotalUah ?? 0), 0)
    );

    return {
      ok: true,
      count: documents.length,
      totalMatched,
      totalSumUah,
      documents,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити чергу бухгалтерії",
    };
  }
}

type ResolvedDoc = {
  id: string;
  source: "inventory" | "fuel" | "service_act";
  amountUah: number | null;
  title: string;
  currentStatus: "new" | "sent_to_1c";
};

async function resolveDocumentsByIds(
  documentIds: string[]
): Promise<ResolvedDoc[]> {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const supabase = createServiceSupabase();
  const found: ResolvedDoc[] = [];
  const remaining = new Set(ids);

  const { data: moves } = await supabase
    .from("inventory_local_moves")
    .select("id, status, qty, unit_price_uah, type, item_ref_key")
    .in("id", ids);
  for (const row of moves ?? []) {
    const id = String(row.id);
    remaining.delete(id);
    const qty = Number(row.qty) || 0;
    const price =
      row.unit_price_uah != null && Number.isFinite(Number(row.unit_price_uah))
        ? Number(row.unit_price_uah)
        : null;
    found.push({
      id,
      source: "inventory",
      amountUah: price != null ? round2(qty * price) : null,
      title: String(row.type ?? "inventory"),
      currentStatus:
        row.status === "sent_to_1c" ? "sent_to_1c" : "new",
    });
  }

  if (remaining.size > 0) {
    const { data: fuel } = await supabase
      .from("fuel_transactions")
      .select("id, sync_status, total_cost, amount_liters, transaction_type")
      .in("id", [...remaining]);
    for (const row of fuel ?? []) {
      const id = String(row.id);
      remaining.delete(id);
      found.push({
        id,
        source: "fuel",
        amountUah:
          row.total_cost != null && Number.isFinite(Number(row.total_cost))
            ? Number(row.total_cost)
            : null,
        title: String(row.transaction_type ?? "fuel"),
        currentStatus:
          row.sync_status === "synced" ? "sent_to_1c" : "new",
      });
    }
  }

  if (remaining.size > 0) {
    const { data: acts } = await supabase
      .from("accounting_acts")
      .select("id, status, total_amount, contractor_name, category")
      .in("id", [...remaining]);
    for (const row of acts ?? []) {
      const id = String(row.id);
      remaining.delete(id);
      found.push({
        id,
        source: "service_act",
        amountUah:
          row.total_amount != null && Number.isFinite(Number(row.total_amount))
            ? Number(row.total_amount)
            : null,
        title:
          (typeof row.contractor_name === "string" && row.contractor_name) ||
          String(row.category ?? "Акт"),
        currentStatus:
          row.status === "sent_to_1c" ? "sent_to_1c" : "new",
      });
    }
  }

  return found;
}

export async function markAgentQueueDocumentsStatus(params: {
  documentIds: string[];
  newStatus: "prepared" | "sent_to_1c" | "new";
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const ids = [
    ...new Set(params.documentIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const isConfirmed = params.confirmed === true;
  const newStatus = params.newStatus;

  if (ids.length === 0) {
    return {
      success: false,
      status: "error",
      error: "Передай documentIds.",
    };
  }

  const resolved = await resolveDocumentsByIds(ids);
  if (resolved.length === 0) {
    return {
      success: false,
      status: "not_found",
      error: "Жодного документа не знайдено за переданими ID.",
    };
  }

  const totalSumUah = round2(
    resolved.reduce((s, d) => s + (d.amountUah ?? 0), 0)
  );
  const missing = ids.length - resolved.length;

  if (!isConfirmed) {
    return {
      success: false,
      status: "requires_confirmation",
      kind: "accountant_queue_status",
      documentCount: resolved.length,
      missingIds: missing > 0 ? missing : 0,
      totalSumUah,
      newStatus,
      documentIds: resolved.map((d) => d.id),
      canConfirm: true,
      confirmChoice: `Підтвердити статус → ${newStatus}`,
      cancelChoice: "Скасувати",
      badge: "Бухгалтерія · статус",
      userHint:
        newStatus === "prepared"
          ? `Позначити ${resolved.length} док. як перевірені (prepared, лишаються в черзі)? Сума ≈ ${totalSumUah} ₴.`
          : newStatus === "sent_to_1c"
            ? `Позначити ${resolved.length} док. як відправлені в 1С? Сума ≈ ${totalSumUah} ₴.`
            : `Повернути ${resolved.length} док. у статус new (чернетка)?`,
      clientEvents: ["accounting-updated"],
    };
  }

  if (newStatus === "prepared") {
    // Soft: у БД немає окремого prepared — лишаємо в черзі.
    return {
      success: true,
      status: "prepared_ack",
      updatedCount: resolved.length,
      appliedStatus: "prepared" as const,
      note:
        "prepared — логічний статус готовності до Excel; у БД документи лишаються draft/pending/posted.",
      totalSumUah,
      message: `Позначив **${resolved.length}** документів як перевірені (prepared). Можна формувати Excel-пакет.`,
      clientEvents: ["accounting-updated"],
    };
  }

  if (newStatus === "sent_to_1c") {
    const res = await markAccountantQueuePrepared(
      resolved.map((d) => ({ id: d.id, source: d.source }))
    );
    if (!res.ok) {
      return { success: false, status: "error", error: res.error };
    }
    const updatedCount =
      res.data.inventory + res.data.fuel + (res.data.acts ?? 0);
    return {
      success: true,
      status: "marked_sent",
      updatedCount,
      appliedStatus: "sent_to_1c" as const,
      breakdown: res.data,
      totalSumUah,
      message: `Позначив **${updatedCount}** документів як sent_to_1c.`,
      clientEvents: ["accounting-updated"],
    };
  }

  // Reset → new
  const supabase = createServiceSupabase();
  let updated = 0;
  const invIds = resolved
    .filter((d) => d.source === "inventory")
    .map((d) => d.id);
  const fuelIds = resolved.filter((d) => d.source === "fuel").map((d) => d.id);
  const actIds = resolved
    .filter((d) => d.source === "service_act")
    .map((d) => d.id);

  if (invIds.length > 0) {
    const { data } = await supabase
      .from("inventory_local_moves")
      .update({
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .in("id", invIds)
      .eq("status", "sent_to_1c")
      .select("id");
    updated += data?.length ?? 0;
  }
  if (fuelIds.length > 0) {
    const { data } = await supabase
      .from("fuel_transactions")
      .update({ sync_status: "pending_1c" })
      .in("id", fuelIds)
      .eq("sync_status", "synced")
      .select("id");
    updated += data?.length ?? 0;
  }
  if (actIds.length > 0) {
    const { data } = await supabase
      .from("accounting_acts")
      .update({ status: "posted" })
      .in("id", actIds)
      .eq("status", "sent_to_1c")
      .select("id");
    updated += data?.length ?? 0;
  }

  return {
    success: true,
    status: "reset_to_new",
    updatedCount: updated,
    appliedStatus: "new" as const,
    message: `Повернув **${updated}** документів у чергу (new).`,
    clientEvents: ["accounting-updated"],
  };
}

export async function collectAccountantPackageItems(params: {
  period?: "today" | "week" | "month" | "season" | "custom";
  status?: "all" | "new" | "prepared";
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<
  | { ok: true; items: AccountantQueueItem[]; totalSumUah: number }
  | { ok: false; error: string }
> {
  const period = params.period ?? "month";
  const status = params.status ?? "prepared";
  const { startIso, endIso, season } = periodBounds(
    period,
    params.dateFrom,
    params.dateTo
  );

  const queue = await listAccountantQueue({ season, startIso, endIso });
  if (!queue.ok) return queue;
  let items = queue.data.items;
  const fuelOut = await fetchFuelOutboundQueue("pending_1c", startIso, endIso);
  items = [...items, ...fuelOut];

  if (status === "prepared") {
    const withReady = items.filter((i) => i.hasAttachment || i.basDraftSent);
    // Якщо нічого «prepared» — експортуємо всю чергу (як UI за замовчуванням)
    items = withReady.length > 0 ? withReady : items;
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  const totalSumUah = round2(
    items.reduce((s, i) => s + (i.amountUah ?? 0), 0)
  );
  return { ok: true, items, totalSumUah };
}

export async function listAgentServiceActs(params: {
  query?: string | null;
  equipmentIdOrName?: string | null;
  limit?: number;
}): Promise<
  | {
      ok: true;
      count: number;
      acts: Array<{
        id: string;
        actNumber: string | null;
        date: string | null;
        contractor: string;
        serviceName: string;
        amountUah: number;
        equipmentName: string | null;
        isLinkedToEquipment: boolean;
        status: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 20)));
  const q = params.query?.trim().toLocaleLowerCase("uk-UA") || "";
  const eqLookup = params.equipmentIdOrName?.trim() || "";
  const supabase = createServiceSupabase();

  let equipmentId: string | null = null;
  if (eqLookup) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        eqLookup
      );
    if (isUuid) {
      equipmentId = eqLookup.toLowerCase();
    } else {
      const { data: eqs } = await supabase
        .from("equipment")
        .select("id, name")
        .ilike("name", `%${eqLookup.replace(/%/g, "")}%`)
        .limit(8);
      const list = eqs ?? [];
      const exact = list.find(
        (e) =>
          String(e.name ?? "").toLocaleLowerCase("uk-UA") ===
          eqLookup.toLocaleLowerCase("uk-UA")
      );
      if (exact) equipmentId = String(exact.id);
      else if (list.length === 1) equipmentId = String(list[0]!.id);
      else if (list.length > 1) {
        return {
          ok: false,
          error: `Кілька одиниць техніки для «${eqLookup}». Уточни.`,
        };
      }
    }
  }

  let query = supabase
    .from("accounting_acts")
    .select(
      "id, act_number, act_date, contractor_name, category, total_amount, services, equipment_id, equipment_name_hint, status, created_at"
    )
    .neq("status", "cancelled")
    .order("act_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (equipmentId) {
    query = query.eq("equipment_id", equipmentId);
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: error.message };
  }

  const eqIds = [
    ...new Set(
      (data ?? [])
        .map((r) => (r.equipment_id ? String(r.equipment_id) : null))
        .filter(Boolean) as string[]
    ),
  ];
  const nameById = new Map<string, string>();
  if (eqIds.length > 0) {
    const { data: eqs } = await supabase
      .from("equipment")
      .select("id, name")
      .in("id", eqIds);
    for (const e of eqs ?? []) {
      nameById.set(String(e.id), String(e.name ?? ""));
    }
  }

  let acts = (data ?? []).map((row) => {
    const services = Array.isArray(row.services) ? row.services : [];
    const firstService =
      services[0] && typeof services[0] === "object"
        ? String((services[0] as { name?: unknown }).name ?? "").trim()
        : "";
    const linkedId = row.equipment_id ? String(row.equipment_id) : null;
    const equipmentName =
      (linkedId ? nameById.get(linkedId) : null) ||
      (typeof row.equipment_name_hint === "string"
        ? row.equipment_name_hint.trim()
        : "") ||
      null;

    return {
      id: String(row.id),
      actNumber:
        typeof row.act_number === "string" && row.act_number.trim()
          ? row.act_number.trim()
          : null,
      date:
        (typeof row.act_date === "string" && row.act_date.slice(0, 10)) ||
        (typeof row.created_at === "string"
          ? row.created_at.slice(0, 10)
          : null),
      contractor:
        typeof row.contractor_name === "string" && row.contractor_name.trim()
          ? row.contractor_name.trim()
          : "Виконавець",
      serviceName: firstService || String(row.category ?? "Послуга"),
      amountUah:
        row.total_amount != null && Number.isFinite(Number(row.total_amount))
          ? Number(row.total_amount)
          : 0,
      equipmentName,
      isLinkedToEquipment: Boolean(linkedId),
      status: String(row.status ?? "posted"),
    };
  });

  if (q) {
    acts = acts.filter((a) => {
      const hay = [
        a.contractor,
        a.serviceName,
        a.equipmentName ?? "",
        a.actNumber ?? "",
        a.status,
      ]
        .join(" ")
        .toLocaleLowerCase("uk-UA");
      return hay.includes(q);
    });
  }

  // Якщо шукали техніку по імені без точного id — фільтр по імені
  if (eqLookup && !equipmentId) {
    const needle = eqLookup.toLocaleLowerCase("uk-UA");
    acts = acts.filter((a) =>
      (a.equipmentName ?? "").toLocaleLowerCase("uk-UA").includes(needle)
    );
  }

  const sliced = acts.slice(0, limit);
  return { ok: true, count: sliced.length, acts: sliced };
}

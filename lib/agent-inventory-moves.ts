/**
 * LEVADIUS · Склад P0: журнал рухів, ручний прихід, продаж врожаю,
 * update/delete inventory_local_moves.
 *
 * Залишок — віртуальний (BAS + draft moves), як у /inventory.
 * Не оновлюємо вигадане inventory_items_cache.quantity.
 */

import "server-only";

import {
  createLocalHarvestSale,
  createLocalInboundMove,
  createLocalInventoryItem,
  deleteLocalMove,
  getLocalMoveById,
  listLocalMoves,
  updateLocalMove,
  type LocalMoveRow,
  type QuickIssueItemOption,
} from "@/app/admin/inventory/actions";
import { loadAgentInventoryStock } from "@/lib/agent-warehouse-stock";
import { shiftKyivYmd, todayKyivYmd, toKyivDayKey } from "@/lib/kyiv-date";
import { currentAgroSeason, DEFAULT_SEASON } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgentInventoryMoveType = "inbound" | "outbound" | "sale";

export type AgentInventoryMoveListItem = {
  id: string;
  date: string;
  type: AgentInventoryMoveType;
  itemName: string;
  itemRefKey: string;
  quantity: number;
  unit: string;
  pricePerUnit: number | null;
  totalPrice: number | null;
  destinationField: string | null;
  counterparty: string | null;
  notes: string | null;
  isSentTo1c: boolean;
  season: string | null;
  category: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function moveDateYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return toKyivDayKey(d);
}

function periodFromYmd(
  period: "all" | "today" | "week" | "month" | "season"
): { fromYmd: string | null; season: string | null } {
  if (period === "all") return { fromYmd: null, season: null };
  if (period === "season") {
    return { fromYmd: null, season: currentAgroSeason() };
  }
  const today = todayKyivYmd();
  if (period === "today") return { fromYmd: today, season: null };
  if (period === "week") {
    return { fromYmd: shiftKyivYmd(today, -6), season: null };
  }
  return { fromYmd: shiftKyivYmd(today, -29), season: null };
}

function mapMoveRow(row: LocalMoveRow): AgentInventoryMoveListItem {
  const price = row.unitPriceUah;
  const total =
    price != null && Number.isFinite(price) ? round2(price * row.qty) : null;
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    itemName: row.itemName,
    itemRefKey: row.itemRefKey,
    quantity: row.qty,
    unit: row.itemUnit || "",
    pricePerUnit: price,
    totalPrice: total,
    destinationField: row.fieldName,
    counterparty: row.buyerName,
    notes: row.note,
    isSentTo1c: row.status === "sent_to_1c",
    season: row.season,
    category: row.itemCategory,
  };
}

export async function listAgentInventoryMoves(params: {
  moveType?: "all" | AgentInventoryMoveType;
  query?: string | null;
  period?: "all" | "today" | "week" | "month" | "season";
  limit?: number;
}): Promise<
  | { ok: true; moves: AgentInventoryMoveListItem[]; totalMatched: number }
  | { ok: false; error: string }
> {
  const moveType = params.moveType ?? "all";
  const period = params.period ?? "all";
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 20)));
  const q = params.query?.trim().toLocaleLowerCase("uk-UA") || "";
  const { fromYmd, season } = periodFromYmd(period);

  const listed = await listLocalMoves(season ? { season } : undefined);
  if (!listed.ok) return listed;

  let rows = listed.moves;
  if (moveType !== "all") {
    rows = rows.filter((m) => m.type === moveType);
  }
  if (fromYmd) {
    rows = rows.filter((m) => moveDateYmd(m.date) >= fromYmd);
  }
  if (q) {
    rows = rows.filter((m) => {
      const hay = [
        m.itemName,
        m.buyerName ?? "",
        m.fieldName ?? "",
        m.note ?? "",
        m.itemRefKey,
        m.type,
      ]
        .join(" ")
        .toLocaleLowerCase("uk-UA");
      return hay.includes(q);
    });
  }

  const totalMatched = rows.length;
  return {
    ok: true,
    moves: rows.slice(0, limit).map(mapMoveRow),
    totalMatched,
  };
}

type CacheItem = {
  basRefKey: string;
  name: string;
  unit: string;
  category: string;
  plannedPriceUah: number;
};

async function lookupInventoryItem(
  itemIdOrName: string
): Promise<
  | { ok: true; item: CacheItem }
  | {
      ok: false;
      status: "not_found" | "ambiguous";
      error: string;
      candidates?: Array<{ id: string; name: string; unit: string }>;
    }
> {
  const needle = itemIdOrName.trim();
  if (!needle) {
    return { ok: false, status: "not_found", error: "Вкажи назву або ID ТМЦ." };
  }
  const supabase = createServiceSupabase();
  const lower = needle.toLowerCase();
  const safe = needle.replace(/[%_,]/g, " ").trim();

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      needle
    )
  ) {
    const { data } = await supabase
      .from("inventory_items_cache")
      .select(
        "bas_ref_key, name, custom_name, unit, category, planned_price_uah"
      )
      .eq("bas_ref_key", lower)
      .maybeSingle();
    if (data) {
      return {
        ok: true,
        item: {
          basRefKey: String(data.bas_ref_key).toLowerCase(),
          name:
            String(data.custom_name ?? "").trim() ||
            String(data.name ?? "").trim() ||
            "ТМЦ",
          unit: String(data.unit ?? "").trim() || "од.",
          category: String(data.category ?? "parts"),
          plannedPriceUah: Number(data.planned_price_uah) || 0,
        },
      };
    }
  }

  const { data: rows, error } = await supabase
    .from("inventory_items_cache")
    .select(
      "bas_ref_key, name, custom_name, unit, category, planned_price_uah"
    )
    .or(`name.ilike.%${safe}%,custom_name.ilike.%${safe}%`)
    .limit(12);

  if (error) {
    return { ok: false, status: "not_found", error: error.message };
  }

  const list = (rows ?? []).map((r) => ({
    basRefKey: String(r.bas_ref_key).toLowerCase(),
    name:
      String(r.custom_name ?? "").trim() ||
      String(r.name ?? "").trim() ||
      "ТМЦ",
    unit: String(r.unit ?? "").trim() || "од.",
    category: String(r.category ?? "parts"),
    plannedPriceUah: Number(r.planned_price_uah) || 0,
  }));

  const exact = list.filter(
    (r) =>
      r.name.toLocaleLowerCase("uk-UA") === needle.toLocaleLowerCase("uk-UA")
  );
  const chosen =
    exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;

  if (chosen) return { ok: true, item: chosen };

  if (list.length > 1) {
    return {
      ok: false,
      status: "ambiguous",
      error: `Кілька позицій для «${needle}». Уточни назву.`,
      candidates: list.slice(0, 6).map((r) => ({
        id: r.basRefKey,
        name: r.name,
        unit: r.unit,
      })),
    };
  }

  return {
    ok: false,
    status: "not_found",
    error: `Позицію «${needle}» не знайдено в довіднику.`,
  };
}

async function virtualBalance(itemRefKey: string): Promise<number> {
  const stock = await loadAgentInventoryStock({
    includeZero: true,
    limit: 400,
  });
  const hit = stock.items.find(
    (i) => i.ref.toLowerCase() === itemRefKey.toLowerCase()
  );
  return hit?.quantity ?? 0;
}

function guessCategoryFromName(
  name: string
): QuickIssueItemOption["category"] {
  const n = name.toLocaleLowerCase("uk-UA");
  if (/насін|посівн/.test(n)) return "seed";
  if (/добрив|селітр|карбам|аміак|npk|калі/.test(n)) return "fertilizer";
  if (/урожа|пшен|кукуруд|соняшн|соя|ячмін|ріпак|зерн/.test(n)) {
    return "harvest";
  }
  if (/фільтр|масл|ремкомплект|підшипник|пас |ремінь/.test(n)) return "parts";
  return "zzr";
}

function harvestQtyFromTons(
  tons: number,
  unit: string
): {
  qty: number;
  pricePerUnit: (pricePerTon: number) => number;
  unitLabel: string;
} {
  const u = unit.trim().toLocaleLowerCase("uk-UA");
  if (u === "кг" || u === "kg") {
    return {
      qty: round2(tons * 1000),
      pricePerUnit: (p) => round2(p / 1000),
      unitLabel: "кг",
    };
  }
  return {
    qty: round2(tons),
    pricePerUnit: (p) => round2(p),
    unitLabel: u || "т",
  };
}

export async function prepareOrCreateInventoryInbound(params: {
  itemIdOrName: string;
  quantity: number;
  pricePerUnit?: number | null;
  supplier?: string | null;
  notes?: string | null;
  confirmed?: boolean;
  categoryHint?: QuickIssueItemOption["category"] | null;
  unitHint?: string | null;
}): Promise<Record<string, unknown>> {
  const qty = Number(params.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      success: false,
      status: "error",
      error: "Кількість має бути більше 0.",
    };
  }

  const isConfirmed = params.confirmed === true;
  let item: CacheItem | null = null;
  const lookup = await lookupInventoryItem(params.itemIdOrName);

  if (lookup.ok) {
    item = lookup.item;
  } else if (lookup.status === "ambiguous") {
    return {
      success: false,
      status: "ambiguous",
      error: lookup.error,
      candidates: lookup.candidates,
    };
  } else if (!isConfirmed) {
    const name = params.itemIdOrName.trim();
    const unit = params.unitHint?.trim() || "кг";
    const price =
      params.pricePerUnit != null &&
      Number.isFinite(Number(params.pricePerUnit))
        ? round2(Number(params.pricePerUnit))
        : null;
    if (price == null || price <= 0) {
      return {
        success: false,
        status: "needs_slots",
        error: `Позицію «${name}» не знайдено. Для створення вкажи pricePerUnit (₴/од.).`,
        itemName: name,
      };
    }
    return {
      success: false,
      status: "requires_confirmation",
      kind: "inventory_inbound",
      willCreateItem: true,
      itemId: null,
      itemName: name,
      unit,
      quantity: qty,
      oldPrice: null,
      newPrice: price,
      stockBefore: 0,
      stockAfter: qty,
      supplier: params.supplier?.trim() || null,
      notes: params.notes?.trim() || null,
      totalCost: round2(qty * price),
      canConfirm: true,
      confirmChoice: `Підтвердити прихід ${qty} ${unit} «${name}»`,
      cancelChoice: "Скасувати",
      badge: "Прихід ТМЦ",
      userHint: `Нова позиція «${name}»: оприбуткувати ${qty} ${unit} по ${price} ₴?`,
      clientEvents: ["warehouse-updated"],
    };
  } else {
    const name = params.itemIdOrName.trim();
    const unit = params.unitHint?.trim() || "кг";
    const category = params.categoryHint ?? guessCategoryFromName(name);
    const price =
      params.pricePerUnit != null &&
      Number.isFinite(Number(params.pricePerUnit))
        ? round2(Number(params.pricePerUnit))
        : 0;
    if (!(price > 0)) {
      return {
        success: false,
        status: "needs_slots",
        error: "Для нової позиції потрібна pricePerUnit > 0.",
      };
    }
    const created = await createLocalInventoryItem({
      name,
      category,
      unit,
      plannedPriceUah: price,
    });
    if (!created.ok) {
      return { success: false, status: "error", error: created.error };
    }
    item = {
      basRefKey: created.basRefKey,
      name,
      unit,
      category,
      plannedPriceUah: price,
    };
  }

  if (!item) {
    return {
      success: false,
      status: "error",
      error: "Не вдалося визначити позицію ТМЦ.",
    };
  }

  const stockBefore = await virtualBalance(item.basRefKey);
  const oldPrice = item.plannedPriceUah;
  const newPrice =
    params.pricePerUnit != null && Number.isFinite(Number(params.pricePerUnit))
      ? round2(Number(params.pricePerUnit))
      : oldPrice > 0
        ? oldPrice
        : null;
  const stockAfter = round2(stockBefore + qty);

  if (!isConfirmed) {
    if (newPrice == null || !(newPrice >= 0)) {
      return {
        success: false,
        status: "needs_slots",
        error: "Вкажи pricePerUnit (₴ за одиницю).",
        itemId: item.basRefKey,
        itemName: item.name,
      };
    }
    return {
      success: false,
      status: "requires_confirmation",
      kind: "inventory_inbound",
      willCreateItem: false,
      itemId: item.basRefKey,
      itemName: item.name,
      unit: item.unit,
      quantity: qty,
      oldPrice,
      newPrice,
      stockBefore,
      stockAfter,
      supplier: params.supplier?.trim() || null,
      notes: params.notes?.trim() || null,
      totalCost: round2(qty * newPrice),
      canConfirm: true,
      confirmChoice: `Підтвердити прихід ${qty} ${item.unit} «${item.name}»`,
      cancelChoice: "Скасувати",
      badge: "Прихід ТМЦ",
      userHint: `Оприбуткувати ${qty} ${item.unit} «${item.name}»${
        params.supplier?.trim() ? ` від ${params.supplier.trim()}` : ""
      }? Залишок ${stockBefore} → ${stockAfter}.`,
      clientEvents: ["warehouse-updated"],
    };
  }

  const unitPrice = newPrice ?? 0;
  const noteParts = [
    params.notes?.trim() || null,
    params.supplier?.trim()
      ? `Постачальник: ${params.supplier.trim()}`
      : null,
  ].filter(Boolean);

  const created = await createLocalInboundMove({
    itemRefKey: item.basRefKey,
    qty,
    unitPriceUah: unitPrice,
    buyerName: params.supplier?.trim() || null,
    note: noteParts.length > 0 ? noteParts.join(". ") : null,
    season: currentAgroSeason() || DEFAULT_SEASON,
  });

  if (!created.ok) {
    return { success: false, status: "error", error: created.error };
  }

  const stockAfterConfirm = await virtualBalance(item.basRefKey);

  return {
    success: true,
    status: "inbound_created",
    kind: "inventory_inbound",
    moveId: created.id,
    itemId: item.basRefKey,
    itemName: item.name,
    unit: item.unit,
    quantity: qty,
    pricePerUnit: unitPrice,
    totalCost: round2(qty * unitPrice),
    supplier: params.supplier?.trim() || null,
    notes: params.notes?.trim() || null,
    stockBefore,
    stockAfter: stockAfterConfirm,
    newStockBalance: stockAfterConfirm,
    message: `Оприбуткував **${qty} ${item.unit}** «${item.name}». Залишок: **${stockAfterConfirm}** ${item.unit}.`,
    clientEvents: ["warehouse-updated"],
    navigatePath: "/inventory",
  };
}

export async function prepareOrCreateInventorySale(params: {
  cropOrCommodity: string;
  quantityTons: number;
  pricePerTonUah: number;
  buyer: string;
  storageLocation?: string | null;
  notes?: string | null;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const tons = Number(params.quantityTons);
  const pricePerTon = Number(params.pricePerTonUah);
  const buyer = params.buyer?.trim() || "";
  const isConfirmed = params.confirmed === true;

  if (!Number.isFinite(tons) || tons <= 0) {
    return {
      success: false,
      status: "error",
      error: "Обʼєм продажу (т) має бути > 0.",
    };
  }
  if (!Number.isFinite(pricePerTon) || pricePerTon <= 0) {
    return {
      success: false,
      status: "error",
      error: "Ціна ₴/т має бути > 0.",
    };
  }
  if (!buyer) {
    return {
      success: false,
      status: "needs_slots",
      error: "Вкажи покупця (buyer).",
    };
  }

  const lookup = await lookupInventoryItem(params.cropOrCommodity);
  let item: CacheItem;

  if (lookup.ok) {
    item = lookup.item;
    if (item.category !== "harvest") {
      const stock = await loadAgentInventoryStock({
        categoryKey: "harvest",
        includeZero: true,
        limit: 200,
      });
      const needle = params.cropOrCommodity.trim().toLocaleLowerCase("uk-UA");
      const harvestHits = stock.items.filter((r) =>
        r.name.toLocaleLowerCase("uk-UA").includes(needle)
      );
      if (harvestHits.length === 1) {
        item = {
          basRefKey: harvestHits[0]!.ref,
          name: harvestHits[0]!.name,
          unit: harvestHits[0]!.unit,
          category: "harvest",
          plannedPriceUah: 0,
        };
      } else if (harvestHits.length > 1) {
        return {
          success: false,
          status: "ambiguous",
          error: `Кілька позицій врожаю для «${params.cropOrCommodity}».`,
          candidates: harvestHits.slice(0, 6).map((r) => ({
            id: r.ref,
            name: r.name,
            unit: r.unit,
            quantity: r.quantity,
          })),
        };
      } else {
        return {
          success: false,
          status: "error",
          error: `«${item.name}» не є врожаєм (category=${item.category}).`,
        };
      }
    }
  } else if (lookup.status === "ambiguous") {
    return {
      success: false,
      status: "ambiguous",
      error: lookup.error,
      candidates: lookup.candidates,
    };
  } else {
    const stock = await loadAgentInventoryStock({
      categoryKey: "harvest",
      includeZero: true,
      limit: 200,
    });
    const needle = params.cropOrCommodity.trim().toLocaleLowerCase("uk-UA");
    const exact = stock.items.filter(
      (r) => r.name.toLocaleLowerCase("uk-UA") === needle
    );
    const fuzzy = stock.items.filter((r) =>
      r.name.toLocaleLowerCase("uk-UA").includes(needle)
    );
    const hit =
      exact.length === 1 ? exact[0] : fuzzy.length === 1 ? fuzzy[0] : null;
    if (!hit) {
      if (fuzzy.length > 1) {
        return {
          success: false,
          status: "ambiguous",
          error: `Кілька позицій врожаю для «${params.cropOrCommodity}».`,
          candidates: fuzzy.slice(0, 6).map((r) => ({
            id: r.ref,
            name: r.name,
            unit: r.unit,
            quantity: r.quantity,
          })),
        };
      }
      return {
        success: false,
        status: "not_found",
        error: `Врожай «${params.cropOrCommodity}» не знайдено на складі.`,
      };
    }
    item = {
      basRefKey: hit.ref,
      name: hit.name,
      unit: hit.unit,
      category: "harvest",
      plannedPriceUah: 0,
    };
  }

  const conv = harvestQtyFromTons(tons, item.unit);
  const qty = conv.qty;
  const unitPrice = conv.pricePerUnit(pricePerTon);
  const totalAmount = round2(tons * pricePerTon);
  const stockBefore = await virtualBalance(item.basRefKey);
  const stockAfter = round2(stockBefore - qty);
  const insufficient = qty > stockBefore + 0.001;

  const noteParts = [
    params.notes?.trim() || null,
    params.storageLocation?.trim()
      ? `Відвантаження: ${params.storageLocation.trim()}`
      : null,
    `Продаж ${tons} т × ${pricePerTon} ₴/т`,
  ].filter(Boolean);

  if (!isConfirmed) {
    return {
      success: false,
      status: "requires_confirmation",
      kind: "inventory_sale",
      itemId: item.basRefKey,
      itemName: item.name,
      unit: conv.unitLabel,
      quantityTons: tons,
      quantity: qty,
      pricePerTonUah: pricePerTon,
      pricePerUnit: unitPrice,
      totalAmount,
      buyer,
      storageLocation: params.storageLocation?.trim() || null,
      stockBefore,
      stockAfter: Math.max(0, stockAfter),
      insufficient,
      canConfirm: !insufficient,
      warning: insufficient
        ? `Недостатньо зерна: є ${stockBefore} ${item.unit}, потрібно ${qty}.`
        : null,
      confirmChoice: `Підтвердити продаж ${tons} т «${item.name}» → ${buyer}`,
      cancelChoice: "Скасувати",
      badge: "Продаж врожаю",
      userHint: insufficient
        ? `Недостатньо залишку для продажу ${tons} т.`
        : `Продати ${tons} т «${item.name}» на ${buyer} по ${pricePerTon} ₴/т (разом ${totalAmount} ₴)? Залишок ${stockBefore} → ${Math.max(0, stockAfter)} ${item.unit}.`,
      clientEvents: ["warehouse-updated"],
    };
  }

  if (insufficient) {
    return {
      success: false,
      status: "insufficient_stock",
      error: `Недостатньо на складі. Доступно: ${stockBefore} ${item.unit}.`,
      stockBefore,
      quantity: qty,
    };
  }

  const created = await createLocalHarvestSale({
    itemRefKey: item.basRefKey,
    qty,
    buyerName: buyer,
    unitPriceUah: unitPrice,
    note: noteParts.join(". "),
    season: currentAgroSeason() || DEFAULT_SEASON,
  });

  if (!created.ok) {
    return { success: false, status: "error", error: created.error };
  }

  const after = await virtualBalance(item.basRefKey);

  return {
    success: true,
    status: "sale_created",
    kind: "inventory_sale",
    moveId: created.id,
    itemId: item.basRefKey,
    itemName: item.name,
    unit: item.unit,
    quantityTons: tons,
    quantity: qty,
    pricePerTonUah: pricePerTon,
    pricePerUnit: unitPrice,
    totalAmount,
    buyer,
    storageLocation: params.storageLocation?.trim() || null,
    stockBefore,
    stockAfter: after,
    newStockBalance: after,
    message: `Продав **${tons} т** «${item.name}» → **${buyer}** по **${pricePerTon} ₴/т** (разом **${totalAmount} ₴**). Залишок: **${after}** ${item.unit}.`,
    clientEvents: ["warehouse-updated"],
    navigatePath: "/inventory",
  };
}

export async function updateAgentInventoryMove(params: {
  moveId: string;
  newQuantity?: number | null;
  newPrice?: number | null;
  notes?: string | null;
}): Promise<Record<string, unknown>> {
  const id = params.moveId.trim();
  if (!id) {
    return { success: false, status: "error", error: "Вкажи moveId." };
  }

  const loaded = await getLocalMoveById(id);
  if (!loaded.ok) {
    return { success: false, status: "not_found", error: loaded.error };
  }
  const move = loaded.move;

  if (move.status === "sent_to_1c") {
    return {
      success: false,
      status: "forbidden",
      error:
        "Операцію вже передано бухгалтеру (sent_to_1c) — редагування заборонено.",
      isSentTo1c: true,
      moveId: id,
    };
  }

  if (
    params.newQuantity == null &&
    params.newPrice === undefined &&
    params.notes === undefined
  ) {
    return {
      success: false,
      status: "needs_slots",
      error: "Вкажи newQuantity, newPrice і/або notes.",
    };
  }

  const oldQty = move.qty;
  const oldPrice = move.unitPriceUah;
  const result = await updateLocalMove({
    id,
    ...(params.newQuantity != null ? { qty: Number(params.newQuantity) } : {}),
    ...(params.newPrice !== undefined
      ? { unitPriceUah: params.newPrice }
      : {}),
    ...(params.notes !== undefined ? { note: params.notes } : {}),
  });

  if (!result.ok) {
    return { success: false, status: "error", error: result.error };
  }

  const nextQty =
    params.newQuantity != null ? round2(Number(params.newQuantity)) : oldQty;
  const delta = round2(nextQty - oldQty);
  const stockAfter = await virtualBalance(move.itemRefKey);

  return {
    success: true,
    status: "updated",
    moveId: id,
    type: move.type,
    itemId: move.itemRefKey,
    itemName: move.itemName,
    unit: move.itemUnit,
    oldQuantity: oldQty,
    newQuantity: nextQty,
    quantityDelta: delta,
    oldPrice,
    newPrice: params.newPrice !== undefined ? params.newPrice : oldPrice,
    notes:
      params.notes !== undefined ? params.notes?.trim() || null : move.note,
    newStockBalance: stockAfter,
    message: `Рух «${move.itemName}» (${move.type}) оновлено: ${oldQty} → ${nextQty}${
      move.itemUnit ? ` ${move.itemUnit}` : ""
    } (Δ ${delta > 0 ? "+" : ""}${delta}).`,
    clientEvents: ["warehouse-updated"],
  };
}

export async function deleteAgentInventoryMove(params: {
  moveId: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const id = params.moveId.trim();
  const isConfirmed = params.confirmed === true;
  if (!id) {
    return { success: false, status: "error", error: "Вкажи moveId." };
  }

  const loaded = await getLocalMoveById(id);
  if (!loaded.ok) {
    return { success: false, status: "not_found", error: loaded.error };
  }
  const move = loaded.move;
  const stockBefore = await virtualBalance(move.itemRefKey);

  const stockAfterDelete =
    move.type === "inbound"
      ? round2(stockBefore - move.qty)
      : round2(stockBefore + move.qty);

  if (move.status === "sent_to_1c") {
    return {
      success: false,
      status: "requires_confirmation",
      kind: "inventory_move_delete",
      moveId: id,
      type: move.type,
      itemName: move.itemName,
      quantity: move.qty,
      unit: move.itemUnit,
      isSentTo1c: true,
      canConfirm: false,
      confirmChoice: "Видалення заблоковано",
      cancelChoice: "Зрозуміло",
      badge: "Видалення руху ТМЦ",
      warning:
        "Операцію вже передано в 1С / бухгалтеру (sent_to_1c). Видалення заборонено.",
      userHint: "Видалення заблоковано: документ уже в пакеті для BAS.",
    };
  }

  if (!isConfirmed) {
    const effect =
      move.type === "inbound"
        ? `залишок зменшиться на ${move.qty}`
        : move.type === "sale"
          ? `зерно ${move.qty} повернеться на склад`
          : `списання скасується, +${move.qty} на склад`;
    return {
      success: false,
      status: "requires_confirmation",
      kind: "inventory_move_delete",
      moveId: id,
      type: move.type,
      itemId: move.itemRefKey,
      itemName: move.itemName,
      quantity: move.qty,
      unit: move.itemUnit,
      counterparty: move.buyerName,
      destinationField: move.fieldName,
      stockBefore,
      stockAfter: stockAfterDelete,
      isSentTo1c: false,
      canConfirm: true,
      confirmChoice: `Підтвердити скасування ${move.type}`,
      cancelChoice: "Скасувати",
      badge: "Видалення руху ТМЦ",
      userHint: `Видалити ${move.type} «${move.itemName}» (${move.qty} ${move.itemUnit})? ${effect}.`,
      clientEvents: ["warehouse-updated"],
    };
  }

  const deleted = await deleteLocalMove(id);
  if (!deleted.ok) {
    return { success: false, status: "error", error: deleted.error };
  }

  const stockAfter = await virtualBalance(move.itemRefKey);

  return {
    success: true,
    status: "deleted",
    kind: "inventory_move_delete",
    moveId: id,
    type: move.type,
    itemId: move.itemRefKey,
    itemName: move.itemName,
    unit: move.itemUnit,
    quantity: move.qty,
    newStockBalance: stockAfter,
    stockBefore,
    stockAfter,
    message: `Скасував ${move.type} «${move.itemName}» (${move.qty}${
      move.itemUnit ? ` ${move.itemUnit}` : ""
    }). Залишок: **${stockAfter}**${move.itemUnit ? ` ${move.itemUnit}` : ""}.`,
    clientEvents: ["warehouse-updated"],
  };
}

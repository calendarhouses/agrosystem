"use server";

import { revalidatePath } from "next/cache";

import {
  aggregateFieldEconomics,
  type FieldEconomicsDashboardData,
} from "@/lib/field-economics";
import {
  getBasCounterparties,
  getBasHarvestOutputSince,
  getBasNomenclature,
  getBasProductionReportsSince,
  getBasPurchasesSince,
  getBasReceiptsSince,
  getBasSaleMovementsSince,
  getBasSalesSince,
  getBasUnits,
} from "@/lib/bas-api";
import { buildFullDashboard } from "@/lib/inventory-bas";
import { enqueueInventoryInboundBasDraft } from "@/lib/bas-drafts/inventory-inbound";
import { enqueueInventorySaleBasDraft } from "@/lib/bas-drafts/inventory-sale";
import { logActivity } from "@/lib/activity-log";
import {
  actorCreateColumns,
  actorUpdateColumns,
  getCurrentActor,
} from "@/lib/app-actor";
import { captureWeatherContextForField } from "@/lib/field-weather-context";
import {
  enqueueInventoryOutboundBasDraft,
  syncLocalMovesToBas,
  type SyncLocalMovesToBasResult,
} from "@/lib/inventory-bas-draft-sync";
import {
  syncNomenclatureToSupabase,
  type SyncNomenclatureResult,
} from "@/lib/inventory-sync";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function syncInventoryNomenclatureAction(): Promise<
  { ok: true; data: SyncNomenclatureResult } | { ok: false; error: string }
> {
  try {
    const data = await syncNomenclatureToSupabase();
    invalidateBasQtyInCache();
    revalidatePath("/inventory");
    revalidatePath("/admin");
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося синхронізувати номенклатуру",
    };
  }
}

export type QuickIssueItemOption = {
  basRefKey: string;
  name: string;
  category: "zzr" | "fertilizer" | "seed" | "parts" | "harvest";
  categoryLabel: string;
  unit: string;
  virtualBalance: number;
  plannedPriceUah: number | null;
  isLocal?: boolean;
};

const QUICK_ISSUE_CATEGORY_LABELS: Record<
  QuickIssueItemOption["category"],
  string
> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  parts: "Запчастини",
  harvest: "Врожай",
};

const ISSUE_CATEGORIES = new Set<QuickIssueItemOption["category"]>([
  "zzr",
  "fertilizer",
  "seed",
  "parts",
]);

const STOCK_CATEGORIES = new Set<QuickIssueItemOption["category"]>([
  "zzr",
  "fertilizer",
  "seed",
  "parts",
  "harvest",
]);

const BAS_STOCK_SINCE = "2024-03-01T00:00:00";
const BAS_QTY_IN_TTL_MS = 5 * 60 * 1000;

type BasStockMaps = {
  qtyIn: Record<string, number>;
  qtyOut: Record<string, number>;
};

let basStockCache: { at: number; maps: BasStockMaps } | null = null;

function invalidateBasQtyInCache() {
  basStockCache = null;
}

/** BAS qtyIn/qtyOut з TTL-кешем — уникаємо повного OData rebuild на кожен options/submit. */
async function loadBasStockByRef(force = false): Promise<BasStockMaps> {
  if (
    !force &&
    basStockCache &&
    Date.now() - basStockCache.at < BAS_QTY_IN_TTL_MS
  ) {
    return basStockCache.maps;
  }
  try {
    const [
      nomenclature,
      units,
      purchases,
      harvest,
      saleMoves,
      receipts,
      sales,
      counterparties,
      productionDocs,
    ] = await Promise.all([
      getBasNomenclature(),
      getBasUnits(),
      getBasPurchasesSince(BAS_STOCK_SINCE),
      getBasHarvestOutputSince(BAS_STOCK_SINCE),
      getBasSaleMovementsSince(BAS_STOCK_SINCE),
      getBasReceiptsSince(BAS_STOCK_SINCE),
      getBasSalesSince(BAS_STOCK_SINCE),
      getBasCounterparties(),
      getBasProductionReportsSince(BAS_STOCK_SINCE),
    ]);

    const full = buildFullDashboard({
      nomenclature,
      units,
      purchases,
      harvest,
      saleMoves,
      receipts,
      sales,
      counterparties,
      productionDocs,
      since: BAS_STOCK_SINCE,
    });

    const qtyIn: Record<string, number> = {};
    const qtyOut: Record<string, number> = {};
    for (const item of full.items) {
      const key = item.id.toLowerCase();
      qtyIn[key] = item.qtyIn;
      qtyOut[key] = item.qtyOut;
    }
    const maps = { qtyIn, qtyOut };
    basStockCache = { at: Date.now(), maps };
    return maps;
  } catch {
    return basStockCache?.maps ?? { qtyIn: {}, qtyOut: {} };
  }
}

async function resolveQuickIssueVirtualBalance(
  basRefKey: string
): Promise<number | { ok: false; error: string }> {
  const key = basRefKey.trim().toLowerCase();
  const [movesRes, basStock] = await Promise.all([
    getLocalMoveQtyByItem(),
    loadBasStockByRef(),
  ]);
  if (!movesRes.ok) {
    return { ok: false, error: movesRes.error };
  }
  const qtyIn = (basStock.qtyIn[key] ?? 0) + (movesRes.inboundByRef[key] ?? 0);
  const qtyOut =
    (basStock.qtyOut[key] ?? 0) + (movesRes.outboundByRef[key] ?? 0);
  return Math.round((qtyIn - qtyOut) * 100) / 100;
}

export type QuickIssueFieldOption = {
  id: string;
  name: string;
  areaHa: number;
  crop: string;
};

export async function getQuickIssueOptions(): Promise<
  | {
      ok: true;
      items: QuickIssueItemOption[];
      fields: QuickIssueFieldOption[];
    }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    let itemsData:
      | {
          bas_ref_key: unknown;
          name: unknown;
          category: unknown;
          unit: unknown;
          custom_name?: unknown;
          is_hidden?: unknown;
          planned_price_uah?: unknown;
        }[]
      | null = null;

    const [itemsRes, fieldsRes, movesRes, basStock] = await Promise.all([
      supabase
        .from("inventory_items_cache")
        .select(
          "bas_ref_key, name, custom_name, category, unit, is_hidden, planned_price_uah, is_local"
        )
        .in("category", ["zzr", "fertilizer", "seed", "parts", "harvest"])
        .order("name"),
      supabase
        .from("farm_fields")
        .select("id, name, area_ha, crop")
        .order("name"),
      getLocalMoveQtyByItem(),
      loadBasStockByRef(),
    ]);

    const outboundByRef = movesRes.ok ? movesRes.outboundByRef : {};
    const inboundByRef = movesRes.ok ? movesRes.inboundByRef : {};
    const qtyInMap = basStock.qtyIn;
    const qtyOutMap = basStock.qtyOut;

    if (itemsRes.error) {
      if (
        itemsRes.error.message?.includes("is_hidden") ||
        itemsRes.error.message?.includes("custom_name") ||
        itemsRes.error.message?.includes("planned_price_uah") ||
        itemsRes.error.message?.includes("is_local")
      ) {
        const legacy = await supabase
          .from("inventory_items_cache")
          .select("bas_ref_key, name, category, unit")
          .in("category", ["zzr", "fertilizer", "seed", "parts", "harvest"])
          .order("name");
        if (legacy.error) {
          return {
            ok: false,
            error:
              legacy.error.code === "PGRST205" || legacy.error.code === "42P01"
                ? "Таблиця inventory_items_cache ще не створена. Виконай міграцію 014."
                : legacy.error.message,
          };
        }
        itemsData = legacy.data;
      } else {
        return {
          ok: false,
          error:
            itemsRes.error.code === "PGRST205" ||
            itemsRes.error.code === "42P01"
              ? "Таблиця inventory_items_cache ще не створена. Виконай міграцію 014."
              : itemsRes.error.message,
        };
      }
    } else {
      itemsData = itemsRes.data;
    }
    if (fieldsRes.error) {
      return { ok: false, error: fieldsRes.error.message };
    }

    const items: QuickIssueItemOption[] = (itemsData ?? [])
      .filter((row) => {
        const cat = row.category as QuickIssueItemOption["category"];
        return STOCK_CATEGORIES.has(cat) && !row.is_hidden;
      })
      .map((row) => {
        const basRefKey = String(row.bas_ref_key);
        const key = basRefKey.toLowerCase();
        const category = row.category as QuickIssueItemOption["category"];
        const qtyIn =
          (qtyInMap[key] ?? 0) + (inboundByRef[key] ?? 0);
        const qtyOut =
          (qtyOutMap[key] ?? 0) + (outboundByRef[key] ?? 0);
        const plannedRaw = row.planned_price_uah;
        const plannedPriceUah =
          plannedRaw != null && Number(plannedRaw) > 0
            ? Number(plannedRaw)
            : null;

        return {
          basRefKey,
          name: String(
            (typeof row.custom_name === "string" && row.custom_name.trim()) ||
              row.name
          ),
          category,
          categoryLabel: QUICK_ISSUE_CATEGORY_LABELS[category],
          unit: String(row.unit ?? ""),
          virtualBalance: Math.round((qtyIn - qtyOut) * 100) / 100,
          plannedPriceUah,
          isLocal: Boolean(
            (row as { is_local?: unknown }).is_local === true
          ),
        };
      });

    const fields: QuickIssueFieldOption[] = (fieldsRes.data ?? []).map(
      (row) => ({
        id: String(row.id),
        name: String(row.name),
        areaHa: Number(row.area_ha) || 0,
        crop: String(row.crop ?? ""),
      })
    );

    return { ok: true, items, fields };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити довідники",
    };
  }
}

export async function createLocalOutboundMove(input: {
  itemRefKey: string;
  fieldId?: string | null;
  qty: number;
  /** Агросезон ('2026'); якщо не передано — DEFAULT_SEASON */
  season?: string;
  note?: string | null;
  /** YYYY-MM-DD або ISO; за замовчуванням — зараз */
  date?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const itemRefKey = input.itemRefKey?.trim().toLowerCase();
  const fieldId = input.fieldId?.trim().toLowerCase() || null;
  const qty = Number(input.qty);
  const season = String(input.season ?? "2026").trim() || "2026";
  const note = input.note?.trim() || null;
  const moveDate = (() => {
    const raw = input.date?.trim();
    if (!raw) return new Date().toISOString();
    const d =
      raw.length <= 10 ? new Date(`${raw.slice(0, 10)}T12:00:00`) : new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  if (!itemRefKey) return { ok: false, error: "Оберіть ТМЦ" };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Вкажіть кількість більше нуля" };
  }

  const balance = await resolveQuickIssueVirtualBalance(itemRefKey);
  if (typeof balance !== "number") {
    return balance;
  }
  if (qty > balance) {
    return {
      ok: false,
      error: `Недостатньо на складі. Доступно: ${balance}`,
    };
  }

  try {
    const supabase = createServiceSupabase();

    const { data: itemRow } = await supabase
      .from("inventory_items_cache")
      .select("category")
      .eq("bas_ref_key", itemRefKey)
      .maybeSingle();
    const category = String(itemRow?.category ?? "");
    const fieldRequired =
      category === "zzr" ||
      category === "fertilizer" ||
      category === "seed";
    if (fieldRequired && !fieldId) {
      return { ok: false, error: "Оберіть поле" };
    }

    const actor = await getCurrentActor();
    const actorCols = actorCreateColumns(actor);
    const weather_context = await captureWeatherContextForField(
      supabase,
      fieldId
    );
    const payload: Record<string, unknown> = {
      item_ref_key: itemRefKey,
      field_id: fieldId,
      type: "outbound",
      qty,
      date: moveDate,
      status: "draft",
      season,
      note,
      weather_context,
      ...actorCols,
    };
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (
        error.message?.includes("weather_context") ||
        error.message?.includes("season") ||
        error.message?.includes("note") ||
        error.message?.includes("actor_")
      ) {
        const {
          season: _s,
          note: _n,
          weather_context: _w,
          actor_id: _a,
          actor_name: _an,
          ...withoutExtra
        } = payload;
        const retry = await supabase
          .from("inventory_local_moves")
          .insert(withoutExtra)
          .select("id")
          .single();
        if (retry.error) return { ok: false, error: retry.error.message };
        const retryId = String(retry.data.id);
        void enqueueInventoryOutboundBasDraft(retryId).catch((e) =>
          console.error("[bas-drafts] outbound", e)
        );
        await logActivity({
          actor,
          action: "create",
          entityType: "inventory_move",
          entityId: retryId,
          summary: `${actor.label} списав ТМЦ зі складу`,
          meta: { type: "outbound", qty, itemRefKey, fieldId },
        });
        revalidatePath("/inventory");
        revalidatePath("/fields");
        return { ok: true, id: retryId };
      }
      return { ok: false, error: error.message };
    }

    const id = String(data.id);
    void enqueueInventoryOutboundBasDraft(id).catch((e) =>
      console.error("[bas-drafts] outbound", e)
    );
    await logActivity({
      actor,
      action: "create",
      entityType: "inventory_move",
      entityId: id,
      summary: `${actor.label} списав ТМЦ зі складу`,
      meta: { type: "outbound", qty, itemRefKey, fieldId },
    });
    revalidatePath("/inventory");
    revalidatePath("/fields");
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося зберегти списання",
    };
  }
}

export async function createLocalInboundMove(input: {
  itemRefKey: string;
  qty: number;
  /** Ціна ₴/од. (закупівля або оцінка собівартості врожаю) */
  unitPriceUah: number;
  /** Постачальник (закупка) або порожньо для власного врожаю */
  buyerName?: string | null;
  fieldId?: string | null;
  note?: string | null;
  season?: string;
  /** YYYY-MM-DD або ISO; за замовчуванням — зараз */
  date?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const itemRefKey = input.itemRefKey?.trim().toLowerCase();
  const fieldId = input.fieldId?.trim().toLowerCase() || null;
  const qty = Number(input.qty);
  const unitPriceUah = Number(input.unitPriceUah);
  const season = String(input.season ?? "2026").trim() || "2026";
  const note = input.note?.trim() || null;
  const buyerName = input.buyerName?.trim() || null;
  const moveDate = (() => {
    const raw = input.date?.trim();
    if (!raw) return new Date().toISOString();
    const d =
      raw.length <= 10 ? new Date(`${raw.slice(0, 10)}T12:00:00`) : new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  if (!itemRefKey) return { ok: false, error: "Оберіть ТМЦ" };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Вкажіть кількість більше нуля" };
  }
  if (!Number.isFinite(unitPriceUah) || unitPriceUah < 0) {
    return { ok: false, error: "Вкажіть ціну за одиницю (₴)" };
  }

  try {
    const supabase = createServiceSupabase();

    const { data: itemRow } = await supabase
      .from("inventory_items_cache")
      .select("category")
      .eq("bas_ref_key", itemRefKey)
      .maybeSingle();

    if (String(itemRow?.category ?? "") === "harvest" && !fieldId) {
      return { ok: false, error: "Для врожаю оберіть поле" };
    }

    const actor = await getCurrentActor();
    const payload: Record<string, unknown> = {
      item_ref_key: itemRefKey,
      field_id: fieldId,
      type: "inbound",
      qty,
      date: moveDate,
      status: "draft",
      season,
      note,
      unit_price_uah: unitPriceUah,
      buyer_name: buyerName,
      ...actorCreateColumns(actor),
    };
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (
        error.message?.includes("inbound") ||
        error.message?.includes("type")
      ) {
        return {
          ok: false,
          error:
            "Не вдалося зберегти прихід. Перевірте дані і спробуйте ще раз.",
        };
      }
      if (error.message?.includes("unit_price")) {
        const { unit_price_uah: _p, ...withoutPrice } = payload;
        const retry = await supabase
          .from("inventory_local_moves")
          .insert(withoutPrice)
          .select("id")
          .single();
        if (retry.error) return { ok: false, error: retry.error.message };
        // Міграція 039 потрібна для ціни — але planned_price все одно оновимо
        await supabase
          .from("inventory_items_cache")
          .update({ planned_price_uah: unitPriceUah })
          .eq("bas_ref_key", itemRefKey);
        revalidatePath("/inventory");
        return { ok: true, id: String(retry.data.id) };
      }
      if (error.message?.includes("season") || error.message?.includes("note")) {
        const { season: _s, note: _n, unit_price_uah: _p, ...withoutExtra } =
          payload;
        const retry = await supabase
          .from("inventory_local_moves")
          .insert({ ...withoutExtra, unit_price_uah: unitPriceUah })
          .select("id")
          .single();
        if (retry.error) {
          const bare = await supabase
            .from("inventory_local_moves")
            .insert(withoutExtra)
            .select("id")
            .single();
          if (bare.error) return { ok: false, error: bare.error.message };
          const bareId = String(bare.data.id);
          void enqueueInventoryInboundBasDraft(bareId).catch((e) =>
            console.error("[bas-drafts] inbound", e)
          );
          revalidatePath("/inventory");
          return { ok: true, id: bareId };
        }
        await supabase
          .from("inventory_items_cache")
          .update({ planned_price_uah: unitPriceUah })
          .eq("bas_ref_key", itemRefKey);
        const retryId = String(retry.data.id);
        void enqueueInventoryInboundBasDraft(retryId).catch((e) =>
          console.error("[bas-drafts] inbound", e)
        );
        revalidatePath("/inventory");
        return { ok: true, id: retryId };
      }
      return { ok: false, error: error.message };
    }

    // Оновлюємо планову ціну в кеші — фінанси поля беруть її при списанні
    await supabase
      .from("inventory_items_cache")
      .update({ planned_price_uah: unitPriceUah })
      .eq("bas_ref_key", itemRefKey);

    const id = String(data.id);
    void enqueueInventoryInboundBasDraft(id).catch((e) =>
      console.error("[bas-drafts] inbound", e)
    );
    await logActivity({
      actor,
      action: "create",
      entityType: "inventory_move",
      entityId: id,
      summary: `${actor.label} оформив прихід ТМЦ`,
      meta: { type: "inbound", qty, itemRefKey },
    });
    revalidatePath("/inventory");
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося зберегти прихід",
    };
  }
}

export async function createLocalHarvestSale(input: {
  itemRefKey: string;
  qty: number;
  buyerName: string;
  unitPriceUah: number;
  date?: string | null;
  note?: string | null;
  season?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const itemRefKey = input.itemRefKey?.trim().toLowerCase();
  const buyerName = input.buyerName?.trim() || "";
  const qty = Number(input.qty);
  const unitPriceUah = Number(input.unitPriceUah);
  const season = String(input.season ?? "2026").trim() || "2026";
  const note = input.note?.trim() || null;
  const dateRaw = input.date?.trim();
  const dateIso = dateRaw
    ? new Date(
        dateRaw.includes("T") ? dateRaw : `${dateRaw}T12:00:00`
      ).toISOString()
    : new Date().toISOString();

  if (!itemRefKey) return { ok: false, error: "Оберіть культуру / ТМЦ" };
  if (!buyerName) return { ok: false, error: "Вкажіть покупця" };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Вкажіть кількість більше нуля" };
  }
  if (!Number.isFinite(unitPriceUah) || unitPriceUah < 0) {
    return { ok: false, error: "Вкажіть коректну ціну" };
  }
  if (Number.isNaN(new Date(dateIso).getTime())) {
    return { ok: false, error: "Невірна дата" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data: itemRow } = await supabase
      .from("inventory_items_cache")
      .select("category")
      .eq("bas_ref_key", itemRefKey)
      .maybeSingle();
    if (String(itemRow?.category ?? "") !== "harvest") {
      return { ok: false, error: "Продаж доступний лише для врожаю" };
    }

    const balance = await resolveQuickIssueVirtualBalance(itemRefKey);
    if (typeof balance !== "number") return balance;
    if (qty > balance) {
      return {
        ok: false,
        error: `Недостатньо на складі. Доступно: ${balance}`,
      };
    }

    const actor = await getCurrentActor();
    const payload: Record<string, unknown> = {
      item_ref_key: itemRefKey,
      field_id: null,
      type: "sale",
      qty,
      date: dateIso,
      status: "draft",
      season,
      note,
      buyer_name: buyerName,
      unit_price_uah: unitPriceUah,
      ...actorCreateColumns(actor),
    };
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (
        error.message?.includes("sale") ||
        error.message?.includes("buyer_name") ||
        error.message?.includes("unit_price") ||
        error.message?.includes("type")
      ) {
        return {
          ok: false,
          error:
            "Потрібна міграція 039 (продаж врожаю). Виконай SQL у Supabase, потім повтори.",
        };
      }
      return { ok: false, error: error.message };
    }

    const id = String(data.id);
    void enqueueInventorySaleBasDraft(id).catch((e) =>
      console.error("[bas-drafts] sale", e)
    );
    await logActivity({
      actor,
      action: "create",
      entityType: "inventory_move",
      entityId: id,
      summary: `${actor.label} оформив продаж врожаю`,
      meta: { type: "sale", qty, itemRefKey, buyerName },
    });
    revalidatePath("/inventory");
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося зберегти продаж",
    };
  }
}

export async function listBuyerSuggestions(): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: string }
> {
  return listCounterpartySuggestions("buyer");
}

export async function listSupplierSuggestions(): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: string }
> {
  return listCounterpartySuggestions("supplier");
}

/** Контрагенти з реальних BAS-документів (як у Фінансах) + локальні імена.
 *  Якщо BAS недоступний — усе одно віддаємо локальних покупців/постачальників. */
async function listCounterpartySuggestions(
  role: "buyer" | "supplier"
): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  const localNames = await listLocalCounterpartyNames(role);
  const counts = new Map<string, number>();
  for (const name of localNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  try {
    const since = "2024-03-01T00:00:00";
    const [docs, counterparties] = await Promise.all([
      role === "buyer" ? getBasSalesSince(since) : getBasReceiptsSince(since),
      getBasCounterparties(),
    ]);

    const cpMap = new Map(
      counterparties.map((c) => [
        c.Ref_Key.toLowerCase(),
        c.Description?.trim() || "",
      ])
    );

    for (const doc of docs) {
      const key = (doc.Контрагент_Key || "").toLowerCase();
      const name = cpMap.get(key);
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  } catch {
    // BAS read-only / offline — локальний список уже зібраний
  }

  const names = [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] || a[0].localeCompare(b[0], "uk", { sensitivity: "base" })
    )
    .map(([name]) => name);

  return { ok: true, names };
}

async function listLocalCounterpartyNames(
  role: "buyer" | "supplier"
): Promise<string[]> {
  try {
    const supabase = createServiceSupabase();
    const type = role === "buyer" ? "sale" : "inbound";
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select("buyer_name")
      .eq("type", type)
      .not("buyer_name", "is", null)
      .limit(500);
    if (error || !data) return [];
    return [
      ...new Set(
        data
          .map((r) =>
            typeof r.buyer_name === "string" ? r.buyer_name.trim() : ""
          )
          .filter((n) => n.length > 0)
      ),
    ];
  } catch {
    return [];
  }
}

export async function createLocalInventoryItem(input: {
  name: string;
  category: QuickIssueItemOption["category"];
  unit: string;
  plannedPriceUah?: number | null;
}): Promise<
  | { ok: true; basRefKey: string }
  | { ok: false; error: string }
> {
  const name = input.name?.trim();
  const unit = input.unit?.trim() || "шт";
  const category = input.category;
  if (!name) return { ok: false, error: "Вкажіть назву" };
  if (!STOCK_CATEGORIES.has(category)) {
    return { ok: false, error: "Невірна категорія" };
  }
  const price = Number(input.plannedPriceUah);
  // Колонка NOT NULL DEFAULT 0 — null ламає insert нових локальних позицій
  const plannedPriceUah =
    Number.isFinite(price) && price >= 0 ? price : 0;

  try {
    const supabase = createServiceSupabase();
    const basRefKey = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      bas_ref_key: basRefKey,
      name,
      category,
      unit,
      planned_price_uah: plannedPriceUah,
      is_local: true,
      is_hidden: false,
      custom_name: null,
    };
    const { error } = await supabase.from("inventory_items_cache").insert(payload);
    if (error) {
      if (error.message?.includes("is_local")) {
        const { is_local: _l, ...withoutLocal } = payload;
        const retry = await supabase
          .from("inventory_items_cache")
          .insert(withoutLocal);
        if (retry.error) return { ok: false, error: retry.error.message };
        revalidatePath("/inventory");
        return { ok: true, basRefKey };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/inventory");
    return { ok: true, basRefKey };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося створити позицію",
    };
  }
}

export async function getFieldEconomicsDashboard(
  activeSeason?: string
): Promise<
  | { ok: true; data: FieldEconomicsDashboardData }
  | { ok: false; error: string }
> {
  try {
    const season = String(activeSeason ?? "2026").trim() || "2026";
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select(
        `
        qty,
        field_id,
        farm_fields (
          id,
          name,
          crop,
          area_ha,
          planned_budget_per_ha
        ),
        inventory_items_cache (
          category,
          unit,
          unit_cost,
          planned_price_uah
        )
      `
      )
      .eq("type", "outbound")
      .eq("season", season)
      .not("field_id", "is", null);

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return {
          ok: false,
          error:
            "Таблиці Operational Inventory ще не створені. Виконай міграції 014–016.",
        };
      }
      // Колонка season ще не існує — без фільтра сезону
      if (error.message?.includes("season") || error.code === "42703") {
        const legacy = await supabase
          .from("inventory_local_moves")
          .select(
            `
            qty,
            field_id,
            farm_fields (
              id,
              name,
              crop,
              area_ha,
              planned_budget_per_ha
            ),
            inventory_items_cache (
              category,
              unit,
              unit_cost,
              planned_price_uah
            )
          `
          )
          .eq("type", "outbound")
          .not("field_id", "is", null);
        if (legacy.error) {
          return { ok: false, error: legacy.error.message };
        }
        const rows = (legacy.data ?? []).map((row) => {
          const cache = unwrapJoin(row.inventory_items_cache) as {
            category: string;
            unit: string | null;
            unit_cost?: number | null;
            planned_price_uah?: number | null;
          } | null;
          return normalizeEconomicsRow(row, {
            unitCost: cache?.unit_cost != null ? Number(cache.unit_cost) : null,
            planned:
              cache?.planned_price_uah != null
                ? Number(cache.planned_price_uah)
                : null,
          });
        });
        return { ok: true, data: aggregateFieldEconomics(rows) };
      }
      // planned_price_uah може ще не існувати — повтор без нього
      if (
        error.message?.includes("planned_price_uah") ||
        error.message?.includes("unit_cost")
      ) {
        const fallback = await supabase
          .from("inventory_local_moves")
          .select(
            `
            qty,
            field_id,
            farm_fields ( id, name, crop, area_ha ),
            inventory_items_cache ( category, unit, unit_cost )
          `
          )
          .eq("type", "outbound")
          .eq("season", season)
          .not("field_id", "is", null);
        if (fallback.error) {
          // ще старший кеш без unit_cost
          const bare = await supabase
            .from("inventory_local_moves")
            .select(
              `
              qty,
              field_id,
              farm_fields ( id, name, crop, area_ha ),
              inventory_items_cache ( category, unit )
            `
            )
            .eq("type", "outbound")
            .eq("season", season)
            .not("field_id", "is", null);
          if (bare.error) {
            return { ok: false, error: bare.error.message };
          }
          return {
            ok: true,
            data: aggregateFieldEconomics(
              (bare.data ?? []).map((row) =>
                normalizeEconomicsRow(row, { unitCost: null, planned: null })
              )
            ),
          };
        }
        return {
          ok: true,
          data: aggregateFieldEconomics(
            (fallback.data ?? []).map((row) => {
              const cache = unwrapJoin(row.inventory_items_cache) as {
                category: string;
                unit: string | null;
                unit_cost?: number | null;
              } | null;
              return normalizeEconomicsRow(row, {
                unitCost:
                  cache?.unit_cost != null ? Number(cache.unit_cost) : null,
                planned: null,
              });
            })
          ),
        };
      }
      return { ok: false, error: error.message };
    }

    const rows = (data ?? []).map((row) => {
      const cache = unwrapJoin(row.inventory_items_cache) as {
        category: string;
        unit: string | null;
        unit_cost?: number | null;
        planned_price_uah?: number | null;
      } | null;
      return normalizeEconomicsRow(row, {
        unitCost: cache?.unit_cost != null ? Number(cache.unit_cost) : null,
        planned:
          cache?.planned_price_uah != null
            ? Number(cache.planned_price_uah)
            : null,
      });
    });

    return { ok: true, data: aggregateFieldEconomics(rows) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити економіку полів",
    };
  }
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeEconomicsRow(
  row: {
    qty: unknown;
    field_id: unknown;
    farm_fields: unknown;
    inventory_items_cache: unknown;
  },
  prices: { unitCost: number | null; planned: number | null }
) {
  const field = unwrapJoin(row.farm_fields) as {
    id: string;
    name: string;
    crop: string;
    area_ha: number;
    planned_budget_per_ha?: number | null;
  } | null;
  const cache = unwrapJoin(row.inventory_items_cache) as {
    category: string;
    unit: string | null;
  } | null;
  return {
    qty: Number(row.qty) || 0,
    field_id: (row.field_id as string | null) ?? null,
    farm_fields: field,
    inventory_items_cache: cache
      ? {
          category: String(cache.category),
          unit: cache.unit,
          unit_cost: prices.unitCost,
          planned_price_uah: prices.planned,
        }
      : null,
  };
}

export async function syncLocalMovesToBasAction(): Promise<
  | { ok: true; data: SyncLocalMovesToBasResult }
  | { ok: false; error: string }
> {
  try {
    const data = await syncLocalMovesToBas();
    revalidatePath("/inventory");
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося синхронізувати чернетки з BAS AGRO",
    };
  }
}

/** Суми локальних рухів по bas_ref_key. sale рахується як відтік (як outbound). */
export type LocalOutboundRow = {
  id: string;
  ref: string;
  qty: number;
  dateYmd: string;
  type: "outbound" | "inbound" | "sale";
  status: "draft" | "sent_to_1c";
  note: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  fieldName: string | null;
  attachmentCount: number;
  receiptId: string | null;
  invoiceNumber: string | null;
};

export async function getLocalMoveQtyByItem(): Promise<
  | {
      ok: true;
      outboundByRef: Record<string, number>;
      inboundByRef: Record<string, number>;
      saleByRef: Record<string, number>;
      rows: LocalOutboundRow[];
    }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select(
        "id, item_ref_key, qty, date, type, status, note, buyer_name, unit_price_uah, field_id, receipt_id, farm_fields ( name ), warehouse_receipts ( invoice_number, invoice_date, supplier_name )"
      );

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return {
          ok: true,
          outboundByRef: {},
          inboundByRef: {},
          saleByRef: {},
          rows: [],
        };
      }
      // Fallback без receipt join (міграція 062 ще не застосована)
      if (
        error.message?.includes("receipt_id") ||
        error.message?.includes("warehouse_receipts")
      ) {
        const mid = await supabase
          .from("inventory_local_moves")
          .select(
            "id, item_ref_key, qty, date, type, status, note, buyer_name, unit_price_uah, field_id, farm_fields ( name )"
          );
        if (mid.error) {
          const legacy = await supabase
            .from("inventory_local_moves")
            .select("id, item_ref_key, qty, date, type, status, note, field_id");
          if (legacy.error) {
            return { ok: false, error: legacy.error.message };
          }
          return aggregateLocalMoves(
            (legacy.data ?? []) as Record<string, unknown>[]
          );
        }
        return aggregateLocalMoves(
          (mid.data ?? []) as Record<string, unknown>[]
        );
      }
      // Fallback якщо 039 / join ще недоступні
      const legacy = await supabase
        .from("inventory_local_moves")
        .select("id, item_ref_key, qty, date, type, status, note, field_id");
      if (legacy.error) {
        return { ok: false, error: legacy.error.message };
      }
      return aggregateLocalMoves(
        (legacy.data ?? []) as Record<string, unknown>[]
      );
    }

    return aggregateLocalMoves((data ?? []) as Record<string, unknown>[]);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити локальні рухи",
    };
  }
}

async function aggregateLocalMoves(
  data: Record<string, unknown>[]
): Promise<{
  ok: true;
  outboundByRef: Record<string, number>;
  inboundByRef: Record<string, number>;
  saleByRef: Record<string, number>;
  rows: LocalOutboundRow[];
}> {
  const outboundByRef: Record<string, number> = {};
  const inboundByRef: Record<string, number> = {};
  const saleByRef: Record<string, number> = {};
  const rows: LocalOutboundRow[] = [];
  for (const row of data) {
    const key = String(row.item_ref_key).toLowerCase();
    const qty = Number(row.qty) || 0;
    const type =
      row.type === "inbound"
        ? ("inbound" as const)
        : row.type === "sale"
          ? ("sale" as const)
          : ("outbound" as const);
    const status: "draft" | "sent_to_1c" =
      row.status === "sent_to_1c" ? "sent_to_1c" : "draft";
    // Після mark sent → бухгалтер проводить у BAS AGRO → BAS sync.
    // У віртуальний залишок / KPI лишаємо лише draft, інакше подвійний рахунок.
    if (status === "draft") {
      if (type === "inbound") {
        inboundByRef[key] = (inboundByRef[key] ?? 0) + qty;
      } else if (type === "sale") {
        saleByRef[key] = (saleByRef[key] ?? 0) + qty;
        outboundByRef[key] = (outboundByRef[key] ?? 0) + qty;
      } else {
        outboundByRef[key] = (outboundByRef[key] ?? 0) + qty;
      }
    }
    const at = new Date(String(row.date));
    const fieldRaw = row.farm_fields as
      | { name?: string }
      | { name?: string }[]
      | null
      | undefined;
    const field = Array.isArray(fieldRaw) ? fieldRaw[0] ?? null : fieldRaw;
    const priceRaw = row.unit_price_uah;
    const unitPriceUah =
      priceRaw != null && Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : null;
    const receiptRaw = row.warehouse_receipts as
      | { invoice_number?: string | null; invoice_date?: string | null; supplier_name?: string | null }
      | { invoice_number?: string | null; invoice_date?: string | null; supplier_name?: string | null }[]
      | null
      | undefined;
    const receipt = Array.isArray(receiptRaw)
      ? receiptRaw[0] ?? null
      : receiptRaw;
    const note =
      typeof row.note === "string" && row.note.trim() ? String(row.note) : null;
    const invoiceFromNote = note?.match(/№\s*([^\s·]+)/)?.[1]?.trim() || null;
    const invoiceNumber =
      (typeof receipt?.invoice_number === "string" &&
      receipt.invoice_number.trim()
        ? receipt.invoice_number.trim()
        : null) || invoiceFromNote;
    rows.push({
      id: String(row.id ?? ""),
      ref: key,
      qty,
      type,
      status,
      dateYmd: Number.isNaN(at.getTime()) ? "" : toKyivDayKey(at),
      note,
      buyerName:
        typeof row.buyer_name === "string" && row.buyer_name.trim()
          ? String(row.buyer_name)
          : null,
      unitPriceUah,
      fieldName: field?.name ? String(field.name) : null,
      attachmentCount: 0,
      receiptId:
        typeof row.receipt_id === "string" && row.receipt_id.trim()
          ? String(row.receipt_id)
          : null,
      invoiceNumber,
    });
  }

  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length > 0) {
    try {
      const { countAttachmentsByEntityIds } = await import(
        "@/lib/operation-attachments"
      );
      const counts = await countAttachmentsByEntityIds("inventory_move", ids);
      for (const r of rows) {
        r.attachmentCount = counts[r.id] ?? 0;
      }
    } catch {
      /* таблиця attachments може ще не існувати */
    }
  }

  return { ok: true, outboundByRef, inboundByRef, saleByRef, rows };
}

/** @deprecated — використовуй getLocalMoveQtyByItem; byRef = outbound (+sale) */
export async function getLocalOutboundQtyByItem(): Promise<
  | {
      ok: true;
      byRef: Record<string, number>;
      inboundByRef: Record<string, number>;
      saleByRef: Record<string, number>;
      rows: LocalOutboundRow[];
    }
  | { ok: false; error: string }
> {
  const res = await getLocalMoveQtyByItem();
  if (!res.ok) return res;
  return {
    ok: true,
    byRef: res.outboundByRef,
    inboundByRef: res.inboundByRef,
    saleByRef: res.saleByRef,
    rows: res.rows.filter((r) => r.type !== "inbound"),
  };
}

export async function getInventoryItemUnitCost(
  basRefKey: string
): Promise<
  | { ok: true; unitCost: number | null }
  | { ok: false; error: string }
> {
  const key = basRefKey?.trim().toLowerCase();
  if (!key) return { ok: false, error: "Невірний ключ ТМЦ" };

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_items_cache")
      .select("planned_price_uah, unit_cost")
      .eq("bas_ref_key", key)
      .maybeSingle();

    if (error) {
      if (error.message?.includes("planned_price_uah")) {
        const legacy = await supabase
          .from("inventory_items_cache")
          .select("unit_cost")
          .eq("bas_ref_key", key)
          .maybeSingle();
        if (legacy.error) {
          if (legacy.error.message?.includes("unit_cost")) {
            return { ok: true, unitCost: null };
          }
          return { ok: false, error: legacy.error.message };
        }
        return {
          ok: true,
          unitCost:
            legacy.data?.unit_cost != null
              ? Number(legacy.data.unit_cost)
              : null,
        };
      }
      return { ok: false, error: error.message };
    }

    const planned =
      data?.planned_price_uah != null ? Number(data.planned_price_uah) : 0;
    if (Number.isFinite(planned) && planned > 0) {
      return { ok: true, unitCost: planned };
    }
    return {
      ok: true,
      unitCost: data?.unit_cost != null ? Number(data.unit_cost) : null,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося прочитати ціну",
    };
  }
}

export async function updateInventoryItemUnitCost(input: {
  basRefKey: string;
  unitCost: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const basRefKey = input.basRefKey?.trim().toLowerCase();
  const unitCost = Number(input.unitCost);

  if (!basRefKey) return { ok: false, error: "Невірний ключ ТМЦ" };
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: "Вкажіть коректну ціну (≥ 0)" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_items_cache")
      .update({
        planned_price_uah: unitCost,
        updated_at: new Date().toISOString(),
      })
      .eq("bas_ref_key", basRefKey)
      .select("bas_ref_key");

    if (error) {
      return {
        ok: false,
        error: error.message?.includes("planned_price_uah")
          ? "Колонка planned_price_uah відсутня. Виконай міграцію 016."
          : error.message,
      };
    }
    if (!data?.length) {
      return {
        ok: false,
        error:
          "Позиції немає в кеші. Спочатку синхронізуй номенклатуру з BAS AGRO.",
      };
    }

    revalidatePath("/inventory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося зберегти ціну",
    };
  }
}

// ── Cache meta + CRUD (custom_name / is_hidden / planned_price) ─────

export type InventoryCacheMeta = {
  basRefKey: string;
  basName: string;
  customName: string | null;
  isHidden: boolean;
  plannedPriceUah: number;
  /** Ціна з BAS AGRO (unit_cost), якщо є в кеші */
  unitCostUah: number;
  category: string;
  unit: string;
  isLocal: boolean;
};

export async function getInventoryCacheMetaMap(): Promise<
  | { ok: true; byRef: Record<string, InventoryCacheMeta> }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();

    function mapRows(
      rows: {
        bas_ref_key: unknown;
        name: unknown;
        custom_name?: unknown;
        is_hidden?: unknown;
        planned_price_uah?: unknown;
        unit_cost?: unknown;
        category: unknown;
        unit?: unknown;
        is_local?: unknown;
      }[],
      isLocalDefault = false
    ): Record<string, InventoryCacheMeta> {
      const byRef: Record<string, InventoryCacheMeta> = {};
      for (const row of rows) {
        const key = String(row.bas_ref_key).toLowerCase();
        const unitCostRaw = row.unit_cost;
        byRef[key] = {
          basRefKey: key,
          basName: String(row.name),
          customName: row.custom_name ? String(row.custom_name) : null,
          isHidden: Boolean(row.is_hidden),
          plannedPriceUah: Number(row.planned_price_uah) || 0,
          unitCostUah:
            unitCostRaw != null && Number(unitCostRaw) > 0
              ? Number(unitCostRaw)
              : 0,
          category: String(row.category),
          unit: String(row.unit ?? ""),
          isLocal:
            row.is_local != null ? Boolean(row.is_local) : isLocalDefault,
        };
      }
      return byRef;
    }

    const { data, error } = await supabase
      .from("inventory_items_cache")
      .select(
        "bas_ref_key, name, custom_name, is_hidden, planned_price_uah, unit_cost, category, unit, is_local"
      );

    if (!error) {
      return { ok: true, byRef: mapRows(data ?? []) };
    }

    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("is_hidden") ||
      error.message?.includes("custom_name")
    ) {
      return { ok: true, byRef: {} };
    }

    // Fallback без is_local / unit_cost
    if (
      error.message?.includes("is_local") ||
      error.message?.includes("unit_cost")
    ) {
      const withCost = await supabase
        .from("inventory_items_cache")
        .select(
          "bas_ref_key, name, custom_name, is_hidden, planned_price_uah, unit_cost, category, unit"
        );
      if (!withCost.error) {
        return {
          ok: true,
          byRef: mapRows(withCost.data ?? [], false),
        };
      }
      const legacy = await supabase
        .from("inventory_items_cache")
        .select(
          "bas_ref_key, name, custom_name, is_hidden, planned_price_uah, category, unit"
        );
      if (legacy.error) {
        if (
          legacy.error.code === "PGRST205" ||
          legacy.error.code === "42P01" ||
          legacy.error.message?.includes("is_hidden")
        ) {
          return { ok: true, byRef: {} };
        }
        return { ok: false, error: legacy.error.message };
      }
      return { ok: true, byRef: mapRows(legacy.data ?? [], false) };
    }

    return { ok: false, error: error.message };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити кеш ТМЦ",
    };
  }
}

export type CacheSeed = {
  name: string;
  category: string;
  unit: string;
};

async function upsertInventoryCachePatch(
  basRefKey: string,
  patch: {
    custom_name?: string | null;
    planned_price_uah?: number;
    is_hidden?: boolean;
  },
  seed?: CacheSeed
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  const { data: existing, error: readErr } = await supabase
    .from("inventory_items_cache")
    .select("bas_ref_key")
    .eq("bas_ref_key", basRefKey)
    .maybeSingle();

  if (readErr) {
    return {
      ok: false,
      error: readErr.message?.includes("is_hidden")
        ? "Колонки UI-кешу відсутні. Виконай міграцію 017."
        : readErr.message,
    };
  }

  if (!existing) {
    if (!seed?.name || !seed.category) {
      return {
        ok: false,
        error:
          "Позиції немає в кеші. Спочатку синхронізуй номенклатуру або відкрий «Редагувати».",
      };
    }
    const { error } = await supabase.from("inventory_items_cache").insert({
      bas_ref_key: basRefKey,
      name: seed.name,
      category: seed.category,
      unit: seed.unit || "",
      custom_name: patch.custom_name ?? null,
      planned_price_uah: patch.planned_price_uah ?? 0,
      is_hidden: patch.is_hidden ?? false,
      updated_at: now,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inventory");
    return { ok: true };
  }

  const { error } = await supabase
    .from("inventory_items_cache")
    .update({ ...patch, updated_at: now })
    .eq("bas_ref_key", basRefKey);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true };
}

export async function updateInventoryItemCard(input: {
  basRefKey: string;
  customName: string | null;
  plannedPriceUah: number;
  seed?: CacheSeed;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const basRefKey = input.basRefKey?.trim().toLowerCase();
  const price = Number(input.plannedPriceUah);
  if (!basRefKey) return { ok: false, error: "Невірний ключ ТМЦ" };
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: "Вкажіть коректну ціну (≥ 0)" };
  }
  const customName = input.customName?.trim() || null;
  return upsertInventoryCachePatch(
    basRefKey,
    { custom_name: customName, planned_price_uah: price },
    input.seed
  );
}

export async function setInventoryItemHidden(input: {
  basRefKey: string;
  isHidden: boolean;
  seed?: CacheSeed;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const basRefKey = input.basRefKey?.trim().toLowerCase();
  if (!basRefKey) return { ok: false, error: "Невірний ключ ТМЦ" };
  return upsertInventoryCachePatch(
    basRefKey,
    { is_hidden: input.isHidden },
    input.seed
  );
}

// ── Local moves journal CRUD ────────────────────────────────────────

export type LocalMoveRow = {
  id: string;
  date: string;
  qty: number;
  type: "outbound" | "inbound" | "sale";
  status: "draft" | "sent_to_1c";
  season: string | null;
  itemRefKey: string;
  itemName: string;
  itemUnit: string;
  itemCategory: string | null;
  fieldId: string | null;
  fieldName: string | null;
  note: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  actorName: string | null;
  attachmentCount: number;
};

export async function listLocalMoves(input?: {
  season?: string | null;
}): Promise<
  | { ok: true; moves: LocalMoveRow[] }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const season = input?.season?.trim() || null;
    let query = supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        type,
        status,
        note,
        season,
        buyer_name,
        unit_price_uah,
        item_ref_key,
        field_id,
        actor_name,
        farm_fields ( id, name ),
        inventory_items_cache ( name, custom_name, unit, category )
      `
      )
      .order("date", { ascending: false })
      .limit(400);

    if (season) {
      query = query.eq("season", season);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, moves: [] };
      }
      // Fallback без season / note / sale columns
      if (
        error.message?.includes("season") ||
        error.message?.includes("note") ||
        error.message?.includes("buyer_name") ||
        error.message?.includes("unit_price") ||
        error.message?.includes("actor_name")
      ) {
        const legacy = await supabase
          .from("inventory_local_moves")
          .select(
            `
            id,
            date,
            qty,
            type,
            status,
            item_ref_key,
            field_id,
            farm_fields ( id, name ),
            inventory_items_cache ( name, custom_name, unit, category )
          `
          )
          .order("date", { ascending: false })
          .limit(400);
        if (legacy.error) {
          if (legacy.error.code === "PGRST205" || legacy.error.code === "42P01") {
            return { ok: true, moves: [] };
          }
          return { ok: false, error: legacy.error.message };
        }
        return {
          ok: true,
          moves: await enrichMovesWithAttachmentCounts(
            mapLocalMoveRows(legacy.data ?? [])
          ),
        };
      }
      return { ok: false, error: error.message };
    }

    return { ok: true, moves: await enrichMovesWithAttachmentCounts(mapLocalMoveRows(data ?? [])) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити журнал рухів",
    };
  }
}

export async function getLocalMoveById(
  id: string
): Promise<{ ok: true; move: LocalMoveRow } | { ok: false; error: string }> {
  const moveId = id?.trim();
  if (!moveId) return { ok: false, error: "Невірний id" };
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        type,
        status,
        note,
        season,
        buyer_name,
        unit_price_uah,
        item_ref_key,
        field_id,
        actor_name,
        farm_fields ( id, name ),
        inventory_items_cache ( name, custom_name, unit, category )
      `
      )
      .eq("id", moveId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: false, error: "Таблиця рухів відсутня" };
      }
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: "Операцію не знайдено" };
    const [move] = await enrichMovesWithAttachmentCounts(
      mapLocalMoveRows([data as Record<string, unknown>])
    );
    if (!move) return { ok: false, error: "Операцію не знайдено" };
    return { ok: true, move };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити операцію",
    };
  }
}

async function enrichMovesWithAttachmentCounts(
  moves: LocalMoveRow[]
): Promise<LocalMoveRow[]> {
  if (moves.length === 0) return moves;
  try {
    const supabase = createServiceSupabase();
    const ids = moves.map((m) => m.id);
    const { data, error } = await supabase
      .from("operation_attachments")
      .select("entity_id")
      .eq("entity_type", "inventory_move")
      .in("entity_id", ids);
    if (error || !data) return moves;
    const counts: Record<string, number> = {};
    for (const row of data) {
      const id = String(row.entity_id);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return moves.map((m) => ({
      ...m,
      attachmentCount: counts[m.id] ?? 0,
    }));
  } catch {
    return moves;
  }
}

function mapLocalMoveRows(data: Record<string, unknown>[]): LocalMoveRow[] {
  return data.map((row) => {
    const fieldRaw = row.farm_fields as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
    const field = Array.isArray(fieldRaw) ? fieldRaw[0] ?? null : fieldRaw;
    const cacheRaw = row.inventory_items_cache as
      | {
          name: string;
          custom_name: string | null;
          unit: string | null;
          category?: string | null;
        }
      | {
          name: string;
          custom_name: string | null;
          unit: string | null;
          category?: string | null;
        }[]
      | null;
    const cache = Array.isArray(cacheRaw) ? cacheRaw[0] ?? null : cacheRaw;
    const status =
      row.status === "sent_to_1c" ? "sent_to_1c" : ("draft" as const);
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
      date: String(row.date),
      qty: Number(row.qty) || 0,
      type,
      status,
      season:
        typeof row.season === "string" && row.season.trim()
          ? String(row.season)
          : null,
      itemRefKey: String(row.item_ref_key).toLowerCase(),
      itemName: String(cache?.custom_name?.trim() || cache?.name || "ТМЦ"),
      itemUnit: String(cache?.unit ?? ""),
      itemCategory: cache?.category ? String(cache.category) : null,
      fieldId: field?.id
        ? String(field.id)
        : row.field_id
          ? String(row.field_id)
          : null,
      fieldName: field?.name ? String(field.name) : null,
      note: typeof row.note === "string" ? String(row.note) : null,
      buyerName:
        typeof row.buyer_name === "string" && row.buyer_name.trim()
          ? String(row.buyer_name)
          : null,
      unitPriceUah,
      actorName:
        typeof row.actor_name === "string" && row.actor_name.trim()
          ? String(row.actor_name).trim()
          : null,
      attachmentCount: 0,
    };
  });
}

export async function updateLocalMove(input: {
  id: string;
  qty?: number;
  /** undefined — не змінювати; null — зняти поле; string — нове поле */
  fieldId?: string | null;
  buyerName?: string | null;
  unitPriceUah?: number | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = input.id?.trim();
  if (!id) return { ok: false, error: "Невірний id" };

  try {
    const supabase = createServiceSupabase();
    const { data: existing, error: readErr } = await supabase
      .from("inventory_local_moves")
      .select("id, status, qty, type, item_ref_key, field_id")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!existing) return { ok: false, error: "Рух не знайдено" };
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Операцію вже передано бухгалтеру — редагування заборонено",
      };
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.qty != null) {
      const qty = Number(input.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, error: "Кількість має бути > 0" };
      }

      const moveType = String(existing.type ?? "outbound");
      const prevQty = Number(existing.qty) || 0;
      if ((moveType === "outbound" || moveType === "sale") && qty > prevQty) {
        const itemRef = String(existing.item_ref_key ?? "").toLowerCase();
        const balance = await resolveQuickIssueVirtualBalance(itemRef);
        if (typeof balance !== "number") return balance;
        const available = Math.round((balance + prevQty) * 100) / 100;
        if (qty > available) {
          return {
            ok: false,
            error: `Недостатньо на складі. Доступно: ${available}`,
          };
        }
      }
      patch.qty = qty;
    }

    if (input.fieldId !== undefined) {
      if (input.fieldId === null || input.fieldId.trim() === "") {
        patch.field_id = null;
      } else {
        patch.field_id = input.fieldId.trim().toLowerCase();
      }
    }

    if (input.buyerName !== undefined) {
      patch.buyer_name = input.buyerName?.trim() || null;
    }
    if (input.unitPriceUah !== undefined) {
      const price = Number(input.unitPriceUah);
      if (input.unitPriceUah != null && (!Number.isFinite(price) || price < 0)) {
        return { ok: false, error: "Невірна ціна" };
      }
      patch.unit_price_uah =
        input.unitPriceUah == null ? null : price;
    }

    if (input.note !== undefined) {
      patch.note = input.note?.trim() || null;
    }

    const actor = await getCurrentActor();
    Object.assign(patch, actorUpdateColumns(actor));

    const { error } = await supabase
      .from("inventory_local_moves")
      .update(patch)
      .eq("id", id)
      .eq("status", "draft");

    if (error) {
      if (error.message?.includes("updated_by")) {
        delete patch.updated_by_id;
        delete patch.updated_by_name;
        const retry = await supabase
          .from("inventory_local_moves")
          .update(patch)
          .eq("id", id)
          .eq("status", "draft");
        if (retry.error) return { ok: false, error: retry.error.message };
      } else {
        return { ok: false, error: error.message };
      }
    }

    if (
      String(existing.type) === "inbound" &&
      input.unitPriceUah != null &&
      Number.isFinite(Number(input.unitPriceUah))
    ) {
      await supabase
        .from("inventory_items_cache")
        .update({ planned_price_uah: Number(input.unitPriceUah) })
        .eq("bas_ref_key", String(existing.item_ref_key).toLowerCase());
    }

    await logActivity({
      actor,
      action: "update",
      entityType: "inventory_move",
      entityId: id,
      summary: `${actor.label} змінив рух ТМЦ`,
      meta: { type: existing.type },
    });

    revalidatePath("/inventory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося оновити рух",
    };
  }
}

export async function deleteLocalMove(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const moveId = id?.trim();
  if (!moveId) return { ok: false, error: "Невірний id" };

  try {
    const supabase = createServiceSupabase();
    const { data: existing, error: readErr } = await supabase
      .from("inventory_local_moves")
      .select("id, status")
      .eq("id", moveId)
      .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!existing) return { ok: false, error: "Рух не знайдено" };
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Операцію вже передано бухгалтеру — видалення заборонено",
      };
    }

    try {
      const { deleteAttachmentsForEntity } = await import(
        "@/lib/operation-attachments"
      );
      await deleteAttachmentsForEntity("inventory_move", moveId);
    } catch {
      /* best-effort */
    }

    const { error } = await supabase
      .from("inventory_local_moves")
      .delete()
      .eq("id", moveId)
      .eq("status", "draft");

    if (error) return { ok: false, error: error.message };

    const actor = await getCurrentActor();
    await logActivity({
      actor,
      action: "delete",
      entityType: "inventory_move",
      entityId: moveId,
      summary: `${actor.label} видалив рух ТМЦ`,
    });

    revalidatePath("/inventory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося видалити рух",
    };
  }
}

/** Оприбуткування розпізнаної накладної з LEVADIUS-картки */
export async function executeWarehouseReceiptAction(input: {
  supplierName: string;
  supplierEdrpou?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  totalAmount?: number | null;
  receiptId?: string | null;
  items: {
    name: string;
    category: "ЗЗР" | "Добрива" | "Насіння" | "Паливо" | "Запчастини";
    quantity: number;
    unit: string;
    pricePerUnit: number;
    totalAmount?: number | null;
  }[];
  /** Скан/фото накладної (base64 без data: префікса) — прикріплюється до кожного приходу */
  attachment?: {
    fileName: string;
    mimeType: string;
    base64: string;
  } | null;
  /** Кілька сканів (пріоритетніше за attachment) */
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> | null;
}) {
  const { executeWarehouseReceipt } = await import(
    "@/lib/agent-warehouse-receipt"
  );
  const result = await executeWarehouseReceipt(input);
  if (!result.success) return result;

  const docs =
    input.attachments?.filter((a) => a?.base64) ??
    (input.attachment?.base64 ? [input.attachment] : []);

  if (docs.length > 0 && result.moveIds.length > 0) {
    try {
      const { uploadOperationAttachment } = await import(
        "@/lib/operation-attachments"
      );
      for (const moveId of result.moveIds) {
        for (const doc of docs) {
          const bytes = Buffer.from(doc.base64, "base64");
          await uploadOperationAttachment({
            entityType: "inventory_move",
            entityId: moveId,
            fileName: doc.fileName || "nakladna.jpg",
            mimeType: doc.mimeType || "image/jpeg",
            bytes,
          });
        }
      }
    } catch (err) {
      console.error("[executeWarehouseReceiptAction] attachment", err);
    }
  }

  revalidatePath("/inventory");
  revalidatePath("/fields");
  return result;
}

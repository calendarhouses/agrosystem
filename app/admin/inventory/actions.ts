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
import {
  syncLocalMovesToBas,
  type SyncLocalMovesToBasResult,
} from "@/lib/inventory-bas-draft-sync";
import {
  syncNomenclatureToSupabase,
  type SyncNomenclatureResult,
} from "@/lib/inventory-sync";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function syncInventoryNomenclatureAction(): Promise<
  { ok: true; data: SyncNomenclatureResult } | { ok: false; error: string }
> {
  try {
    const data = await syncNomenclatureToSupabase();
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
  category: "zzr" | "fertilizer" | "seed";
  categoryLabel: string;
  unit: string;
  virtualBalance: number;
  plannedPriceUah: number | null;
};

const QUICK_ISSUE_CATEGORY_LABELS: Record<
  QuickIssueItemOption["category"],
  string
> = {
  zzr: "ЗЗР",
  fertilizer: "Добриво",
  seed: "Насіння",
};

const BAS_STOCK_SINCE = "2024-03-01T00:00:00";

async function loadBasQtyInByRef(): Promise<Record<string, number>> {
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

    const map: Record<string, number> = {};
    for (const item of full.items) {
      map[item.id.toLowerCase()] = item.qtyIn;
    }
    return map;
  } catch {
    return {};
  }
}

async function resolveQuickIssueVirtualBalance(
  basRefKey: string
): Promise<number | { ok: false; error: string }> {
  const key = basRefKey.trim().toLowerCase();
  const [outboundRes, qtyInMap] = await Promise.all([
    getLocalOutboundQtyByItem(),
    loadBasQtyInByRef(),
  ]);
  if (!outboundRes.ok) {
    return { ok: false, error: outboundRes.error };
  }
  const qtyIn = qtyInMap[key] ?? 0;
  const qtyOut = outboundRes.byRef[key] ?? 0;
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

    const [itemsRes, fieldsRes, outboundRes, qtyInMap] = await Promise.all([
      supabase
        .from("inventory_items_cache")
        .select(
          "bas_ref_key, name, custom_name, category, unit, is_hidden, planned_price_uah"
        )
        .in("category", ["zzr", "fertilizer", "seed"])
        .order("name"),
      supabase
        .from("farm_fields")
        .select("id, name, area_ha, crop")
        .order("name"),
      getLocalOutboundQtyByItem(),
      loadBasQtyInByRef(),
    ]);

    const outboundByRef = outboundRes.ok ? outboundRes.byRef : {};

    if (itemsRes.error) {
      if (
        itemsRes.error.message?.includes("is_hidden") ||
        itemsRes.error.message?.includes("custom_name") ||
        itemsRes.error.message?.includes("planned_price_uah")
      ) {
        const legacy = await supabase
          .from("inventory_items_cache")
          .select("bas_ref_key, name, category, unit")
          .in("category", ["zzr", "fertilizer", "seed"])
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
      .filter(
        (row) =>
          (row.category === "zzr" ||
            row.category === "fertilizer" ||
            row.category === "seed") &&
          !row.is_hidden
      )
      .map((row) => {
        const basRefKey = String(row.bas_ref_key);
        const key = basRefKey.toLowerCase();
        const category = row.category as QuickIssueItemOption["category"];
        const qtyIn = qtyInMap[key] ?? 0;
        const qtyOut = outboundByRef[key] ?? 0;
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
  fieldId: string;
  qty: number;
  /** Агросезон ('2026'); якщо не передано — DEFAULT_SEASON */
  season?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const itemRefKey = input.itemRefKey?.trim().toLowerCase();
  const fieldId = input.fieldId?.trim().toLowerCase();
  const qty = Number(input.qty);
  const season = String(input.season ?? "2026").trim() || "2026";

  if (!itemRefKey) return { ok: false, error: "Оберіть ТМЦ" };
  if (!fieldId) return { ok: false, error: "Оберіть поле" };
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
    const payload: Record<string, unknown> = {
      item_ref_key: itemRefKey,
      field_id: fieldId,
      type: "outbound",
      qty,
      date: new Date().toISOString(),
      status: "draft",
      season,
    };
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (error.message?.includes("season")) {
        const { season: _s, ...withoutSeason } = payload;
        const retry = await supabase
          .from("inventory_local_moves")
          .insert(withoutSeason)
          .select("id")
          .single();
        if (retry.error) return { ok: false, error: retry.error.message };
        revalidatePath("/inventory");
        revalidatePath("/fields");
        return { ok: true, id: String(retry.data.id) };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/inventory");
    revalidatePath("/fields");
    return { ok: true, id: String(data.id) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося зберегти списання",
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
          : "Не вдалося синхронізувати чернетки з 1С",
    };
  }
}

/** Сума outbound з inventory_local_moves по bas_ref_key (item_ref_key). */
export async function getLocalOutboundQtyByItem(): Promise<
  | { ok: true; byRef: Record<string, number> }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select("item_ref_key, qty")
      .eq("type", "outbound");

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, byRef: {} };
      }
      return { ok: false, error: error.message };
    }

    const byRef: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = String(row.item_ref_key).toLowerCase();
      byRef[key] = (byRef[key] ?? 0) + (Number(row.qty) || 0);
    }
    return { ok: true, byRef };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити локальні списання",
    };
  }
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
          "Позиції немає в кеші. Спочатку синхронізуй номенклатуру з 1С.",
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
  category: string;
  unit: string;
};

export async function getInventoryCacheMetaMap(): Promise<
  | { ok: true; byRef: Record<string, InventoryCacheMeta> }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_items_cache")
      .select(
        "bas_ref_key, name, custom_name, is_hidden, planned_price_uah, category, unit"
      );

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("is_hidden") ||
        error.message?.includes("custom_name")
      ) {
        return { ok: true, byRef: {} };
      }
      return { ok: false, error: error.message };
    }

    const byRef: Record<string, InventoryCacheMeta> = {};
    for (const row of data ?? []) {
      const key = String(row.bas_ref_key).toLowerCase();
      byRef[key] = {
        basRefKey: key,
        basName: String(row.name),
        customName: row.custom_name ? String(row.custom_name) : null,
        isHidden: Boolean(row.is_hidden),
        plannedPriceUah: Number(row.planned_price_uah) || 0,
        category: String(row.category),
        unit: String(row.unit ?? ""),
      };
    }
    return { ok: true, byRef };
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
  status: "draft" | "sent_to_1c";
  itemRefKey: string;
  itemName: string;
  itemUnit: string;
  fieldId: string | null;
  fieldName: string | null;
};

export async function listLocalMoves(): Promise<
  | { ok: true; moves: LocalMoveRow[] }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        status,
        item_ref_key,
        field_id,
        farm_fields ( id, name ),
        inventory_items_cache ( name, custom_name, unit )
      `
      )
      .eq("type", "outbound")
      .order("date", { ascending: false })
      .limit(300);

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, moves: [] };
      }
      return { ok: false, error: error.message };
    }

    const moves: LocalMoveRow[] = (data ?? []).map((row) => {
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
          }
        | {
            name: string;
            custom_name: string | null;
            unit: string | null;
          }[]
        | null;
      const cache = Array.isArray(cacheRaw) ? cacheRaw[0] ?? null : cacheRaw;
      const status =
        row.status === "sent_to_1c" ? "sent_to_1c" : ("draft" as const);
      return {
        id: String(row.id),
        date: String(row.date),
        qty: Number(row.qty) || 0,
        status,
        itemRefKey: String(row.item_ref_key).toLowerCase(),
        itemName: String(
          cache?.custom_name?.trim() || cache?.name || "ТМЦ"
        ),
        itemUnit: String(cache?.unit ?? ""),
        fieldId: field?.id ? String(field.id) : row.field_id
          ? String(row.field_id)
          : null,
        fieldName: field?.name ? String(field.name) : null,
      };
    });

    return { ok: true, moves };
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

export async function updateLocalMove(input: {
  id: string;
  qty?: number;
  fieldId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = input.id?.trim();
  if (!id) return { ok: false, error: "Невірний id" };

  try {
    const supabase = createServiceSupabase();
    const { data: existing, error: readErr } = await supabase
      .from("inventory_local_moves")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!existing) return { ok: false, error: "Рух не знайдено" };
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Рух уже відправлено в 1С — редагування заборонено",
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
      patch.qty = qty;
    }
    if (input.fieldId != null) {
      const fieldId = input.fieldId.trim().toLowerCase();
      if (!fieldId) return { ok: false, error: "Оберіть поле" };
      patch.field_id = fieldId;
    }

    const { error } = await supabase
      .from("inventory_local_moves")
      .update(patch)
      .eq("id", id)
      .eq("status", "draft");

    if (error) return { ok: false, error: error.message };
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
        error: "Рух уже відправлено в 1С — видалення заборонено",
      };
    }

    const { error } = await supabase
      .from("inventory_local_moves")
      .delete()
      .eq("id", moveId)
      .eq("status", "draft");

    if (error) return { ok: false, error: error.message };
    revalidatePath("/inventory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося видалити рух",
    };
  }
}

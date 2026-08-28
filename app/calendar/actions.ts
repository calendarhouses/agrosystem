"use server";

import { revalidatePath } from "next/cache";

import { createLocalInboundMove } from "@/app/admin/inventory/actions";
import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import type { AgroFleetUnit } from "@/lib/agronomy-fleet";
import type { AgroNdviAlert } from "@/lib/agronomy-engine";
import type { AgroInventoryItem } from "@/lib/agronomy-resources";
import {
  DEFAULT_DIESEL_PRICE_UAH,
  resolveDieselPriceUah,
} from "@/lib/fuel-price";
import { currentAgroSeason } from "@/lib/season";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgroRadarStockContext = {
  inventory: AgroInventoryItem[];
  fuelPriceUah: number;
  fleet: AgroFleetUnit[];
  ndviAlerts: AgroNdviAlert[];
};

/**
 * Віртуальні залишки складу + флот + NDVI + ціна ДП для Агро-Радара.
 */
export async function getAgroRadarStockContext(): Promise<AgroRadarStockContext> {
  const supabase = createServiceSupabase();
  const diesel = await resolveDieselPriceUah(DEFAULT_DIESEL_PRICE_UAH);

  const [inventory, fleet, ndviAlerts] = await Promise.all([
    loadInventorySnapshot(supabase),
    loadFleetSnapshot(supabase),
    loadNdviAlerts(supabase),
  ]);

  return {
    inventory,
    fleet,
    ndviAlerts,
    fuelPriceUah: diesel.priceUah,
  };
}

async function loadInventorySnapshot(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<AgroInventoryItem[]> {
  const { data: items, error: itemsError } = await supabase
    .from("inventory_items_cache")
    .select(
      "bas_ref_key, name, custom_name, category, unit, unit_cost, planned_price_uah, is_hidden"
    )
    .limit(2000);

  if (itemsError || !items) {
    const legacy = await supabase
      .from("inventory_items_cache")
      .select("bas_ref_key, name, category, unit")
      .limit(2000);
    if (legacy.error || !legacy.data) {
      console.error(
        "[agro-radar] inventory_items_cache:",
        itemsError?.message ?? legacy.error?.message
      );
      return [];
    }
    const { data: moves } = await supabase
      .from("inventory_local_moves")
      .select("item_ref_key, type, qty")
      .limit(10000);
    const balance = buildBalanceMap(moves ?? []);
    return legacy.data.map((row) => ({
      basRefKey: String(row.bas_ref_key).toLowerCase(),
      name: String(row.name ?? "ТМЦ"),
      category: String(row.category ?? ""),
      unit: String(row.unit ?? "").trim() || "од.",
      availableQty: Math.max(
        0,
        balance.get(String(row.bas_ref_key).toLowerCase()) ?? 0
      ),
      unitPriceUah: 0,
    }));
  }

  const visible = items.filter((row) => row.is_hidden !== true);
  const { data: moves, error: movesError } = await supabase
    .from("inventory_local_moves")
    .select("item_ref_key, type, qty")
    .limit(10000);

  if (movesError) {
    console.error("[agro-radar] inventory_local_moves:", movesError.message);
  }

  const balance = buildBalanceMap(moves ?? []);

  return visible.map((row) => {
    const basRefKey = String(row.bas_ref_key).toLowerCase();
    const name =
      (typeof row.custom_name === "string" && row.custom_name.trim()) ||
      String(row.name ?? "ТМЦ");
    const planned = Number(row.planned_price_uah);
    const cost = Number(row.unit_cost);
    const unitPriceUah =
      Number.isFinite(planned) && planned > 0
        ? planned
        : Number.isFinite(cost) && cost > 0
          ? cost
          : 0;

    return {
      basRefKey,
      name,
      category: String(row.category ?? ""),
      unit: String(row.unit ?? "").trim() || "од.",
      availableQty: Math.max(0, balance.get(basRefKey) ?? 0),
      unitPriceUah,
    };
  });
}

async function loadFleetSnapshot(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<AgroFleetUnit[]> {
  const season = currentAgroSeason();

  const [{ data: equipment }, { data: implements_ }, activeOps] =
    await Promise.all([
      supabase
        .from("equipment")
        .select("id, name, type, is_active, wialon_id"),
      supabase.from("implements").select("id, name, type"),
      loadBusyEquipmentIds(supabase, season),
    ]);

  const busy = activeOps;
  const units: AgroFleetUnit[] = [];

  for (const row of equipment ?? []) {
    const id = String(row.id);
    const wialonId =
      row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
        ? Number(row.wialon_id)
        : null;
    units.push({
      id,
      name: String(row.name ?? "Техніка"),
      type: String(row.type ?? "other"),
      isActive: row.is_active !== false,
      wialonId,
      isBusy: busy.equipmentIds.has(id) || (wialonId != null && busy.wialonIds.has(wialonId)),
    });
  }

  for (const row of implements_ ?? []) {
    const id = String(row.id);
    units.push({
      id,
      name: String(row.name ?? "Знаряддя"),
      type: String(row.type ?? "other"),
      isActive: true,
      wialonId: null,
      isBusy: busy.implementNames.has(normalizeName(String(row.name ?? ""))),
    });
  }

  return units;
}

async function loadBusyEquipmentIds(
  supabase: ReturnType<typeof createServiceSupabase>,
  season: string
): Promise<{
  equipmentIds: Set<string>;
  wialonIds: Set<number>;
  implementNames: Set<string>;
}> {
  const equipmentIds = new Set<string>();
  const wialonIds = new Set<number>();
  const implementNames = new Set<string>();

  let { data, error } = await supabase
    .from("field_operations")
    .select("equipment_id, wialon_unit_id, implement, machinery")
    .in("status", ["in_progress", "planned"])
    .eq("season", season)
    .limit(500);

  if (error && (error.message?.includes("season") || error.code === "42703")) {
    const legacy = await supabase
      .from("field_operations")
      .select("equipment_id, wialon_unit_id, implement, machinery")
      .in("status", ["in_progress", "planned"])
      .limit(500);
    data = legacy.data;
    error = legacy.error;
  }

  if (error) {
    console.error("[agro-radar] active ops:", error.message);
    return { equipmentIds, wialonIds, implementNames };
  }

  for (const row of data ?? []) {
    if (row.equipment_id) equipmentIds.add(String(row.equipment_id));
    if (row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))) {
      wialonIds.add(Number(row.wialon_unit_id));
    }
    const impl = String(row.implement ?? "").trim();
    if (impl) implementNames.add(normalizeName(impl));
  }

  return { equipmentIds, wialonIds, implementNames };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[''`"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadNdviAlerts(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<AgroNdviAlert[]> {
  const { data, error } = await supabase
    .from("field_ndvi_alerts")
    .select(
      "id, field_id, drop_percent, zone_note, detected_at, farm_fields ( id, name, crop, area_ha )"
    )
    .eq("is_active", true)
    .order("detected_at", { ascending: false })
    .limit(50);

  if (error) {
    // Таблиця ще не створена (до міграції 045)
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("field_ndvi_alerts")
    ) {
      return [];
    }
    console.error("[agro-radar] ndvi:", error.message);
    return [];
  }

  const out: AgroNdviAlert[] = [];
  for (const row of data ?? []) {
    const joinRaw = row.farm_fields as
      | { id: string; name: string; crop: string; area_ha: number }
      | { id: string; name: string; crop: string; area_ha: number }[]
      | null;
    const field = Array.isArray(joinRaw) ? joinRaw[0] : joinRaw;
    const fieldId = String(row.field_id);
    out.push({
      id: String(row.id),
      fieldId,
      fieldName: field?.name?.trim() || "Поле",
      crop: field?.crop?.trim() || "—",
      areaHa:
        field?.area_ha != null && Number.isFinite(Number(field.area_ha))
          ? Number(field.area_ha)
          : undefined,
      dropPercent: Number(row.drop_percent) || 0,
      zoneNote:
        typeof row.zone_note === "string" && row.zone_note.trim()
          ? row.zone_note.trim()
          : null,
      detectedAt: String(row.detected_at ?? new Date().toISOString()),
    });
  }
  return out;
}

function buildBalanceMap(
  moves: { item_ref_key?: unknown; type?: unknown; qty?: unknown }[]
): Map<string, number> {
  const balance = new Map<string, number>();
  for (const row of moves) {
    const key = String(row.item_ref_key ?? "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const qty = Number(row.qty) || 0;
    const type = String(row.type ?? "");
    const cur = balance.get(key) ?? 0;
    if (type === "inbound") balance.set(key, cur + qty);
    else if (type === "outbound" || type === "sale")
      balance.set(key, cur - qty);
  }
  return balance;
}

export type SubmitPurchaseRequestInput = {
  itemRefKey: string | null;
  itemName: string;
  qty: number;
  unit: string;
  unitPriceUah?: number;
  reason: string;
  operationName: string;
  fieldNames: string[];
  seasonYear: number;
};

/**
 * Заявка на закупівлю ТМЦ з Агро-Радара → draft inbound + журнал бухгалтера.
 */
export async function submitAgroPurchaseRequest(
  input: SubmitPurchaseRequestInput
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Некоректна кількість" };
  }

  const actor = await getCurrentActor();
  const season = String(input.seasonYear);
  const reason =
    input.reason.trim() ||
    `Операція ${input.operationName} (${input.fieldNames.join(", ")})`;
  const note = `Заявка Агро-Радар: ${reason}`;

  let moveId: string | null = null;

  if (input.itemRefKey) {
    const price =
      typeof input.unitPriceUah === "number" && input.unitPriceUah > 0
        ? input.unitPriceUah
        : 0;
    const res = await createLocalInboundMove({
      itemRefKey: input.itemRefKey,
      qty,
      unitPriceUah: price,
      buyerName: "Заявка (Агро-Радар)",
      note,
      season,
    });
    if (!res.ok) return res;
    moveId = res.id;
  }

  await logActivity({
    actor,
    action: "create",
    entityType: "purchase_request",
    entityId: moveId,
    summary: `${actor.label} подав заявку на закупівлю «${input.itemName}» (${qty} ${input.unit})`,
    meta: {
      itemName: input.itemName,
      itemRefKey: input.itemRefKey,
      qty,
      unit: input.unit,
      reason,
      operationName: input.operationName,
      fieldNames: input.fieldNames,
      moveId,
      source: "agro_radar",
    },
  });

  revalidatePath("/accounting");
  revalidatePath("/inventory");
  revalidatePath("/calendar");

  return { ok: true, id: moveId };
}

/**
 * LEVADIUS · Крок C: звірка BAS + локальний мапінг bas_ref_key.
 * Ніколи не пишемо в OData Catalog_* — лише наша БД.
 */

import "server-only";

import { loadAccountingReconciliation } from "@/app/accounting/actions";
import {
  saveBasMapping as saveBasMappingAction,
} from "@/app/admin/mapping/actions";
import {
  allChangeItems,
  describeItem,
  type BasChangeRequest,
} from "@/lib/bas-change-request";
import { normalizeBasRefKey, type BasMappingTable } from "@/lib/bas-mapping";
import { isUnmappedBasRef } from "@/lib/reconciliation-gaps";
import { createServiceSupabase } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export type AgentReconCategory =
  | "all"
  | "fields"
  | "equipment"
  | "inventory"
  | "fuel_storages";

export type AgentReconGap = {
  category: Exclude<AgentReconCategory, "all"> | "ops_price" | "ops_fuel";
  id: string;
  name: string;
  details: string;
  missingKey: "bas_ref_key" | "unit_price" | "field_operation_id" | "close";
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function getAgentReconciliationGaps(params: {
  category?: AgentReconCategory;
}): Promise<
  | {
      ok: true;
      totalChecked: number;
      unmappedCount: number;
      gaps: AgentReconGap[];
      counts: Record<string, number>;
      basError: string | null;
    }
  | { ok: false; error: string }
> {
  const category = params.category ?? "all";
  const supabase = createServiceSupabase();
  const gaps: AgentReconGap[] = [];
  let totalChecked = 0;

  try {
    const recon = await loadAccountingReconciliation();
    if (!recon.ok) return recon;
    const { request, gaps: linkGaps, counts, basError } = recon.data;

    // ── Fields (з BasChangeRequest create + unmapped) ──
    if (category === "all" || category === "fields") {
      const createItems = request.create;
      totalChecked += createItems.reduce((s, i) => s + i.rows.length, 0);
      for (const item of createItems) {
        for (const row of item.rows) {
          gaps.push({
            category: "fields",
            id: row.id,
            name: row.canonicalName.trim() || row.wialonName.trim() || "Поле",
            details: [
              row.areaHa != null ? `${row.areaHa} га` : null,
              row.fieldNo?.trim() ? `№ ${row.fieldNo}` : null,
              "немає bas_ref_key",
            ]
              .filter(Boolean)
              .join(" · "),
            missingKey: "bas_ref_key",
          });
        }
      }
      // split / area — теж gaps для бухгалтера
      for (const item of [...request.split, ...request.area]) {
        totalChecked += item.rows.length;
        for (const row of item.rows) {
          gaps.push({
            category: "fields",
            id: row.id,
            name: row.canonicalName.trim() || row.wialonName.trim() || "Поле",
            details: describeItem(item),
            missingKey: "bas_ref_key",
          });
        }
      }
    }

    // ── Equipment: equipment table + wialon_bas_mapping ──
    if (category === "all" || category === "equipment") {
      const [eqRes, mapRes] = await Promise.all([
        supabase
          .from("equipment")
          .select("id, name, full_name, code, bas_ref_key, wialon_id, is_active")
          .eq("is_active", true)
          .order("name")
          .limit(500),
        Promise.resolve(linkGaps.machinery),
      ]);

      const eqRows = eqRes.data ?? [];
      totalChecked += eqRows.length;
      for (const row of eqRows) {
        if (!isUnmappedBasRef(row.bas_ref_key)) continue;
        gaps.push({
          category: "equipment",
          id: String(row.id),
          name: String(row.name || row.full_name || "Техніка"),
          details: [
            row.code ? `код ${row.code}` : null,
            row.wialon_id != null ? `Wialon ${row.wialon_id}` : "без GPS",
            "немає bas_ref_key (ОЗ)",
          ]
            .filter(Boolean)
            .join(" · "),
          missingKey: "bas_ref_key",
        });
      }

      totalChecked += mapRes.length;
      for (const g of mapRes) {
        // уникнути дублів якщо вже є з equipment
        if (gaps.some((x) => x.category === "equipment" && x.name === g.title)) {
          continue;
        }
        gaps.push({
          category: "equipment",
          id: g.id,
          name: g.title,
          details: g.subtitle
            ? `${g.subtitle} · wialon_bas_mapping`
            : "wialon_bas_mapping без bas_ref_key",
          missingKey: "bas_ref_key",
        });
      }
    }

    // ── Inventory TMC ──
    if (category === "all" || category === "inventory") {
      totalChecked += linkGaps.tmc.length;
      // loadAccounting вже відфільтрував unmapped; але totalChecked має бути повний
      const { count } = await supabase
        .from("inventory_items_cache")
        .select("id", { count: "exact", head: true })
        .or("is_hidden.is.null,is_hidden.eq.false");
      if (typeof count === "number") totalChecked += Math.max(0, count - linkGaps.tmc.length);

      for (const g of linkGaps.tmc) {
        gaps.push({
          category: "inventory",
          id: g.id,
          name: g.title,
          details: g.subtitle ?? "немає коду номенклатури BAS",
          missingKey: "bas_ref_key",
        });
      }
    }

    // ── Fuel storages ──
    if (category === "all" || category === "fuel_storages") {
      const { data: storages } = await supabase
        .from("fuel_storages")
        .select("id, name, type, bas_ref_key")
        .order("name");
      const rows = storages ?? [];
      totalChecked += rows.length;
      for (const g of linkGaps.storages) {
        gaps.push({
          category: "fuel_storages",
          id: g.id,
          name: g.title,
          details: g.subtitle ?? "немає bas_ref_key складу 1С",
          missingKey: "bas_ref_key",
        });
      }
    }

    // ── Operational gaps (лише при all або inventory/fuel context) ──
    if (category === "all" || category === "inventory") {
      const { data: zeroPrice } = await supabase
        .from("inventory_local_moves")
        .select(
          "id, qty, unit_price_uah, type, status, item_ref_key, inventory_items_cache ( name, custom_name, unit )"
        )
        .eq("type", "outbound")
        .eq("status", "draft")
        .or("unit_price_uah.is.null,unit_price_uah.eq.0")
        .order("date", { ascending: false })
        .limit(50);

      for (const row of zeroPrice ?? []) {
        totalChecked += 1;
        const cache = Array.isArray(row.inventory_items_cache)
          ? row.inventory_items_cache[0]
          : row.inventory_items_cache;
        const name =
          (cache &&
            typeof cache === "object" &&
            (String(
              (cache as { custom_name?: string | null }).custom_name ?? ""
            ).trim() ||
              String((cache as { name?: string | null }).name ?? ""))) ||
          String(row.item_ref_key);
        gaps.push({
          category: "ops_price",
          id: String(row.id),
          name,
          details: `Списання ${row.qty} без ціни (unit_price_uah)`,
          missingKey: "unit_price",
        });
      }
    }

    if (category === "all" || category === "equipment") {
      // Незакриті наряди з фактом пального
      const { data: openOps } = await supabase
        .from("field_operations")
        .select("id, work_type, status, fuel_fact, mechanic_name, farm_fields ( name, canonical_name )")
        .in("status", ["planned", "confirmed", "in_progress"])
        .gt("fuel_fact", 0)
        .order("occurred_at", { ascending: false })
        .limit(40);

      for (const row of openOps ?? []) {
        totalChecked += 1;
        const field = Array.isArray(row.farm_fields)
          ? row.farm_fields[0]
          : row.farm_fields;
        const fieldName =
          (field &&
            typeof field === "object" &&
            (String(
              (field as { canonical_name?: string | null }).canonical_name ?? ""
            ).trim() ||
              String((field as { name?: string | null }).name ?? ""))) ||
          "поле";
        gaps.push({
          category: "ops_fuel",
          id: String(row.id),
          name: `${row.work_type ?? "Наряд"} · ${fieldName}`,
          details: `Статус ${row.status}, fuel_fact=${row.fuel_fact} л — наряд не закрито`,
          missingKey: "close",
        });
      }

      // Заправки без привʼязки до наряду
      const { data: orphanFuel } = await supabase
        .from("fuel_transactions")
        .select(
          "id, amount_liters, transaction_date, equipment_id, field_operation_id, equipment:equipment!fuel_transactions_equipment_id_fkey ( name )"
        )
        .eq("transaction_type", "outbound")
        .is("field_operation_id", null)
        .not("equipment_id", "is", null)
        .order("transaction_date", { ascending: false })
        .limit(40);

      for (const row of orphanFuel ?? []) {
        totalChecked += 1;
        const eq = Array.isArray(row.equipment)
          ? row.equipment[0]
          : row.equipment;
        const eqName =
          eq && typeof eq === "object" && "name" in eq
            ? String((eq as { name?: unknown }).name ?? "Техніка")
            : "Техніка";
        gaps.push({
          category: "ops_fuel",
          id: String(row.id),
          name: `Заправка · ${eqName}`,
          details: `${row.amount_liters} л · ${String(row.transaction_date).slice(0, 10)} · без field_operation_id`,
          missingKey: "field_operation_id",
        });
      }
    }

    const unmappedCount = gaps.filter(
      (g) => g.missingKey === "bas_ref_key"
    ).length;

    const countByCat: Record<string, number> = {};
    for (const g of gaps) {
      countByCat[g.category] = (countByCat[g.category] ?? 0) + 1;
    }

    return {
      ok: true,
      totalChecked: Math.max(totalChecked, gaps.length),
      unmappedCount,
      gaps,
      counts: {
        ...countByCat,
        fieldsOpen: counts.fieldsOpen,
        machinery: counts.machinery,
        storages: counts.storages,
        tmc: counts.tmc,
        hubTotalOpen: counts.totalOpen,
      },
      basError,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося зібрати звірку BAS",
    };
  }
}

type EntityType = "field" | "equipment" | "inventory_item" | "fuel_storage";

async function resolveEntity(
  entityType: EntityType,
  entityIdOrName: string
): Promise<
  | {
      ok: true;
      table: BasMappingTable | "equipment";
      id: string;
      name: string;
    }
  | {
      ok: false;
      status: "not_found" | "ambiguous";
      error: string;
      candidates?: Array<{ id: string; name: string }>;
    }
> {
  const needle = entityIdOrName.trim();
  if (!needle) {
    return { ok: false, status: "not_found", error: "Вкажи entityIdOrName." };
  }
  const supabase = createServiceSupabase();
  const safe = needle.replace(/[%_,]/g, " ").trim();

  if (entityType === "field") {
    if (isUuid(needle)) {
      const { data } = await supabase
        .from("farm_fields")
        .select("id, name, canonical_name")
        .eq("id", needle.toLowerCase())
        .maybeSingle();
      if (data) {
        return {
          ok: true,
          table: "farm_fields",
          id: String(data.id),
          name:
            String(data.canonical_name ?? "").trim() ||
            String(data.name ?? "Поле"),
        };
      }
    }
    const { data: rows } = await supabase
      .from("farm_fields")
      .select("id, name, canonical_name")
      .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
      .limit(10);
    const list = (rows ?? []).map((r) => ({
      id: String(r.id),
      name:
        String(r.canonical_name ?? "").trim() || String(r.name ?? "Поле"),
    }));
    const exact = list.filter(
      (r) =>
        r.name.toLocaleLowerCase("uk-UA") === needle.toLocaleLowerCase("uk-UA")
    );
    const chosen =
      exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
    if (chosen) {
      return { ok: true, table: "farm_fields", id: chosen.id, name: chosen.name };
    }
    if (list.length > 1) {
      return {
        ok: false,
        status: "ambiguous",
        error: `Кілька полів для «${needle}».`,
        candidates: list.slice(0, 6),
      };
    }
    return {
      ok: false,
      status: "not_found",
      error: `Поле «${needle}» не знайдено.`,
    };
  }

  if (entityType === "fuel_storage") {
    if (isUuid(needle)) {
      const { data } = await supabase
        .from("fuel_storages")
        .select("id, name")
        .eq("id", needle.toLowerCase())
        .maybeSingle();
      if (data) {
        return {
          ok: true,
          table: "fuel_storages",
          id: String(data.id),
          name: String(data.name ?? "Ємність"),
        };
      }
    }
    const { data: rows } = await supabase
      .from("fuel_storages")
      .select("id, name")
      .ilike("name", `%${safe}%`)
      .limit(10);
    const list = (rows ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Ємність"),
    }));
    const exact = list.filter(
      (r) =>
        r.name.toLocaleLowerCase("uk-UA") === needle.toLocaleLowerCase("uk-UA")
    );
    const chosen =
      exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
    if (chosen) {
      return {
        ok: true,
        table: "fuel_storages",
        id: chosen.id,
        name: chosen.name,
      };
    }
    if (list.length > 1) {
      return {
        ok: false,
        status: "ambiguous",
        error: `Кілька ємностей для «${needle}».`,
        candidates: list.slice(0, 6),
      };
    }
    return {
      ok: false,
      status: "not_found",
      error: `Ємність «${needle}» не знайдена.`,
    };
  }

  if (entityType === "inventory_item") {
    if (isUuid(needle)) {
      const byId = await supabase
        .from("inventory_items_cache")
        .select("id, name, custom_name, bas_ref_key")
        .eq("id", needle.toLowerCase())
        .maybeSingle();
      if (byId.data) {
        return {
          ok: true,
          table: "inventory_items_cache",
          id: String(byId.data.id),
          name:
            String(byId.data.custom_name ?? "").trim() ||
            String(byId.data.name ?? "ТМЦ"),
        };
      }
      const byKey = await supabase
        .from("inventory_items_cache")
        .select("id, name, custom_name, bas_ref_key")
        .eq("bas_ref_key", needle.toLowerCase())
        .maybeSingle();
      if (byKey.data) {
        return {
          ok: true,
          table: "inventory_items_cache",
          id: String(byKey.data.id),
          name:
            String(byKey.data.custom_name ?? "").trim() ||
            String(byKey.data.name ?? "ТМЦ"),
        };
      }
    }
    const { data: rows } = await supabase
      .from("inventory_items_cache")
      .select("id, name, custom_name")
      .or(`name.ilike.%${safe}%,custom_name.ilike.%${safe}%`)
      .limit(12);
    const list = (rows ?? []).map((r) => ({
      id: String(r.id),
      name:
        String(r.custom_name ?? "").trim() || String(r.name ?? "ТМЦ"),
    }));
    const exact = list.filter(
      (r) =>
        r.name.toLocaleLowerCase("uk-UA") === needle.toLocaleLowerCase("uk-UA")
    );
    const chosen =
      exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
    if (chosen) {
      return {
        ok: true,
        table: "inventory_items_cache",
        id: chosen.id,
        name: chosen.name,
      };
    }
    if (list.length > 1) {
      return {
        ok: false,
        status: "ambiguous",
        error: `Кілька ТМЦ для «${needle}».`,
        candidates: list.slice(0, 6),
      };
    }
    return {
      ok: false,
      status: "not_found",
      error: `ТМЦ «${needle}» не знайдено.`,
    };
  }

  // equipment — спочатку equipment, потім wialon_bas_mapping
  if (isUuid(needle)) {
    const { data: eq } = await supabase
      .from("equipment")
      .select("id, name")
      .eq("id", needle.toLowerCase())
      .maybeSingle();
    if (eq) {
      return {
        ok: true,
        table: "equipment",
        id: String(eq.id),
        name: String(eq.name ?? "Техніка"),
      };
    }
    const { data: map } = await supabase
      .from("wialon_bas_mapping")
      .select("id, wialon_name")
      .eq("id", needle.toLowerCase())
      .maybeSingle();
    if (map) {
      return {
        ok: true,
        table: "wialon_bas_mapping",
        id: String(map.id),
        name: String(map.wialon_name ?? "Техніка"),
      };
    }
  }

  const { data: eqRows } = await supabase
    .from("equipment")
    .select("id, name, full_name")
    .or(`name.ilike.%${safe}%,full_name.ilike.%${safe}%`)
    .limit(10);
  const eqList = (eqRows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name || r.full_name || "Техніка"),
    table: "equipment" as const,
  }));
  const exactEq = eqList.filter(
    (r) =>
      r.name.toLocaleLowerCase("uk-UA") === needle.toLocaleLowerCase("uk-UA")
  );
  if (exactEq.length === 1 || eqList.length === 1) {
    const c = exactEq[0] ?? eqList[0]!;
    return { ok: true, table: "equipment", id: c.id, name: c.name };
  }
  if (eqList.length > 1) {
    return {
      ok: false,
      status: "ambiguous",
      error: `Кілька одиниць техніки для «${needle}».`,
      candidates: eqList.slice(0, 6).map((r) => ({ id: r.id, name: r.name })),
    };
  }

  const { data: mapRows } = await supabase
    .from("wialon_bas_mapping")
    .select("id, wialon_name")
    .ilike("wialon_name", `%${safe}%`)
    .limit(10);
  const mapList = (mapRows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.wialon_name ?? "Техніка"),
  }));
  if (mapList.length === 1) {
    return {
      ok: true,
      table: "wialon_bas_mapping",
      id: mapList[0]!.id,
      name: mapList[0]!.name,
    };
  }
  if (mapList.length > 1) {
    return {
      ok: false,
      status: "ambiguous",
      error: `Кілька GPS-мапінгів для «${needle}».`,
      candidates: mapList.slice(0, 6),
    };
  }

  return {
    ok: false,
    status: "not_found",
    error: `Техніку «${needle}» не знайдено.`,
  };
}

export async function saveAgentBasMapping(params: {
  entityType: EntityType;
  entityIdOrName: string;
  basRefKey: string;
  basName?: string | null;
}): Promise<Record<string, unknown>> {
  const basRefKey = normalizeBasRefKey(params.basRefKey);
  if (!basRefKey) {
    return {
      success: false,
      status: "error",
      error: "Некоректний basRefKey (очікується GUID / Ref_Key BAS).",
    };
  }

  const resolved = await resolveEntity(
    params.entityType,
    params.entityIdOrName
  );
  if (!resolved.ok) {
    return {
      success: false,
      status: resolved.status,
      error: resolved.error,
      candidates: resolved.candidates,
    };
  }

  const supabase = createServiceSupabase();
  const basName = params.basName?.trim() || null;

  if (resolved.table === "equipment") {
    const { error } = await supabase
      .from("equipment")
      .update({
        bas_ref_key: basRefKey,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resolved.id);
    if (error) {
      return { success: false, status: "error", error: error.message };
    }
    // Підтягнути wialon_bas_mapping за wialon_id, якщо є
    const { data: eq } = await supabase
      .from("equipment")
      .select("wialon_id")
      .eq("id", resolved.id)
      .maybeSingle();
    if (eq?.wialon_id != null) {
      await supabase
        .from("wialon_bas_mapping")
        .update({ bas_ref_key: basRefKey })
        .eq("wialon_id", eq.wialon_id);
    }
  } else {
    const res = await saveBasMappingAction({
      table: resolved.table,
      id: resolved.id,
      basRefKey,
    });
    if (!res.ok) {
      return { success: false, status: "error", error: res.error };
    }
  }

  // basName — опційно в custom_name для ТМЦ, якщо порожньо
  if (basName && resolved.table === "inventory_items_cache") {
    const { data: row } = await supabase
      .from("inventory_items_cache")
      .select("custom_name")
      .eq("id", resolved.id)
      .maybeSingle();
    if (!row?.custom_name) {
      await supabase
        .from("inventory_items_cache")
        .update({ custom_name: basName })
        .eq("id", resolved.id);
    }
  }

  const clientEvent =
    params.entityType === "field"
      ? "field-updated"
      : params.entityType === "equipment"
        ? "equipment-updated"
        : params.entityType === "fuel_storage"
          ? "fuel-updated"
          : "warehouse-updated";

  return {
    success: true,
    status: "mapped",
    entityType: params.entityType,
    entityId: resolved.id,
    entityName: resolved.name,
    basRefKey,
    basName,
    message: `Звʼязок із BAS успішно збережено в локальній базі («${resolved.name}» → ${basRefKey}).`,
    clientEvents: [clientEvent, "accounting-updated"],
    navigatePath: "/accounting",
  };
}

export type BasChangeExportRow = {
  internalId: string;
  entityType: string;
  levadaName: string;
  unit: string;
  stockOrData: string;
  recommendedBasName: string;
  basRefKeyInput: string;
};

export async function collectBasChangeRequestRows(params: {
  category?: "all" | "inventory" | "equipment" | "fields";
}): Promise<
  | { ok: true; rows: BasChangeExportRow[]; fieldRequest: BasChangeRequest | null }
  | { ok: false; error: string }
> {
  const category = params.category ?? "all";
  const mapCat =
    category === "all"
      ? "all"
      : category === "fields"
        ? "fields"
        : category === "equipment"
          ? "equipment"
          : "inventory";

  const gaps = await getAgentReconciliationGaps({
    category: mapCat === "inventory" ? "inventory" : mapCat,
  });
  if (!gaps.ok) return gaps;

  // Для fuel storages при all — додати
  let allGaps = gaps.gaps.filter((g) => g.missingKey === "bas_ref_key");
  if (category === "all") {
    const fuel = await getAgentReconciliationGaps({
      category: "fuel_storages",
    });
    if (fuel.ok) {
      allGaps = [
        ...allGaps,
        ...fuel.gaps.filter((g) => g.missingKey === "bas_ref_key"),
      ];
    }
  }

  const recon = await loadAccountingReconciliation();
  const fieldRequest = recon.ok ? recon.data.request : null;

  const rows: BasChangeExportRow[] = allGaps.map((g) => ({
    internalId: g.id,
    entityType:
      g.category === "fields"
        ? "Поле"
        : g.category === "equipment"
          ? "Техніка"
          : g.category === "inventory"
            ? "ТМЦ"
            : g.category === "fuel_storages"
              ? "Склад ДП"
              : g.category,
    levadaName: g.name,
    unit: "",
    stockOrData: g.details,
    recommendedBasName: g.name,
    basRefKeyInput: "",
  }));

  // Збагатити ТМЦ unit
  if (rows.some((r) => r.entityType === "ТМЦ")) {
    const supabase = createServiceSupabase();
    const ids = rows.filter((r) => r.entityType === "ТМЦ").map((r) => r.internalId);
    const { data } = await supabase
      .from("inventory_items_cache")
      .select("id, unit")
      .in("id", ids);
    const unitById = new Map(
      (data ?? []).map((r) => [String(r.id), String(r.unit ?? "")])
    );
    for (const row of rows) {
      if (row.entityType === "ТМЦ") {
        row.unit = unitById.get(row.internalId) ?? "";
      }
    }
  }

  return { ok: true, rows, fieldRequest };
}

export function buildBasChangeRequestXlsxBuffer(
  rows: BasChangeExportRow[],
  fieldRequest: BasChangeRequest | null
): { buffer: Buffer; filename: string } {
  const book = XLSX.utils.book_new();

  const mainRows = [
    [
      "Внутрішній ID",
      "Тип сутності",
      "Назва в LEVADIUS",
      "Одиниця виміру",
      "Поточний залишок / Дані",
      "Рекомендована назва для створення в 1С",
      "Поле для вводу bas_ref_key",
    ],
    ...rows.map((r) => [
      r.internalId,
      r.entityType,
      r.levadaName,
      r.unit,
      r.stockOrData,
      r.recommendedBasName,
      r.basRefKeyInput,
    ]),
  ];
  const main = XLSX.utils.aoa_to_sheet(mainRows);
  main["!cols"] = [
    { wch: 38 },
    { wch: 12 },
    { wch: 32 },
    { wch: 10 },
    { wch: 40 },
    { wch: 32 },
    { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(book, main, "Запит мапінгу");

  if (fieldRequest && allChangeItems(fieldRequest).length > 0) {
    const fieldRows: (string | number)[][] = [
      ["Дія", "Поле LEVADIUS", "Площа га", "Деталі"],
    ];
    for (const item of allChangeItems(fieldRequest)) {
      for (const row of item.rows) {
        fieldRows.push([
          item.kind,
          row.canonicalName.trim() || row.wialonName.trim(),
          row.areaHa ?? "",
          describeItem(item),
        ]);
      }
    }
    const fs = XLSX.utils.aoa_to_sheet(fieldRows);
    XLSX.utils.book_append_sheet(book, fs, "Поля детально");
  }

  const readme = XLSX.utils.aoa_to_sheet([
    ["BAS Change Request · LEVADIUS"],
    ["Файл для головного бухгалтера."],
    ["Ми НЕ пишемо в OData Catalog_* — лише просимо створити/уточнити довідник."],
    ["Після створення в BAS — привʼяжіть bas_ref_key через saveBasMapping / Mapping Studio."],
  ]);
  XLSX.utils.book_append_sheet(book, readme, "README");

  const year = new Date().getFullYear();
  const filename = `BAS_Change_Request_${year}.xlsx`;
  const buffer = XLSX.write(book, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
  return { buffer, filename };
}

export function buildBasChangeRequestCsv(rows: BasChangeExportRow[]): string {
  const header = [
    "internal_id",
    "entity_type",
    "levada_name",
    "unit",
    "stock_or_data",
    "recommended_bas_name",
    "bas_ref_key",
  ];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    header.join(";"),
    ...rows.map((r) =>
      [
        r.internalId,
        r.entityType,
        r.levadaName,
        r.unit,
        r.stockOrData,
        r.recommendedBasName,
        r.basRefKeyInput,
      ]
        .map(esc)
        .join(";")
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

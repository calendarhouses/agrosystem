/**
 * Чернетки Лімітно-забірних карт у BAS (Document_ИНАГРО_ЛимитноЗаборнаяКарта).
 *
 * POST лише через lib/bas-drafts/post.ts + isBasDraftPostEnabled().
 * Проведені документи не чіпаємо — лише Posted: false.
 */

import {
  basDefaultWarehouseKey,
  basOrganizationKey,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import { createServiceSupabase } from "@/lib/supabase/server";

const ENTITY = "Document_ИНАГРО_ЛимитноЗаборнаяКарта";

export type LimitCardMaterialLine = {
  LineNumber: number;
  Номенклатура_Key: string;
  Количество: number;
  ПлощадьПоля?: number;
  Коэффициент?: number;
};

export type LimitCardDraftPayload = {
  Date: string;
  Posted: false;
  DeletionMark: false;
  Комментарий: string;
  УдалитьПодразделение_Key?: string;
  Склад_Key?: string;
  Организация_Key?: string;
  Материалы: LimitCardMaterialLine[];
  _meta: {
    groupKey: string;
    fieldId: string | null;
    fieldName: string;
    moveIds: string[];
    moveCount: number;
  };
};

export type SyncLocalMovesToBasResult = {
  dryRun: boolean;
  draftCount: number;
  moveCount: number;
  payloads: LimitCardDraftPayload[];
  errors: string[];
};

type DraftMoveRow = {
  id: string;
  item_ref_key: string;
  field_id: string | null;
  qty: number;
  date: string;
  bas_draft_ref_key: string | null;
  farm_fields: {
    id: string;
    name: string;
    area_ha: number;
    bas_ref_key: string | null;
  } | null;
  inventory_items_cache: {
    bas_ref_key: string;
    name: string;
    category: string;
    unit: string | null;
  } | null;
};

function dayKey(iso: string): string {
  return iso.slice(0, 10) || "unknown-date";
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function buildPayloads(rows: DraftMoveRow[]): LimitCardDraftPayload[] {
  type Group = {
    key: string;
    fieldId: string | null;
    fieldName: string;
    fieldBasKey: string | null;
    areaHa: number;
    dateIso: string;
    moveIds: string[];
    lines: { itemKey: string; qty: number; name: string }[];
  };

  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (row.bas_draft_ref_key) continue;
    const field = unwrapOne(row.farm_fields);
    const item = unwrapOne(row.inventory_items_cache);
    if (!item?.bas_ref_key) continue;

    const fieldId = field?.id ?? row.field_id;
    const dateDay = dayKey(row.date);
    const key = `${fieldId ?? "no-field"}|${dateDay}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        fieldId: fieldId ?? null,
        fieldName: field?.name ?? "Без поля",
        fieldBasKey: field?.bas_ref_key
          ? String(field.bas_ref_key).toLowerCase()
          : null,
        areaHa: Number(field?.area_ha) || 0,
        dateIso: toIsoDateTime(row.date),
        moveIds: [],
        lines: [],
      };
      groups.set(key, g);
    }

    g.moveIds.push(row.id);
    const itemKey = String(item.bas_ref_key).toLowerCase();
    const existing = g.lines.find((l) => l.itemKey === itemKey);
    const qty = Number(row.qty) || 0;
    if (existing) existing.qty += qty;
    else {
      g.lines.push({
        itemKey,
        qty,
        name: item.name,
      });
    }
  }

  const orgKey = basOrganizationKey();
  const warehouseKey = basDefaultWarehouseKey();

  return [...groups.values()]
    .filter((g) => g.lines.length > 0)
    .map((g) => {
      const materials: LimitCardMaterialLine[] = g.lines.map((line, idx) => ({
        LineNumber: idx + 1,
        Номенклатура_Key: line.itemKey,
        Количество: Math.round(line.qty * 1000) / 1000,
        Коэффициент: 1,
        ...(g.areaHa > 0 ? { ПлощадьПоля: g.areaHa } : {}),
      }));

      const namesPreview = g.lines
        .slice(0, 3)
        .map((l) => l.name)
        .join(", ");

      const payload: LimitCardDraftPayload = {
        Date: g.dateIso,
        Posted: false,
        DeletionMark: false,
        Комментарий: [
          "AgroSystem · тіньовий склад (чернетка)",
          `Поле: ${g.fieldName}`,
          `Рухів: ${g.moveIds.length}`,
          namesPreview ? `ТМЦ: ${namesPreview}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        Материалы: materials,
        _meta: {
          groupKey: g.key,
          fieldId: g.fieldId,
          fieldName: g.fieldName,
          moveIds: g.moveIds,
          moveCount: g.moveIds.length,
        },
      };

      if (g.fieldBasKey) {
        payload.УдалитьПодразделение_Key = g.fieldBasKey;
      }
      if (orgKey) payload.Организация_Key = orgKey;
      if (warehouseKey) payload.Склад_Key = warehouseKey;

      return payload;
    });
}

/** Тіло для OData без службового _meta */
export function toODataBody(
  payload: LimitCardDraftPayload
): Record<string, unknown> {
  const { _meta: _ignored, ...body } = payload;
  return body;
}

/**
 * Batch: усі draft outbound без bas_draft_ref_key → ЛЗК.
 * Dry-run не пише ref у БД. sent_to_1c лишається контуром Excel (/export).
 */
export async function syncLocalMovesToBas(): Promise<SyncLocalMovesToBasResult> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      item_ref_key,
      field_id,
      qty,
      date,
      bas_draft_ref_key,
      farm_fields (
        id,
        name,
        area_ha,
        bas_ref_key
      ),
      inventory_items_cache (
        bas_ref_key,
        name,
        category,
        unit
      )
    `
    )
    .eq("status", "draft")
    .eq("type", "outbound")
    .is("bas_draft_ref_key", null)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`inventory_local_moves: ${error.message}`);
  }

  const rows: DraftMoveRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    item_ref_key: String(row.item_ref_key),
    field_id: (row.field_id as string | null) ?? null,
    qty: Number(row.qty) || 0,
    date: String(row.date),
    bas_draft_ref_key:
      row.bas_draft_ref_key != null ? String(row.bas_draft_ref_key) : null,
    farm_fields: unwrapOne(
      row.farm_fields as
        | DraftMoveRow["farm_fields"]
        | DraftMoveRow["farm_fields"][]
    ),
    inventory_items_cache: unwrapOne(
      row.inventory_items_cache as
        | DraftMoveRow["inventory_items_cache"]
        | DraftMoveRow["inventory_items_cache"][]
    ),
  }));

  const dryRun = !isBasDraftPostEnabled();
  if (rows.length === 0) {
    return {
      dryRun,
      draftCount: 0,
      moveCount: 0,
      payloads: [],
      errors: [],
    };
  }

  const payloads = buildPayloads(rows);
  const allMoveIds = payloads.flatMap((p) => p._meta.moveIds);
  const errors: string[] = [];

  for (const payload of payloads) {
    const result = await postBasDocumentDraft(ENTITY, toODataBody(payload));
    if (!result.ok) {
      const msg = `${payload._meta.fieldName}: ${result.error}`;
      errors.push(msg);
      await markBasDraftFailure({
        table: "inventory_local_moves",
        ids: payload._meta.moveIds,
        error: result.error,
      });
      continue;
    }

    if (!result.dryRun) {
      await markBasDraftSuccess({
        table: "inventory_local_moves",
        ids: payload._meta.moveIds,
        refKey: result.refKey,
        entitySet: ENTITY,
      });
    }
  }

  return {
    dryRun,
    draftCount: payloads.length,
    moveCount: allMoveIds.length,
    payloads,
    errors,
  };
}

/**
 * Після створення списання: якщо POST увімкнено — batch ЛЗК для всіх
 * незакритих draft outbound (група поле+день). У dry-run лише лог однієї групи.
 */
export async function enqueueInventoryOutboundBasDraft(
  moveId: string
): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  if (!isBasDraftPostEnabled()) {
    // Не спамимо dry-run на кожне збереження — batch через syncLocalMovesToBasAction.
    console.log(
      "[bas-drafts] outbound skip auto-post (BAS_DRAFT_POST_ENABLED=false)",
      moveId
    );
    return { ok: true, dryRun: true };
  }
  const result = await syncLocalMovesToBas();
  if (result.errors.length > 0) {
    return { ok: false, dryRun: false, error: result.errors[0] };
  }
  return { ok: true, dryRun: false };
}

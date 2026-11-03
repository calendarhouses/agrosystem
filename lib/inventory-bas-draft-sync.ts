/**
 * Чернетки списання ТМЦ у BAS:
 *  - Насіння / Добрива / ЗЗР → Document_ИНАГРО_ЛимитноЗаборнаяКарта
 *  - Запчастини (і подібне складське) → Document_ТребованиеНакладная
 *
 * POST лише через lib/bas-drafts/post.ts + isBasDraftPostEnabled().
 * Проведені документи не чіпаємо — лише Posted: false.
 */

import {
  resolveBasInventoryAccountKey,
  resolveBasTaxPurposeVatKey,
} from "@/lib/bas-drafts/accounts";
import {
  basDefaultWarehouseKey,
  basOrganizationKey,
  isBasDraftPipelineEnabled,
} from "@/lib/bas-drafts/config";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import { resolveBasUnitKey } from "@/lib/bas-drafts/units";
import { createServiceSupabase } from "@/lib/supabase/server";

const LZK_ENTITY = "Document_ИНАГРО_ЛимитноЗаборнаяКарта";
const REQUIREMENT_ENTITY = "Document_ТребованиеНакладная";
const LZK_PIPELINE = "inventory_outbound_lzk";
const REQUIREMENT_PIPELINE = "inventory_outbound_requirement";

/** Види операції ЛЗК (enum OData BAS АГРО). */
const LZK_OP_SEEDS = "СписаниеСемян";
const LZK_OP_CHEMICALS = "СписаниеУдобренийИЯдохимикатов";

export type LimitCardMaterialLine = {
  LineNumber: number;
  Номенклатура_Key: string;
  Количество: number;
  ПлощадьПоля?: number;
  Коэффициент?: number;
  ЕдиницаИзмерения_Key?: string;
  /** $metadata: Счет_Key (не СчетУчета_Key) */
  Счет_Key?: string;
  НалоговоеНазначение_Key?: string;
};

export type LimitCardDraftPayload = {
  Date: string;
  Posted: false;
  DeletionMark: false;
  ВидОперации: string;
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
    entity: string;
    operation: string;
  };
};

export type RequirementDraftPayload = {
  Date: string;
  Posted: false;
  DeletionMark: false;
  Комментарий: string;
  Склад_Key?: string;
  Организация_Key?: string;
  ИНАГРО_УказатьОС?: boolean;
  ИНАГРО_ОсновноеСредство_Key?: string;
  /** $metadata: таблична частина — Материалы (не Товары) */
  Материалы: Array<Record<string, unknown>>;
  _meta: {
    groupKey: string;
    equipmentId: string | null;
    equipmentName: string | null;
    moveIds: string[];
    moveCount: number;
    entity: string;
  };
};

export type SyncLocalMovesToBasResult = {
  dryRun: boolean;
  draftCount: number;
  moveCount: number;
  payloads: Array<LimitCardDraftPayload | RequirementDraftPayload>;
  errors: string[];
};

type DraftMoveRow = {
  id: string;
  item_ref_key: string;
  field_id: string | null;
  equipment_id: string | null;
  qty: number;
  date: string;
  note: string | null;
  bas_draft_ref_key: string | null;
  farm_fields: {
    id: string;
    name: string;
    area_ha: number;
    bas_ref_key: string | null;
  } | null;
  equipment: {
    id: string;
    name: string;
    bas_ref_key?: string | null;
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

function isLzkCategory(category: string | null | undefined): boolean {
  return (
    category === "seed" ||
    category === "fertilizer" ||
    category === "zzr"
  );
}

function isRequirementCategory(category: string | null | undefined): boolean {
  // Запчастини (+ запасні шляхи для палива/мастил, якщо зʼявляться в складі)
  return (
    category === "parts" ||
    category === "fuel" ||
    category === "oil" ||
    category === "lubricant"
  );
}

function lzkOperationForCategory(category: string): string {
  if (category === "seed") return LZK_OP_SEEDS;
  return LZK_OP_CHEMICALS;
}

async function enrichMaterialLine(input: {
  lineNumber: number;
  itemKey: string;
  qty: number;
  unitLabel: string | null;
  category: string | null;
  areaHa: number;
}): Promise<LimitCardMaterialLine> {
  const [unit, accountKey, taxPurposeKey] = await Promise.all([
    resolveBasUnitKey(input.unitLabel),
    resolveBasInventoryAccountKey(input.category),
    resolveBasTaxPurposeVatKey(),
  ]);
  const row: LimitCardMaterialLine = {
    LineNumber: input.lineNumber,
    Номенклатура_Key: input.itemKey,
    Количество: Math.round(input.qty * 1000) / 1000,
    Коэффициент: 1,
  };
  if (unit.key) row.ЕдиницаИзмерения_Key = unit.key;
  if (accountKey) row.Счет_Key = accountKey;
  if (taxPurposeKey) {
    row.НалоговоеНазначение_Key = taxPurposeKey;
  }
  if (input.areaHa > 0) row.ПлощадьПоля = input.areaHa;
  return row;
}

async function buildLzkPayloads(
  rows: DraftMoveRow[]
): Promise<LimitCardDraftPayload[]> {
  type LineAcc = {
    itemKey: string;
    qty: number;
    name: string;
    unit: string | null;
    category: string;
  };
  type Group = {
    key: string;
    fieldId: string | null;
    fieldName: string;
    fieldBasKey: string | null;
    areaHa: number;
    dateIso: string;
    operation: string;
    categoryHint: string;
    moveIds: string[];
    lines: LineAcc[];
  };

  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (row.bas_draft_ref_key) continue;
    const item = unwrapOne(row.inventory_items_cache);
    if (!item?.bas_ref_key) continue;
    if (!isLzkCategory(item.category)) continue;

    const field = unwrapOne(row.farm_fields);
    const fieldId = field?.id ?? row.field_id;
    const dateDay = dayKey(row.date);
    const operation = lzkOperationForCategory(item.category);
    // Окремі документи: насіння vs добрива/ЗЗР + поле + день
    const key = `${operation}|${fieldId ?? "no-field"}|${dateDay}`;

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
        operation,
        categoryHint: item.category,
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
        unit: item.unit,
        category: item.category,
      });
    }
  }

  const orgKey = basOrganizationKey();
  const warehouseKey = basDefaultWarehouseKey();
  const payloads: LimitCardDraftPayload[] = [];

  for (const g of groups.values()) {
    if (g.lines.length === 0) continue;
    const materials: LimitCardMaterialLine[] = [];
    for (let i = 0; i < g.lines.length; i += 1) {
      const line = g.lines[i]!;
      materials.push(
        await enrichMaterialLine({
          lineNumber: i + 1,
          itemKey: line.itemKey,
          qty: line.qty,
          unitLabel: line.unit,
          category: line.category,
          areaHa: g.areaHa,
        })
      );
    }

    const opLabel =
      g.operation === LZK_OP_SEEDS
        ? "Списання насіння"
        : "Списання добрив та отрутохімікатів";
    const namesPreview = g.lines
      .slice(0, 3)
      .map((l) => l.name)
      .join(", ");

    const payload: LimitCardDraftPayload = {
      Date: g.dateIso,
      Posted: false,
      DeletionMark: false,
      ВидОперации: g.operation,
      Комментарий: [
        "AgroSystem · ЛЗК (чернетка)",
        opLabel,
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
        entity: LZK_ENTITY,
        operation: g.operation,
      },
    };

    if (g.fieldBasKey) {
      payload.УдалитьПодразделение_Key = g.fieldBasKey;
    }
    if (orgKey) payload.Организация_Key = orgKey;
    if (warehouseKey) payload.Склад_Key = warehouseKey;

    payloads.push(payload);
  }

  return payloads;
}

async function buildRequirementPayloads(
  rows: DraftMoveRow[]
): Promise<RequirementDraftPayload[]> {
  type LineAcc = {
    itemKey: string;
    qty: number;
    name: string;
    unit: string | null;
    category: string;
  };
  type Group = {
    key: string;
    equipmentId: string | null;
    equipmentName: string | null;
    equipmentBasKey: string | null;
    dateIso: string;
    moveIds: string[];
    lines: LineAcc[];
  };

  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (row.bas_draft_ref_key) continue;
    const item = unwrapOne(row.inventory_items_cache);
    if (!item?.bas_ref_key) continue;
    if (!isRequirementCategory(item.category)) continue;

    const equipment = unwrapOne(row.equipment);
    const equipmentId = equipment?.id ?? row.equipment_id;
    const dateDay = dayKey(row.date);
    const key = `${equipmentId ?? "no-equipment"}|${dateDay}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        equipmentId: equipmentId ?? null,
        equipmentName: equipment?.name ?? null,
        equipmentBasKey: equipment?.bas_ref_key
          ? String(equipment.bas_ref_key).toLowerCase()
          : null,
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
        unit: item.unit,
        category: item.category,
      });
    }
  }

  const orgKey = basOrganizationKey();
  const warehouseKey = basDefaultWarehouseKey();
  const taxPurposeKey = await resolveBasTaxPurposeVatKey();
  const payloads: RequirementDraftPayload[] = [];

  for (const g of groups.values()) {
    if (g.lines.length === 0) continue;
    const materials: Record<string, unknown>[] = [];
    for (let i = 0; i < g.lines.length; i += 1) {
      const line = g.lines[i]!;
      const [unit, accountKey] = await Promise.all([
        resolveBasUnitKey(line.unit),
        resolveBasInventoryAccountKey(line.category),
      ]);
      const row: Record<string, unknown> = {
        LineNumber: i + 1,
        Номенклатура_Key: line.itemKey,
        Количество: Math.round(line.qty * 1000) / 1000,
        Коэффициент: 1,
      };
      if (unit.key) row.ЕдиницаИзмерения_Key = unit.key;
      if (accountKey) row.Счет_Key = accountKey;
      if (taxPurposeKey) {
        row.НалоговоеНазначение_Key = taxPurposeKey;
      }
      materials.push(row);
    }

    const payload: RequirementDraftPayload = {
      Date: g.dateIso,
      Posted: false,
      DeletionMark: false,
      Комментарий: [
        "AgroSystem · Списання запчастин",
        g.equipmentName
          ? `Техніка: ${g.equipmentName}`
          : "Техніка не вказана",
      ]
        .filter(Boolean)
        .join(" · "),
      Материалы: materials,
      _meta: {
        groupKey: g.key,
        equipmentId: g.equipmentId,
        equipmentName: g.equipmentName,
        moveIds: g.moveIds,
        moveCount: g.moveIds.length,
        entity: REQUIREMENT_ENTITY,
      },
    };

    if (orgKey) payload.Организация_Key = orgKey;
    if (warehouseKey) payload.Склад_Key = warehouseKey;
    if (g.equipmentBasKey) {
      payload.ИНАГРО_УказатьОС = true;
      payload.ИНАГРО_ОсновноеСредство_Key = g.equipmentBasKey;
    }

    payloads.push(payload);
  }

  return payloads;
}

/** Тіло для OData без службового _meta */
export function toODataBody(
  payload: LimitCardDraftPayload | RequirementDraftPayload
): Record<string, unknown> {
  const { _meta: _ignored, ...body } = payload;
  return body;
}

async function loadDraftOutboundMoves(): Promise<DraftMoveRow[]> {
  const supabase = createServiceSupabase();

  let { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      item_ref_key,
      field_id,
      equipment_id,
      qty,
      date,
      note,
      bas_draft_ref_key,
      farm_fields (
        id,
        name,
        area_ha,
        bas_ref_key
      ),
      equipment (
        id,
        name,
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

  if (
    error &&
    (error.message?.includes("equipment") || error.code === "42703")
  ) {
    const legacy = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        item_ref_key,
        field_id,
        qty,
        date,
        note,
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
    data = legacy.data as typeof data;
    error = legacy.error;
  }

  if (error) {
    throw new Error(`inventory_local_moves: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    item_ref_key: String(row.item_ref_key),
    field_id: (row.field_id as string | null) ?? null,
    equipment_id:
      "equipment_id" in row && row.equipment_id != null
        ? String(row.equipment_id)
        : null,
    qty: Number(row.qty) || 0,
    date: String(row.date),
    note: typeof row.note === "string" ? row.note : null,
    bas_draft_ref_key:
      row.bas_draft_ref_key != null ? String(row.bas_draft_ref_key) : null,
    farm_fields: unwrapOne(
      row.farm_fields as
        | DraftMoveRow["farm_fields"]
        | DraftMoveRow["farm_fields"][]
    ),
    equipment: unwrapOne(
      ("equipment" in row ? row.equipment : null) as
        | DraftMoveRow["equipment"]
        | DraftMoveRow["equipment"][]
        | null
    ),
    inventory_items_cache: unwrapOne(
      row.inventory_items_cache as
        | DraftMoveRow["inventory_items_cache"]
        | DraftMoveRow["inventory_items_cache"][]
    ),
  }));
}

/**
 * Batch: draft outbound без bas_draft_ref_key → ЛЗК та/або Вимога-накладна.
 */
export async function syncLocalMovesToBas(): Promise<SyncLocalMovesToBasResult> {
  const rows = await loadDraftOutboundMoves();
  const lzkOn = isBasDraftPipelineEnabled(LZK_PIPELINE);
  const reqOn = isBasDraftPipelineEnabled(REQUIREMENT_PIPELINE);
  // Якщо окремий pipeline requirement ще не в env — дозволяємо разом з LZK
  // (щоб parts не лишались без маршруту після оновлення).
  const requirementEnabled = reqOn || lzkOn;
  const dryRun = !lzkOn && !requirementEnabled;

  if (rows.length === 0) {
    return {
      dryRun,
      draftCount: 0,
      moveCount: 0,
      payloads: [],
      errors: [],
    };
  }

  if (!lzkOn && !requirementEnabled) {
    return {
      dryRun: true,
      draftCount: 0,
      moveCount: rows.length,
      payloads: [],
      errors: [],
    };
  }

  const payloads: Array<LimitCardDraftPayload | RequirementDraftPayload> = [];
  if (lzkOn) {
    payloads.push(...(await buildLzkPayloads(rows)));
  }
  if (requirementEnabled) {
    payloads.push(...(await buildRequirementPayloads(rows)));
  }

  const allMoveIds = payloads.flatMap((p) => p._meta.moveIds);
  const errors: string[] = [];

  for (const payload of payloads) {
    const entity = payload._meta.entity;
    const label =
      "_meta" in payload && "fieldName" in payload._meta
        ? (payload._meta as LimitCardDraftPayload["_meta"]).fieldName
        : (payload._meta as RequirementDraftPayload["_meta"]).equipmentName ||
          "Вимога-накладна";

    const result = await postBasDocumentDraft(entity, toODataBody(payload));
    if (!result.ok) {
      const msg = `${label}: ${result.error}`;
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
        entitySet: entity,
      });
    }
  }

  return {
    dryRun: false,
    draftCount: payloads.length,
    moveCount: allMoveIds.length,
    payloads,
    errors,
  };
}

/**
 * Після створення списання: маршрутизація за категорією ТМЦ.
 */
export async function enqueueInventoryOutboundBasDraft(
  moveId: string
): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  const lzkOn = isBasDraftPipelineEnabled(LZK_PIPELINE);
  const reqOn =
    isBasDraftPipelineEnabled(REQUIREMENT_PIPELINE) || lzkOn;

  if (!lzkOn && !reqOn) {
    console.log(
      "[bas-drafts] outbound skip auto-post (pipelines off)",
      moveId
    );
    return { ok: true, dryRun: true };
  }

  // Швидкий шлях: дивимось категорію саме цього move
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        inventory_items_cache ( category, is_local, bas_ref_key )
      `
      )
      .eq("id", moveId)
      .maybeSingle();
    const cache = unwrapOne(
      data?.inventory_items_cache as
        | { category?: string; is_local?: boolean; bas_ref_key?: string }
        | { category?: string; is_local?: boolean; bas_ref_key?: string }[]
        | null
    );
    const category = cache?.category ? String(cache.category) : null;
    if (isRequirementCategory(category) && !reqOn) {
      console.log(
        "[bas-drafts] outbound requirement pipeline off",
        moveId,
        category
      );
      return { ok: true, dryRun: true };
    }
    if (isLzkCategory(category) && !lzkOn) {
      console.log("[bas-drafts] outbound LZK pipeline off", moveId, category);
      return { ok: true, dryRun: true };
    }
  } catch (err) {
    console.warn("[bas-drafts] outbound category peek", err);
  }

  const result = await syncLocalMovesToBas();
  if (result.errors.length > 0) {
    return { ok: false, dryRun: false, error: result.errors[0] };
  }
  return { ok: true, dryRun: result.dryRun };
}

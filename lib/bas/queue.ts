/**
 * Універсальна черга BAS-чернеток (Queue-Only / Dry-Run).
 *
 * Kill-switch: BAS_DRAFT_POST_ENABLED (див. lib/bas-drafts/config.ts).
 * Цей модуль НІКОЛИ не робить HTTP/OData POST у BAS —
 * лише пише в bas_sync_queue з валідним OData-payload у payload_json.
 */

import "server-only";

import { isBasDraftPostEnabled } from "@/lib/bas-drafts/config";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Дзеркало kill-switch для імпорту в інших модулях. */
export const BAS_DRAFT_POST_ENABLED = process.env.BAS_DRAFT_POST_ENABLED === "true";

export type BasDraftDocumentType =
  | "work_order"
  | "inventory_write_off"
  | "fuel_dispense"
  | "fuel_purchase"
  | "fuel_transfer"
  | "inventory_sale"
  | "inventory_inbound"
  | "unknown_document"
  | "service_receipt"
  | "grain_receipt"
  | "fuel_advance";

export type BasQueueStatus =
  | "dry_run_ready"
  | "queued"
  | "pending_approval"
  | "pending";

export type EnqueueBasDraftInput = {
  documentType: BasDraftDocumentType;
  entityId: string;
  /** OData-структура чернетки (Posted: false) + _meta */
  payload: Record<string, unknown>;
  summary?: string | null;
  sourceTable?: string | null;
  pipelineId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  /** Якщо true — завжди pending_approval (чекає рішення людини) */
  requireApproval?: boolean;
};

export type EnqueueBasDraftResult =
  | {
      ok: true;
      draftId: string;
      status: BasQueueStatus;
      documentType: BasDraftDocumentType;
      entityId: string;
      dryRun: boolean;
      alreadyQueued?: boolean;
      message: string;
    }
  | { ok: false; error: string };

const SOURCE_TABLE_BY_TYPE: Record<BasDraftDocumentType, string> = {
  work_order: "field_operations",
  inventory_write_off: "inventory_local_moves",
  fuel_dispense: "fuel_transactions",
  fuel_purchase: "fuel_transactions",
  fuel_transfer: "fuel_transactions",
  inventory_sale: "inventory_local_moves",
  inventory_inbound: "inventory_local_moves",
  unknown_document: "bas_sync_queue",
  service_receipt: "accounting_acts",
  grain_receipt: "inventory_local_moves",
  fuel_advance: "fuel_transactions",
};

const PIPELINE_BY_TYPE: Record<BasDraftDocumentType, string> = {
  work_order: "field_operation_waybill",
  inventory_write_off: "inventory_outbound_chemicals_act",
  fuel_dispense: "fuel_outbound_refuel",
  fuel_purchase: "fuel_inbound",
  fuel_transfer: "fuel_transfer",
  inventory_sale: "inventory_sale",
  inventory_inbound: "inventory_inbound_receipt",
  unknown_document: "document_recognition",
  service_receipt: "service_receipt",
  grain_receipt: "grain_receipt",
  fuel_advance: "fuel_advance_report",
};

function resolveQueueStatus(requireApproval?: boolean): {
  status: BasQueueStatus;
  dryRun: boolean;
} {
  if (requireApproval) {
    return { status: "pending_approval", dryRun: !isBasDraftPostEnabled() };
  }
  if (isBasDraftPostEnabled()) {
    return { status: "queued", dryRun: false };
  }
  return { status: "dry_run_ready", dryRun: true };
}

/**
 * Ставить чернетку в bas_sync_queue.
 * Не виконує жодного POST до odata/standard.odata.
 */
export async function enqueueBasDraft(
  input: EnqueueBasDraftInput
): Promise<EnqueueBasDraftResult> {
  const entityId = String(input.entityId ?? "").trim();
  if (!entityId) {
    return { ok: false, error: "Не вказано entityId" };
  }
  if (!input.payload || typeof input.payload !== "object") {
    return { ok: false, error: "Порожній payload чернетки" };
  }

  const { status, dryRun } = resolveQueueStatus(input.requireApproval);
  const documentType = input.documentType;
  const sourceTable =
    input.sourceTable?.trim() || SOURCE_TABLE_BY_TYPE[documentType];
  const pipelineId =
    input.pipelineId?.trim() || PIPELINE_BY_TYPE[documentType];

  const supabase = createServiceSupabase();

  // Уже відкрита позиція в черзі?
  const { data: existing } = await supabase
    .from("bas_sync_queue")
    .select("id, status, payload")
    .eq("document_type", documentType)
    .eq("source_id", entityId)
    .in("status", ["pending", "dry_run_ready", "queued", "pending_approval"])
    .maybeSingle();

  if (existing?.id) {
    console.log(
      `[BAS_QUEUE: ${dryRun ? "DRY-RUN" : "QUEUED"}] Already open ${documentType} for entity ${entityId} → ${existing.id}`
    );
    return {
      ok: true,
      draftId: String(existing.id),
      status: (existing.status as BasQueueStatus) || status,
      documentType,
      entityId,
      dryRun,
      alreadyQueued: true,
      message: dryRun
        ? "Чернетка вже в черзі (dry-run, без запису в 1С)."
        : "Чернетка вже в черзі на відправку воркером.",
    };
  }

  const payload = {
    ...input.payload,
    Posted: false,
    _meta: {
      ...((input.payload._meta as Record<string, unknown> | undefined) ?? {}),
      documentType,
      entityId,
      dryRun,
      queueStatus: status,
      summary: input.summary?.trim() || null,
      preparedAt: new Date().toISOString(),
    },
  };

  const row = {
    document_type: documentType,
    source_id: entityId,
    source_table: sourceTable,
    status,
    payload,
    notes: input.summary?.trim() || null,
    pipeline_id: pipelineId,
    actor_id: input.actorId || null,
    actor_name: input.actorName || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("bas_sync_queue")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    if (
      error.message?.includes("bas_sync_queue") ||
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return {
        ok: false,
        error:
          "Таблиця bas_sync_queue відсутня. Виконай міграції 071 + 077.",
      };
    }
    // Якщо міграція 077 ще не на проді — fallback на pending + legacy types
    if (
      /dry_run_ready|queued|pending_approval|inventory_sale|unknown_document|check/i.test(
        error.message
      )
    ) {
      const legacyTypeMap: Record<string, string> = {
        work_order: "work_order",
        inventory_write_off: "inventory_write_off",
        fuel_dispense: "fuel_dispense",
        fuel_purchase: "fuel_purchase",
        fuel_transfer: "fuel_transfer",
        inventory_sale: "inventory_write_off",
        inventory_inbound: "inventory_write_off",
        unknown_document: "work_order",
        service_receipt: "work_order",
        grain_receipt: "inventory_write_off",
        fuel_advance: "fuel_dispense",
      };
      const legacyType = legacyTypeMap[documentType] ?? "work_order";
      const fallback = await supabase
        .from("bas_sync_queue")
        .insert({
          ...row,
          status: "pending",
          document_type: legacyType,
        })
        .select("id")
        .maybeSingle();
      if (fallback.error || !fallback.data?.id) {
        return { ok: false, error: error.message };
      }
      console.log(
        `[BAS_QUEUE: DRY-RUN] Prepared ${documentType} for entity ${entityId} (legacy pending fallback → ${fallback.data.id}).`
      );
      return {
        ok: true,
        draftId: String(fallback.data.id),
        status: "pending",
        documentType,
        entityId,
        dryRun: true,
        message:
          "Чернетку збережено в чергу (legacy pending — застосуй міграцію 077).",
      };
    }
    return { ok: false, error: error.message };
  }

  const draftId = String(data?.id);
  console.log(
    `[BAS_QUEUE: ${dryRun ? "DRY-RUN" : "QUEUED"}] Prepared ${documentType} for entity ${entityId}. draftId=${draftId}`
  );

  return {
    ok: true,
    draftId,
    status,
    documentType,
    entityId,
    dryRun,
    message: dryRun
      ? "Чернетку підготовлено в режимі Dry-Run (без запису в 1С)."
      : "Чернетку додано в чергу на відправку воркером.",
  };
}

export async function getBasDraftById(draftId: string): Promise<{
  ok: true;
  row: {
    id: string;
    documentType: string;
    sourceId: string;
    sourceTable: string;
    status: string;
    payload: Record<string, unknown>;
    notes: string | null;
    pipelineId: string | null;
  };
} | { ok: false; error: string }> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("bas_sync_queue")
    .select(
      "id, document_type, source_id, source_table, status, payload, notes, pipeline_id"
    )
    .eq("id", draftId.trim())
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message || "Чернетку не знайдено" };
  }
  return {
    ok: true,
    row: {
      id: String(data.id),
      documentType: String(data.document_type),
      sourceId: String(data.source_id),
      sourceTable: String(data.source_table),
      status: String(data.status),
      payload: (data.payload as Record<string, unknown>) ?? {},
      notes: data.notes != null ? String(data.notes) : null,
      pipelineId: data.pipeline_id != null ? String(data.pipeline_id) : null,
    },
  };
}

export async function markBasDraftRouted(input: {
  draftId: string;
  targetSection: string;
  localEntityId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceSupabase();
  const draft = await getBasDraftById(input.draftId);
  if (!draft.ok) return draft;

  const payload = {
    ...draft.row.payload,
    _meta: {
      ...((draft.row.payload._meta as Record<string, unknown>) ?? {}),
      routedTo: input.targetSection,
      localEntityId: input.localEntityId ?? null,
      routedAt: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from("bas_sync_queue")
    .update({
      payload,
      notes: input.notes?.trim() || draft.row.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.draftId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* OData payload builders (Posted: false) — лише структура для черги          */
/* -------------------------------------------------------------------------- */

export function buildWaybillOdataPayload(input: {
  operationId: string;
  workType: string;
  fieldName: string;
  crop: string;
  mechanicName?: string | null;
  machinery?: string | null;
  areaFact: number;
  fuelFact?: number | null;
  wageFact?: number | null;
  occurredAt?: string | null;
  fieldBasRefKey?: string | null;
  equipmentBasRefKey?: string | null;
}): Record<string, unknown> {
  const date = (input.occurredAt || new Date().toISOString()).slice(0, 10);
  return {
    Date: `${date}T00:00:00`,
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · обліковий лист (чернетка)",
      input.workType,
      input.fieldName,
      input.crop,
      input.mechanicName ? `мех. ${input.mechanicName}` : null,
      input.machinery ? `техн. ${input.machinery}` : null,
      `факт ${input.areaFact} га`,
      input.fuelFact != null ? `ДП ${input.fuelFact} л` : null,
      input.wageFact != null ? `ЗП ${input.wageFact} ₴` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    ЗатратыТопливаПоФакту: input.fuelFact ?? null,
    Автомобиль_Key: input.equipmentBasRefKey || null,
    Организация_Key: null,
    _meta: {
      basDocument: "Document_УчетныйЛистТрактористаМашиниста",
      basDocumentAlt: "Document_ИНАГРО_ПутевойЛистТрактористаМашиниста",
      pipeline: "field_operation_waybill",
      operationId: input.operationId,
      fieldBasKey: input.fieldBasRefKey ?? null,
      areaFact: input.areaFact,
      fuelFact: input.fuelFact ?? null,
      wageFact: input.wageFact ?? null,
    },
  };
}

export function buildChemicalsActOdataPayload(input: {
  moveId: string;
  itemName: string;
  itemBasRefKey: string;
  qty: number;
  unit?: string | null;
  fieldName?: string | null;
  crop?: string | null;
  fieldBasRefKey?: string | null;
  date?: string | null;
}): Record<string, unknown> {
  const date = (input.date || new Date().toISOString()).slice(0, 10);
  return {
    Date: `${date}T00:00:00`,
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · акт використання добрив/ЗЗР (чернетка)",
      input.itemName,
      `${input.qty}${input.unit ? ` ${input.unit}` : ""}`,
      input.fieldName ? `поле ${input.fieldName}` : null,
      input.crop || null,
    ]
      .filter(Boolean)
      .join(" · "),
    Материалы: [
      {
        LineNumber: 1,
        Номенклатура_Key: input.itemBasRefKey,
        Количество: input.qty,
        Коэффициент: 1,
        ЕдиницаИзмерения: input.unit || null,
      },
    ],
    _meta: {
      basDocument: "Document_АктОбИспользованииУдобренийИЯдохимикатов",
      pipeline: "inventory_outbound_chemicals_act",
      moveId: input.moveId,
      fieldBasKey: input.fieldBasRefKey ?? null,
    },
  };
}

export function buildFuelDispenseOdataPayload(input: {
  transactionId: string;
  liters: number;
  storageName?: string | null;
  storageBasRefKey?: string | null;
  equipmentName?: string | null;
  equipmentBasRefKey?: string | null;
  operatorName?: string | null;
  date?: string | null;
}): Record<string, unknown> {
  const date = (input.date || new Date().toISOString()).slice(0, 10);
  return {
    Date: `${date}T00:00:00`,
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · роздача ДП (чернетка)",
      input.storageName ? `з ${input.storageName}` : null,
      input.equipmentName ? `→ ${input.equipmentName}` : null,
      `${input.liters} л`,
      input.operatorName || null,
    ]
      .filter(Boolean)
      .join(" · "),
    Склад_Key: input.storageBasRefKey || null,
    ТранспортноеСредствоПолучатель_Key: input.equipmentBasRefKey || null,
    Товары: [
      {
        LineNumber: 1,
        Количество: input.liters,
        КоличествоВОсновномТопливеПолучатель: input.liters,
        КоэффициентВОсновноеТопливоПолучатель: 1,
      },
    ],
    _meta: {
      basDocument: "Document_ТребованиеНакладная",
      basDocumentAlt: "Document_ИНАГРО_ПередачаТоплива",
      pipeline: "fuel_outbound_refuel",
      transactionId: input.transactionId,
    },
  };
}

export function buildSaleOdataPayload(input: {
  moveId: string;
  itemName: string;
  itemBasRefKey?: string | null;
  qtyTons: number;
  pricePerTonUah: number;
  buyer: string;
  date?: string | null;
}): Record<string, unknown> {
  const date = (input.date || new Date().toISOString()).slice(0, 10);
  const qty = input.qtyTons;
  const price = input.pricePerTonUah;
  const sum = Math.round(qty * price * 100) / 100;
  return {
    Date: `${date}T00:00:00`,
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · реалізація (чернетка)",
      input.buyer,
      input.itemName,
      `${qty} т`,
      `${sum} ₴ без ПДВ`,
    ].join(" · "),
    Товары: [
      {
        LineNumber: 1,
        Номенклатура_Key: input.itemBasRefKey || null,
        Количество: qty,
        Цена: price,
        Сумма: sum,
      },
    ],
    _meta: {
      basDocument: "Document_РеализацияТоваровУслуг",
      pipeline: "inventory_sale",
      moveId: input.moveId,
      buyer: input.buyer,
      amountUahExVat: sum,
    },
  };
}

export function buildRecognizedDocumentOdataPayload(input: {
  classification: string;
  basDocument: string;
  basSection: "Товари" | "Послуги" | "Зерно" | "Аванс" | "Невідомо";
  counterparty: string | null;
  docNumber: string | null;
  docDate: string | null;
  totalAmountUah: number | null;
  lines: Array<{
    name: string;
    unit?: string | null;
    qty?: number | null;
    price?: number | null;
    sum?: number | null;
  }>;
  alternatives?: string[];
  docHint?: string | null;
}): Record<string, unknown> {
  const date = (input.docDate || new Date().toISOString()).slice(0, 10);
  const goods = input.lines.map((line, idx) => ({
    LineNumber: idx + 1,
    НоменклатураНаименование: line.name,
    Количество: line.qty ?? null,
    ЕдиницаИзмерения: line.unit ?? null,
    Цена: line.price ?? null,
    Сумма: line.sum ?? null,
  }));

  return {
    Date: `${date}T00:00:00`,
    Posted: false,
    DeletionMark: false,
    НомерВходящегоДокумента: input.docNumber,
    Комментарий: [
      "AgroSystem · розпізнаний документ (чернетка)",
      input.classification,
      input.counterparty,
      input.docHint,
    ]
      .filter(Boolean)
      .join(" · "),
    КонтрагентНаименование: input.counterparty,
    Товары: input.basSection === "Послуги" ? [] : goods,
    Услуги: input.basSection === "Послуги" ? goods : [],
    СуммаДокумента: input.totalAmountUah,
    _meta: {
      basDocument: input.basDocument,
      basSection: input.basSection,
      classification: input.classification,
      alternatives: input.alternatives ?? [],
      lineCount: input.lines.length,
      recognition: true,
    },
  };
}

/**
 * Черга документів AgroSystem → BAS (bas_sync_queue).
 * Не POST в OData — лише запис у нашу БД (+ оновлення статусів джерела).
 */

import { createServiceSupabase } from "@/lib/supabase/server";

export type BasSyncDocumentType =
  | "work_order"
  | "inventory_write_off"
  | "fuel_dispense";

export type EnqueueBasSyncResult =
  | {
      ok: true;
      syncId: string;
      status: "queued";
      documentType: BasSyncDocumentType;
      sourceId: string;
      payload: Record<string, unknown>;
      message: string;
      alreadyQueued?: boolean;
    }
  | { ok: false; error: string; status?: string };

const PIPELINE_BY_TYPE: Record<BasSyncDocumentType, string> = {
  work_order: "field_operation_waybill",
  inventory_write_off: "inventory_outbound_lzk",
  fuel_dispense: "fuel_outbound_refuel",
};

const SOURCE_TABLE_BY_TYPE: Record<BasSyncDocumentType, string> = {
  work_order: "field_operations",
  inventory_write_off: "inventory_local_moves",
  fuel_dispense: "fuel_transactions",
};

export async function enqueueBasSyncQueue(input: {
  documentType: BasSyncDocumentType;
  sourceId: string;
  payload: Record<string, unknown>;
  notes?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}): Promise<EnqueueBasSyncResult> {
  const supabase = createServiceSupabase();
  const documentType = input.documentType;
  const sourceId = input.sourceId.trim();
  if (!sourceId) {
    return { ok: false, error: "Не вказано entityId / source_id" };
  }

  // Унікальність pending — якщо вже в черзі, повертаємо існуючий
  const { data: existing } = await supabase
    .from("bas_sync_queue")
    .select("id, status, payload")
    .eq("document_type", documentType)
    .eq("source_id", sourceId)
    .eq("status", "pending")
    .maybeSingle();

  if (existing?.id) {
    return {
      ok: true,
      syncId: String(existing.id),
      status: "queued",
      documentType,
      sourceId,
      payload: (existing.payload as Record<string, unknown>) ?? input.payload,
      alreadyQueued: true,
      message: "Документ уже в черзі імпорту в BAS АГРО",
    };
  }

  const row = {
    document_type: documentType,
    source_id: sourceId,
    source_table: SOURCE_TABLE_BY_TYPE[documentType],
    status: "pending",
    payload: input.payload,
    notes: input.notes?.trim() || null,
    pipeline_id: PIPELINE_BY_TYPE[documentType],
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
          "Таблиця bas_sync_queue відсутня. Виконай міграцію 071_bas_sync_queue.sql.",
        status: "error",
      };
    }
    return { ok: false, error: error.message, status: "error" };
  }

  return {
    ok: true,
    syncId: String(data?.id),
    status: "queued",
    documentType,
    sourceId,
    payload: input.payload,
    message: "Документ успішно додано до черги імпорту в BAS АГРО",
  };
}

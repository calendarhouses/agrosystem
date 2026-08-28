/**
 * Закритий наряд → чернетка Document_ИНАГРО_ПутевойЛистТрактористаМашиниста.
 * Partial: лише шапка; табличні частини (ПутевыеЛисты, Начисления) — з бухгалтером.
 */

import { basOrganizationKey, isBasDraftPostEnabled } from "@/lib/bas-drafts/config";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import { createServiceSupabase } from "@/lib/supabase/server";

const ENTITY = "Document_ИНАГРО_ПутевойЛистТрактористаМашиниста";

export async function enqueueFieldOperationBasDraft(
  operationId: string
): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  if (!isBasDraftPostEnabled()) {
    console.log(
      "[bas-drafts] waybill skip auto-post (BAS_DRAFT_POST_ENABLED=false)",
      operationId
    );
    return { ok: true, dryRun: true };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("field_operations")
    .select(
      `
      id, work_type, crop, area_fact, fuel_fact, wage_fact,
      occurred_at, closed_at, machinery, implement, agronomist_comment,
      bas_draft_ref_key, equipment_id,
      farm_fields ( id, name, bas_ref_key ),
      equipment_id
    `
    )
    .eq("id", operationId)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      error: error?.message ?? "наряд не знайдено",
    };
  }
  if (data.bas_draft_ref_key) {
    return { ok: true, dryRun: false };
  }

  const field = Array.isArray(data.farm_fields)
    ? data.farm_fields[0]
    : data.farm_fields;

  let equipmentBas: string | null = null;
  if (data.equipment_id) {
    const { data: eq } = await supabase
      .from("equipment")
      .select("bas_ref_key")
      .eq("id", data.equipment_id)
      .maybeSingle();
    if (eq?.bas_ref_key) {
      equipmentBas = String(eq.bas_ref_key).toLowerCase();
    }
  }
  const org = basOrganizationKey();
  const dateIso = toIsoDateTime(
    String(data.occurred_at || data.closed_at || new Date().toISOString())
  );

  const body: Record<string, unknown> = {
    Date: dateIso,
    Posted: false,
    DeletionMark: false,
    ЗатратыТопливаПоФакту:
      data.fuel_fact != null ? Number(data.fuel_fact) : undefined,
    Комментарий: [
      "AgroSystem · шляховий лист (чернетка)",
      data.work_type ? String(data.work_type) : null,
      data.crop ? `культура: ${data.crop}` : null,
      field?.name ? `поле: ${field.name}` : null,
      data.area_fact != null ? `га: ${data.area_fact}` : null,
      data.machinery ? String(data.machinery) : null,
      data.implement ? `агрегат: ${data.implement}` : null,
      data.agronomist_comment ? String(data.agronomist_comment) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    _meta: {
      operationId,
      pipeline: "field_operation_waybill",
      fieldBasKey: field?.bas_ref_key
        ? String(field.bas_ref_key).toLowerCase()
        : null,
    },
  };
  if (org) body.Организация_Key = org;
  if (equipmentBas) body.Автомобиль_Key = equipmentBas;

  const result = await postBasDocumentDraft(ENTITY, body);
  if (!result.ok) {
    await markBasDraftFailure({
      table: "field_operations",
      ids: [operationId],
      error: result.error,
    });
    return { ok: false, dryRun: result.dryRun, error: result.error };
  }

  if (!result.dryRun) {
    await markBasDraftSuccess({
      table: "field_operations",
      ids: [operationId],
      refKey: result.refKey,
      entitySet: ENTITY,
    });
    await supabase
      .from("field_operations")
      .update({ export_status: "synced" })
      .eq("id", operationId);
  }

  return { ok: true, dryRun: result.dryRun };
}

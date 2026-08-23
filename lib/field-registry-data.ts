import "server-only";

import { getBasFields } from "@/lib/bas-api";
import { normalizeBasRefKey } from "@/lib/bas-mapping";
import {
  basFieldsToSummaries,
  type BasFieldSummary,
  type BasRequestStatus,
  type FieldRegistryRow,
} from "@/lib/field-registry";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Спільне завантаження реєстру для сторінок полів і заявки бухгалтеру. */

const REQUEST_STATUSES = new Set<BasRequestStatus>([
  "none",
  "pending",
  "synced",
  "error",
]);

function toRequestStatus(raw: unknown): BasRequestStatus {
  const value = typeof raw === "string" ? raw : "none";
  return REQUEST_STATUSES.has(value as BasRequestStatus)
    ? (value as BasRequestStatus)
    : "none";
}

export async function loadRegistryRows(): Promise<FieldRegistryRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("farm_fields")
    .select(
      "id, name, area_ha, wialon_zone_id, canonical_name, field_no, tract, is_field, bas_ref_key, bas_sync_status, bas_synced_at, bas_sync_error"
    )
    .order("canonical_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[field-registry] farm_fields:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    wialonName: String(row.name ?? "Поле"),
    wialonZoneId: row.wialon_zone_id ? String(row.wialon_zone_id) : null,
    areaHa: row.area_ha != null ? Number(row.area_ha) : null,
    canonicalName: String(row.canonical_name ?? ""),
    fieldNo: String(row.field_no ?? ""),
    tract: String(row.tract ?? ""),
    isField: row.is_field !== false,
    basRefKey: normalizeBasRefKey(row.bas_ref_key),
    requestStatus: toRequestStatus(row.bas_sync_status),
    requestedAt: row.bas_synced_at ? String(row.bas_synced_at) : null,
    requestNote: row.bas_sync_error ? String(row.bas_sync_error) : null,
  }));
}

export async function loadBasFields(): Promise<{
  items: BasFieldSummary[];
  error: string | null;
}> {
  try {
    return { items: basFieldsToSummaries(await getBasFields()), error: null };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "Помилка BAS OData",
    };
  }
}

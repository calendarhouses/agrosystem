import type { SupabaseClient } from "@supabase/supabase-js";

import { mapOperationRow, type FieldOperation } from "@/lib/field-operations";

/** Колонки з міграцій 008 / 022 / 043 — можуть бути відсутні на старій БД */
const OPTIONAL_UPSERT_COLUMNS = [
  "weather_context",
  "export_status",
  "equipment_id",
  "wialon_unit_id",
  "implement_width_m",
  "tracker_distance_km",
  "tracker_work_hours",
  "tracker_fuel_l",
  "season",
  "season_year",
  "actor_id",
  "actor_name",
  "closed_by_id",
  "closed_by_name",
] as const;

function isMissingColumnError(message: string, column: string): boolean {
  const m = message.toLowerCase();
  const col = column.toLowerCase();
  return (
    m.includes(col) &&
    (m.includes("schema cache") ||
      m.includes("could not find") ||
      m.includes("column") ||
      m.includes("42703"))
  );
}

function stripMissingColumn(
  payload: Record<string, unknown>,
  errorMessage: string
): Record<string, unknown> | null {
  const missing = OPTIONAL_UPSERT_COLUMNS.find(
    (column) =>
      column in payload && isMissingColumnError(errorMessage, column)
  );
  if (!missing) return null;
  const next = { ...payload };
  delete next[missing];
  return next;
}

export type UpsertFieldOperationResult =
  | { ok: true; operation: FieldOperation }
  | { ok: false; error: string; code?: string };

/** Upsert наряду з повтором без колонок, яких ще немає в Supabase. */
export async function upsertFieldOperationRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<UpsertFieldOperationResult> {
  let payload = { ...row };

  for (let attempt = 0; attempt <= OPTIONAL_UPSERT_COLUMNS.length; attempt++) {
    const { data, error } = await supabase
      .from("field_operations")
      .upsert(payload, { onConflict: "client_key" })
      .select("*")
      .single();

    if (!error) {
      return {
        ok: true,
        operation: mapOperationRow(data as Record<string, unknown>),
      };
    }

    const nextPayload = stripMissingColumn(payload, error.message);
    if (!nextPayload) {
      return { ok: false, error: error.message, code: error.code };
    }
    payload = nextPayload;
  }

  return { ok: false, error: "Не вдалося зберегти наряд" };
}

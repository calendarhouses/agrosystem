import { createServiceSupabase } from "@/lib/supabase/server";
import { farmFieldIdFromKey } from "@/lib/field-operations";
import { currentAgroSeason } from "@/lib/season";
import type { AgroplanSeasonOperation } from "@/lib/agroplan/season-ops";

type FieldJoin = {
  id?: string;
  name?: string | null;
  canonical_name?: string | null;
} | null;

type OpRow = {
  client_key: string;
  field_id: string | null;
  field_key: string | null;
  work_type: string | null;
  crop: string | null;
  status: string | null;
  occurred_at: string | null;
  machinery: string | null;
  implement: string | null;
  farm_fields?: FieldJoin | FieldJoin[];
};

function fieldLabel(row: OpRow): { fieldId: string | null; fieldName: string } {
  const joinRaw = row.farm_fields;
  const join = Array.isArray(joinRaw) ? joinRaw[0] : joinRaw;
  const fromJoinId = join?.id ? String(join.id) : null;
  const fieldId =
    (row.field_id ? String(row.field_id) : null) ||
    fromJoinId ||
    (row.field_key ? farmFieldIdFromKey(String(row.field_key)) : null);
  const fieldName =
    join?.canonical_name?.trim() ||
    join?.name?.trim() ||
    (fieldId ? "Поле" : "Поле (без паспорта)");
  return { fieldId, fieldName };
}

/** Наряди сезону для таймлайну Агроплану */
export async function loadAgroplanSeasonOperations(
  season = currentAgroSeason()
): Promise<AgroplanSeasonOperation[]> {
  const supabase = createServiceSupabase();

  let query = supabase
    .from("field_operations")
    .select(
      "client_key, field_id, field_key, work_type, crop, status, occurred_at, machinery, implement, farm_fields ( id, name, canonical_name )"
    )
    .in("status", ["planned", "in_progress", "completed"])
    .order("occurred_at", { ascending: true })
    .limit(800);

  let { data, error } = await query.eq("season", season);

  if (error && (error.message?.includes("season") || error.code === "42703")) {
    const legacy = await supabase
      .from("field_operations")
      .select(
        "client_key, field_id, field_key, work_type, crop, status, occurred_at, machinery, implement, farm_fields ( id, name, canonical_name )"
      )
      .in("status", ["planned", "in_progress", "completed"])
      .order("occurred_at", { ascending: true })
      .limit(800);
    data = legacy.data;
    error = legacy.error;
  }

  if (error) {
    console.error("[agroplan/season-ops]", error.message);
    return [];
  }

  const out: AgroplanSeasonOperation[] = [];
  for (const raw of data ?? []) {
    const row = raw as OpRow;
    const ymd = String(row.occurred_at ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const { fieldId, fieldName } = fieldLabel(row);
    out.push({
      clientKey: String(row.client_key),
      fieldId,
      fieldKey: row.field_key ? String(row.field_key) : `farm:${fieldId ?? "unknown"}`,
      fieldName,
      workType: String(row.work_type ?? "").trim() || "Операція",
      crop: String(row.crop ?? "").trim() || "—",
      status: (String(row.status ?? "planned") as AgroplanSeasonOperation["status"]),
      occurredAt: ymd,
      machinery: String(row.machinery ?? "").trim() || "—",
      implement: String(row.implement ?? "").trim() || "—",
    });
  }
  return out;
}

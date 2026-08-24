/**
 * Активні наряди для карток техніки / причіпного.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { farmFieldIdFromKey } from "@/lib/field-operations";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";

export type FleetActiveOperation = {
  id: string;
  fieldId: string | null;
  fieldName: string;
  fieldKey: string | null;
  machinery: string;
  implement: string;
  wialonUnitId: number | null;
  equipmentId: string | null;
  implementId: string | null;
  workType: string;
  areaPlan: number | null;
  areaFact: number | null;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[''`"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function plateTokens(value: string): string[] {
  return (value.match(/[a-zа-яіїєґ]*\d{4,}[a-zа-яіїєґ\d]*/gi) ?? []).map((t) =>
    t.toLowerCase()
  );
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aPlates = plateTokens(na);
  const bPlates = new Set(plateTokens(nb));
  if (aPlates.length === 0 || bPlates.size === 0) return false;
  return aPlates.some((t) => bPlates.has(t));
}

type FieldJoin = {
  id?: string;
  name?: string | null;
  canonical_name?: string | null;
} | null;

type OpRow = {
  id: string;
  field_id: string | null;
  field_key: string | null;
  machinery: string | null;
  implement: string | null;
  wialon_unit_id: number | null;
  work_type: string | null;
  area_plan: number | string | null;
  area_fact: number | string | null;
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

  const fromCanonical = join?.canonical_name?.trim();
  const fromName = join?.name?.trim();
  const fieldName =
    fromCanonical ||
    fromName ||
    (fieldId ? "Поле" : "Поле (без паспорта)");

  return { fieldId, fieldName };
}

/**
 * Наряди in_progress за сьогодні (Europe/Kyiv) + матч до equipment/implements.
 */
export async function loadTodayActiveOperations(): Promise<
  FleetActiveOperation[]
> {
  const supabase = createServiceSupabase();
  const today = todayKyivYmd();
  const season = currentAgroSeason();

  let query = supabase
    .from("field_operations")
    .select(
      "id, field_id, field_key, machinery, implement, wialon_unit_id, work_type, area_plan, area_fact, farm_fields ( id, name )"
    )
    .eq("status", "in_progress")
    .eq("occurred_at", today);

  let { data, error } = await query.eq("season", season);

  if (error && (error.message?.includes("season") || error.code === "42703")) {
    const legacy = await supabase
      .from("field_operations")
      .select(
        "id, field_id, field_key, machinery, implement, wialon_unit_id, work_type, area_plan, area_fact, farm_fields ( id, name )"
      )
      .eq("status", "in_progress")
      .eq("occurred_at", today);
    data = legacy.data as typeof data;
    error = legacy.error;
  }

  if (error) {
    console.error("[active-ops]", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as OpRow[];

  const [{ data: equipment }, { data: implements_ }] = await Promise.all([
    supabase.from("equipment").select("id, name, wialon_id").eq("is_active", true),
    supabase.from("implements").select("id, name"),
  ]);

  const eqByWialon = new Map<number, { id: string; name: string }>();
  const eqList = (equipment ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    wialon_id:
      row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
        ? Number(row.wialon_id)
        : null,
  }));
  for (const row of eqList) {
    if (row.wialon_id != null) eqByWialon.set(row.wialon_id, row);
  }

  const implList = (implements_ ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
  }));

  const out: FleetActiveOperation[] = [];

  for (const raw of rows) {
    const row = raw;
    const { fieldId, fieldName } = fieldLabel(row);
    const machinery = String(row.machinery ?? "").trim();
    const implement = String(row.implement ?? "").trim();
    const wialonUnitId =
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : null;

    let equipmentId: string | null = null;
    if (wialonUnitId != null) {
      equipmentId = eqByWialon.get(wialonUnitId)?.id ?? null;
    }
    if (!equipmentId && machinery) {
      const hit = eqList.find((eq) => namesMatch(eq.name, machinery));
      equipmentId = hit?.id ?? null;
    }

    let implementId: string | null = null;
    if (implement) {
      const hit = implList.find((item) => namesMatch(item.name, implement));
      implementId = hit?.id ?? null;
    }

    out.push({
      id: String(row.id),
      fieldId,
      fieldName,
      fieldKey: row.field_key ? String(row.field_key) : null,
      machinery: machinery || "—",
      implement: implement || "—",
      wialonUnitId,
      equipmentId,
      implementId,
      workType: String(row.work_type ?? "").trim() || "Операція",
      areaPlan: numOrNull(row.area_plan),
      areaFact: numOrNull(row.area_fact),
    });
  }

  return out;
}

function attachActiveOpsToInventory<
  TNon extends { equipmentId: string; source?: string },
>(
  items: TNon[],
  ops: FleetActiveOperation[],
  byEquipment: Map<string, FleetActiveOperation>,
  byImplement: Map<string, FleetActiveOperation>
): (TNon & { activeOp: FleetActiveOperation | null })[] {
  return items.map((item) => {
    const isImplement = item.source === "implement";
    return {
      ...item,
      activeOp: isImplement
        ? byImplement.get(item.equipmentId) ?? null
        : byEquipment.get(item.equipmentId) ?? null,
    };
  });
}

export function attachActiveOpsToFleet<
  TTracked extends { equipmentId: string; id: number; nm?: string },
  TNon extends { equipmentId: string; source?: string },
>(
  tracked: TTracked[],
  nonTracked: TNon[],
  towedEquipment: TNon[],
  ops: FleetActiveOperation[]
): {
  tracked: (TTracked & { activeOp: FleetActiveOperation | null })[];
  nonTracked: (TNon & { activeOp: FleetActiveOperation | null })[];
  towedEquipment: (TNon & { activeOp: FleetActiveOperation | null })[];
} {
  const byEquipment = new Map<string, FleetActiveOperation>();
  const byWialon = new Map<number, FleetActiveOperation>();
  const byImplement = new Map<string, FleetActiveOperation>();

  for (const op of ops) {
    if (op.equipmentId) byEquipment.set(op.equipmentId, op);
    if (op.wialonUnitId != null) byWialon.set(op.wialonUnitId, op);
    if (op.implementId) byImplement.set(op.implementId, op);
  }

  return {
    tracked: tracked.map((unit) => {
      const byEq = byEquipment.get(unit.equipmentId);
      const byW = byWialon.get(unit.id);
      let byName: FleetActiveOperation | null = null;
      if (!byEq && !byW && unit.nm) {
        for (const op of ops) {
          if (
            op.machinery &&
            op.machinery !== "—" &&
            namesMatch(op.machinery, unit.nm)
          ) {
            byName = op;
            break;
          }
        }
      }
      return {
        ...unit,
        activeOp: byEq ?? byW ?? byName ?? null,
      };
    }),
    nonTracked: attachActiveOpsToInventory(
      nonTracked,
      ops,
      byEquipment,
      byImplement
    ),
    towedEquipment: attachActiveOpsToInventory(
      towedEquipment,
      ops,
      byEquipment,
      byImplement
    ),
  };
}

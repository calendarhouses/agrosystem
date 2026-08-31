/**
 * Людські назви юнітів Wialon для розшифровок KPI (паливо, поля).
 * Спочатку equipment.name, інакше nm з Wialon API.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { listWialonUnitBasics, wialonLogin } from "@/lib/wialon";

export function isPlaceholderEquipmentName(name: string): boolean {
  return (
    !name.trim() ||
    name === "Техніка" ||
    /^Wialon #\d+$/i.test(name.trim()) ||
    /^Unit \d+$/i.test(name.trim())
  );
}

export type WialonUnitNameResolution = {
  names: Map<number, string>;
  equipmentIdByWialon: Map<number, string>;
};

/**
 * wialon_id → назва + equipment.id (якщо зіставлено).
 */
export async function resolveWialonUnitNames(
  wialonIds: number[]
): Promise<WialonUnitNameResolution> {
  const names = new Map<number, string>();
  const equipmentIdByWialon = new Map<number, string>();
  const unique = [...new Set(wialonIds.filter((id) => id > 0))];
  if (unique.length === 0) {
    return { names, equipmentIdByWialon };
  }

  const supabase = createServiceSupabase();
  const { data: eqRows } = await supabase
    .from("equipment")
    .select("id, name, wialon_id")
    .in("wialon_id", unique);

  for (const row of eqRows ?? []) {
    const wid = Number(row.wialon_id);
    if (!Number.isFinite(wid) || wid <= 0) continue;
    equipmentIdByWialon.set(wid, String(row.id));
    const name = String(row.name ?? "").trim();
    if (name) names.set(wid, name);
  }

  const stillMissing = unique.filter((id) => !names.has(id));
  if (stillMissing.length > 0) {
    try {
      const eid = await wialonLogin();
      const units = await listWialonUnitBasics(eid);
      const want = new Set(stillMissing);
      for (const u of units) {
        if (!want.has(u.id)) continue;
        const nm = String(u.nm ?? "").trim();
        if (nm) names.set(u.id, nm);
      }
    } catch (err) {
      console.error(
        "[wialon-unit-names] Wialon basics",
        err instanceof Error ? err.message : err
      );
    }
  }

  return { names, equipmentIdByWialon };
}

/** Зручний alias — лише назви для UI. */
export async function resolveWialonUnitDisplayNames(
  wialonIds: number[]
): Promise<Map<number, string>> {
  const { names } = await resolveWialonUnitNames(wialonIds);
  return names;
}

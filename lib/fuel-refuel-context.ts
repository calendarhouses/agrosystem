/**
 * Smart Context для модалки «Заправка»: локація Wialon + активний наряд.
 */

import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { loadTodayActiveOperations } from "@/lib/equipment-active-ops";
import type { FieldGeometry } from "@/lib/farm-fields";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  getWialonUnitById,
  hasValidWialonPosition,
  wialonLogin,
  type WialonUnit,
} from "@/lib/wialon";

export type RefuelActiveOpHint = {
  id: string;
  workType: string;
  fieldName: string;
};

export type RefuelSmartContext = {
  wialonUnitId: number;
  /** Назва геозони/поля, де зараз GPS юніта */
  locationLabel: string | null;
  activeOperation: RefuelActiveOpHint | null;
};

function fieldDisplayName(row: {
  name?: string | null;
  canonical_name?: string | null;
}): string {
  const canonical = row.canonical_name?.trim();
  const name = row.name?.trim();
  return canonical || name || "Поле";
}

async function resolveUnitLocationLabel(
  unit: WialonUnit
): Promise<string | null> {
  if (!hasValidWialonPosition(unit)) return null;
  const lng = unit.pos.x;
  const lat = unit.pos.y;

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("farm_fields")
    .select("name, canonical_name, geometry")
    .not("geometry", "is", null);

  if (error || !data?.length) return null;

  const pt = point([lng, lat]);
  for (const row of data) {
    const geometry = row.geometry as FieldGeometry | null;
    if (
      !geometry ||
      (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
    ) {
      continue;
    }
    const feature: Feature<Polygon | MultiPolygon> = {
      type: "Feature",
      properties: {},
      geometry,
    };
    try {
      if (booleanPointInPolygon(pt, feature)) {
        return fieldDisplayName(row);
      }
    } catch {
      /* skip bad geometry */
    }
  }
  return null;
}

/**
 * Мікро-контекст для агронома: де трактор зараз + чи є in_progress наряд.
 */
export async function loadRefuelSmartContext(
  wialonUnitId: number
): Promise<RefuelSmartContext> {
  const empty: RefuelSmartContext = {
    wialonUnitId,
    locationLabel: null,
    activeOperation: null,
  };
  if (!Number.isFinite(wialonUnitId) || wialonUnitId <= 0) return empty;

  let locationLabel: string | null = null;
  try {
    const eid = await wialonLogin();
    const unit = await getWialonUnitById(eid, wialonUnitId, {
      withSensorCalc: false,
    });
    if (unit) {
      locationLabel = await resolveUnitLocationLabel(unit);
    }
  } catch (error) {
    console.error(
      "[refuel-context] location",
      error instanceof Error ? error.message : error
    );
  }

  let activeOperation: RefuelActiveOpHint | null = null;
  try {
    const ops = await loadTodayActiveOperations();
    const hit =
      ops.find((op) => op.wialonUnitId === wialonUnitId) ??
      null;
    if (hit) {
      activeOperation = {
        id: hit.id,
        workType: hit.workType,
        fieldName: hit.fieldName,
      };
    }
  } catch (error) {
    console.error(
      "[refuel-context] active-op",
      error instanceof Error ? error.message : error
    );
  }

  return { wialonUnitId, locationLabel, activeOperation };
}

import { NextResponse } from "next/server";
import type { FeatureCollection, Polygon } from "geojson";

import {
  attachActiveOpsToFleet,
  loadTodayActiveOperations,
} from "@/lib/equipment-active-ops";
import {
  appendImplementsAsTowedEquipment,
  wialonFirstFleet,
  type FleetEquipmentRow,
} from "@/lib/equipment-fleet";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  EMPTY_GEOFENCE_COLLECTION,
  getWialonGeofences,
  getWialonUnits,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
  type WialonGeofenceProperties,
} from "@/lib/wialon";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type EquipmentDbRow = {
  id: string;
  name: string;
  type: string;
  code: string | null;
  wialon_id: number | null;
  fuel_tank_volume?: number | string | null;
};

/**
 * GET /api/equipment/fleet
 * Тимчасово: джерело правди = усі юніти Wialon (до зіставлення з BAS AGRO).
 * Equipment / implements — опційне збагачення + «Без трекера».
 */
export async function GET() {
  try {
    const supabase = createServiceSupabase();

    let equipment: FleetEquipmentRow[] = [];
    let { data: rows, error } = await supabase
      .from("equipment")
      .select("id, name, type, code, wialon_id, fuel_tank_volume")
      .eq("is_active", true)
      .order("name");

    if (error && error.message?.includes("fuel_tank_volume")) {
      const legacy = await supabase
        .from("equipment")
        .select("id, name, type, code, wialon_id")
        .eq("is_active", true)
        .order("name");
      rows = (legacy.data ?? []).map((row) => ({
        ...row,
        fuel_tank_volume: null,
      }));
      error = legacy.error;
    }

    if (!error && rows) {
      equipment = (rows as EquipmentDbRow[]).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        type: String(row.type ?? "other"),
        code: row.code != null ? String(row.code) : null,
        wialon_id:
          row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
            ? Number(row.wialon_id)
            : null,
        fuel_tank_volume:
          row.fuel_tank_volume != null &&
          Number.isFinite(Number(row.fuel_tank_volume))
            ? Number(row.fuel_tank_volume)
            : null,
      }));
    }

    const { data: implementsRows } = await supabase
      .from("implements")
      .select("id, name, type, code")
      .order("name");

    let geofences: FeatureCollection<
      Polygon,
      WialonGeofenceProperties
    > = EMPTY_GEOFENCE_COLLECTION;
    let wialonUnits: Awaited<ReturnType<typeof getWialonUnits>> = [];
    let wialonError: string | null = null;

    try {
      const eid = await wialonLogin();
      wialonUnits = await getWialonUnits(eid);
      try {
        const resources = await getWialonGeofences(eid);
        geofences = wialonResourcesToGeofenceGeoJSON(resources);
      } catch (geoErr) {
        wialonError =
          geoErr instanceof Error
            ? `Геозони: ${geoErr.message}`
            : "Не вдалося завантажити геозони";
      }
    } catch (err) {
      wialonError =
        err instanceof Error ? err.message : "Не вдалося завантажити Wialon";
    }

    if (wialonUnits.length === 0 && wialonError) {
      return NextResponse.json(
        {
          ok: false,
          error: wialonError,
          tracked: [],
          nonTracked: [],
          towedEquipment: [],
          activeOps: [],
          geofences,
          mode: "wialon-first",
        },
        { status: 502, headers: JSON_UTF8 }
      );
    }

    const merged = wialonFirstFleet(wialonUnits, equipment);
    const towedEquipment = appendImplementsAsTowedEquipment(
      merged.towedEquipment,
      (implementsRows ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        type: String(row.type ?? "other"),
        code: row.code != null ? String(row.code) : null,
      }))
    );

    const activeOps = await loadTodayActiveOperations();
    const { tracked, nonTracked, towedEquipment: towedWithOps } =
      attachActiveOpsToFleet(
        merged.tracked,
        merged.nonTracked,
        towedEquipment,
        activeOps
      );

    return NextResponse.json(
      {
        ok: true,
        mode: "wialon-first",
        tracked,
        nonTracked,
        towedEquipment: towedWithOps,
        activeOps,
        geofences,
        wialonError,
        counts: {
          equipment: equipment.length,
          tracked: tracked.length,
          nonTracked: nonTracked.length,
          towedEquipment: towedWithOps.length,
          implements: implementsRows?.length ?? 0,
          activeOps: activeOps.length,
          wialon: wialonUnits.length,
        },
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка флоту",
        tracked: [],
        nonTracked: [],
        towedEquipment: [],
        activeOps: [],
        geofences: EMPTY_GEOFENCE_COLLECTION,
        mode: "wialon-first",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

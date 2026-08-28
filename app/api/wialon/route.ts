import { NextResponse } from "next/server";

import {
  EMPTY_GEOFENCE_COLLECTION,
  getWialonGeofences,
  getWialonUnits,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
} from "@/lib/wialon";

export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/wialon — READ-ONLY: техніка + геозони (поля) як GeoJSON.
 */
const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

export async function GET() {
  try {
    const eid = await wialonLogin();
    const [units, resources] = await Promise.all([
      getWialonUnits(eid),
      getWialonGeofences(eid),
    ]);
    const geofences = wialonResourcesToGeofenceGeoJSON(resources);

    return NextResponse.json(
      {
        ok: true,
        count: units.length,
        geofenceCount: geofences.features.length,
        units,
        geofences,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка Wialon",
        units: [],
        geofences: EMPTY_GEOFENCE_COLLECTION,
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

import { NextResponse } from "next/server";

import { EMPTY_GEOFENCE_COLLECTION } from "@/lib/wialon";
import { getCachedWialonBoot } from "@/lib/wialon-boot-cache";

export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/wialon — READ-ONLY: техніка + геозони (поля) як GeoJSON.
 * Boot з in-process кешем + single-flight (3+ логіни не валять Wialon).
 */
const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
} as const;

export async function GET() {
  try {
    // lightUnits: без N× calc — boot карти швидкий; літри тягне /api/equipment/fleet
    const boot = await getCachedWialonBoot({ lightUnits: true });

    return NextResponse.json(
      {
        ok: true,
        count: boot.units.length,
        geofenceCount: boot.geofences.features.length,
        units: boot.units,
        geofences: boot.geofences,
        fetchedAt: new Date(boot.fetchedAt).toISOString(),
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
      { status: 500, headers: { "Content-Type": JSON_UTF8["Content-Type"] } }
    );
  }
}

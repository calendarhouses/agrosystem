import { NextRequest, NextResponse } from "next/server";

import { EMPTY_DAY_ANALYTICS } from "@/lib/equipment-day-analytics";
import {
  EMPTY_TRACK_LINE,
  getWialonUnitTrack,
  getWialonUnitTrackBundle,
  wialonLogin,
} from "@/lib/wialon";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/wialon/track?unitId=&from=&to=
 * READ-ONLY: трек (лише рух) + денна аналітика (паливо, idle, зливи).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const unitId = Number.parseInt(searchParams.get("unitId") ?? "", 10);
    const timeFrom = Number.parseInt(searchParams.get("from") ?? "", 10);
    const timeTo = Number.parseInt(searchParams.get("to") ?? "", 10);

    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Потрібен unitId",
          track: EMPTY_TRACK_LINE,
          analytics: EMPTY_DAY_ANALYTICS,
        },
        { status: 400, headers: JSON_UTF8 }
      );
    }
    if (
      !Number.isFinite(timeFrom) ||
      !Number.isFinite(timeTo) ||
      timeTo < timeFrom
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Потрібні коректні from/to (UNIX sec)",
          track: EMPTY_TRACK_LINE,
          analytics: EMPTY_DAY_ANALYTICS,
        },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    const eid = await wialonLogin();
    const wantAnalytics = searchParams.get("analytics") !== "0";

    if (!wantAnalytics) {
      const track = await getWialonUnitTrack(eid, unitId, timeFrom, timeTo);
      return NextResponse.json(
        {
          ok: true,
          pointCount: track.properties.pointCount,
          track,
          analytics: EMPTY_DAY_ANALYTICS,
        },
        { headers: JSON_UTF8 }
      );
    }

    const { track, analytics } = await getWialonUnitTrackBundle(
      eid,
      unitId,
      timeFrom,
      timeTo
    );

    return NextResponse.json(
      {
        ok: true,
        pointCount: track.properties.pointCount,
        track,
        analytics,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка треку Wialon",
        track: EMPTY_TRACK_LINE,
        analytics: EMPTY_DAY_ANALYTICS,
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

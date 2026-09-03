import { NextResponse } from "next/server";

import { getCachedWialonUnitsLive } from "@/lib/wialon-live-cache";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
  /** Клієнтський hint; головний захист — серверний TTL + single-flight */
  "Cache-Control": "private, max-age=8, stale-while-revalidate=30",
} as const;

/**
 * GET /api/wialon/units — лише позиції техніки (легкий поллінг для карти).
 * Без N× calc_last_message; відповіді зшиваються через in-process кеш ~12 с.
 */
export async function GET(request: Request) {
  try {
    const force =
      new URL(request.url).searchParams.get("force") === "1" ||
      new URL(request.url).searchParams.get("force") === "true";

    const result = await getCachedWialonUnitsLive({ force });

    return NextResponse.json(
      {
        ok: true,
        count: result.units.length,
        units: result.units,
        fetchedAt: new Date(result.fetchedAt).toISOString(),
        fromCache: result.fromCache,
        stale: result.stale,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка Wialon",
        units: [],
      },
      { status: 500, headers: { "Content-Type": JSON_UTF8["Content-Type"] } }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import {
  isFleetDayStatsStale,
  loadFleetDaySummaryFromDb,
  syncWialonEquipmentDayStats,
  todayKyivYmd,
} from "@/lib/wialon-equipment-day-sync";

export const runtime = "nodejs";
/** Hobby ~60с; sync пише батчами і обривається по бюджету */
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function parseIdList(raw: string): number[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * GET /api/equipment/fleet-day-summary?date=YYYY-MM-DD&unitIds=1,2,3&ignoreDrainIds=…
 * &syncIfEmpty=1 — якщо в БД порожньо, підтягнути з Wialon
 * &refresh=1 — примусово пересинхронізувати день з Wialon
 *
 * unitIds — поточний live-флот (Wialon).
 * ignoreDrainIds — бензовоз тощо: не рахувати «зливи».
 *
 * CRON лишається фоновою підстраховкою; UI може оновлюватись без нього.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date")?.trim();
    const dateYmd =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : todayKyivYmd();

    const trackedIds = parseIdList(url.searchParams.get("unitIds") ?? "");
    const ignoreDrainIds = parseIdList(
      url.searchParams.get("ignoreDrainIds") ?? ""
    );
    const refresh = url.searchParams.get("refresh") === "1";
    const syncIfEmpty = url.searchParams.get("syncIfEmpty") === "1";

    const loadOpts = {
      ignoreDrainUnitIds:
        ignoreDrainIds.length > 0 ? ignoreDrainIds : undefined,
    };

    let summary = await loadFleetDaySummaryFromDb(
      dateYmd,
      trackedIds.length > 0 ? trackedIds : undefined,
      loadOpts
    );

    const shouldSync =
      refresh ||
      (syncIfEmpty &&
        (summary.source === "empty" ||
          isFleetDayStatsStale(dateYmd, summary.syncedAt)));

    let truncated = false;
    if (shouldSync) {
      const syncResult = await syncWialonEquipmentDayStats(dateYmd);
      truncated = syncResult.truncated;
      summary = await loadFleetDaySummaryFromDb(
        dateYmd,
        trackedIds.length > 0 ? trackedIds : undefined,
        loadOpts
      );
    }

    return NextResponse.json(
      {
        ok: true,
        date: dateYmd,
        synced: shouldSync,
        truncated,
        ...summary,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити підсумок флоту",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

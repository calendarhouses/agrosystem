import { NextRequest, NextResponse } from "next/server";

import {
  loadFleetDaySummaryFromDb,
  todayKyivYmd,
} from "@/lib/wialon-equipment-day-sync";

export const runtime = "nodejs";
/** Лише читання з БД — sync робить CRON, не user request */
export const maxDuration = 30;

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
 * unitIds — поточний live-флот (Wialon).
 * ignoreDrainIds — бензовоз тощо: не рахувати «зливи» (роздача палива).
 *
 * Тільки читання wialon_equipment_day_stats.
 * Заповнення таблиці — /api/cron/sync-wialon-equipment-day (кожні 15 хв).
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

    const summary = await loadFleetDaySummaryFromDb(
      dateYmd,
      trackedIds.length > 0 ? trackedIds : undefined,
      {
        ignoreDrainUnitIds:
          ignoreDrainIds.length > 0 ? ignoreDrainIds : undefined,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        date: dateYmd,
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

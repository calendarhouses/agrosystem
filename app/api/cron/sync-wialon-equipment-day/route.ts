import { NextRequest, NextResponse } from "next/server";

import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { syncWialonEquipmentDayStats } from "@/lib/wialon-equipment-day-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron/sync-wialon-equipment-day] CRON_SECRET не задано");
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * GET/POST /api/cron/sync-wialon-equipment-day
 * Денний пробіг / idle / зливи / паливо по техніці → wialon_equipment_day_stats.
 * Без ?date= — спочатку вчора (повна доба), потім сьогодні.
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() || undefined;
    if (date) {
      const result = await syncWialonEquipmentDayStats(date, {
        budgetMs: 55_000,
      });
      console.log("[cron/sync-wialon-equipment-day]", result);
      return NextResponse.json(result, { headers: JSON_UTF8 });
    }

    const started = Date.now();
    const today = todayKyivYmd();
    const yesterday = await syncWialonEquipmentDayStats(
      shiftKyivYmd(today, -1),
      { budgetMs: 40_000 }
    );
    const todayResult = await syncWialonEquipmentDayStats(today, {
      budgetMs: Math.max(8_000, 55_000 - (Date.now() - started)),
    });
    const result = { ok: true as const, yesterday, today: todayResult };
    console.log("[cron/sync-wialon-equipment-day]", result);
    return NextResponse.json(result, { headers: JSON_UTF8 });
  } catch (error) {
    console.error("[cron/sync-wialon-equipment-day]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося синхронізувати денну статистику техніки",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

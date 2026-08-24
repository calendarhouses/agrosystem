import { NextRequest, NextResponse } from "next/server";

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
 * Денний пробіг / idle / зливи по техніці → wialon_equipment_day_stats.
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
    const result = await syncWialonEquipmentDayStats(date, {
      budgetMs: 55_000,
    });
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

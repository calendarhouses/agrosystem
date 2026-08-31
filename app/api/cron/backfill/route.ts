import { NextRequest, NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { invalidateFuelKpisAfterTelemetrySync } from "@/lib/fuel-kpis-invalidate";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { syncWialonEquipmentDayStats } from "@/lib/wialon-equipment-day-sync";
import { syncWialonFieldFuelForDate } from "@/lib/wialon-field-fuel-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function parseDays(raw: string | null): number {
  const n = Number.parseInt(raw ?? "4", 10);
  if (!Number.isFinite(n)) return 4;
  return Math.min(7, Math.max(1, n));
}

/**
 * GET/POST /api/cron/backfill
 *
 * Примусово підтягує Wialon за останні N календарних днів Києва
 * (field fuel + equipment day stats) — для презентації / відновлення пропусків.
 *
 * Auth:
 *   Authorization: Bearer $CRON_SECRET
 *   ?secret=$CRON_SECRET
 *
 * Query:
 *   ?days=4   — скільки днів назад включно з сьогодні (1–7, default 4)
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  const url = new URL(request.url);
  const days = parseDays(url.searchParams.get("days"));
  const started = Date.now();
  const today = todayKyivYmd();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(shiftKyivYmd(today, -i));
  }

  try {
    const fieldResults = [];
    const equipmentResults = [];
    const budgetMs = 280_000;

    for (const date of dates) {
      if (Date.now() - started > budgetMs) break;
      const remaining = Math.max(15_000, budgetMs - (Date.now() - started));
      const perDayBudget = Math.floor(remaining / (dates.length - fieldResults.length));

      fieldResults.push(await syncWialonFieldFuelForDate(date));
      equipmentResults.push(
        await syncWialonEquipmentDayStats(date, {
          budgetMs: Math.max(12_000, perDayBudget),
        })
      );
    }

    await invalidateFuelKpisAfterTelemetrySync();

    const payload = {
      ok: true as const,
      days,
      dates: dates.slice(0, fieldResults.length),
      elapsedMs: Date.now() - started,
      fieldFuel: fieldResults,
      equipmentDay: equipmentResults,
      truncated: fieldResults.length < dates.length,
    };
    console.log("[cron/backfill]", {
      days,
      syncedDays: fieldResults.length,
      elapsedMs: payload.elapsedMs,
    });
    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    console.error("[cron/backfill]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося виконати backfill Wialon",
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

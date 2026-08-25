import { NextRequest, NextResponse } from "next/server";

import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { syncWialonEquipmentDayStats } from "@/lib/wialon-equipment-day-sync";
import {
  syncWialonFieldFuelForToday,
  syncWialonFieldFuelForYesterday,
} from "@/lib/wialon-field-fuel-sync";

export const runtime = "nodejs";
/** Зовнішній cronjob (кожну хвилину) — тримаємо бюджет під soft limit Vercel */
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron/sync-telemetry] CRON_SECRET не задано");
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * GET/POST /api/cron/sync-telemetry
 *
 * Єдиний ingest для Техніки / Карти / Палива:
 * 1) field fuel → wialon_field_fuel_logs
 * 2) equipment day stats → wialon_equipment_day_stats (вкл. fuel_start/end)
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Зовнішній cron (не Vercel Hobby):
 *   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     https://YOUR_HOST/api/cron/sync-telemetry
 *
 * Query:
 *   ?mode=tick     — швидкий прогін сьогодні (за замовчуванням)
 *   ?mode=nightly  — ще й закритий вчорашній день (поля + техніка)
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode")?.trim() || "tick";
  const started = Date.now();
  const today = todayKyivYmd();

  try {
    const fieldToday = await syncWialonFieldFuelForToday();
    const fieldYesterday =
      mode === "nightly"
        ? await syncWialonFieldFuelForYesterday()
        : null;

    const remainingAfterField = Math.max(
      8_000,
      55_000 - (Date.now() - started)
    );
    const equipmentToday = await syncWialonEquipmentDayStats(today, {
      budgetMs: Math.floor(
        remainingAfterField * (mode === "nightly" ? 0.55 : 1)
      ),
    });

    const equipmentYesterday =
      mode === "nightly"
        ? await syncWialonEquipmentDayStats(shiftKyivYmd(today, -1), {
            budgetMs: Math.max(8_000, 55_000 - (Date.now() - started)),
          })
        : null;

    const payload = {
      ok: true as const,
      mode,
      elapsedMs: Date.now() - started,
      fieldFuelToday: fieldToday,
      fieldFuelYesterday: fieldYesterday,
      equipmentDay: equipmentToday,
      equipmentDayYesterday: equipmentYesterday,
    };
    console.log("[cron/sync-telemetry]", {
      mode,
      elapsedMs: payload.elapsedMs,
      fieldUpserted: fieldToday.upserted,
      equipmentUpserted: equipmentToday.upserted,
      equipmentTruncated: equipmentToday.truncated,
    });
    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    console.error("[cron/sync-telemetry]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося синхронізувати телеметрію",
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

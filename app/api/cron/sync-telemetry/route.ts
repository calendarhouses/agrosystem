import { NextRequest, NextResponse } from "next/server";

import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { syncWialonEquipmentDayStats } from "@/lib/wialon-equipment-day-sync";
import {
  backfillWialonFieldFuelRange,
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
 * Query:
 *   ?mode=tick      — сьогодні (за замовчуванням)
 *   ?mode=nightly   — сьогодні + вчора + бекфіл 3 пропущених днів
 *   ?mode=backfill  — лише бекфіл пропущених днів (до 12 за прогін)
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
    if (mode === "backfill") {
      const fromDate = shiftKyivYmd(today, -29);
      const backfill = await backfillWialonFieldFuelRange(fromDate, today, {
        maxDays: 12,
        budgetMs: 50_000,
      });
      const payload = {
        ok: true as const,
        mode,
        elapsedMs: Date.now() - started,
        fieldFuelBackfill: backfill,
      };
      console.log("[cron/sync-telemetry]", payload);
      return NextResponse.json(payload, { headers: JSON_UTF8 });
    }

    const fieldToday = await syncWialonFieldFuelForToday();
    const fieldYesterday =
      mode === "nightly" ? await syncWialonFieldFuelForYesterday() : null;

    const fieldBackfill =
      mode === "nightly"
        ? await backfillWialonFieldFuelRange(shiftKyivYmd(today, -29), today, {
            maxDays: 3,
            budgetMs: Math.max(8_000, 25_000 - (Date.now() - started)),
          })
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
      fieldFuelBackfill: fieldBackfill,
      equipmentDay: equipmentToday,
      equipmentDayYesterday: equipmentYesterday,
    };
    console.log("[cron/sync-telemetry]", {
      mode,
      elapsedMs: payload.elapsedMs,
      fieldUpserted: fieldToday.upserted,
      equipmentUpserted: equipmentToday.upserted,
      equipmentTruncated: equipmentToday.truncated,
      backfillMissing: fieldBackfill?.daysStillMissing ?? null,
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

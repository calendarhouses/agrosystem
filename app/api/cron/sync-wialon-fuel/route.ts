import { NextRequest, NextResponse } from "next/server";

import {
  syncWialonFieldFuelForToday,
  syncWialonFieldFuelForYesterday,
} from "@/lib/wialon-field-fuel-sync";

export const runtime = "nodejs";
/** Vercel Pro: до 300с; Hobby — обмеження платформи */
export const maxDuration = 300;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron/sync-wialon-fuel] CRON_SECRET не задано");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  // Vercel Cron (з CRON_SECRET) і ручний виклик: Bearer <secret>
  return header === `Bearer ${secret}`;
}

/**
 * GET/POST /api/cron/sync-wialon-fuel
 *
 * Нічний CRON: закритий вчорашній день + часткове «сьогодні»
 * → upsert у wialon_field_fuel_logs.
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  try {
    const yesterday = await syncWialonFieldFuelForYesterday();
    const today = await syncWialonFieldFuelForToday();
    const result = { ok: true as const, yesterday, today };
    console.log("[cron/sync-wialon-fuel]", result);
    return NextResponse.json(result, { headers: JSON_UTF8 });
  } catch (error) {
    console.error("[cron/sync-wialon-fuel]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося синхронізувати паливо Wialon",
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

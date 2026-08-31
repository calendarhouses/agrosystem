import { NextRequest, NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
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

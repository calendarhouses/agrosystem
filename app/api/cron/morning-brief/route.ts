import { NextRequest, NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import {
  collectMorningBriefData,
  generateMorningBriefText,
} from "@/lib/levadius-morning-brief";
import { broadcastTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET/POST /api/cron/morning-brief
 *
 * Ранкове диспетчерське зведення → Telegram (щодня ~07:00 Kyiv).
 *
 * Auth:
 *   Authorization: Bearer $CRON_SECRET
 *   ?secret=$CRON_SECRET
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (або profiles.telegram_chat_id)
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  const started = Date.now();
  const dryRun =
    new URL(request.url).searchParams.get("dryRun") === "1" ||
    new URL(request.url).searchParams.get("dry_run") === "1";

  try {
    const data = await collectMorningBriefData();
    const text = await generateMorningBriefText(data);

    if (dryRun) {
      const payload = {
        ok: true as const,
        dryRun: true,
        elapsedMs: Date.now() - started,
        brief: text,
        stats: {
          plannedOps: data.plannedOps.length,
          ndviAlerts: data.ndviAlerts.length,
          maintenanceDue: data.maintenanceDue.length,
          weather: data.weather,
        },
      };
      console.log("[cron/morning-brief] dryRun", payload.stats);
      return NextResponse.json(payload, { headers: JSON_UTF8 });
    }

    const telegram = await broadcastTelegram(text);
    const payload = {
      ok: telegram.ok,
      elapsedMs: Date.now() - started,
      date: data.date,
      briefPreview: text.slice(0, 280),
      stats: {
        plannedOps: data.plannedOps.length,
        ndviAlerts: data.ndviAlerts.length,
        maintenanceDue: data.maintenanceDue.length,
      },
      telegram: {
        sent: telegram.sent,
        error: telegram.error,
        results: telegram.results,
      },
    };
    console.log("[cron/morning-brief]", {
      ok: payload.ok,
      sent: telegram.sent,
      elapsedMs: payload.elapsedMs,
      stats: payload.stats,
    });
    return NextResponse.json(payload, {
      status: telegram.ok ? 200 : 502,
      headers: JSON_UTF8,
    });
  } catch (error) {
    console.error(
      "[cron/morning-brief]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Morning brief failed",
        elapsedMs: Date.now() - started,
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

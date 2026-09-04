import { NextRequest, NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { runTelemetryAnomalyScan } from "@/lib/levadius-telemetry-alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET/POST /api/cron/telemetry-alerts
 *
 * Аномалії idle / злив пального → Telegram.
 * НЕ в vercel.json: інтервал 30 хв ламає Hobby (лише 1 cron/день).
 * Зовнішній планувальник: cron-job.org.
 *
 * cron-job.org:
 *   URL: https://<domain>/api/cron/telemetry-alerts
 *   Method: GET
 *   Schedule: every 30 minutes (cron: star/30 * * * *)
 *   Headers:
 *     Authorization: Bearer <CRON_SECRET>
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
    const result = await runTelemetryAnomalyScan({ dryRun });

    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          elapsedMs: Date.now() - started,
          checked: result.checked,
          alerts: result.alerts,
          telegramSkipped: true,
        },
        { headers: JSON_UTF8 }
      );
    }

    const payload = {
      ok: true as const,
      elapsedMs: Date.now() - started,
      checked: result.checked,
      alertCount: result.alerts.length,
      alerts: result.alerts.map((a) => ({
        type: a.type,
        equipmentName: a.equipmentName,
        fieldName: a.fieldName ?? null,
        message: a.message,
      })),
      telegram: result.telegram,
    };
    console.log("[cron/telemetry-alerts]", {
      checked: payload.checked,
      alertCount: payload.alertCount,
      telegramSent: result.telegram.sent,
      elapsedMs: payload.elapsedMs,
    });
    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    console.error(
      "[cron/telemetry-alerts]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Telemetry alerts failed",
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

import { NextRequest, NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { runSmartDispatchWatchdog } from "@/lib/agent-smart-dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET/POST /api/cron/smart-dispatch-watchdog
 *
 * Паливний штурман + погодний ризик → Telegram.
 * НЕ в vercel.json (Hobby: 1 cron/день). Зовнішній планувальник:
 *
 * cron-job.org:
 *   URL: https://<domain>/api/cron/smart-dispatch-watchdog
 *   Method: GET
 *   Schedule: every 15–30 minutes
 *   Headers: Authorization: Bearer <CRON_SECRET>
 *   Optional: ?dryRun=1
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
    const result = await runSmartDispatchWatchdog({ dryRun });

    const payload = {
      ok: true as const,
      dryRun,
      elapsedMs: Date.now() - started,
      fuelChecked: result.fuelChecked,
      weatherChecked: result.weatherChecked,
      fuelAlertCount: result.fuelAlerts.length,
      weatherAlertCount: result.weatherAlerts.length,
      fuelAlerts: result.fuelAlerts.map((a) => ({
        equipmentName: a.equipmentName,
        hoursLeft: a.hoursLeft,
        currentFuel: a.currentFuel,
        nearestTankerName: a.nearestTankerName,
        tankerDistanceKm: a.tankerDistanceKm,
      })),
      weatherAlerts: result.weatherAlerts.map((a) => ({
        fieldName: a.fieldName,
        operationType: a.operationType,
        rainETA: a.rainETA,
        windGusts: a.windGusts,
        urgentAction: a.urgentAction,
      })),
      telegram: dryRun
        ? { skipped: true }
        : {
            ok: result.telegram.ok,
            sent: result.telegram.sent,
            error: result.telegram.error ?? null,
          },
    };

    console.log("[cron/smart-dispatch-watchdog]", {
      fuelChecked: payload.fuelChecked,
      weatherChecked: payload.weatherChecked,
      fuelAlertCount: payload.fuelAlertCount,
      weatherAlertCount: payload.weatherAlertCount,
      telegramSent: dryRun ? 0 : result.telegram.sent,
      elapsedMs: payload.elapsedMs,
    });

    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    console.error(
      "[cron/smart-dispatch-watchdog]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Smart dispatch watchdog failed",
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

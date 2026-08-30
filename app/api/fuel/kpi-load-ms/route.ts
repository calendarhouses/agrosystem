import { NextResponse } from "next/server";

import type { FieldFuelPeriod } from "@/app/fuel/actions";
import {
  getAllSharedFuelKpiLoadMs,
  isFieldFuelPeriod,
  recordSharedFuelKpiLoadMs,
} from "@/lib/fuel-kpi-load-stats";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** GET — спільні оцінки часу KPI для шкали у всіх клієнтів. */
export async function GET() {
  const byPeriod = await getAllSharedFuelKpiLoadMs();
  return NextResponse.json({ ok: true, byPeriod }, { headers: JSON_UTF8 });
}

/**
 * POST { period, elapsedMs } — один клієнт заміряв повний цикл,
 * оновлюємо спільну EMA для всіх.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Невірний JSON" },
      { status: 400, headers: JSON_UTF8 }
    );
  }

  const period = (body as { period?: unknown })?.period;
  const elapsedMs = Number((body as { elapsedMs?: unknown })?.elapsedMs);

  if (!isFieldFuelPeriod(period)) {
    return NextResponse.json(
      { ok: false, error: "Невірний period" },
      { status: 400, headers: JSON_UTF8 }
    );
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 800 || elapsedMs > 180_000) {
    return NextResponse.json(
      { ok: false, error: "Невірний elapsedMs" },
      { status: 400, headers: JSON_UTF8 }
    );
  }

  try {
    const emaMs = await recordSharedFuelKpiLoadMs(
      period as FieldFuelPeriod,
      elapsedMs
    );
    return NextResponse.json(
      { ok: true, period, emaMs },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося зберегти замір",
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

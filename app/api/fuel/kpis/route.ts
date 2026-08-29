import { NextResponse } from "next/server";

import {
  getFieldFuelConsumed,
  getFuelRefueledForPeriod,
  type FieldFuelPeriod,
} from "@/app/fuel/actions";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

const PERIODS = new Set<FieldFuelPeriod>([
  "today",
  "yesterday",
  "week",
  "month",
]);

function parsePeriod(raw: string | null): FieldFuelPeriod {
  if (raw && PERIODS.has(raw as FieldFuelPeriod)) {
    return raw as FieldFuelPeriod;
  }
  return "today";
}

/**
 * GET /api/fuel/kpis?period=today
 * Спалено технікою + заправлено — для кеша / фонового прогріву з карти.
 */
export async function GET(request: Request) {
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));

  try {
    const [burned, refueled] = await Promise.all([
      getFieldFuelConsumed(period),
      getFuelRefueledForPeriod(period),
    ]);

    return NextResponse.json(
      { ok: true, period, burned, refueled },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        period,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити KPI палива",
        burned: null,
        refueled: null,
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

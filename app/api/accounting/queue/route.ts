import { NextResponse } from "next/server";

import { listAccountantQueue } from "@/app/export/actions";
import {
  defaultFinanceSeasonYear,
  getSeasonRange,
} from "@/lib/finance-period";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/accounting/queue?season=2026&start=&end=
 * Черга бухгалтера — для кеша / прогріву з карти.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("season");
  const parsed = raw ? Number(raw) : NaN;
  const seasonYear = Number.isFinite(parsed)
    ? parsed
    : defaultFinanceSeasonYear();
  const range = getSeasonRange(seasonYear);
  const startIso = params.get("start") || range.startIso;
  const endIso = params.get("end") || range.endIso;

  try {
    const res = await listAccountantQueue({
      season: String(seasonYear),
      startIso,
      endIso,
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          seasonYear,
          error: res.error,
          items: [],
          stats: null,
        },
        { status: 502, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        seasonYear,
        items: res.data.items,
        stats: res.data.stats,
        startIso,
        endIso,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        seasonYear,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити чергу бухгалтера",
        items: [],
        stats: null,
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

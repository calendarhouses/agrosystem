import { NextResponse } from "next/server";

import { fetchFieldTimeline } from "@/lib/field-timeline";
import { DEFAULT_SEASON } from "@/lib/season";

export const runtime = "nodejs";

/** GET /api/field-timeline?season=2026 — хронологія по всіх активних полях */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const season = searchParams.get("season")?.trim() || DEFAULT_SEASON;
    const fieldsWithTimeline = await fetchFieldTimeline(season);

    return NextResponse.json({
      ok: true,
      season,
      fieldsWithTimeline,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити хронологію полів",
        fieldsWithTimeline: [],
      },
      { status: 500 }
    );
  }
}

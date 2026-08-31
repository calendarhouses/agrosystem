import { NextResponse } from "next/server";

import { loadAgroplanSeasonOperations } from "@/lib/agroplan/season-ops-server";
import { currentAgroSeason } from "@/lib/season";

export const runtime = "nodejs";

/** GET /api/agroplan/season-ops — наряди сезону для таймлайну */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const season = searchParams.get("season")?.trim() || currentAgroSeason();
    const operations = await loadAgroplanSeasonOperations(season);
    return NextResponse.json({ ok: true, season, operations, count: operations.length });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити наряди сезону",
        operations: [],
      },
      { status: 500 }
    );
  }
}

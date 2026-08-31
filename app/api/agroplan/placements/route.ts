import { NextResponse } from "next/server";

import {
  loadAgroplanPlacements,
  upsertAgroplanPlacements,
  type UpsertAgroplanPlacementInput,
} from "@/lib/agroplan/placements-server";
import { currentAgroSeason } from "@/lib/season";

export const runtime = "nodejs";

/** GET /api/agroplan/placements?season=2026 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const season = searchParams.get("season")?.trim() || currentAgroSeason();
    const placements = await loadAgroplanPlacements(season);
    return NextResponse.json({ ok: true, season, placements });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити позиції",
        placements: {},
      },
      { status: 500 }
    );
  }
}

type PostBody = {
  season?: string;
  placements?: UpsertAgroplanPlacementInput[];
};

/** POST /api/agroplan/placements — upsert позицій блоків */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PostBody;
    const season = body.season?.trim() || currentAgroSeason();
    const rows = body.placements ?? [];
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Потрібен масив placements" },
        { status: 400 }
      );
    }

    const normalized = rows
      .map((row) => ({
        blockId: row.blockId?.trim() ?? "",
        season,
        startMs: Number(row.startMs),
        durationHours: row.durationHours,
        hidden: row.hidden,
      }))
      .filter((row) => row.blockId && Number.isFinite(row.startMs));

    const result = await upsertAgroplanPlacements(normalized);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, count: result.count });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Не вдалося зберегти",
      },
      { status: 500 }
    );
  }
}

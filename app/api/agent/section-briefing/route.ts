import { NextRequest, NextResponse } from "next/server";

import {
  getSectionBriefing,
  SECTION_IDS,
} from "@/lib/agent-section-briefing";
import { getCurrentActor } from "@/lib/app-actor";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/agent/section-briefing?section=fields|equipment|fuel|...
 * Швидкий секційний бриф диспетчера (cache 2.5 хв, без LLM).
 */
export async function GET(request: NextRequest) {
  try {
    const authSupabase = await createAuthServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Потрібна авторизація" },
        { status: 401, headers: JSON_UTF8 }
      );
    }

    const actor = await getCurrentActor();
    if (!canAccessLevadius(actor)) {
      return NextResponse.json(
        { ok: false, error: "LEVADIUS поки доступний лише адміністратору" },
        { status: 403, headers: JSON_UTF8 }
      );
    }

    const section =
      request.nextUrl.searchParams.get("section")?.trim().toLowerCase() ?? "";
    if (!section) {
      return NextResponse.json(
        {
          ok: false,
          error: `Вкажіть section. Дозволено: ${SECTION_IDS.join(", ")}`,
        },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    const briefing = await getSectionBriefing(section);
    if (!briefing.ok) {
      return NextResponse.json(briefing, {
        status: 400,
        headers: JSON_UTF8,
      });
    }

    return NextResponse.json(briefing, {
      headers: {
        ...JSON_UTF8,
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    console.error(
      "[api/agent/section-briefing]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося зібрати секційний бриф",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

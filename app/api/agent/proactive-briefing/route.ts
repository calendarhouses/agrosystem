import { NextResponse } from "next/server";

import { getProactiveBriefing } from "@/lib/agent-proactive-briefing";
import { getCurrentActor } from "@/lib/app-actor";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/agent/proactive-briefing
 * Оперативне зведення зміни для порожнього чату / після паузи >2 год.
 */
export async function GET() {
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

    const briefing = await getProactiveBriefing();
    return NextResponse.json(briefing, { headers: JSON_UTF8 });
  } catch (error) {
    console.error(
      "[api/agent/proactive-briefing]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося зібрати зведення зміни",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

import { NextResponse } from "next/server";

import { toKyivDayKey } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = {
  clientKey?: string;
  occurredAt?: string;
};

/** PATCH-like POST — перенести наряд на іншу дату (лише occurred_at) */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const clientKey = body.clientKey?.trim();
    const occurredAt = body.occurredAt?.slice(0, 10);

    if (!clientKey || !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt ?? "")) {
      return NextResponse.json(
        { ok: false, error: "Потрібні clientKey та occurredAt (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("field_operations")
      .update({
        occurred_at: occurredAt,
        updated_at: new Date().toISOString(),
      })
      .eq("client_key", clientKey)
      .select("client_key, occurred_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Наряд не знайдено" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      clientKey: String(data.client_key),
      occurredAt: toKyivDayKey(new Date(String(data.occurred_at))),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Не вдалося перенести наряд",
      },
      { status: 500 }
    );
  }
}

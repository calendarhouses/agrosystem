import { NextResponse } from "next/server";

import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/inventory/cache-sync — дата останнього оновлення тіньового складу */
export async function GET() {
  try {
    const supabase = createServiceSupabase();
    const { data, error, count } = await supabase
      .from("inventory_items_cache")
      .select("updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return NextResponse.json({
          ok: true,
          lastUpdatedAt: null,
          itemCount: 0,
        });
      }
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const lastUpdatedAt =
      data?.[0]?.updated_at != null ? String(data[0].updated_at) : null;

    return NextResponse.json({
      ok: true,
      lastUpdatedAt,
      itemCount: count ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Не вдалося отримати метадані кешу ТМЦ",
      },
      { status: 500 }
    );
  }
}

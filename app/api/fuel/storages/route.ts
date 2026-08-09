import { NextResponse } from "next/server";

import { mapFuelStorageRow } from "@/lib/fuel-storages";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** GET /api/fuel/storages — склади палива з Supabase */
export async function GET() {
  try {
    const supabase = createServiceSupabase();
    const { data: storages, error } = await supabase
      .from("fuel_storages")
      .select("*")
      .order("capacity", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, storages: [] },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
          headers: JSON_UTF8,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        storages: (storages ?? []).map((row) =>
          mapFuelStorageRow(row as Record<string, unknown>)
        ),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка читання",
        storages: [],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

import { NextResponse } from "next/server";

import { mapOperationRow, todayIsoLocal } from "@/lib/field-operations";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SyncBody = {
  /** fieldKey → список wialon unit id, що зараз у полі */
  presence?: Array<{
    fieldKey: string;
    unitIds: number[];
  }>;
  /** ISO дата (локальна), за замовчуванням сьогодні */
  date?: string;
};

/**
 * POST /api/field-operations/sync-tracker
 * planned + сьогодні + техніка в полі → in_progress
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SyncBody;
    const presence = Array.isArray(body.presence) ? body.presence : [];
    const date = body.date?.slice(0, 10) || todayIsoLocal();

    if (presence.length === 0) {
      return NextResponse.json({ updated: [], count: 0 });
    }

    const supabase = createServiceSupabase();
    const updated: ReturnType<typeof mapOperationRow>[] = [];

    for (const entry of presence) {
      const fieldKey = entry.fieldKey?.trim();
      const unitIds = (entry.unitIds ?? []).filter(
        (id) => typeof id === "number" && Number.isFinite(id)
      );
      if (!fieldKey || unitIds.length === 0) continue;

      const { data, error } = await supabase
        .from("field_operations")
        .update({
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("field_key", fieldKey)
        .eq("status", "planned")
        .eq("occurred_at", date)
        .in("wialon_unit_id", unitIds)
        .select("*");

      if (error) {
        // Колонки ще немає (міграція не застосована) — тихо
        if (error.code === "PGRST205" || error.code === "42P01") {
          return NextResponse.json(
            { updated: [], count: 0, error: error.message, code: error.code },
            { status: 503 }
          );
        }
        continue;
      }

      for (const row of data ?? []) {
        updated.push(mapOperationRow(row as Record<string, unknown>));
      }
    }

    return NextResponse.json({ updated, count: updated.length });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка sync трекера",
        updated: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

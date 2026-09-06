import { NextResponse } from "next/server";

import {
  buildEquipmentUnitDayJournal,
  unitJournalToCsv,
  unitJournalToXlsxBuffer,
  type UnitJournalFormat,
} from "@/lib/equipment-unit-journal-export";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/export/equipment-day-journal?equipmentId=&date=&format=xlsx|csv
 */
export async function GET(request: Request) {
  try {
    const auth = await createAuthServerSupabase();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (
      !user ||
      !canAccessLevadius({ id: user.id, email: user.email ?? null })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const equipmentId = url.searchParams.get("equipmentId")?.trim() || "";
    const date = url.searchParams.get("date")?.trim() || null;
    const format = (
      url.searchParams.get("format") === "csv" ? "csv" : "xlsx"
    ) as UnitJournalFormat;

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        equipmentId
      )
    ) {
      return NextResponse.json(
        { error: "Потрібен коректний equipmentId" },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();
    const { data: eq, error } = await supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("id", equipmentId)
      .maybeSingle();
    if (error || !eq) {
      return NextResponse.json(
        { error: "Техніку не знайдено" },
        { status: 404 }
      );
    }

    const journal = await buildEquipmentUnitDayJournal({
      supabase,
      equipmentId: String(eq.id),
      equipmentName: String(eq.name ?? "Техніка"),
      wialonId:
        eq.wialon_id != null && Number.isFinite(Number(eq.wialon_id))
          ? Number(eq.wialon_id)
          : null,
      date,
    });

    const filename =
      format === "csv"
        ? `${journal.filenameBase}.csv`
        : `${journal.filenameBase}.xlsx`;

    if (format === "csv") {
      const csv = unitJournalToCsv(journal);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buf = unitJournalToXlsxBuffer(journal);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Помилка експорту журналу машини",
      },
      { status: 500 }
    );
  }
}

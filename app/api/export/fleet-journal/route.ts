import { NextResponse } from "next/server";

import {
  buildFleetDayJournal,
  fleetJournalToCsv,
  fleetJournalToXlsxBuffer,
  type FleetJournalFormat,
} from "@/lib/fleet-journal-export";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/export/fleet-journal?date=YYYY-MM-DD&format=xlsx|csv
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
    const date = url.searchParams.get("date")?.trim() || null;
    const format = (
      url.searchParams.get("format") === "csv" ? "csv" : "xlsx"
    ) as FleetJournalFormat;

    const supabase = createServiceSupabase();
    const journal = await buildFleetDayJournal(supabase, date);

    const year = journal.date.slice(0, 4);
    const filename =
      format === "csv"
        ? `Fleet_Journal_${year}.csv`
        : `Fleet_Journal_${year}.xlsx`;

    if (format === "csv") {
      const csv = fleetJournalToCsv(journal);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buf = fleetJournalToXlsxBuffer(journal);
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
          error instanceof Error ? error.message : "Помилка експорту журналу",
      },
      { status: 500 }
    );
  }
}

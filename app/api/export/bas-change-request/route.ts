import { NextResponse } from "next/server";

import {
  buildBasChangeRequestCsv,
  buildBasChangeRequestXlsxBuffer,
  collectBasChangeRequestRows,
} from "@/lib/agent-bas-reconciliation";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/export/bas-change-request
 * ?category=all|inventory|equipment|fields&format=xlsx|csv
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
    const categoryRaw = url.searchParams.get("category") || "all";
    const categorySet = new Set(["all", "inventory", "equipment", "fields"]);
    const category = categorySet.has(categoryRaw)
      ? (categoryRaw as "all" | "inventory" | "equipment" | "fields")
      : "all";
    const format =
      url.searchParams.get("format") === "csv" ? "csv" : "xlsx";

    const collected = await collectBasChangeRequestRows({ category });
    if (!collected.ok) {
      return NextResponse.json({ error: collected.error }, { status: 400 });
    }

    if (format === "csv") {
      const body = buildBasChangeRequestCsv(collected.rows);
      const year = new Date().getFullYear();
      const filename = `BAS_Change_Request_${year}.csv`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Total-Gaps": String(collected.rows.length),
        },
      });
    }

    const { buffer, filename } = buildBasChangeRequestXlsxBuffer(
      collected.rows,
      collected.fieldRequest
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Total-Gaps": String(collected.rows.length),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Помилка експорту BAS change request",
      },
      { status: 500 }
    );
  }
}

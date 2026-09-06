import { NextResponse } from "next/server";

import {
  collectAccountantPackageItems,
  markAgentQueueDocumentsStatus,
} from "@/lib/agent-accountant-ops";
import { buildAccountantPackageXlsxBuffer } from "@/lib/inventory-excel-export";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/export/accountant-package
 * ?period=month&status=prepared|new|all&markAsSent=0|1&dateFrom=&dateTo=
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
    const periodRaw = (url.searchParams.get("period") || "month") as string;
    const periodSet = new Set(["today", "week", "month", "season", "custom"]);
    const period = periodSet.has(periodRaw)
      ? (periodRaw as "today" | "week" | "month" | "season" | "custom")
      : "month";
    const statusRaw = (url.searchParams.get("status") || "prepared") as string;
    const statusSet = new Set(["all", "new", "prepared"]);
    const status = statusSet.has(statusRaw)
      ? (statusRaw as "all" | "new" | "prepared")
      : "prepared";
    const markAsSent =
      url.searchParams.get("markAsSent") === "1" ||
      url.searchParams.get("markAsSent") === "true";
    const dateFrom = url.searchParams.get("dateFrom")?.trim() || null;
    const dateTo = url.searchParams.get("dateTo")?.trim() || null;

    const collected = await collectAccountantPackageItems({
      period,
      status,
      dateFrom,
      dateTo,
    });
    if (!collected.ok) {
      return NextResponse.json({ error: collected.error }, { status: 400 });
    }

    if (markAsSent && collected.items.length > 0) {
      await markAgentQueueDocumentsStatus({
        documentIds: collected.items.map((i) => i.id),
        newStatus: "sent_to_1c",
        confirmed: true,
      });
    }

    const { buffer, filename } = buildAccountantPackageXlsxBuffer(
      collected.items
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Total-Documents": String(collected.items.length),
        "X-Total-Sum-Uah": String(collected.totalSumUah),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Помилка експорту пакета бухгалтерії",
      },
      { status: 500 }
    );
  }
}

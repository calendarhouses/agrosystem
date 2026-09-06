import { NextResponse } from "next/server";

import {
  buildCustomExcelReport,
  customExcelToBuffer,
  CUSTOM_EXCEL_SCOPES,
  type CustomExcelScope,
} from "@/lib/custom-excel-export";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/export/custom-excel
 * ?reportScope=&title=&dateFrom=&dateTo=&target=&metrics=fuel,area
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
    const reportScopeRaw = (url.searchParams.get("reportScope") || "").trim();
    if (
      !CUSTOM_EXCEL_SCOPES.includes(reportScopeRaw as CustomExcelScope)
    ) {
      return NextResponse.json(
        { error: "Некоректний reportScope" },
        { status: 400 }
      );
    }
    const reportScope = reportScopeRaw as CustomExcelScope;
    const title =
      url.searchParams.get("title")?.trim() || "Звіт LEVADIUS";
    const dateFrom = url.searchParams.get("dateFrom")?.trim() || null;
    const dateTo = url.searchParams.get("dateTo")?.trim() || null;
    const target =
      url.searchParams.get("target")?.trim() ||
      url.searchParams.get("targetEntityIdOrName")?.trim() ||
      null;
    const metricsRaw = url.searchParams.get("metrics")?.trim() || "";
    const includeMetrics = metricsRaw
      ? metricsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const supabase = createServiceSupabase();
    const report = await buildCustomExcelReport(supabase, {
      reportScope,
      title,
      dateFrom,
      dateTo,
      targetEntityIdOrName: target,
      includeMetrics,
    });

    const buffer = await customExcelToBuffer(report);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
        "X-Total-Rows": String(report.totalRows),
        "X-Report-Scope": report.reportScope,
      },
    });
  } catch (error) {
    console.error(
      "[export/custom-excel]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Помилка генерації Excel-звіту",
      },
      { status: 500 }
    );
  }
}

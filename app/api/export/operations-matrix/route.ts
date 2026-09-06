import { NextResponse } from "next/server";

import { canAccessLevadius } from "@/lib/levadius-access";
import {
  buildOperationsMatrix,
  operationsMatrixToCsv,
  operationsMatrixToXlsxBuffer,
  type OperationsMatrixFormat,
  type OperationsMatrixPeriod,
} from "@/lib/operations-matrix-export";
import { normalizeSeason } from "@/lib/season";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PERIODS = new Set<OperationsMatrixPeriod>([
  "all_season",
  "current_month",
  "last_30_days",
  "custom",
]);

/**
 * GET /api/export/operations-matrix
 * ?season=2026&fieldId=&period=all_season&format=xlsx&dateFrom=&dateTo=
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
    const season = normalizeSeason(
      url.searchParams.get("season") || 2026
    );
    const fieldId = url.searchParams.get("fieldId")?.trim() || null;
    const periodRaw = (url.searchParams.get("period") ||
      "all_season") as OperationsMatrixPeriod;
    const period = PERIODS.has(periodRaw) ? periodRaw : "all_season";
    const format = (
      url.searchParams.get("format") === "csv" ? "csv" : "xlsx"
    ) as OperationsMatrixFormat;
    const dateFrom = url.searchParams.get("dateFrom")?.trim() || null;
    const dateTo = url.searchParams.get("dateTo")?.trim() || null;

    if (
      fieldId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        fieldId
      )
    ) {
      return NextResponse.json(
        { error: "Некоректний fieldId" },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();
    const matrix = await buildOperationsMatrix(supabase, {
      season,
      fieldId,
      period,
      dateFrom,
      dateTo,
    });

    const filename =
      format === "csv"
        ? `${matrix.filenameBase}.csv`
        : `${matrix.filenameBase}.xlsx`;

    if (format === "csv") {
      const body = operationsMatrixToCsv(matrix.rows);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Total-Operations": String(matrix.totalOperations),
          "X-Total-Area": String(matrix.totalArea),
        },
      });
    }

    const buffer = operationsMatrixToXlsxBuffer(matrix.rows);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Total-Operations": String(matrix.totalOperations),
        "X-Total-Area": String(matrix.totalArea),
      },
    });
  } catch (error) {
    console.error(
      "[export/operations-matrix]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка експорту матриці",
      },
      { status: 500 }
    );
  }
}

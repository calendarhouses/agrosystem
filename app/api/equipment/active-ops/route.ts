import { NextResponse } from "next/server";

import { loadTodayActiveOperations } from "@/lib/equipment-active-ops";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** GET /api/equipment/active-ops — наряди in_progress за сьогодні */
export async function GET() {
  try {
    const operations = await loadTodayActiveOperations();
    return NextResponse.json(
      { ok: true, operations, count: operations.length },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити активні наряди",
        operations: [],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

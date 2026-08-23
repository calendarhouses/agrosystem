import { NextResponse } from "next/server";

import { getWialonUnits, wialonLogin } from "@/lib/wialon";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/wialon/units — лише позиції техніки (легкий поллінг для карти).
 */
export async function GET() {
  try {
    const eid = await wialonLogin();
    const units = await getWialonUnits(eid);

    return NextResponse.json(
      {
        ok: true,
        count: units.length,
        units,
        fetchedAt: new Date().toISOString(),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка Wialon",
        units: [],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

import { NextResponse } from "next/server";

import { getAgroRadarStockContext } from "@/app/calendar/actions";

export const runtime = "nodejs";
export const maxDuration = 30;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** GET /api/agro-radar/stock — залишки / флот для Агро-Радара */
export async function GET() {
  try {
    const stock = await getAgroRadarStockContext();
    return NextResponse.json({ ok: true, stock }, { headers: JSON_UTF8 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити Агро-Радар",
        stock: null,
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

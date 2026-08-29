import { NextResponse } from "next/server";

import {
  INVENTORY_DASHBOARD_SINCE,
  loadInventoryDashboard,
} from "@/lib/inventory-dashboard-load";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** GET /api/inventory/dashboard — BAS-склад для клієнтського кеша / прогріву */
export async function GET() {
  try {
    const dashboard = await loadInventoryDashboard(INVENTORY_DASHBOARD_SINCE);
    return NextResponse.json(
      { ok: true, dashboard, since: INVENTORY_DASHBOARD_SINCE },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити склад з BAS",
        dashboard: null,
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

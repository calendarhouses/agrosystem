import { NextResponse } from "next/server";

import {
  fetchCompanyFinancialOverview,
} from "@/lib/company-finance";
import {
  defaultFinanceSeasonYear,
  getSeasonRange,
  seasonSinceIso,
} from "@/lib/finance-period";
import { loadInventoryDashboard } from "@/lib/inventory-dashboard-load";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * GET /api/finance/boot — огляд + BAS-дашборд поточного сезону
 * (для фонового прогріву з карти полів).
 */
export async function GET() {
  const seasonYear = defaultFinanceSeasonYear();
  const seasonRange = getSeasonRange(seasonYear);
  const since = seasonSinceIso(seasonYear);

  try {
    const [overview, bas] = await Promise.all([
      fetchCompanyFinancialOverview(String(seasonYear), {
        startIso: seasonRange.startIso,
        endIso: seasonRange.endIso,
      }),
      loadInventoryDashboard(since),
    ]);

    return NextResponse.json(
      {
        ok: true,
        seasonYear,
        overview,
        bas,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        seasonYear,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити фінанси",
        overview: null,
        bas: null,
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

"use server";

import {
  fetchCompanyFinancialOverview,
  type CompanyFinancialOverview,
} from "@/lib/company-finance";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * CEO-огляд: глобальний Plan/Fact + матриця burnRate по всіх активних полях.
 */
export async function getCompanyFinancialOverview(
  activeSeason?: string
): Promise<
  ActionResult<CompanyFinancialOverview>
> {
  try {
    const data = await fetchCompanyFinancialOverview(activeSeason);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити фінансовий огляд",
    };
  }
}

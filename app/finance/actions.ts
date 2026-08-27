"use server";

import {
  fetchCompanyFinancialOverview,
  type CompanyFinancialOverview,
  type FinanceDateRange,
} from "@/lib/company-finance";
import {
  getBasCounterparties,
  getBasHarvestOutputSince,
  getBasNomenclature,
  getBasProductionReportsSince,
  getBasPurchasesSince,
  getBasReceiptsSince,
  getBasSaleMovementsSince,
  getBasSalesSince,
  getBasUnits,
} from "@/lib/bas-api";
import { seasonSinceIso } from "@/lib/finance-period";
import {
  buildFullDashboard,
  type InventoryFullDashboard,
} from "@/lib/inventory-bas";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Огляд: Plan/Fact + матриця burnRate + локальні продажі/приходи.
 * range — yyyy-MM-dd; без range = увесь сезон (фільтр лише season у запитах).
 */
export async function getCompanyFinancialOverview(
  activeSeason?: string,
  range?: FinanceDateRange | null
): Promise<ActionResult<CompanyFinancialOverview>> {
  try {
    const data = await fetchCompanyFinancialOverview(activeSeason, range);
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

/**
 * BAS-дашборд для вибраного агросезону (read-only).
 * Потрібен при зміні сезону в UI — SSR дає лише поточний сезон.
 */
export async function getFinanceBasDashboard(
  seasonYear: number
): Promise<ActionResult<InventoryFullDashboard>> {
  try {
    const year = Number(seasonYear);
    if (!Number.isFinite(year) || year < 2020 || year > 2100) {
      return { ok: false, error: "Некоректний сезон" };
    }
    const since = seasonSinceIso(year);
    const [
      nomenclature,
      units,
      purchases,
      harvest,
      saleMoves,
      receipts,
      sales,
      counterparties,
      productionDocs,
    ] = await Promise.all([
      getBasNomenclature(),
      getBasUnits(),
      getBasPurchasesSince(since),
      getBasHarvestOutputSince(since),
      getBasSaleMovementsSince(since),
      getBasReceiptsSince(since),
      getBasSalesSince(since),
      getBasCounterparties(),
      getBasProductionReportsSince(since),
    ]);

    return {
      ok: true,
      data: buildFullDashboard({
        nomenclature,
        units,
        purchases,
        harvest,
        saleMoves,
        receipts,
        sales,
        counterparties,
        productionDocs,
        since,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити динаміку BAS",
    };
  }
}

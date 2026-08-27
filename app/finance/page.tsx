import type { Metadata } from "next";

import { FinanceView } from "@/components/dashboard/finance-view";
import { getCompanyFinancialOverview } from "@/app/finance/actions";
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
import {
  defaultFinanceSeasonYear,
  getSeasonRange,
  seasonSinceIso,
} from "@/lib/finance-period";
import { buildFullDashboard } from "@/lib/inventory-bas";

export const metadata: Metadata = {
  title: "Фінанси",
};

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const seasonYear = defaultFinanceSeasonYear();
  const seasonRange = getSeasonRange(seasonYear);
  const since = seasonSinceIso(seasonYear);

  const [overviewRes, basResult] = await Promise.all([
    getCompanyFinancialOverview(String(seasonYear), {
      startIso: seasonRange.startIso,
      endIso: seasonRange.endIso,
    }),
    (async () => {
      try {
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
          ok: true as const,
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
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "Не вдалося завантажити динаміку",
        };
      }
    })(),
  ]);

  return (
    <FinanceView
      initialSeasonYear={seasonYear}
      overview={overviewRes.ok ? overviewRes.data : null}
      overviewError={overviewRes.ok ? null : overviewRes.error}
      bas={basResult.ok ? basResult.data : null}
      basError={basResult.ok ? null : basResult.error}
    />
  );
}

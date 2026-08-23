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
import { buildFullDashboard } from "@/lib/inventory-bas";

export const metadata: Metadata = {
  title: "Фінанси",
};

export const dynamic = "force-dynamic";

const SINCE = "2024-03-01T00:00:00";

export default async function FinancePage() {
  const [overviewRes, basResult] = await Promise.all([
    getCompanyFinancialOverview(),
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
          getBasPurchasesSince(SINCE),
          getBasHarvestOutputSince(SINCE),
          getBasSaleMovementsSince(SINCE),
          getBasReceiptsSince(SINCE),
          getBasSalesSince(SINCE),
          getBasCounterparties(),
          getBasProductionReportsSince(SINCE),
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
            since: SINCE,
          }),
        };
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "Не вдалося завантажити cashflow з 1С",
        };
      }
    })(),
  ]);

  return (
    <FinanceView
      overview={overviewRes.ok ? overviewRes.data : null}
      overviewError={overviewRes.ok ? null : overviewRes.error}
      bas={basResult.ok ? basResult.data : null}
      basError={basResult.ok ? null : basResult.error}
    />
  );
}

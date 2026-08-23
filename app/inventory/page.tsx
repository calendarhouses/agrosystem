import type { Metadata } from "next";

import { InventoryView } from "@/components/dashboard/inventory-view";
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
  title: "Склад",
};

export const dynamic = "force-dynamic";

const SINCE = "2024-03-01T00:00:00";

export default async function InventoryPage() {
  let dashboard = null;
  let error: string | null = null;

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

    dashboard = buildFullDashboard({
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
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Не вдалося завантажити склад з BAS";
  }

  return <InventoryView dashboard={dashboard} error={error} />;
}

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
  buildFullDashboard,
  type InventoryFullDashboard,
} from "@/lib/inventory-bas";

/** Від цієї дати тягнемо документи BAS для складу (як на /inventory). */
export const INVENTORY_DASHBOARD_SINCE = "2024-03-01T00:00:00";

export async function loadInventoryDashboard(
  since: string = INVENTORY_DASHBOARD_SINCE
): Promise<InventoryFullDashboard> {
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

  return buildFullDashboard({
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
  });
}

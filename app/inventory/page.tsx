import type { Metadata } from "next";

import { InventoryView } from "@/components/dashboard/inventory-view";

export const metadata: Metadata = {
  title: "Склад та Врожай",
};

export default function InventoryPage() {
  return <InventoryView />;
}

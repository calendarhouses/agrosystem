import type { Metadata } from "next";

import { InventoryRoute } from "@/components/dashboard/inventory-route";

export const metadata: Metadata = {
  title: "Склад",
};

export default function InventoryPage() {
  return <InventoryRoute />;
}

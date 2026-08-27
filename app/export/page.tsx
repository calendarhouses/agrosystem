import type { Metadata } from "next";

import { AccountantHubView } from "@/components/dashboard/accountant-hub-view";

export const metadata: Metadata = {
  title: "Бухгалтерія",
};

export const dynamic = "force-dynamic";

export default function ExportPage() {
  return <AccountantHubView />;
}

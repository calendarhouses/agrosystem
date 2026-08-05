import type { Metadata } from "next";

import { FinanceView } from "@/components/dashboard/finance-view";

export const metadata: Metadata = {
  title: "Фінанси",
};

export default function FinancePage() {
  return <FinanceView />;
}

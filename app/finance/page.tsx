import type { Metadata } from "next";

import { FinanceRoute } from "@/components/dashboard/finance-route";

export const metadata: Metadata = {
  title: "Фінанси",
};

export default function FinancePage() {
  return <FinanceRoute />;
}

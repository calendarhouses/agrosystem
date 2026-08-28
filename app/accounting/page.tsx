import type { Metadata } from "next";

import { AccountingHub } from "@/components/dashboard/accounting/accounting-hub";

export const metadata: Metadata = {
  title: "Бухгалтерія та Інтеграція",
};

export const dynamic = "force-dynamic";

/** Легка сторінка: важкі BAS-запити лише при відкритті вкладок звірки/мапінгу. */
export default function AccountingPage() {
  return <AccountingHub />;
}

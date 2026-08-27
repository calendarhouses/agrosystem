import type { Metadata } from "next";

import { BasExportView } from "@/components/dashboard/bas-export-view";

export const metadata: Metadata = {
  title: "Бухгалтерія",
};

export const dynamic = "force-dynamic";

export default function ExportPage() {
  return <BasExportView />;
}

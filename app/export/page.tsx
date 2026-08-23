import type { Metadata } from "next";

import { BasExportView } from "@/components/dashboard/bas-export-view";

export const metadata: Metadata = {
  title: "Експорт в 1С",
};

export const dynamic = "force-dynamic";

export default function ExportPage() {
  return <BasExportView />;
}

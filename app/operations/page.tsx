import type { Metadata } from "next";

import { OperationsMatrixView } from "@/components/dashboard/operations-matrix-view";

export const metadata: Metadata = {
  title: "Хронологія полів",
};

export default function OperationsPage() {
  return <OperationsMatrixView />;
}

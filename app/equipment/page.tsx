import { Suspense } from "react";
import type { Metadata } from "next";

import { EquipmentView } from "@/components/dashboard/equipment-view";

export const metadata: Metadata = {
  title: "Техніка",
};

export default function EquipmentPage() {
  return (
    <Suspense fallback={null}>
      <EquipmentView />
    </Suspense>
  );
}

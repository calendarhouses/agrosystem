import { Suspense } from "react";
import type { Metadata } from "next";

import { CommandCenterPageBootFallback } from "@/components/dashboard/command-center-page-boot-fallback";
import { EquipmentView } from "@/components/dashboard/equipment-view";

export const metadata: Metadata = {
  title: "Техніка",
};

export default function EquipmentPage() {
  return (
    <Suspense
      fallback={
        <CommandCenterPageBootFallback
          variant="equipment"
          subtitle="Центруємо на вашому господарстві…"
        />
      }
    >
      <EquipmentView />
    </Suspense>
  );
}

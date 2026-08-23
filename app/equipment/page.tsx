import { Suspense } from "react";
import type { Metadata } from "next";
import { Loader2 } from "lucide-react";

import { EquipmentView } from "@/components/dashboard/equipment-view";

export const metadata: Metadata = {
  title: "Техніка",
};

export default function EquipmentPage() {
  return (
    <Suspense
      fallback={
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/40 bg-background/80 px-6 py-5 shadow-xl backdrop-blur-xl">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            <p className="text-sm font-semibold text-foreground">
              Завантаження диспетчерської…
            </p>
          </div>
        </div>
      }
    >
      <EquipmentView />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { InstallPrompt } from "@/components/pwa/install-prompt";

export const metadata: Metadata = {
  title: "Встановлення",
};

export default function InstallPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F4F1EA] text-sm text-zinc-500">
          Завантаження…
        </div>
      }
    >
      <InstallPrompt />
    </Suspense>
  );
}

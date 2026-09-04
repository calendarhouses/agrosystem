import type { Metadata } from "next";
import { Suspense } from "react";

import { InstallPrompt } from "@/components/pwa/install-prompt";

export const metadata: Metadata = {
  title: "Встановлення",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LEVADA",
  },
  icons: {
    apple: [{ url: "/apple-touch-icon.png?v=7", sizes: "180x180", type: "image/png" }],
  },
};

export default function InstallPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center bg-[#F4F1EA] text-sm text-zinc-500">
          Завантаження…
        </div>
      }
    >
      <InstallPrompt />
    </Suspense>
  );
}

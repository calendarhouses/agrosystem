import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

/** App Shell: фіксований viewport без прокрутки сторінки */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-hidden bg-zinc-100 text-zinc-900">
      <Sidebar />

      <div className="flex h-full flex-col pl-16 md:pl-[250px]">
        <TopBar />
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

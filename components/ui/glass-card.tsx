import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Картка «преміум-глина» на світло-металевому фоні */
export function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-6 text-zinc-900",
        "shadow-sm transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-md",
        className
      )}
    >
      {children}
    </div>
  );
}

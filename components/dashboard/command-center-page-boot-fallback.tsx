import { Map as MapIcon, Radar } from "lucide-react";

import { COMMAND_CENTER_MAP_AREA_CLASS } from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

/** SSR/Suspense fallback — той самий чорний стиль, без білого кадру */
export function CommandCenterPageBootFallback({
  subtitle,
  variant = "fields",
}: {
  subtitle?: string;
  variant?: "fields" | "equipment";
}) {
  const Icon = variant === "equipment" ? Radar : MapIcon;

  return (
    <div className="absolute inset-0 overflow-hidden bg-zinc-950">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(39,103,73,0.22),transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        className={cn(
          COMMAND_CENTER_MAP_AREA_CLASS,
          "z-10 flex flex-col items-center justify-center px-6 text-center"
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-lg backdrop-blur-sm">
          <Icon className="h-7 w-7 animate-pulse text-emerald-400" />
        </div>
        <p className="mt-3 text-sm font-semibold text-zinc-200">
          Підготовка карти
        </p>
        {subtitle ? (
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

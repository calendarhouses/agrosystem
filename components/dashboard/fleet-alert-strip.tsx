"use client";

import { Fuel, RadioTower, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

export type FleetAlertKind = "idling" | "offline" | "fuel";

export type FleetAlert = {
  kind: FleetAlertKind;
  count: number;
  label: string;
  detail: string;
};

type FleetAlertStripProps = {
  alerts: FleetAlert[];
  activeKind: FleetAlertKind | null;
  onSelect: (kind: FleetAlertKind | null) => void;
};

const ALERT_STYLES: Record<
  FleetAlertKind,
  {
    idle: string;
    active: string;
    icon: string;
    Icon: typeof Zap;
  }
> = {
  idling: {
    idle: "border-rose-200/80 bg-rose-50/90 text-rose-700 hover:bg-rose-50",
    active:
      "border-rose-400 bg-rose-600 text-white shadow-[0_8px_24px_rgba(225,29,72,0.28)]",
    icon: "bg-rose-500/15 text-rose-600",
    Icon: Zap,
  },
  offline: {
    idle: "border-amber-200/80 bg-amber-50/90 text-amber-800 hover:bg-amber-50",
    active:
      "border-amber-400 bg-amber-600 text-white shadow-[0_8px_24px_rgba(217,119,6,0.28)]",
    icon: "bg-amber-500/15 text-amber-700",
    Icon: RadioTower,
  },
  fuel: {
    idle: "border-[#E8C4B0] bg-[#FBF1EA] text-[#9A3412] hover:bg-[#F8E8DC]",
    active:
      "border-[#C05621] bg-[#C05621] text-white shadow-[0_8px_24px_rgba(192,86,33,0.3)]",
    icon: "bg-[#C05621]/12 text-[#C05621]",
    Icon: Fuel,
  },
};

export function FleetAlertStrip({
  alerts,
  activeKind,
  onSelect,
}: FleetAlertStripProps) {
  if (alerts.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm backdrop-blur-md">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Флот у нормі
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5">
      {alerts.map((alert) => {
        const style = ALERT_STYLES[alert.kind];
        const Icon = style.Icon;
        const active = activeKind === alert.kind;
        return (
          <button
            key={alert.kind}
            type="button"
            onClick={() => onSelect(active ? null : alert.kind)}
            className={cn(
              "group inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md transition-all",
              "outline-none focus-visible:outline-none focus-visible:ring-0",
              active ? style.active : style.idle
            )}
            title={alert.detail}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full",
                active ? "bg-white/20 text-white" : style.icon
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={2} />
            </span>
            <span className="tabular-nums">{alert.count}</span>
            <span className="hidden sm:inline">{alert.label}</span>
            {active ? (
              <span
                className={cn(
                  "ml-0.5 h-1.5 w-1.5 rounded-full",
                  alert.kind === "idling" && "bg-white animate-pulse",
                  alert.kind === "offline" && "bg-white animate-pulse",
                  alert.kind === "fuel" && "bg-white animate-pulse"
                )}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

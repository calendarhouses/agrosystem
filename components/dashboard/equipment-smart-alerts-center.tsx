"use client";

import { Bell, Droplets, Timer } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SmartAlert } from "@/lib/equipment-smart-alerts";
import { cn } from "@/lib/utils";

const KIND_ICON = {
  fuel_drain: Droplets,
  long_idle: Timer,
} as const;

type Props = {
  alerts: SmartAlert[];
  onAlertClick: (alert: SmartAlert) => void;
};

export function EquipmentSmartAlertsCenter({ alerts, onAlertClick }: Props) {
  const count = alerts.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/40 shadow-xl transition hover:bg-white/90",
          "bg-background/80 backdrop-blur-2xl outline-none",
          count > 0 && "ring-2 ring-rose-400/30"
        )}
        aria-label={`Сповіщення: ${count}`}
      >
        <span className="relative">
          <Bell className="h-5 w-5 text-zinc-800" strokeWidth={1.6} />
          {count > 0 ? (
            <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,360px)] border-white/40 bg-background/95 p-0 backdrop-blur-2xl"
      >
        <DropdownMenuGroup className="border-b border-border/50">
          <DropdownMenuLabel className="px-3 py-2.5">
            <span className="block text-sm font-semibold text-foreground">
              Центр сповіщень
            </span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {count > 0
                ? `${count} активн${count === 1 ? "е" : "их"}`
                : "Аномалій не виявлено"}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuGroup className="max-h-[min(60vh,420px)] overflow-y-auto p-1">
          {count === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Усе спокійно
            </p>
          ) : (
            alerts.map((alert, index) => {
              const Icon = KIND_ICON[alert.kind];
              return (
                <div key={alert.id}>
                  {index > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    className={cn(
                      "cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5",
                      alert.severity === "critical" && "focus:bg-rose-50",
                      alert.severity === "warning" && "focus:bg-amber-50"
                    )}
                    onClick={() => onAlertClick(alert)}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background",
                        alert.severity === "critical" &&
                          "border-rose-200 text-rose-700",
                        alert.severity === "warning" &&
                          "border-amber-200 text-amber-700",
                        alert.severity === "info" &&
                          "border-border text-muted-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.6} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {alert.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {alert.detail}
                      </p>
                    </div>
                  </DropdownMenuItem>
                </div>
              );
            })
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

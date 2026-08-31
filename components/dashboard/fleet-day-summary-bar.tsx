"use client";

import { useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar as CalendarIcon, Loader2, RefreshCw } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FleetSummaryMetric =
  | "active"
  | "onField"
  | "distance"
  | "idling"
  | "drain";

export type FleetDaySummary = {
  unitsActive: number;
  unitsTotal: number;
  distanceKm: number;
  hoursOnField: number;
  hoursIdling: number;
  drainEvents: number;
  byMetric: Record<FleetSummaryMetric, number[]>;
  syncedAt?: string | null;
  truncated?: boolean;
};

type FleetDaySummaryBarProps = {
  date: Date;
  onDateChange: (date: Date) => void;
  summary: FleetDaySummary | null;
  loading?: boolean;
  /** Підказка: йде sync з Wialon або БД порожня */
  syncHint?: "syncing" | "empty" | null;
  activeMetric?: FleetSummaryMetric | null;
  onMetricSelect?: (metric: FleetSummaryMetric | null) => void;
  /** Примусове оновлення з Wialon */
  onRefresh?: () => void;
  /** Компактні плитки для Command Center */
  compact?: boolean;
};

function formatHoursShort(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0";
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes}хв`;
  if (minutes <= 0) return `${hours}г`;
  return `${hours}г ${minutes}хв`;
}

export function emptyFleetByMetric(): Record<FleetSummaryMetric, number[]> {
  return {
    active: [],
    onField: [],
    distance: [],
    idling: [],
    drain: [],
  };
}

export function FleetDaySummaryBar({
  date,
  onDateChange,
  summary,
  loading,
  syncHint = null,
  activeMetric = null,
  onMetricSelect,
  onRefresh,
  compact = false,
}: FleetDaySummaryBarProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const tiles: Array<{
    metric: FleetSummaryMetric;
    label: string;
    value: string;
    empty: boolean;
    valueClassName?: string;
  }> = [
    {
      metric: "active",
      label: "У роботі",
      value: summary
        ? `${summary.unitsActive}/${summary.unitsTotal}`
        : "—",
      empty: !summary || summary.unitsActive <= 0,
    },
    {
      metric: "onField",
      label: "На полях · Σ парк",
      value: summary ? formatHoursShort(summary.hoursOnField) : "—",
      empty: !summary || summary.hoursOnField <= 0,
      valueClassName: "text-emerald-700",
    },
    {
      metric: "distance",
      label: "Пробіг",
      value: summary
        ? `${Math.round(summary.distanceKm).toLocaleString("uk-UA")} км`
        : "—",
      empty: !summary || summary.distanceKm <= 0.05,
    },
    {
      metric: "idling",
      label: "Холостий",
      value: summary ? formatHoursShort(summary.hoursIdling) : "—",
      empty: !summary || summary.hoursIdling <= 0,
      valueClassName:
        summary && summary.hoursIdling > 1 ? "text-rose-600" : undefined,
    },
    {
      metric: "drain",
      label: "Зливи",
      value: summary ? String(summary.drainEvents) : "—",
      empty: !summary || summary.drainEvents <= 0,
      valueClassName:
        summary && summary.drainEvents > 0 ? "text-rose-600" : undefined,
    },
  ];

  return (
    <section className={cn(compact ? "space-y-2" : "space-y-3")}>
      <div className="flex items-center justify-between gap-2">
        <h2
          className={cn(
            "font-semibold tracking-tight text-foreground",
            compact ? "text-xs" : "text-sm"
          )}
        >
          Активність парку
        </h2>

        <div className="flex shrink-0 items-center gap-1">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="Оновити з Wialon"
              aria-label="Оновити з Wialon"
              className={cn(
                "inline-flex items-center justify-center rounded-lg border border-border/60 bg-background/80 text-muted-foreground shadow-sm outline-none transition",
                "hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                "disabled:pointer-events-none disabled:opacity-50",
                compact ? "h-7 w-7" : "h-8 w-8"
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
            </button>
          ) : null}

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 text-muted-foreground shadow-sm outline-none transition",
                "hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                compact ? "h-7 px-2" : "h-8 px-2.5"
              )}
              aria-label={`Дата: ${format(date, "d MMMM yyyy", { locale: uk })}`}
            >
              {loading && !onRefresh ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span
                className={cn(
                  "font-semibold tabular-nums text-foreground",
                  compact ? "text-[11px]" : "text-xs"
                )}
              >
                {format(date, compact ? "d MMM yyyy" : "d MMMM yyyy", {
                  locale: uk,
                })}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sheetOnMobile={false}
              sideOffset={8}
              className="z-[220] w-auto overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-xl"
              data-vaul-no-drag=""
            >
              <div className="border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                {format(date, "d MMMM yyyy", { locale: uk })}
              </div>
              <Calendar
                mode="single"
                selected={date}
                onSelect={(next) => {
                  if (!next) return;
                  onDateChange(next);
                  setOpen(false);
                }}
                disabled={{ after: todayStart }}
                className="rounded-xl bg-transparent p-2"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {syncHint === "syncing" ? (
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-amber-800/90">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          Оновлюємо з Wialon…
        </p>
      ) : syncHint === "empty" && !loading ? (
        <p className="text-[10px] font-medium text-muted-foreground">
          Немає денної статистики — натисніть оновлення з Wialon
        </p>
      ) : summary?.truncated && !loading ? (
        <p className="text-[10px] font-medium text-amber-800/90">
          Частина парку не встигла оновитись — натисніть оновлення ще раз
        </p>
      ) : summary?.syncedAt && !loading ? (
        <p className="text-[10px] font-medium text-muted-foreground">
          Оновлено{" "}
          {format(new Date(summary.syncedAt), "HH:mm", { locale: uk })}
        </p>
      ) : null}

      <div className={cn("grid grid-cols-2", compact ? "gap-1.5" : "gap-3")}>
        {tiles.map((tile) => {
          const active = activeMetric === tile.metric;
          const interactive = Boolean(onMetricSelect && summary && !tile.empty);
          return (
            <button
              key={tile.metric}
              type="button"
              disabled={!interactive}
              onClick={() => {
                if (!onMetricSelect) return;
                onMetricSelect(active ? null : tile.metric);
              }}
              className={cn(
                "min-w-0 rounded-lg border text-left transition-colors",
                compact ? "px-2 py-1.5" : "rounded-xl px-3 py-2.5",
                active
                  ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                  : "border-border/50 bg-background/60",
                interactive && !active && "hover:bg-background/90",
                !interactive && "cursor-default"
              )}
            >
              <p
                className={cn(
                  "truncate whitespace-nowrap text-muted-foreground",
                  compact ? "text-[10px] leading-tight" : "text-xs"
                )}
              >
                {tile.label}
              </p>
              {loading && !summary ? (
                <div
                  className={cn(
                    "animate-pulse rounded bg-muted",
                    compact ? "mt-0.5 h-4 w-10" : "mt-1 h-6 w-12"
                  )}
                />
              ) : (
                <p
                  className={cn(
                    "truncate font-bold whitespace-nowrap tabular-nums text-foreground",
                    compact ? "mt-0 text-sm leading-tight" : "mt-0.5 text-lg",
                    tile.valueClassName
                  )}
                >
                  {tile.value}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

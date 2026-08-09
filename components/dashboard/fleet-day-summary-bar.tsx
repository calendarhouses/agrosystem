"use client";

import { useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  Droplets,
  Loader2,
  MapPin,
  Route,
  Zap,
} from "lucide-react";

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
  /** Техніка, що входить у кожну метрику (для підсвітки карток) */
  byMetric: Record<FleetSummaryMetric, number[]>;
};

type FleetDaySummaryBarProps = {
  date: Date;
  onDateChange: (date: Date) => void;
  summary: FleetDaySummary | null;
  loading?: boolean;
  activeMetric?: FleetSummaryMetric | null;
  onMetricSelect?: (metric: FleetSummaryMetric | null) => void;
};

function formatHoursShort(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 хв";
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes <= 0) return `${hours} год`;
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
  activeMetric = null,
  onMetricSelect,
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
    icon: typeof Route;
    label: string;
    value: string;
    tone: string;
    empty: boolean;
  }> = [
    {
      metric: "active",
      icon: Route,
      label: "У роботі",
      value: summary
        ? `${summary.unitsActive} / ${summary.unitsTotal}`
        : "—",
      tone: "text-zinc-900",
      empty: !summary || summary.unitsActive <= 0,
    },
    {
      metric: "onField",
      icon: MapPin,
      label: "На полях",
      value: summary ? formatHoursShort(summary.hoursOnField) : "—",
      tone: "text-emerald-700",
      empty: !summary || summary.hoursOnField <= 0,
    },
    {
      metric: "distance",
      icon: Route,
      label: "Пробіг флоту",
      value: summary
        ? `${summary.distanceKm.toLocaleString("uk-UA", {
            maximumFractionDigits: 0,
          })} км`
        : "—",
      tone: "text-zinc-900",
      empty: !summary || summary.distanceKm <= 0.05,
    },
    {
      metric: "idling",
      icon: Zap,
      label: "Холостий",
      value: summary ? formatHoursShort(summary.hoursIdling) : "—",
      tone:
        summary && summary.hoursIdling > 1 ? "text-rose-600" : "text-zinc-900",
      empty: !summary || summary.hoursIdling <= 0,
    },
    {
      metric: "drain",
      icon: Droplets,
      label: "Підозри зливу",
      value: summary ? String(summary.drainEvents) : "—",
      tone:
        summary && summary.drainEvents > 0 ? "text-rose-600" : "text-zinc-900",
      empty: !summary || summary.drainEvents <= 0,
    },
  ];

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-[#E5DFD3] bg-gradient-to-r from-[#F4F1EA] via-white to-[#F4F1EA] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#E5DFD3]/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Підсумок зміни флоту
          </p>
          <p className="text-sm font-bold text-zinc-900">
            Агрегат по всьому парку за обрану дату
          </p>
          {activeMetric ? (
            <p className="mt-0.5 text-xs text-[#276749]">
              Підсвічено техніку з обраної метрики · натисніть ще раз, щоб
              скинути
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500">
              Натисніть картку — підсвітиться відповідна техніка
            </p>
          )}
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={cn(
              "inline-flex h-9 items-center justify-start gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 shadow-sm",
              "outline-none transition hover:border-[#276749]/30 hover:bg-white focus-visible:ring-2 focus-visible:ring-[#276749]/25"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 text-[#276749]" />
            {format(date, "d MMMM yyyy", { locale: uk })}
            {loading ? (
              <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-zinc-400" />
            ) : null}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-auto overflow-hidden rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 shadow-xl"
          >
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

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
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
                "rounded-xl border px-3 py-2.5 text-left transition-all",
                "shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]",
                active
                  ? "border-[#276749] bg-emerald-50/80 ring-2 ring-[#276749]/20"
                  : "border-[#E5DFD3]/80 bg-white/85",
                interactive &&
                  !active &&
                  "cursor-pointer hover:-translate-y-0.5 hover:border-[#276749]/35 hover:shadow-md",
                !interactive && "cursor-default opacity-80"
              )}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                <Icon
                  className={cn(
                    "h-3 w-3",
                    active ? "text-[#276749]" : "text-[#C05621]"
                  )}
                  strokeWidth={1.6}
                />
                {tile.label}
              </div>
              {loading && !summary ? (
                <div className="h-5 w-16 animate-pulse rounded bg-zinc-100" />
              ) : (
                <p className={cn("text-sm font-bold tabular-nums", tile.tone)}>
                  {tile.value}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

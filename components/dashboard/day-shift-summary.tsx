"use client";

import {
  Droplets,
  Fuel,
  MapPin,
  Route,
  Timer,
  Zap,
} from "lucide-react";

import type {
  DayAnalyticsSummary,
  FuelDrainEvent,
} from "@/lib/equipment-day-analytics";
import { cn } from "@/lib/utils";

function formatHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 хв";
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes <= 0) return `${hours} год`;
  return `${hours} год ${minutes} хв`;
}

function formatClock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type DayShiftSummaryProps = {
  summary: DayAnalyticsSummary;
  hoursOnField: number;
  hoursOnRoad: number;
  hoursAtBase: number;
  fuelEvents: FuelDrainEvent[];
  loading?: boolean;
  /** Поточний рівень з live-телеметрії (якщо день ще без семплів) */
  liveFuelLiters?: number | null;
  onFuelEventClick?: (event: FuelDrainEvent) => void;
};

export function DayShiftSummary({
  summary,
  hoursOnField,
  hoursOnRoad,
  hoursAtBase,
  fuelEvents,
  loading,
  liveFuelLiters,
  onFuelEventClick,
}: DayShiftSummaryProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-[#E5DFD3]/90 bg-white/70 p-5">
        <div className="mb-4 h-4 w-40 rounded bg-zinc-200" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-zinc-100" />
          ))}
        </div>
      </div>
    );
  }

  const timePieces = [
    { key: "field", label: "Поля", hours: hoursOnField, color: "bg-emerald-500" },
    { key: "road", label: "Дорога", hours: hoursOnRoad, color: "bg-amber-400" },
    { key: "base", label: "База", hours: hoursAtBase, color: "bg-zinc-400" },
    {
      key: "idle",
      label: "Холостий",
      hours: summary.hoursIdling,
      color: "bg-rose-500",
    },
  ];
  const timeTotal = timePieces.reduce((s, p) => s + p.hours, 0) || 1;

  const metrics: Array<{
    icon: typeof Route;
    label: string;
    value: string;
    tone: string;
    hint?: string;
    hintTone?: string;
  }> = [
    {
      icon: Route,
      label: "Пробіг",
      value: `${summary.distanceKm.toLocaleString("uk-UA", {
        maximumFractionDigits: 1,
      })} км`,
      tone: "text-zinc-900",
    },
    {
      icon: Timer,
      label: summary.hasIgnitionSensor ? "Мотогодини" : "Час у русі",
      value: formatHours(summary.workHours),
      tone: "text-zinc-900",
    },
    {
      icon: MapPin,
      label: "На полях",
      value: formatHours(hoursOnField),
      tone: "text-emerald-700",
    },
    {
      icon: Zap,
      label: "Холостий хід",
      value: formatHours(summary.hoursIdling),
      tone:
        summary.hoursIdling > 0.25 ? "text-rose-600" : "text-zinc-900",
    },
    {
      icon: Fuel,
      label: "Рівень палива",
      value: !summary.hasFuelSensor
        ? "Немає датчика"
        : summary.fuelStart != null && summary.fuelEnd != null
          ? `${Math.round(summary.fuelStart)} → ${Math.round(summary.fuelEnd)} л`
          : liveFuelLiters != null && Number.isFinite(liveFuelLiters)
            ? `${Math.round(liveFuelLiters)} л`
            : summary.sampleCount === 0
              ? "Немає даних за день"
              : "—",
      tone: "text-zinc-900",
      hint: !summary.hasFuelSensor
        ? undefined
        : summary.fuelStart != null &&
            summary.fuelEnd != null &&
            summary.fuelDelta != null
          ? summary.fuelDelta > 15
            ? `заправка ≈ +${Math.round(summary.fuelDelta)} л`
            : summary.fuelDelta < -15
              ? `витрата ≈ ${Math.round(Math.abs(summary.fuelDelta))} л`
              : undefined
          : undefined,
      hintTone:
        summary.fuelDelta != null && summary.fuelDelta < -20
          ? "text-rose-600"
          : summary.fuelDelta != null && summary.fuelDelta > 15
            ? "text-emerald-700"
            : "text-zinc-500",
    },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-gradient-to-b from-white via-white to-[#F4F1EA]/90 shadow-[0_8px_30px_rgba(28,25,23,0.06)]">
      <div className="border-b border-[#E5DFD3]/70 px-4 py-3.5">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          Зміна за день
        </p>
        <p className="mt-0.5 text-sm font-bold text-zinc-900">
          Що зробила техніка сьогодні
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="rounded-xl border border-[#E5DFD3]/70 bg-white/80 px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                <Icon className="h-3 w-3 text-[#C05621]" strokeWidth={1.6} />
                {m.label}
              </div>
              <p className={cn("text-sm font-bold tabular-nums", m.tone)}>
                {m.value}
              </p>
              {m.hint ? (
                <p
                  className={cn(
                    "mt-0.5 text-[10px] font-medium",
                    m.hintTone ?? "text-zinc-500"
                  )}
                >
                  {m.hint}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3">
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Розподіл часу
        </p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100 shadow-inner">
          {timePieces.map((p) => {
            const pct = (p.hours / timeTotal) * 100;
            if (pct < 0.5) return null;
            return (
              <div
                key={p.key}
                className={cn("h-full transition-all", p.color)}
                style={{ width: `${pct}%` }}
                title={`${p.label}: ${formatHours(p.hours)}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {timePieces.map((p) => (
            <span
              key={p.key}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-600"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", p.color)} />
              {p.label} · {formatHours(p.hours)}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-[#E5DFD3]/70 bg-[#FBF9F5]/80 px-4 py-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <Droplets className="h-3.5 w-3.5 text-rose-500" strokeWidth={1.7} />
          <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Події палива
          </p>
        </div>

        {!summary.hasFuelSensor ? (
          <p className="rounded-xl border border-dashed border-[#E5DFD3] bg-white/50 px-3 py-3 text-sm text-zinc-500">
            Немає датчика
          </p>
        ) : fuelEvents.length === 0 ? (
          summary.fuelDelta != null && summary.fuelDelta > 15 ? (
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-3">
              <p className="text-sm font-semibold text-emerald-800">
                Заправка за день ≈ +{Math.round(summary.fuelDelta)} л
              </p>
              <p className="mt-0.5 text-xs text-emerald-700/80">
                Рівень бака зріс за обрану добу (ДУТ). Зливів не виявлено.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-3">
              <p className="text-sm font-semibold text-emerald-800">
                Підозр на злив не виявлено
              </p>
              <p className="mt-0.5 text-xs text-emerald-700/80">
                Немає стійкого падіння ≥40 л на довгій стоянці (з підтвердженням
                датчика)
              </p>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {fuelEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onFuelEventClick?.(event)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border border-rose-200/80 bg-gradient-to-r from-rose-50 to-white px-3 py-2.5 text-left shadow-sm",
                    "transition hover:border-rose-300 hover:shadow-md",
                    "outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50"
                  )}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600">
                    <Fuel className="h-3.5 w-3.5" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-rose-700/80 tabular-nums">
                        {formatClock(event.startUnix)} –{" "}
                        {formatClock(event.endUnix)}
                      </p>
                      <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">
                        −{event.litersLost} л
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-bold text-zinc-900">
                      Підозра на злив на стоянці
                    </p>
                    <p className="text-xs text-zinc-500">
                      {event.confidence === "high"
                        ? "Висока впевненість"
                        : "Середня впевненість"}{" "}
                      · натисніть, щоб відкрити на карті
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

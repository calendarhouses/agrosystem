"use client";

import { useMemo, type ComponentType } from "react";
import { Fuel } from "lucide-react";

import type {
  DayAnalyticsPayload,
  FuelDrainEvent,
} from "@/lib/equipment-day-analytics";
import {
  fuelPercentOfTank,
  isFuelCritical,
} from "@/lib/equipment-fleet";
import {
  buildDayUtilization,
  formatUtilizationHours,
  utilizationKindMeta,
} from "@/lib/equipment-utilization";
import { cn } from "@/lib/utils";

function GlassEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/40 px-4 py-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 text-muted-foreground">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground/80">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function UtilizationTimelineBar({
  analytics,
  loading,
  dateLabel,
}: {
  analytics: DayAnalyticsPayload;
  loading?: boolean;
  /** Напр. «23 серпня 2026» замість hardcoded «сьогодні» */
  dateLabel?: string;
}) {
  const segments = useMemo(
    () => buildDayUtilization(analytics),
    [analytics]
  );

  if (loading) {
    return <div className="h-20 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/70 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          Таймлайн ефективності
        </p>
        <span className="text-xs text-muted-foreground">
          {dateLabel ?? "сьогодні"}
        </span>
      </div>

      <div className="h-4 w-full overflow-hidden rounded-full bg-muted shadow-inner">
        <div className="flex h-full w-full">
          {segments.map((seg) => (
            <div
              key={seg.kind}
              className={cn(
                "h-full min-w-0 shrink-0",
                utilizationKindMeta(seg.kind).color
              )}
              style={{ width: `${seg.percent}%` }}
              title={`${seg.label}: ${formatUtilizationHours(seg.hours)}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <div
            key={seg.kind}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                utilizationKindMeta(seg.kind).color
              )}
            />
            <span className="font-medium text-foreground/80">
              {seg.label}
            </span>
            <span className="tabular-nums">
              {formatUtilizationHours(seg.hours)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Рівень палива відносно номіналу бака */
export function FuelSparkline({
  analytics,
  fuelEvents: _fuelEvents,
  loading,
  liveLiters,
  tankVolume,
  hasFuelSensor: hasFuelSensorProp,
}: {
  analytics: DayAnalyticsPayload;
  fuelEvents: FuelDrainEvent[];
  loading?: boolean;
  /** Поточний залишок з телеметрії (пріоритет над fuelEnd) */
  liveLiters?: number | null;
  /** Номінальний обʼєм бака, л */
  tankVolume?: number | null;
  /** false = немає ДУТ — не показувати 0 л / «критично» */
  hasFuelSensor?: boolean;
}) {
  void _fuelEvents;

  const hasFuelSensor =
    hasFuelSensorProp ?? analytics.summary.hasFuelSensor;

  if (loading) {
    return <div className="h-[108px] animate-pulse rounded-xl bg-muted/50" />;
  }

  if (!hasFuelSensor) {
    return (
      <GlassEmptyState
        icon={Fuel}
        title="Немає датчика"
      />
    );
  }

  const remainingRaw =
    liveLiters != null && Number.isFinite(liveLiters)
      ? liveLiters
      : analytics.summary.fuelEnd;

  const remaining =
    remainingRaw != null &&
    Number.isFinite(remainingRaw) &&
    remainingRaw > 0
      ? remainingRaw
      : null;

  if (remaining == null) {
    return (
      <GlassEmptyState
        icon={Fuel}
        title="Рівень палива невідомий"
        hint="Датчик не передавав значення"
      />
    );
  }

  const tank =
    tankVolume != null && Number.isFinite(tankVolume) && tankVolume > 0
      ? tankVolume
      : null;
  const pct = fuelPercentOfTank(remaining, tank);
  const critical = isFuelCritical(remaining, tank);
  const low = pct != null && pct < 30 && !critical;

  const fillPct =
    pct ?? Math.min(100, Math.max(0, (remaining / 800) * 100));
  const displayPct = pct != null ? Math.round(pct) : null;
  const barWidth = Math.max(fillPct > 0 && fillPct < 2 ? 2 : fillPct, 0);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border",
        "border-[#E5DFD3]/90 bg-gradient-to-b from-white via-white to-[#F4F1EA]/90",
        "shadow-[0_8px_30px_rgba(28,25,23,0.06)]"
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(39,103,73,0.12),transparent_70%)]"
      />

      <div className="relative px-4 pt-3.5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
              Паливо
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <p
                className={cn(
                  "text-2xl font-bold tracking-tight tabular-nums",
                  critical
                    ? "text-rose-600"
                    : low
                      ? "text-amber-700"
                      : "text-zinc-900"
                )}
              >
                {Math.round(remaining).toLocaleString("uk-UA")}
                <span className="ml-1 text-sm font-semibold text-zinc-500">
                  л
                </span>
              </p>
              {displayPct != null ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                    critical
                      ? "bg-rose-50 text-rose-700"
                      : low
                        ? "bg-amber-50 text-amber-800"
                        : "bg-emerald-50 text-emerald-800"
                  )}
                >
                  {displayPct}%
                </span>
              ) : null}
            </div>
          </div>

          {tank != null ? (
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-medium text-zinc-400">Бак</p>
              <p className="text-sm font-semibold tabular-nums text-zinc-600">
                {Math.round(tank).toLocaleString("uk-UA")} л
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-3.5">
          <div
            className="relative h-4 overflow-hidden rounded-full bg-zinc-200/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={tank ?? 100}
            aria-valuenow={Math.round(remaining)}
            aria-label="Рівень палива"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {[25, 50, 75].map((mark) => (
                <div
                  key={mark}
                  className="absolute top-0 bottom-0 w-px bg-zinc-400/30"
                  style={{ left: `${mark}%` }}
                />
              ))}
            </div>

            <div
              className={cn(
                "relative h-full rounded-full transition-[width] duration-700 ease-out",
                critical
                  ? "bg-gradient-to-r from-rose-600 via-rose-500 to-orange-400"
                  : low
                    ? "bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-400"
                    : "bg-gradient-to-r from-[#1a4d35] via-[#276749] to-[#3d9b6a]"
              )}
              style={{ width: `${barWidth}%` }}
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/35 to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/25 to-transparent"
              />
            </div>
          </div>

          <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-zinc-400">
            <span>0</span>
            <span>¼</span>
            <span>½</span>
            <span>¾</span>
            <span>{tank != null ? Math.round(tank) : "max"}</span>
          </div>
        </div>

        {critical ? (
          <p className="mt-2 text-[11px] font-semibold text-rose-600">
            Критично мало палива — потрібна заправка
          </p>
        ) : low ? (
          <p className="mt-2 text-[11px] font-medium text-amber-700">
            Запас нижче 30% бака
          </p>
        ) : null}
      </div>
    </div>
  );
}

export { GlassEmptyState };

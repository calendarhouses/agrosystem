"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Package,
  Plus,
  Search,
  Sprout,
  Tractor,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { normalizeFieldCrop } from "@/components/dashboard/field-passport-form";
import { OperationsTimelineImageThumb } from "@/components/dashboard/operations-timeline-image";
import { OperationsWeatherBadge } from "@/components/dashboard/operations-weather-badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  FieldTimelineField,
  FieldWithTimeline,
  UnifiedTimelineEvent,
  UnifiedTimelineEventType,
  UnifiedTimelineIcon,
} from "@/lib/field-timeline";
import {
  deriveTimelineIcon,
  isFutureTimelineOperation,
  timelineEventDateIso,
  timelineOperationStatusLabel,
  toTimelineField,
} from "@/lib/field-timeline";
import {
  groupTimelineByCrop,
  normalizeFieldLineColor,
  TIMELINE_NO_CROP_LABEL,
  type TimelineCropGroup,
} from "@/lib/field-timeline-crops";
import { ukFieldLabel, ukStationLabel } from "@/lib/uk-plural";
import { cn } from "@/lib/utils";

export type OperationsMetroVariant = "mobile" | "desktop";

type MetroLayoutMetrics = {
  stationCardWidth: number;
  stationStep: number;
  trackPadX: number;
  trackEndPad: number;
  trackMinHeight: number;
  cardGap: number;
  nodeRadius: number;
  lineGap: number;
  trackPaddingY: number;
  standardCardH: number;
  scoutingCardH: number;
  strokeWidth: number;
};

const MOBILE_METRO_METRICS: MetroLayoutMetrics = {
  stationCardWidth: 216,
  stationStep: 252,
  trackPadX: 216 / 2 + 24,
  trackEndPad: 24,
  trackMinHeight: 240,
  cardGap: 10,
  nodeRadius: 10,
  lineGap: 56,
  trackPaddingY: 4,
  standardCardH: 142,
  scoutingCardH: 214,
  strokeWidth: 7,
};

const DESKTOP_METRO_METRICS: MetroLayoutMetrics = {
  stationCardWidth: 168,
  stationStep: 184,
  trackPadX: 168 / 2 + 16,
  trackEndPad: 16,
  trackMinHeight: 168,
  cardGap: 6,
  nodeRadius: 7,
  lineGap: 40,
  trackPaddingY: 2,
  standardCardH: 100,
  scoutingCardH: 156,
  strokeWidth: 5,
};

function metroMetricsFor(variant: OperationsMetroVariant): MetroLayoutMetrics {
  return variant === "desktop" ? DESKTOP_METRO_METRICS : MOBILE_METRO_METRICS;
}

const METRO_LINE_COLORS = [
  {
    id: "amber",
    stroke: "#f97316",
    ring: "border-orange-500",
    glow: "shadow-orange-500/30",
    fill: "bg-orange-500",
  },
  {
    id: "emerald",
    stroke: "#34d399",
    ring: "border-emerald-500",
    glow: "shadow-emerald-500/30",
    fill: "bg-emerald-500",
  },
  {
    id: "sky",
    stroke: "#38bdf8",
    ring: "border-sky-500",
    glow: "shadow-sky-500/30",
    fill: "bg-sky-500",
  },
  {
    id: "violet",
    stroke: "#a78bfa",
    ring: "border-violet-500",
    glow: "shadow-violet-500/30",
    fill: "bg-violet-500",
  },
  {
    id: "rose",
    stroke: "#fb7185",
    ring: "border-rose-500",
    glow: "shadow-rose-500/30",
    fill: "bg-rose-500",
  },
] as const;

const METRO_PLANNED_LINE_STROKE = "#38bdf8";

const uahFormatter = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

const uahFormatterPrecise = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 2,
});

function formatAreaHa(areaHa: number): string {
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: areaHa >= 100 ? 0 : 1,
  }).format(areaHa)} га`;
}

function formatStationDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM", { locale: uk });
}

function formatUah(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return uahFormatter.format(value);
}

function formatCostUah(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return uahFormatterPrecise.format(value);
}

function eventTypeLabel(type: UnifiedTimelineEventType): string {
  switch (type) {
    case "equipment":
      return "Техніка";
    case "inventory":
      return "ТМЦ";
    case "scouting":
      return "Скаутинг";
  }
}

function eventTypeTone(type: UnifiedTimelineEventType): string {
  switch (type) {
    case "equipment":
      return "text-orange-400/90";
    case "scouting":
      return "text-blue-400/90";
    case "inventory":
      return "text-emerald-400/90";
  }
}

function eventIcon(
  icon: UnifiedTimelineIcon,
  type: UnifiedTimelineEventType
) {
  const tone =
    type === "equipment"
      ? "text-orange-400"
      : type === "scouting"
        ? "text-blue-400"
        : "text-emerald-400";

  if (type === "equipment") {
    return <Tractor className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
  }
  if (type === "scouting") {
    return <Search className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
  }
  switch (icon) {
    case "wheat":
      return <Sprout className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
    case "flask":
      return (
        <FlaskConical className={cn("size-3.5 shrink-0", tone)} aria-hidden />
      );
    default:
      return <Package className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
  }
}

function estimateStationCardHeight(
  event: UnifiedTimelineEvent,
  metrics: MetroLayoutMetrics
): number {
  if (event.type !== "scouting") {
    const withStatus = isFutureTimelineOperation(event) ? 20 : 0;
    return metrics.standardCardH + withStatus;
  }

  let height = 16;
  height += metrics === DESKTOP_METRO_METRICS ? 64 : 86;
  if (event.notes?.trim()) height += metrics === DESKTOP_METRO_METRICS ? 28 : 34;
  else height += metrics === DESKTOP_METRO_METRICS ? 12 : 16;
  height += metrics === DESKTOP_METRO_METRICS ? 20 : 26;
  return Math.max(height, metrics.scoutingCardH);
}

function computeMetroTrackLayout(
  events: UnifiedTimelineEvent[],
  variant: OperationsMetroVariant = "mobile"
): {
  trackHeight: number;
  trackWidth: number;
  yPositions: number[];
  stationXs: number[];
  fullWidthLine: boolean;
  metrics: MetroLayoutMetrics;
} {
  const metrics = metroMetricsFor(variant);
  const {
    stationCardWidth,
    stationStep,
    trackPadX,
    trackEndPad,
    trackMinHeight,
    cardGap,
    nodeRadius,
    lineGap,
    trackPaddingY,
  } = metrics;

  if (events.length === 0) {
    return {
      trackHeight: trackMinHeight,
      trackWidth: stationCardWidth + trackEndPad * 2,
      yPositions: [],
      stationXs: [],
      fullWidthLine: false,
      metrics,
    };
  }

  if (events.length === 1) {
    const cardHeight = estimateStationCardHeight(events[0]!, metrics);
    const y = trackPaddingY + cardHeight + cardGap + nodeRadius;
    const normalizedWidth = 1000;
    return {
      trackHeight: y + nodeRadius + trackPaddingY,
      trackWidth: normalizedWidth,
      yPositions: [y],
      stationXs: [normalizedWidth / 2],
      fullWidthLine: true,
      metrics,
    };
  }

  let maxAbove = 0;
  let maxBelow = 0;

  for (let index = 0; index < events.length; index++) {
    const height = estimateStationCardHeight(events[index]!, metrics);
    if (index % 2 === 0) {
      maxAbove = Math.max(maxAbove, height);
    } else {
      maxBelow = Math.max(maxBelow, height);
    }
  }

  const lineYTop = trackPaddingY + maxAbove + cardGap + nodeRadius;
  const lineYBottom = lineYTop + lineGap;
  const trackHeight = lineYBottom + cardGap + maxBelow + trackPaddingY;
  const stationXs = events.map((_, index) => trackPadX + index * stationStep);
  const lastStationX = stationXs[stationXs.length - 1] ?? trackPadX;
  const trackWidth =
    lastStationX + stationCardWidth / 2 + trackEndPad;

  const yPositions = events.map((_, index) =>
    index % 2 === 0 ? lineYTop : lineYBottom
  );

  return { trackHeight, trackWidth, yPositions, stationXs, fullWidthLine: false, metrics };
}

function buildMetroPathSegments(
  yPositions: number[],
  stationXs: number[],
  trackWidth: number,
  events: UnifiedTimelineEvent[]
): { d: string; sky: boolean }[] {
  const count = stationXs.length;
  if (count === 0) return [];

  const isFutureAt = (index: number) =>
    isFutureTimelineOperation(events[index]!);

  const y0 = yPositions[0] ?? 0;
  const x0 = stationXs[0] ?? 0;

  if (count === 1) {
    return [{ d: `M 0 ${y0} H ${trackWidth}`, sky: isFutureAt(0) }];
  }

  const segments: { d: string; sky: boolean }[] = [
    { d: `M 0 ${y0} H ${x0}`, sky: isFutureAt(0) },
  ];

  for (let i = 1; i < count; i++) {
    const xPrev = stationXs[i - 1] ?? x0;
    const x1 = stationXs[i] ?? x0;
    const yPrev = yPositions[i - 1] ?? y0;
    const y1 = yPositions[i] ?? y0;
    const midX = (xPrev + x1) / 2;
    segments.push({
      d: `M ${xPrev} ${yPrev} H ${midX - 10} Q ${midX} ${yPrev} ${midX} ${(yPrev + y1) / 2} Q ${midX} ${y1} ${midX + 10} ${y1} H ${x1}`,
      sky: isFutureAt(i),
    });
  }

  const xLast = stationXs[count - 1] ?? x0;
  const yLast = yPositions[count - 1] ?? y0;
  segments.push({
    d: `M ${xLast} ${yLast} H ${trackWidth}`,
    sky: isFutureAt(count - 1),
  });

  return segments;
}

function MetroStationDateRow({ event }: { event: UnifiedTimelineEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <time
        className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase"
        dateTime={timelineEventDateIso(event.date)}
      >
        {formatStationDate(event.date)}
      </time>
      <OperationsWeatherBadge weatherContext={event.weatherContext} />
    </div>
  );
}

function MetroStationCard({
  event,
  onClick,
  compact = false,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
  compact?: boolean;
}) {
  const icon = deriveTimelineIcon(event);
  const isFuture = isFutureTimelineOperation(event);
  const statusLabel = timelineOperationStatusLabel(event.operationStatus);
  const cardWidth = compact ? "w-[10.5rem]" : "w-[13.5rem]";
  const cardPad = compact ? "p-2" : "p-2.5";
  const cardRadius = compact ? "rounded-xl" : "rounded-2xl";

  if (event.type === "scouting") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={cn(
          "relative z-10 cursor-pointer touch-pan-xy border border-white/10 bg-white/[0.07] text-left shadow-[0_12px_40px_-20px_rgba(0,0,0,0.85)] backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.12] active:scale-[0.98]",
          cardWidth,
          cardPad,
          cardRadius
        )}
      >
        <MetroStationDateRow event={event} />

        <OperationsTimelineImageThumb
          src={event.imageUrl}
          variant="dark"
          compact
          onBeforeExpand={(e) => {
            e.stopPropagation();
            if ("preventDefault" in e) e.preventDefault();
          }}
        />

        {event.notes ? (
          <p
            className={cn(
              "line-clamp-2 leading-snug text-zinc-300",
              compact ? "mt-1 text-[10px]" : "mt-1.5 text-[11px]"
            )}
          >
            {event.notes}
          </p>
        ) : (
          <p
            className={cn(
              "truncate font-semibold text-zinc-50",
              compact ? "mt-1 text-xs" : "mt-1.5 text-sm"
            )}
          >
            {event.title}
          </p>
        )}

        <p
          className={cn(
            "font-bold tracking-[0.14em] uppercase",
            compact ? "mt-1 text-[9px]" : "mt-1.5 text-[10px]",
            eventTypeTone(event.type)
          )}
        >
          {eventTypeLabel(event.type)}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 touch-pan-xy text-left backdrop-blur-md transition active:scale-[0.98]",
        cardWidth,
        cardPad,
        cardRadius,
        isFuture &&
          "border-dashed border-sky-400/45 bg-sky-500/[0.08] shadow-[0_12px_40px_-20px_rgba(14,116,144,0.45)] ring-1 ring-sky-400/15",
        !isFuture &&
          "border border-white/10 bg-white/[0.07] shadow-[0_12px_40px_-20px_rgba(0,0,0,0.85)] hover:border-white/20 hover:bg-white/[0.12]"
      )}
    >
      <MetroStationDateRow event={event} />

      {statusLabel ? (
        <p
          className={cn(
            "inline-flex rounded-full border border-sky-400/30 bg-sky-500/15 font-bold tracking-[0.12em] text-sky-200 uppercase",
            compact
              ? "mt-1 px-1.5 py-0 text-[9px]"
              : "mt-1.5 px-2 py-0.5 text-[10px]"
          )}
        >
          {statusLabel}
        </p>
      ) : null}

      <div
        className={cn(
          "flex items-start justify-between gap-2",
          statusLabel ? (compact ? "mt-1" : "mt-1.5") : compact ? "mt-1" : "mt-1.5"
        )}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          {eventIcon(icon, event.type)}
          <div className="min-w-0">
            <p
              className={cn(
                "truncate font-semibold text-zinc-50",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {event.title}
            </p>
            <p
              className={cn(
                "truncate text-zinc-400",
                compact ? "text-[10px]" : "text-[11px]"
              )}
            >
              {event.subtitle}
            </p>
          </div>
        </div>
        <p
          className={cn(
            "shrink-0 font-bold text-zinc-100 tabular-nums",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {event.metric ?? "—"}
        </p>
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-2",
          compact ? "mt-1" : "mt-1.5"
        )}
      >
        <p
          className={cn(
            "font-bold tracking-[0.14em] uppercase",
            compact ? "text-[9px]" : "text-[10px]",
            eventTypeTone(event.type)
          )}
        >
          {eventTypeLabel(event.type)}
        </p>
        <p
          className={cn(
            "font-semibold tabular-nums",
            compact ? "text-[9px]" : "text-[10px]",
            isFuture ? "text-sky-300/80" : "text-red-400/80"
          )}
        >
          {isFuture ? "план" : formatCostUah(event.cost)}
        </p>
      </div>
    </button>
  );
}

function MetroTrackScroll({
  className,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;

      const { deltaY, deltaX } = event;
      const dominantVertical = Math.abs(deltaY) >= Math.abs(deltaX);
      if (!dominantVertical || deltaY === 0) return;

      event.preventDefault();
      event.stopPropagation();
      el.scrollLeft += deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={scrollRef} className={className} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

function MetroFieldLine({
  item,
  lineIndex,
  onEventClick,
  onAddClick,
  variant = "mobile",
}: {
  item: FieldWithTimeline;
  lineIndex: number;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
  variant?: OperationsMetroVariant;
}) {
  const field = toTimelineField(item);
  const fieldAccent = normalizeFieldLineColor(item.color);
  const line = METRO_LINE_COLORS[lineIndex % METRO_LINE_COLORS.length]!;
  const compact = variant === "desktop";

  const events = useMemo(
    () => [...item.events].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [item.events]
  );

  const { trackHeight, trackWidth, yPositions, stationXs, fullWidthLine, metrics } =
    useMemo(() => computeMetroTrackLayout(events, variant), [events, variant]);
  const metroSegments = buildMetroPathSegments(
    yPositions,
    stationXs,
    trackWidth,
    events
  );

  return (
    <AccordionItem
      id={`metro-field-${item.fieldId}`}
      value={item.fieldId}
      className={cn(
        "overflow-hidden border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent",
        compact ? "rounded-2xl" : "rounded-3xl"
      )}
    >
      <AccordionTrigger
        id={`metro-field-trigger-${item.fieldId}`}
        className={cn(
          "group w-full border-b border-white/5 hover:bg-white/[0.03] hover:no-underline [&>svg]:hidden",
          compact ? "px-3 py-2" : "px-4 py-3"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pr-2 sm:gap-3">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex shrink-0 rounded-full",
                  compact ? "h-2 w-6" : "h-2.5 w-8"
                )}
                style={{ backgroundColor: fieldAccent }}
                aria-hidden
              />
              <h3
                className={cn(
                  "truncate font-semibold tracking-tight text-zinc-50",
                  compact ? "text-sm" : "text-base"
                )}
              >
                {item.fieldName}
              </h3>
            </div>
            <p className={cn("text-zinc-400", compact ? "mt-0.5 text-[11px]" : "mt-1 text-xs")}>
              {normalizeFieldCrop(item.cropName) || TIMELINE_NO_CROP_LABEL}
              <span className="mx-1.5 opacity-40">·</span>
              {formatAreaHa(item.area)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="hidden text-right sm:block">
              <p
                className={cn(
                  "font-semibold text-red-400/90 tabular-nums",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {formatUah(item.totalCost)}
              </p>
              <p className="text-[10px] text-zinc-500 tabular-nums">
                {item.area > 0 && item.totalCost > 0
                  ? `${formatCostUah(item.costPerHectare)}/га`
                  : "—/га"}
              </p>
            </div>

            <span
              className={cn(
                "rounded-full border border-white/10 bg-black/20 font-semibold text-zinc-300 tabular-nums",
                compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
              )}
            >
              {ukStationLabel(events.length)}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddClick?.(field);
              }}
              className={cn(
                "inline-flex items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 transition hover:bg-emerald-500/25",
                compact ? "size-8" : "size-9"
              )}
              aria-label={`Додати позицію для ${item.fieldName}`}
            >
              <Plus className={compact ? "size-3.5" : "size-4"} />
            </button>

            <ChevronDown
              className={cn(
                "shrink-0 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180",
                compact ? "size-4" : "size-5"
              )}
            />
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="pb-0 touch-pan-y [&>div]:pb-1">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm italic text-zinc-500">
              Історія операцій порожня
            </p>
            <button
              type="button"
              onClick={() => onAddClick?.(field)}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
            >
              <Plus className="size-4" />
              Додати першу позицію
            </button>
          </div>
        ) : (
          <div
            className="relative overflow-hidden"
            style={{ overscrollBehaviorX: "contain" }}
          >
            <MetroTrackScroll
              className="ops-track-scroll overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-xy px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label={`Хронологія поля ${item.fieldName}`}
            >
              <div
                className={cn(
                  "relative",
                  fullWidthLine ? "w-full" : "mx-auto"
                )}
                style={{
                  width: fullWidthLine ? "100%" : trackWidth,
                  height: trackHeight,
                  minHeight: trackHeight,
                }}
              >
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={fullWidthLine ? "100%" : trackWidth}
                  height={trackHeight}
                  viewBox={
                    fullWidthLine ? `0 0 ${trackWidth} ${trackHeight}` : undefined
                  }
                  preserveAspectRatio={fullWidthLine ? "none" : undefined}
                  aria-hidden
                >
                  <defs>
                    <filter id={`glow-${line.id}-${lineIndex}`}>
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {metroSegments.map((segment, index) => (
                    <path
                      key={index}
                      d={segment.d}
                      fill="none"
                      stroke={
                        segment.sky ? METRO_PLANNED_LINE_STROKE : line.stroke
                      }
                      strokeWidth={metrics.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.95}
                      filter={`url(#glow-${line.id}-${lineIndex})`}
                    />
                  ))}
                </svg>

                {events.map((event, index) => {
                  const x = stationXs[index] ?? 0;
                  const y = yPositions[index] ?? 0;
                  const cardAbove = index % 2 === 0;
                  const stationLeft = fullWidthLine ? "50%" : x;
                  const isFuture = isFutureTimelineOperation(event);

                  return (
                    <div
                      key={event.id}
                      className="absolute top-0 left-0"
                      style={{
                        left: stationLeft,
                        transform: "translateX(-50%)",
                        width: 0,
                        height: trackHeight,
                      }}
                    >
                      <span
                        className={cn(
                          "absolute left-1/2 z-10 -translate-x-1/2 rounded-full border-[3px] shadow-lg",
                          compact ? "size-3.5" : "size-5",
                          isFuture
                            ? "border-sky-400 bg-zinc-950"
                            : "bg-zinc-950",
                          !isFuture && line.ring,
                          !isFuture && line.glow
                        )}
                        style={{ top: y - metrics.nodeRadius }}
                      />

                      <div
                        className="absolute left-1/2 -translate-x-1/2"
                        style={
                          cardAbove
                            ? {
                                bottom:
                                  trackHeight -
                                  y +
                                  metrics.cardGap +
                                  metrics.nodeRadius,
                              }
                            : {
                                top: y + metrics.cardGap + metrics.nodeRadius,
                              }
                        }
                      >
                        <MetroStationCard
                          event={event}
                          compact={compact}
                          onClick={() => onEventClick?.(field, event)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </MetroTrackScroll>

            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-zinc-950/90 to-transparent"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-zinc-950/90 to-transparent"
              aria-hidden
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function CropCategoryCard({
  group,
  onSelect,
  active = false,
  compact = false,
}: {
  group: TimelineCropGroup;
  onSelect: () => void;
  active?: boolean;
  compact?: boolean;
}) {
  const description =
    group.label === TIMELINE_NO_CROP_LABEL
      ? "Поля без культури в паспорті"
      : `${ukFieldLabel(group.fieldCount)} · ${ukStationLabel(group.stationCount)}`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full rounded-xl border px-3 py-2.5 text-left transition",
          active
            ? "border-white/20 bg-white/10 ring-1 ring-white/10"
            : "border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]"
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="h-9 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: group.accentColor }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {group.label}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{description}</p>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 text-left transition",
        "bg-white/5 backdrop-blur-md",
        "hover:border-white/15 hover:bg-white/[0.07] active:scale-[0.99]"
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background: `linear-gradient(135deg, ${group.accentColor}33 0%, transparent 55%)`,
        }}
      />
      <div className="relative flex items-center gap-4 p-4">
        <span
          className="flex h-14 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.accentColor }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-medium tracking-tight text-zinc-100">
            {group.label}
          </h3>
          <p className="mt-1 text-sm text-zinc-400">{description}</p>
          <p className="mt-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {formatAreaHa(group.totalAreaHa)} загалом
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300" />
      </div>
    </button>
  );
}

function scrollChronicleFieldHeaderIntoView(fieldId: string) {
  const trigger = document.getElementById(`metro-field-trigger-${fieldId}`);
  if (!trigger) return;

  const scrollContainer =
    trigger.closest<HTMLElement>("[data-chronicle-scroll]") ??
    document.querySelector<HTMLElement>("[data-chronicle-scroll]");

  const alignToScrollTop = (behavior: ScrollBehavior = "smooth") => {
    if (!scrollContainer) {
      trigger.scrollIntoView({ behavior, block: "start", inline: "nearest" });
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const targetTop =
      scrollContainer.scrollTop + (triggerRect.top - containerRect.top);

    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
  };

  alignToScrollTop("auto");
  window.requestAnimationFrame(() => {
    alignToScrollTop("smooth");
    window.setTimeout(() => alignToScrollTop("smooth"), 120);
    window.setTimeout(() => alignToScrollTop("smooth"), 320);
  });
}

function MetroFieldsAccordion({
  fields,
  onEventClick,
  onAddClick,
  variant = "mobile",
}: {
  fields: FieldWithTimeline[];
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
  variant?: OperationsMetroVariant;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const openIdsRef = useRef(openIds);
  const pendingScrollFieldIdRef = useRef<string | null>(null);

  openIdsRef.current = openIds;

  const handleOpenChange = useCallback((next: string[]) => {
    const opened = next.filter((id) => !openIdsRef.current.includes(id));
    setOpenIds(next);
    if (opened.length > 0) {
      pendingScrollFieldIdRef.current = opened[opened.length - 1]!;
    }
  }, []);

  useLayoutEffect(() => {
    const fieldId = pendingScrollFieldIdRef.current;
    if (!fieldId || !openIds.includes(fieldId)) return;
    pendingScrollFieldIdRef.current = null;
    scrollChronicleFieldHeaderIntoView(fieldId);
  }, [openIds]);

  useEffect(() => {
    if (fields.length === 0) {
      setOpenIds([]);
      return;
    }
    setOpenIds((prev) => prev.filter((id) => fields.some((item) => item.fieldId === id)));
  }, [fields]);

  return (
    <Accordion
      type="multiple"
      value={openIds}
      onValueChange={handleOpenChange}
      className={cn("space-y-3", variant === "desktop" && "space-y-2")}
    >
      {fields.map((item, index) => (
        <MetroFieldLine
          key={item.fieldId}
          item={item}
          lineIndex={index}
          variant={variant}
          onEventClick={onEventClick}
          onAddClick={onAddClick}
        />
      ))}
    </Accordion>
  );
}

function MetroMapSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Завантаження карти">
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          className="h-56 w-full animate-pulse rounded-3xl border border-white/5 bg-white/10"
        />
      ))}
    </div>
  );
}

export function OperationsMetroMap({
  fields,
  isLoading,
  searchQuery = "",
  variant = "mobile",
  onEventClick,
  onAddClick,
}: {
  fields: FieldWithTimeline[];
  isLoading: boolean;
  searchQuery?: string;
  variant?: OperationsMetroVariant;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  const desktop = variant === "desktop";
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const cropGroups = useMemo(() => groupTimelineByCrop(fields), [fields]);
  const isSearchMode = Boolean(searchQuery.trim());

  useEffect(() => {
    setSelectedCropId(null);
  }, [fields, searchQuery]);

  useEffect(() => {
    if (!desktop || isSearchMode || cropGroups.length === 0) return;
    setSelectedCropId((prev) => prev ?? cropGroups[0]!.id);
  }, [desktop, isSearchMode, cropGroups]);

  if (isLoading) return <MetroMapSkeleton />;

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 px-6 py-14 text-center backdrop-blur-md">
        <Search className="mb-4 size-10 text-zinc-600" aria-hidden />
        <p className="text-sm font-medium text-zinc-300">Активних полів не знайдено</p>
        <p className="mt-1 text-xs text-zinc-500">
          Спробуйте інший пошук або період
        </p>
      </div>
    );
  }

  if (isSearchMode) {
    if (desktop) {
      return (
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-auto"
          data-chronicle-scroll
        >
          <MetroFieldsAccordion
            fields={fields}
            variant={variant}
            onEventClick={onEventClick}
            onAddClick={onAddClick}
          />
        </div>
      );
    }

    return (
      <MetroFieldsAccordion
        fields={fields}
        variant={variant}
        onEventClick={onEventClick}
        onAddClick={onAddClick}
      />
    );
  }

  const activeGroup =
    cropGroups.find((group) => group.id === selectedCropId) ?? cropGroups[0] ?? null;

  const fieldsPanel = (
    <MetroFieldsAccordion
      fields={activeGroup?.fields ?? fields}
      variant={variant}
      onEventClick={onEventClick}
      onAddClick={onAddClick}
    />
  );

  if (desktop) {
    return (
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col gap-2 self-stretch border-r border-white/5 bg-zinc-950 pr-4">
          <p className="shrink-0 px-1 text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Культури
          </p>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-y-contain">
            {cropGroups.map((group) => (
              <CropCategoryCard
                key={group.id}
                group={group}
                compact
                active={activeGroup?.id === group.id}
                onSelect={() => setSelectedCropId(group.id)}
              />
            ))}
          </div>
        </aside>

        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-auto"
          data-chronicle-scroll
        >
          {fieldsPanel}
        </div>
      </div>
    );
  }

  if (!selectedCropId) {
    return (
      <div className="space-y-3">
        <p className="px-1 text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          Культури
        </p>
        {cropGroups.map((group) => (
          <CropCategoryCard
            key={group.id}
            group={group}
            onSelect={() => setSelectedCropId(group.id)}
          />
        ))}
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <MetroFieldsAccordion
        fields={fields}
        variant={variant}
        onEventClick={onEventClick}
        onAddClick={onAddClick}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setSelectedCropId(null)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
      >
        <ChevronLeft className="size-4" />
        Усі культури
      </button>

      <div
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md"
        style={{
          background: `linear-gradient(135deg, ${activeGroup.accentColor}18 0%, rgba(255,255,255,0.03) 70%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="h-10 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: activeGroup.accentColor }}
          />
          <div>
            <h2 className="text-base font-medium text-zinc-100">
              {activeGroup.label}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {ukFieldLabel(activeGroup.fieldCount)} ·{" "}
              {ukStationLabel(activeGroup.stationCount)} ·{" "}
              {formatAreaHa(activeGroup.totalAreaHa)}
            </p>
          </div>
        </div>
      </div>

      {fieldsPanel}
    </div>
  );
}

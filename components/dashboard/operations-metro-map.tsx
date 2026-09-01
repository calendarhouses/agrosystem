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
import { useEffect, useMemo, useState } from "react";

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
  timelineEventDateIso,
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

const STATION_CARD_WIDTH = 216;
const STATION_STEP = 252;
const TRACK_PAD_X = STATION_CARD_WIDTH / 2 + 24;
const METRO_TRACK_MIN_HEIGHT = 420;
const METRO_CARD_GAP = 20;
const METRO_NODE_RADIUS = 10;
const METRO_NODE_OUTER_RADIUS = 13;
const METRO_LINE_GAP = 88;
const METRO_TRACK_PADDING_Y = 16;
const METRO_STANDARD_CARD_H = 148;
const METRO_SCOUTING_CARD_H = 268;
const METRO_CURVE_BEND = 0.52;
const METRO_VERTICAL_BEND = 0.42;

const METRO_LINE_COLORS = [
  {
    id: "amber",
    stroke: "#f97316",
    strokeBright: "#fdba74",
    strokeDim: "#c2410c",
    glowRgb: "249, 115, 22",
    ring: "border-orange-500",
    glow: "shadow-orange-500/30",
    fill: "bg-orange-500",
  },
  {
    id: "emerald",
    stroke: "#34d399",
    strokeBright: "#6ee7b7",
    strokeDim: "#059669",
    glowRgb: "52, 211, 153",
    ring: "border-emerald-500",
    glow: "shadow-emerald-500/30",
    fill: "bg-emerald-500",
  },
  {
    id: "sky",
    stroke: "#38bdf8",
    strokeBright: "#7dd3fc",
    strokeDim: "#0284c7",
    glowRgb: "56, 189, 248",
    ring: "border-sky-500",
    glow: "shadow-sky-500/30",
    fill: "bg-sky-500",
  },
  {
    id: "violet",
    stroke: "#a78bfa",
    strokeBright: "#c4b5fd",
    strokeDim: "#7c3aed",
    glowRgb: "167, 139, 250",
    ring: "border-violet-500",
    glow: "shadow-violet-500/30",
    fill: "bg-violet-500",
  },
  {
    id: "rose",
    stroke: "#fb7185",
    strokeBright: "#fda4af",
    strokeDim: "#e11d48",
    glowRgb: "251, 113, 133",
    ring: "border-rose-500",
    glow: "shadow-rose-500/30",
    fill: "bg-rose-500",
  },
] as const;

type MetroLineColor = (typeof METRO_LINE_COLORS)[number];

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

function eventTypeTone(
  type: UnifiedTimelineEventType,
  desktop: boolean
): string {
  switch (type) {
    case "equipment":
      return desktop ? "text-orange-600" : "text-orange-400/90";
    case "scouting":
      return desktop ? "text-blue-600" : "text-blue-400/90";
    case "inventory":
      return desktop ? "text-emerald-700" : "text-emerald-400/90";
  }
}

function eventIcon(
  icon: UnifiedTimelineIcon,
  type: UnifiedTimelineEventType,
  desktop: boolean
) {
  const tone =
    type === "equipment"
      ? desktop
        ? "text-orange-600"
        : "text-orange-400"
      : type === "scouting"
        ? desktop
          ? "text-blue-600"
          : "text-blue-400"
        : desktop
          ? "text-emerald-700"
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

function estimateStationCardHeight(event: UnifiedTimelineEvent): number {
  if (event.type !== "scouting") return METRO_STANDARD_CARD_H;

  let height = 108;
  height += 104;
  if (event.notes?.trim()) height += 40;
  else height += 22;
  return Math.max(height, METRO_SCOUTING_CARD_H);
}

function computeMetroTrackLayout(events: UnifiedTimelineEvent[]): {
  trackHeight: number;
  yPositions: number[];
} {
  if (events.length === 0) {
    return { trackHeight: METRO_TRACK_MIN_HEIGHT, yPositions: [] };
  }

  let maxAbove = 0;
  let maxBelow = 0;

  for (let index = 0; index < events.length; index++) {
    const height = estimateStationCardHeight(events[index]!);
    if (index % 2 === 0) {
      maxAbove = Math.max(maxAbove, height);
    } else {
      maxBelow = Math.max(maxBelow, height);
    }
  }

  const lineYTop =
    METRO_TRACK_PADDING_Y +
    maxAbove +
    METRO_CARD_GAP +
    METRO_NODE_RADIUS;
  const lineYBottom = lineYTop + METRO_LINE_GAP;
  const trackHeight = Math.max(
    METRO_TRACK_MIN_HEIGHT,
    lineYBottom + METRO_CARD_GAP + maxBelow + METRO_TRACK_PADDING_Y
  );

  const yPositions = events.map((_, index) =>
    index % 2 === 0 ? lineYTop : lineYBottom
  );

  return { trackHeight, yPositions };
}

function metroStationX(index: number): number {
  return TRACK_PAD_X + index * STATION_STEP;
}

function cubicBezierSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bend = METRO_CURVE_BEND
): string {
  const dx = (x1 - x0) * bend;
  return `C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`;
}

function verticalBezierSegment(
  x: number,
  y0: number,
  y1: number,
  bend = METRO_VERTICAL_BEND
): string {
  const dy = (y1 - y0) * bend;
  return `C ${x} ${y0 + dy}, ${x} ${y1 - dy}, ${x} ${y1}`;
}

function buildMetroPath(
  count: number,
  yPositions: number[],
  trackHeight: number
): string {
  if (count === 0) return "";

  const x0 = metroStationX(0);
  const y0 = yPositions[0] ?? 0;
  const parts: string[] = [`M ${x0} 0`, verticalBezierSegment(x0, 0, y0)];

  for (let i = 1; i < count; i++) {
    parts.push(
      cubicBezierSegment(
        metroStationX(i - 1),
        yPositions[i - 1] ?? y0,
        metroStationX(i),
        yPositions[i] ?? y0
      )
    );
  }

  const xLast = metroStationX(count - 1);
  const yLast = yPositions[count - 1] ?? y0;
  parts.push(verticalBezierSegment(xLast, yLast, trackHeight));

  return parts.join(" ");
}

function MetroTrackSvg({
  line,
  lineIndex,
  trackWidth,
  trackHeight,
  metroPath,
  stationCount,
}: {
  line: MetroLineColor;
  lineIndex: number;
  trackWidth: number;
  trackHeight: number;
  metroPath: string;
  stationCount: number;
}) {
  const gradId = `metro-grad-${line.id}-${lineIndex}`;
  const bloomId = `metro-bloom-${line.id}-${lineIndex}`;
  const xEnd = metroStationX(Math.max(stationCount - 1, 0));

  if (!metroPath) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={trackWidth}
      height={trackHeight}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={metroStationX(0)}
          y1={0}
          x2={xEnd || metroStationX(0)}
          y2={trackHeight}
        >
          <stop offset="0%" stopColor={line.strokeDim} stopOpacity={0.2} />
          <stop offset="8%" stopColor={line.strokeBright} stopOpacity={0.95} />
          <stop offset="45%" stopColor={line.stroke} stopOpacity={1} />
          <stop offset="55%" stopColor="#ffffff" stopOpacity={0.92} />
          <stop offset="92%" stopColor={line.strokeBright} stopOpacity={0.95} />
          <stop offset="100%" stopColor={line.strokeDim} stopOpacity={0.2} />
        </linearGradient>

        <filter
          id={bloomId}
          x="-60%"
          y="-40%"
          width="220%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="10" result="bloomWide" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="bloomMid" />
          <feMerge>
            <feMergeNode in="bloomWide" />
            <feMergeNode in="bloomMid" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g
        style={{
          filter: `drop-shadow(0 0 10px rgba(${line.glowRgb}, 0.75)) drop-shadow(0 0 22px rgba(${line.glowRgb}, 0.4)) drop-shadow(0 0 40px rgba(${line.glowRgb}, 0.18))`,
        }}
      >
        <path
          d={metroPath}
          fill="none"
          stroke={line.stroke}
          strokeWidth={22}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.1}
        />
        <path
          d={metroPath}
          fill="none"
          stroke={line.strokeBright}
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.22}
        />
        <path
          d={metroPath}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${bloomId})`}
        />
        <path
          d={metroPath}
          fill="none"
          stroke="#ffffff"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
      </g>
    </svg>
  );
}

function MetroStationDateRow({
  event,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  desktop?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <time
        className={cn(
          "text-[10px] font-semibold tracking-wide uppercase",
          desktop ? "text-zinc-400" : "text-zinc-500"
        )}
        dateTime={timelineEventDateIso(event.date)}
      >
        {formatStationDate(event.date)}
      </time>
      <OperationsWeatherBadge
        weatherContext={event.weatherContext}
        desktop={desktop}
      />
    </div>
  );
}

function MetroStationCard({
  event,
  onClick,
  desktop = false,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
  desktop?: boolean;
}) {
  const icon = deriveTimelineIcon(event);

  if (event.type === "scouting") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative z-10 w-[13.5rem] touch-pan-xy rounded-2xl border p-3 text-left backdrop-blur-md transition active:scale-[0.98]",
          desktop
            ? "border-[#E5DFD3]/90 bg-white/95 shadow-sm hover:border-blue-200 hover:shadow-md"
            : "border-white/10 bg-white/[0.07] shadow-[0_12px_40px_-20px_rgba(0,0,0,0.85)] hover:border-white/20 hover:bg-white/[0.12]"
        )}
      >
        <MetroStationDateRow event={event} desktop={desktop} />

        <OperationsTimelineImageThumb
          src={event.imageUrl}
          variant={desktop ? "light" : "dark"}
        />

        {event.notes ? (
          <p
            className={cn(
              "mt-2 line-clamp-2 text-[11px] leading-relaxed",
              desktop ? "text-zinc-600" : "text-zinc-300"
            )}
          >
            {event.notes}
          </p>
        ) : (
          <p
            className={cn(
              "mt-2 truncate text-sm font-semibold",
              desktop ? "text-zinc-900" : "text-zinc-50"
            )}
          >
            {event.title}
          </p>
        )}

        <p
          className={cn(
            "mt-2 text-[10px] font-bold tracking-[0.14em] uppercase",
            eventTypeTone(event.type, desktop)
          )}
        >
          {eventTypeLabel(event.type)}
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 w-[13.5rem] touch-pan-xy rounded-2xl border p-3 text-left backdrop-blur-md transition active:scale-[0.98]",
        desktop
          ? "border-[#E5DFD3]/90 bg-white/95 shadow-sm hover:border-[#276749]/20 hover:shadow-md"
          : "border-white/10 bg-white/[0.07] shadow-[0_12px_40px_-20px_rgba(0,0,0,0.85)] hover:border-white/20 hover:bg-white/[0.12]"
      )}
    >
      <MetroStationDateRow event={event} desktop={desktop} />

      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {eventIcon(icon, event.type, desktop)}
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-sm font-semibold",
                desktop ? "text-zinc-900" : "text-zinc-50"
              )}
            >
              {event.title}
            </p>
            <p
              className={cn(
                "truncate text-[11px]",
                desktop ? "text-zinc-500" : "text-zinc-400"
              )}
            >
              {event.subtitle}
            </p>
          </div>
        </div>
        <p
          className={cn(
            "shrink-0 text-sm font-bold tabular-nums",
            desktop ? "text-zinc-900" : "text-zinc-100"
          )}
        >
          {event.metric ?? "—"}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-[10px] font-bold tracking-[0.14em] uppercase",
            eventTypeTone(event.type, desktop)
          )}
        >
          {eventTypeLabel(event.type)}
        </p>
        <p
          className={cn(
            "text-[10px] font-semibold tabular-nums",
            desktop ? "text-red-600/80" : "text-red-400/80"
          )}
        >
          {formatCostUah(event.cost)}
        </p>
      </div>
    </button>
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
  const desktop = variant === "desktop";
  const field = toTimelineField(item);
  const fieldAccent = normalizeFieldLineColor(item.color);
  const line = METRO_LINE_COLORS[lineIndex % METRO_LINE_COLORS.length]!;

  const events = useMemo(
    () => [...item.events].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [item.events]
  );

  const { trackHeight, yPositions } = useMemo(
    () => computeMetroTrackLayout(events),
    [events]
  );
  const trackWidth = Math.max(
    STATION_STEP * Math.max(events.length - 1, 0) + TRACK_PAD_X * 2,
    STATION_CARD_WIDTH + TRACK_PAD_X * 2
  );
  const metroPath = buildMetroPath(events.length, yPositions, trackHeight);

  return (
    <AccordionItem
      value={item.fieldId}
      className={cn(
        "overflow-visible rounded-3xl border",
        desktop
          ? "border-[#E5DFD3]/90 bg-white/80 shadow-sm"
          : "border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent"
      )}
    >
      <AccordionTrigger
        className={cn(
          "group w-full px-4 py-3 hover:no-underline [&>svg]:hidden",
          desktop
            ? "border-b border-[#E5DFD3]/80 hover:bg-white/60"
            : "border-b border-white/5 hover:bg-white/[0.03]"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pr-2">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-2.5 w-8 shrink-0 rounded-full"
                style={{ backgroundColor: fieldAccent }}
                aria-hidden
              />
              <h3
                className={cn(
                  "truncate text-base font-semibold tracking-tight",
                  desktop ? "text-zinc-900" : "text-zinc-50"
                )}
              >
                {item.fieldName}
              </h3>
            </div>
            <p
              className={cn(
                "mt-1 text-xs",
                desktop ? "text-zinc-500" : "text-zinc-400"
              )}
            >
              {normalizeFieldCrop(item.cropName) || TIMELINE_NO_CROP_LABEL}
              <span className="mx-1.5 opacity-40">·</span>
              {formatAreaHa(item.area)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right sm:block">
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  desktop ? "text-red-600/90" : "text-red-400/90"
                )}
              >
                {formatUah(item.totalCost)}
              </p>
              <p
                className={cn(
                  "text-[10px] tabular-nums",
                  desktop ? "text-zinc-400" : "text-zinc-500"
                )}
              >
                {item.area > 0 && item.totalCost > 0
                  ? `${formatCostUah(item.costPerHectare)}/га`
                  : "—/га"}
              </p>
            </div>

            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums",
                desktop
                  ? "border-[#E5DFD3] bg-[#F4F1EA] text-zinc-600"
                  : "border-white/10 bg-black/20 text-zinc-300"
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
                "inline-flex size-9 items-center justify-center rounded-full border transition",
                desktop
                  ? "border-emerald-600/20 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
              )}
              aria-label={`Додати позицію для ${item.fieldName}`}
            >
              <Plus className="size-4" />
            </button>

            <ChevronDown
              className={cn(
                "size-5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180",
                desktop ? "text-zinc-400" : "text-zinc-500"
              )}
            />
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="overflow-visible pb-0 touch-pan-y">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p
              className={cn(
                "text-sm italic",
                desktop ? "text-zinc-500" : "text-zinc-500"
              )}
            >
              Історія операцій порожня
            </p>
            <button
              type="button"
              onClick={() => onAddClick?.(field)}
              className={cn(
                "mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                desktop
                  ? "border-[#E5DFD3] bg-white text-zinc-700 hover:bg-[#F4F1EA]"
                  : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
              )}
            >
              <Plus className="size-4" />
              Додати першу позицію
            </button>
          </div>
        ) : (
          <div
            className="relative overflow-visible py-2"
            style={{ overscrollBehaviorX: "contain" }}
          >
            <div
              className="ops-track-scroll overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-xy px-1 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label={`Хронологія поля ${item.fieldName}`}
            >
              <div
                className="relative mx-auto overflow-visible"
                style={{
                  width: trackWidth,
                  height: trackHeight,
                  minHeight: trackHeight,
                }}
              >
                <MetroTrackSvg
                  line={line}
                  lineIndex={lineIndex}
                  trackWidth={trackWidth}
                  trackHeight={trackHeight}
                  metroPath={metroPath}
                  stationCount={events.length}
                />

                {events.map((event, index) => {
                  const x = metroStationX(index);
                  const y = yPositions[index] ?? 0;
                  const cardAbove = index % 2 === 0;

                  return (
                    <div
                      key={event.id}
                      className="absolute top-0 left-0"
                      style={{
                        left: x,
                        transform: "translateX(-50%)",
                        width: 0,
                        height: trackHeight,
                      }}
                    >
                      <span
                        className="absolute left-1/2 z-10 -translate-x-1/2"
                        style={{ top: y - METRO_NODE_RADIUS }}
                        aria-hidden
                      >
                        <span
                          className="relative flex items-center justify-center"
                          style={{
                            width: METRO_NODE_OUTER_RADIUS * 2 + 8,
                            height: METRO_NODE_OUTER_RADIUS * 2 + 8,
                          }}
                        >
                          <span
                            className="absolute inset-0 rounded-full"
                            style={{
                              background: `radial-gradient(circle, rgba(${line.glowRgb}, 0.55) 0%, rgba(${line.glowRgb}, 0.12) 55%, transparent 72%)`,
                            }}
                          />
                          <span
                            className={cn(
                              "relative block rounded-full border-[2.5px]",
                              desktop ? "bg-white" : "bg-zinc-950",
                              line.ring
                            )}
                            style={{
                              width: METRO_NODE_OUTER_RADIUS * 2,
                              height: METRO_NODE_OUTER_RADIUS * 2,
                              boxShadow: `0 0 10px rgba(${line.glowRgb}, 0.65), 0 0 20px rgba(${line.glowRgb}, 0.3), inset 0 0 6px rgba(255,255,255,0.25)`,
                            }}
                          >
                            <span
                              className="absolute inset-1 rounded-full"
                              style={{
                                background: `linear-gradient(145deg, ${line.strokeBright}, ${line.stroke})`,
                              }}
                            />
                            <span
                              className="absolute rounded-full bg-white"
                              style={{
                                width: 4,
                                height: 4,
                                top: 5,
                                left: 5,
                                opacity: 0.6,
                              }}
                            />
                          </span>
                        </span>
                      </span>

                      <div
                        className="absolute left-1/2 -translate-x-1/2"
                        style={
                          cardAbove
                            ? { bottom: trackHeight - y + METRO_CARD_GAP }
                            : { top: y + METRO_CARD_GAP }
                        }
                      >
                        <MetroStationCard
                          event={event}
                          desktop={desktop}
                          onClick={() => onEventClick?.(field, event)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent",
                desktop ? "from-[#F4F1EA]/95" : "from-zinc-950/90"
              )}
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
  variant = "mobile",
}: {
  group: TimelineCropGroup;
  onSelect: () => void;
  active?: boolean;
  variant?: OperationsMetroVariant;
}) {
  const desktop = variant === "desktop";
  const description =
    group.label === TIMELINE_NO_CROP_LABEL
      ? "Поля без культури в паспорті"
      : `${ukFieldLabel(group.fieldCount)} · ${ukStationLabel(group.stationCount)}`;

  if (desktop) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full rounded-xl border px-3 py-2.5 text-left transition",
          active
            ? "border-[#276749]/25 bg-white shadow-sm ring-1 ring-[#276749]/15"
            : "border-transparent hover:bg-white/70"
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="h-9 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: group.accentColor }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-zinc-900">
              {group.label}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {description}
            </p>
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
  const desktop = variant === "desktop";
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (fields.length === 0) {
      setOpenIds([]);
      return;
    }
    setOpenIds((prev) => {
      const valid = prev.filter((id) => fields.some((item) => item.fieldId === id));
      if (valid.length > 0) return valid;
      if (desktop) return fields.map((item) => item.fieldId);
      return [fields[0]!.fieldId];
    });
  }, [fields, desktop]);

  return (
    <Accordion
      type="multiple"
      value={openIds}
      onValueChange={setOpenIds}
      className={cn(desktop ? "space-y-4" : "space-y-3")}
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

function MetroMapSkeleton({ variant = "mobile" }: { variant?: OperationsMetroVariant }) {
  const desktop = variant === "desktop";
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Завантаження карти">
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-56 w-full animate-pulse rounded-3xl border",
            desktop
              ? "border-[#E5DFD3]/80 bg-white/60"
              : "border-white/5 bg-white/10"
          )}
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

  if (isLoading) return <MetroMapSkeleton variant={variant} />;

  if (fields.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center rounded-2xl border px-6 py-14 text-center",
          desktop
            ? "border-[#E5DFD3]/90 bg-white/70"
            : "border-white/10 bg-white/5 backdrop-blur-md"
        )}
      >
        <Search
          className={cn("mb-4 size-10", desktop ? "text-zinc-300" : "text-zinc-600")}
          aria-hidden
        />
        <p
          className={cn(
            "text-sm font-medium",
            desktop ? "text-zinc-600" : "text-zinc-300"
          )}
        >
          Активних полів не знайдено
        </p>
        <p
          className={cn(
            "mt-1 text-xs",
            desktop ? "text-zinc-500" : "text-zinc-500"
          )}
        >
          Спробуйте інший пошук або період
        </p>
      </div>
    );
  }

  if (isSearchMode) {
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
      <div className="flex h-full min-h-0 gap-5">
        <aside className="flex w-60 shrink-0 flex-col gap-3">
          <p className="px-1 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
            Культури
          </p>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {cropGroups.map((group) => (
              <CropCategoryCard
                key={group.id}
                group={group}
                variant="desktop"
                active={activeGroup?.id === group.id}
                onSelect={() => setSelectedCropId(group.id)}
              />
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          {activeGroup ? (
            <div
              className="shrink-0 rounded-2xl border border-[#E5DFD3]/90 bg-white/80 px-5 py-4 shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${activeGroup.accentColor}14 0%, rgba(255,255,255,0.92) 65%)`,
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-10 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: activeGroup.accentColor }}
                />
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">
                    {activeGroup.label}
                  </h2>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {ukFieldLabel(activeGroup.fieldCount)} ·{" "}
                    {ukStationLabel(activeGroup.stationCount)} ·{" "}
                    {formatAreaHa(activeGroup.totalAreaHa)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">{fieldsPanel}</div>
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

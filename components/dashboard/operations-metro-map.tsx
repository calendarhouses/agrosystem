"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  FlaskConical,
  Fuel,
  Package,
  Plus,
  Sprout,
  Tractor,
} from "lucide-react";
import { useMemo } from "react";

import { normalizeFieldCrop } from "@/components/dashboard/field-passport-form";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  FieldTimelineField,
  FieldWithTimeline,
  UnifiedTimelineEvent,
  UnifiedTimelineIcon,
} from "@/lib/field-timeline";
import { cn } from "@/lib/utils";

const STATION_STEP = 252;
const TRACK_PAD_X = 40;
const TRACK_HEIGHT = 360;
const LINE_Y_TOP = 148;
const LINE_Y_BOTTOM = 232;

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

function formatAreaHa(areaHa: number): string {
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: areaHa >= 100 ? 0 : 1,
  }).format(areaHa)} га`;
}

function formatStationDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM", { locale: uk });
}

function eventIcon(icon: UnifiedTimelineIcon, type: UnifiedTimelineEvent["type"]) {
  if (type === "equipment") {
    return <Tractor className="size-3.5 shrink-0 text-orange-400" aria-hidden />;
  }
  switch (icon) {
    case "wheat":
      return <Sprout className="size-3.5 shrink-0 text-emerald-400" aria-hidden />;
    case "flask":
      return <FlaskConical className="size-3.5 shrink-0 text-emerald-400" aria-hidden />;
    case "fuel":
      return <Fuel className="size-3.5 shrink-0 text-emerald-400" aria-hidden />;
    default:
      return <Package className="size-3.5 shrink-0 text-emerald-400" aria-hidden />;
  }
}

function buildMetroSegments(count: number, yPositions: number[]): string[] {
  if (count < 2) return [];
  const segments: string[] = [];
  for (let i = 1; i < count; i++) {
    const x0 = TRACK_PAD_X + (i - 1) * STATION_STEP;
    const x1 = TRACK_PAD_X + i * STATION_STEP;
    const y0 = yPositions[i - 1] ?? LINE_Y_TOP;
    const y1 = yPositions[i] ?? LINE_Y_BOTTOM;
    const midX = (x0 + x1) / 2;
    segments.push(
      `M ${x0} ${y0} H ${midX - 10} Q ${midX} ${y0} ${midX} ${(y0 + y1) / 2} Q ${midX} ${y1} ${midX + 10} ${y1} H ${x1}`
    );
  }
  return segments;
}

function MetroStationCard({
  event,
  onClick,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-[13.5rem] rounded-2xl border border-white/10 bg-white/[0.07] p-3 text-left backdrop-blur-md",
        "shadow-[0_12px_40px_-20px_rgba(0,0,0,0.85)] transition",
        "hover:border-white/20 hover:bg-white/[0.12] active:scale-[0.98]"
      )}
    >
      <time
        className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase"
        dateTime={event.date}
      >
        {formatStationDate(event.date)}
      </time>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {eventIcon(event.icon, event.type)}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-50">
              {event.title}
            </p>
            <p className="truncate text-[11px] text-zinc-400">{event.subtitle}</p>
          </div>
        </div>
        <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-100">
          {event.metric}
        </p>
      </div>
      <p
        className={cn(
          "mt-2 text-[10px] font-bold tracking-[0.14em] uppercase",
          event.type === "equipment" ? "text-orange-400/90" : "text-emerald-400/90"
        )}
      >
        {event.type === "equipment" ? "Техніка" : "ТМЦ"}
      </p>
    </button>
  );
}

function MetroFieldLine({
  item,
  lineIndex,
  onEventClick,
  onAddClick,
}: {
  item: FieldWithTimeline;
  lineIndex: number;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  const line = METRO_LINE_COLORS[lineIndex % METRO_LINE_COLORS.length];
  const events = useMemo(
    () => [...item.events].sort((a, b) => a.date.localeCompare(b.date)),
    [item.events]
  );

  const yPositions = events.map((_, index) =>
    index % 2 === 0 ? LINE_Y_TOP : LINE_Y_BOTTOM
  );
  const trackWidth = Math.max(
    STATION_STEP * Math.max(events.length - 1, 1) + TRACK_PAD_X * 2,
    320
  );
  const segments = buildMetroSegments(events.length, yPositions);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent">
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn("inline-flex h-2.5 w-8 shrink-0 rounded-full", line.fill)}
              aria-hidden
            />
            <h3 className="truncate text-base font-semibold tracking-tight text-zinc-50">
              {item.field.name}
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {normalizeFieldCrop(item.field.crop)} · {formatAreaHa(item.field.areaHa)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 tabular-nums">
            {events.length}{" "}
            {events.length === 1 ? "станція" : "станцій"}
          </span>
          <button
            type="button"
            onClick={() => onAddClick?.(item.field)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 transition hover:bg-emerald-500/25"
            aria-label={`Додати позицію для ${item.field.name}`}
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-zinc-500 italic">
            Історія операцій порожня
          </p>
          <button
            type="button"
            onClick={() => onAddClick?.(item.field)}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <Plus className="size-4" />
            Додати першу позицію
          </button>
        </div>
      ) : (
        <div className="relative">
          <div
            className="overflow-x-auto overscroll-x-contain pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={`Хронологія поля ${item.field.name}`}
          >
            <div
              className="relative"
              style={{ width: trackWidth, height: TRACK_HEIGHT }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={trackWidth}
                height={TRACK_HEIGHT}
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
                {segments.map((d, index) => (
                  <path
                    key={index}
                    d={d}
                    fill="none"
                    stroke={line.stroke}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                    filter={`url(#glow-${line.id}-${lineIndex})`}
                  />
                ))}
              </svg>

              {events.map((event, index) => {
                const x = TRACK_PAD_X + index * STATION_STEP;
                const y = yPositions[index] ?? LINE_Y_TOP;
                const cardAbove = y === LINE_Y_TOP;

                return (
                  <div
                    key={event.id}
                    className="absolute left-0 top-0"
                    style={{
                      left: x,
                      transform: "translateX(-50%)",
                      width: 0,
                      height: TRACK_HEIGHT,
                    }}
                  >
                    <span
                      className={cn(
                        "absolute left-1/2 size-5 -translate-x-1/2 rounded-full border-[3px] bg-zinc-950 shadow-lg",
                        line.ring,
                        line.glow
                      )}
                      style={{ top: y - 10 }}
                    />

                    <div
                      className="absolute left-1/2 -translate-x-1/2"
                      style={
                        cardAbove
                          ? { bottom: TRACK_HEIGHT - y + 20 }
                          : { top: y + 20 }
                      }
                    >
                      <MetroStationCard
                        event={event}
                        onClick={() => onEventClick?.(item.field, event)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-zinc-950/90 to-transparent"
            aria-hidden
          />
        </div>
      )}
    </section>
  );
}

function MetroMapSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Завантаження карти">
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
  onEventClick,
  onAddClick,
}: {
  fields: FieldWithTimeline[];
  isLoading: boolean;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  if (isLoading) return <MetroMapSkeleton />;

  if (fields.length === 0) {
    return (
      <p className="rounded-3xl border border-white/10 bg-white/5 px-4 py-12 text-center text-sm text-zinc-400">
        Активних полів не знайдено.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((item, index) => (
        <MetroFieldLine
          key={item.field.id}
          item={item}
          lineIndex={index}
          onEventClick={onEventClick}
          onAddClick={onAddClick}
        />
      ))}
    </div>
  );
}

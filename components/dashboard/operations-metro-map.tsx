"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Fuel,
  Package,
  Plus,
  Sprout,
  Tractor,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { normalizeFieldCrop } from "@/components/dashboard/field-passport-form";
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
  UnifiedTimelineIcon,
} from "@/lib/field-timeline";
import {
  fieldLineGlowShadow,
  groupTimelineByCrop,
  normalizeFieldLineColor,
  TIMELINE_NO_CROP_LABEL,
  type TimelineCropGroup,
} from "@/lib/field-timeline-crops";
import { cn } from "@/lib/utils";

const STATION_CARD_WIDTH = 216;
const STATION_STEP = 252;
const STATION_HALF = STATION_CARD_WIDTH / 2;
const TRACK_HEIGHT = 392;
const LINE_Y_TOP = 156;
const LINE_Y_BOTTOM = 248;

function stationX(index: number, count: number, trackWidth: number): number {
  if (count <= 1) return trackWidth / 2;
  const span = Math.max(trackWidth - STATION_CARD_WIDTH, 0);
  return STATION_HALF + (index / (count - 1)) * span;
}

function minTrackWidth(count: number): number {
  if (count <= 1) return STATION_CARD_WIDTH;
  return STATION_CARD_WIDTH + (count - 1) * STATION_STEP;
}

function useContainerWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.getBoundingClientRect().width);
    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

type FieldLineVisual = {
  color: string;
  filterKey: string;
};

function getFieldLineVisual(
  field: FieldTimelineField,
  suffix: string
): FieldLineVisual {
  return {
    color: normalizeFieldLineColor(field.color),
    filterKey: `${field.id}-${suffix}`,
  };
}

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

function buildMetroSegments(
  count: number,
  yPositions: number[],
  trackWidth: number
): string[] {
  if (count < 1) return [];

  const segments: string[] = [];
  const firstX = stationX(0, count, trackWidth);
  const firstY = yPositions[0] ?? LINE_Y_TOP;
  segments.push(`M 0 ${firstY} H ${firstX}`);

  for (let i = 1; i < count; i++) {
    const x0 = stationX(i - 1, count, trackWidth);
    const x1 = stationX(i, count, trackWidth);
    const y0 = yPositions[i - 1] ?? LINE_Y_TOP;
    const y1 = yPositions[i] ?? LINE_Y_BOTTOM;
    const midX = (x0 + x1) / 2;
    segments.push(
      `M ${x0} ${y0} H ${midX - 10} Q ${midX} ${y0} ${midX} ${(y0 + y1) / 2} Q ${midX} ${y1} ${midX + 10} ${y1} H ${x1}`
    );
  }

  const lastX = stationX(count - 1, count, trackWidth);
  const lastY = yPositions[count - 1] ?? LINE_Y_BOTTOM;
  segments.push(`M ${lastX} ${lastY} H ${trackWidth}`);

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
        "relative z-10 w-[13.5rem] rounded-2xl border border-white/10 bg-white/[0.07] p-3 text-left backdrop-blur-md",
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

function MetroDot({
  line,
  className,
  style,
}: {
  line: FieldLineVisual;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "absolute size-5 rounded-full border-[3px] bg-zinc-950",
        className
      )}
      style={{
        borderColor: line.color,
        boxShadow: fieldLineGlowShadow(line.color),
        ...style,
      }}
    />
  );
}

function MetroSingleStationTrack({
  event,
  line,
  onEventClick,
  field,
}: {
  event: UnifiedTimelineEvent;
  line: FieldLineVisual;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  field: FieldTimelineField;
}) {
  return (
    <div className="py-3">
      <div className="mb-3 flex justify-center px-4">
        <MetroStationCard
          event={event}
          onClick={() => onEventClick?.(field, event)}
        />
      </div>

      <div className="relative h-5 w-full">
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <filter id={`glow-single-${line.filterKey}`}>
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <line
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            stroke={line.color}
            strokeWidth={6}
            strokeLinecap="butt"
            filter={`url(#glow-single-${line.filterKey})`}
          />
        </svg>
        <MetroDot
          line={line}
          className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
}

function MetroFieldLine({
  item,
  onEventClick,
  onAddClick,
}: {
  item: FieldWithTimeline;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(trackContainerRef);
  const line = getFieldLineVisual(item.field, "track");
  const events = useMemo(
    () => [...item.events].sort((a, b) => a.date.localeCompare(b.date)),
    [item.events]
  );

  const yPositions = events.map((_, index) =>
    index % 2 === 0 ? LINE_Y_TOP : LINE_Y_BOTTOM
  );
  const trackWidth = Math.max(
    minTrackWidth(events.length),
    containerWidth
  );
  const segments = buildMetroSegments(events.length, yPositions, trackWidth);

  return (
    <AccordionItem
      value={item.field.id}
      className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent"
    >
      <AccordionTrigger className="group border-b border-white/5 px-4 py-3 hover:no-underline [&>svg]:hidden">
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pr-2">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-2.5 w-8 shrink-0 rounded-full"
                style={{ backgroundColor: line.color }}
                aria-hidden
              />
              <h3 className="truncate text-base font-semibold tracking-tight text-zinc-50">
                {item.field.name}
              </h3>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {normalizeFieldCrop(item.field.crop) || TIMELINE_NO_CROP_LABEL} ·{" "}
              {formatAreaHa(item.field.areaHa)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 tabular-nums">
              {events.length}{" "}
              {events.length === 1 ? "станція" : "станцій"}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddClick?.(item.field);
              }}
              className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 transition hover:bg-emerald-500/25"
              aria-label={`Додати позицію для ${item.field.name}`}
            >
              <Plus className="size-4" />
            </button>
            <ChevronDown className="size-5 shrink-0 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="overflow-visible pb-0 touch-pan-y">
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
        ) : events.length === 1 ? (
          <MetroSingleStationTrack
            event={events[0]!}
            line={line}
            field={item.field}
            onEventClick={onEventClick}
          />
        ) : (
          <div
            ref={trackContainerRef}
            className="relative py-2"
            style={{ overscrollBehaviorX: "contain" }}
          >
            <div
              className="overflow-x-auto overscroll-x-contain pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                    <filter id={`glow-${line.filterKey}`}>
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
                      stroke={line.color}
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.95}
                      filter={`url(#glow-${line.filterKey})`}
                    />
                  ))}
                </svg>

                {events.map((event, index) => {
                  const x = stationX(index, events.length, trackWidth);
                  const y = yPositions[index] ?? LINE_Y_TOP;
                  const cardAbove = y === LINE_Y_TOP;

                  return (
                    <div
                      key={event.id}
                      className="absolute top-0 left-0"
                      style={{
                        left: x,
                        transform: "translateX(-50%)",
                        width: 0,
                        height: TRACK_HEIGHT,
                      }}
                    >
                      <MetroDot
                        line={line}
                        className="left-1/2 -translate-x-1/2"
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
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function CropCategoryCard({
  group,
  onSelect,
}: {
  group: TimelineCropGroup;
  onSelect: () => void;
}) {
  const description =
    group.label === TIMELINE_NO_CROP_LABEL
      ? "Поля без культури в паспорті"
      : `${group.fieldCount} ${group.fieldCount === 1 ? "поле" : group.fieldCount < 5 ? "поля" : "полів"} · ${group.stationCount} ${group.stationCount === 1 ? "станція" : group.stationCount < 5 ? "станції" : "станцій"}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full overflow-hidden rounded-3xl border border-white/8 text-left transition",
        "bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-transparent",
        "hover:border-white/15 hover:from-white/[0.09] active:scale-[0.99]"
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
          <h3 className="text-lg font-bold tracking-tight text-zinc-50">
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
}: {
  fields: FieldWithTimeline[];
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (fields.length === 0) {
      setOpenIds([]);
      return;
    }
    setOpenIds((prev) => {
      const valid = prev.filter((id) => fields.some((item) => item.field.id === id));
      if (valid.length > 0) return valid;
      return [fields[0]!.field.id];
    });
  }, [fields]);

  return (
    <Accordion
      type="multiple"
      value={openIds}
      onValueChange={setOpenIds}
      className="space-y-3"
    >
      {fields.map((item) => (
        <MetroFieldLine
          key={item.field.id}
          item={item}
          onEventClick={onEventClick}
          onAddClick={onAddClick}
        />
      ))}
    </Accordion>
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
  searchQuery = "",
  onEventClick,
  onAddClick,
}: {
  fields: FieldWithTimeline[];
  isLoading: boolean;
  searchQuery?: string;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
}) {
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const cropGroups = useMemo(() => groupTimelineByCrop(fields), [fields]);
  const isSearchMode = Boolean(searchQuery.trim());

  useEffect(() => {
    setSelectedCropId(null);
  }, [fields, searchQuery]);

  if (isLoading) return <MetroMapSkeleton />;

  if (fields.length === 0) {
    return (
      <p className="rounded-3xl border border-white/10 bg-white/5 px-4 py-12 text-center text-sm text-zinc-400">
        Активних полів не знайдено.
      </p>
    );
  }

  if (isSearchMode) {
    return (
      <MetroFieldsAccordion
        fields={fields}
        onEventClick={onEventClick}
        onAddClick={onAddClick}
      />
    );
  }

  if (!selectedCropId) {
    return (
      <div className="space-y-3">
        <p className="px-1 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
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

  const activeGroup = cropGroups.find((group) => group.id === selectedCropId);

  if (!activeGroup) {
    return (
      <MetroFieldsAccordion
        fields={fields}
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
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
      >
        <ChevronLeft className="size-4" />
        Усі культури
      </button>

      <div
        className="rounded-3xl border border-white/8 px-4 py-3"
        style={{
          background: `linear-gradient(135deg, ${activeGroup.accentColor}18 0%, transparent 70%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="h-10 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: activeGroup.accentColor }}
          />
          <div>
            <h2 className="text-base font-bold text-zinc-50">{activeGroup.label}</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {activeGroup.fieldCount}{" "}
              {activeGroup.fieldCount === 1 ? "поле" : "полів"} ·{" "}
              {activeGroup.stationCount}{" "}
              {activeGroup.stationCount === 1 ? "станція" : "станцій"} ·{" "}
              {formatAreaHa(activeGroup.totalAreaHa)}
            </p>
          </div>
        </div>
      </div>

      <MetroFieldsAccordion
        fields={activeGroup.fields}
        onEventClick={onEventClick}
        onAddClick={onAddClick}
      />
    </div>
  );
}

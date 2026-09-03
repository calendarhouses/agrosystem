"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
} from "date-fns";
import { uk } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  PackageMinus,
  Plus,
  Tractor,
  X,
} from "lucide-react";

import type {
  FieldTimelineField,
  FieldWithTimeline,
  UnifiedTimelineEvent,
  UnifiedTimelineEventType,
} from "@/lib/field-timeline";
import {
  timelineEventDateIso,
  toTimelineField,
} from "@/lib/field-timeline";
import { CropCategoryCard } from "@/components/dashboard/operations-metro-map";
import { groupTimelineByCrop } from "@/lib/field-timeline-crops";
import { ukFieldLabel, ukStationLabel } from "@/lib/uk-plural";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

function formatAreaHa(areaHa: number): string {
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: areaHa >= 100 ? 0 : 1,
  }).format(areaHa)} га`;
}

type CalendarStation = {
  event: UnifiedTimelineEvent;
  field: FieldTimelineField;
  dateIso: string;
};

type DayBucket = {
  date: Date;
  dateIso: string;
  stations: CalendarStation[];
  byType: Record<UnifiedTimelineEventType, number>;
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"] as const;

/** Агросезон: бер → лют наступного року */
const AGRO_MONTH_OFFSETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1] as const;

const TYPE_META: Record<
  UnifiedTimelineEventType,
  {
    label: string;
    short: string;
    /** Повне слово для мобільного бейджа */
    word: string;
    dot: string;
    soft: string;
    ring: string;
    border: string;
    bg: string;
    heat: string;
    text: string;
    Icon: typeof Tractor;
  }
> = {
  equipment: {
    label: "Наряди",
    short: "Нар.",
    word: "Наряд",
    dot: "bg-orange-400",
    soft: "bg-orange-500/20 text-orange-200",
    ring: "ring-orange-400/50",
    border: "border-orange-400/55",
    bg: "bg-orange-500/15",
    heat: "bg-orange-400/55",
    text: "text-orange-200",
    Icon: Tractor,
  },
  inventory: {
    label: "ТМЦ",
    short: "ТМЦ",
    word: "Списання",
    dot: "bg-emerald-400",
    soft: "bg-emerald-500/20 text-emerald-200",
    ring: "ring-emerald-400/50",
    border: "border-emerald-400/55",
    bg: "bg-emerald-500/15",
    heat: "bg-emerald-400/55",
    text: "text-emerald-200",
    Icon: PackageMinus,
  },
  scouting: {
    label: "Скаутинг",
    short: "Скаут",
    word: "Скаутинг",
    dot: "bg-sky-400",
    soft: "bg-sky-500/20 text-sky-200",
    ring: "ring-sky-400/50",
    border: "border-sky-400/55",
    bg: "bg-sky-500/15",
    heat: "bg-sky-400/55",
    text: "text-sky-200",
    Icon: Camera,
  },
};

const TYPE_ORDER: UnifiedTimelineEventType[] = [
  "equipment",
  "inventory",
  "scouting",
];

function agroMonthDate(seasonYear: number, monthIndex: number): Date {
  const month = AGRO_MONTH_OFFSETS[monthIndex]!;
  const year = month >= 2 ? seasonYear : seasonYear + 1;
  return new Date(year, month, 1, 12, 0, 0, 0);
}

function mondayIndex(date: Date): number {
  return (getDay(date) + 6) % 7;
}

/** Тільки реальна кількість тижнів (4–6 рядків), без примусових 42 клітинок */
function buildMonthGrid(monthDate: Date): (Date | null)[] {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });
  const pad = mondayIndex(start);
  const cells: (Date | null)[] = Array.from({ length: pad }, () => null);
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function flattenStations(fields: FieldWithTimeline[]): CalendarStation[] {
  const out: CalendarStation[] = [];
  for (const field of fields) {
    const tf = toTimelineField(field);
    for (const event of field.events) {
      out.push({
        event,
        field: tf,
        dateIso: timelineEventDateIso(event.date),
      });
    }
  }
  return out;
}

function dominantType(
  byType: DayBucket["byType"]
): UnifiedTimelineEventType | null {
  let best: UnifiedTimelineEventType | null = null;
  let bestCount = 0;
  for (const type of TYPE_ORDER) {
    const n = byType[type];
    if (n > bestCount) {
      best = type;
      bestCount = n;
    }
  }
  return bestCount > 0 ? best : null;
}

function activeTypes(byType: DayBucket["byType"]): UnifiedTimelineEventType[] {
  return TYPE_ORDER.filter((type) => byType[type] > 0);
}

// Перша літера дня тижня
const WEEKDAY_LETTERS = ["П", "В", "С", "Ч", "П", "С", "Н"] as const;

function MonthMiniHeat({
  monthDate,
  buckets,
}: {
  monthDate: Date;
  buckets: Map<string, DayBucket>;
}) {
  const isMobile = useIsMobile();
  const cells = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  return (
    <div className={cn("flex flex-col", isMobile ? "gap-[3px]" : "gap-[2px]")}>
      {/* Заголовок — одна літера кожного дня */}
      <div className={cn("grid grid-cols-7", isMobile ? "gap-[3px]" : "gap-[2px]")}>
        {WEEKDAY_LETTERS.map((d, i) => (
          <div
            key={i}
            className={cn(
              "text-center font-semibold text-zinc-600",
              isMobile ? "text-[8px]" : "text-[7px]"
            )}
          >
            {d}
          </div>
        ))}
      </div>
      {/* Клітинки */}
      <div className={cn("grid grid-cols-7", isMobile ? "gap-[3px]" : "gap-[2px]")}>
        {cells.map((day, i) => {
          if (!day || !isSameMonth(day, monthDate)) {
            return (
              <div
                key={`e-${i}`}
                className={cn(
                  "aspect-square",
                  isMobile && "rounded-[4px] border border-white/[0.04] bg-white/[0.01]"
                )}
              />
            );
          }
          const iso = format(day, "yyyy-MM-dd");
          const bucket = buckets.get(iso);
          const types = bucket ? activeTypes(bucket.byType) : [];
          const primary = bucket ? dominantType(bucket.byType) : null;
          const today = isToday(day);
          const hasEvents = types.length > 0;
          return (
            <div
              key={iso}
              title={
                bucket
                  ? `${format(day, "d MMM", { locale: uk })} · ${ukStationLabel(bucket.stations.length)}`
                  : undefined
              }
              className={cn(
                "flex aspect-square items-center justify-center rounded-[4px] font-semibold tabular-nums transition-all",
                isMobile ? "text-[8.5px]" : "text-[7.5px]",
                // Порожні дні — прозорі, щоб не зливались
                !hasEvents && !today
                  ? isMobile
                    ? "text-zinc-600 border border-white/[0.04] bg-white/[0.01]"
                    : "text-zinc-600"
                  : "",
                // День з однією категорією
                hasEvents &&
                  types.length === 1 &&
                  primary &&
                  cn(
                    TYPE_META[primary].bg,
                    TYPE_META[primary].text,
                    "ring-1 ring-inset",
                    TYPE_META[primary].ring
                  ),
                // День з кількома категоріями
                hasEvents &&
                  types.length > 1 &&
                  "bg-gradient-to-br from-orange-500/35 via-emerald-500/20 to-sky-500/35 text-zinc-50 ring-1 ring-inset ring-white/25",
                // Сьогодні
                today &&
                  !hasEvents &&
                  "bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-400/60",
                today &&
                  hasEvents &&
                  "ring-2 ring-emerald-300/90"
              )}
            >
              {format(day, "d")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Компактний преміальний чіп події — для місячного перегляду і денної панелі */
function CalendarEventChip({
  event,
  field,
  onClick,
}: {
  event: UnifiedTimelineEvent;
  field: FieldTimelineField;
  onClick: () => void;
}) {
  const meta = TYPE_META[event.type];
  const Icon = meta.Icon;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left",
        "shadow-[0_4px_16px_-8px_rgba(0,0,0,0.6)] transition",
        "hover:brightness-110 active:scale-[0.99]",
        meta.border,
        meta.bg
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1",
          meta.soft,
          meta.ring
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.1} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight text-zinc-50">
          {event.title}
        </span>
        <span className="mt-0.5 block truncate text-xs leading-tight text-zinc-400">
          {field.name}
          {event.metric ? (
            <span className="text-zinc-500"> · {event.metric}</span>
          ) : null}
        </span>
      </span>
      {event.cost > 0 ? (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-500">
          {new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
            event.cost
          )}{" "}
          ₴
        </span>
      ) : null}
    </button>
  );
}

/** Денна панель для мобільного: список подій дня */
function DayStationsPanel({
  bucket,
  onClose,
  onEventClick,
}: {
  bucket: DayBucket;
  onClose: () => void;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
}) {
  const label = format(bucket.date, "EEEE, d MMMM", { locale: uk });

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400/80">
            {ukStationLabel(bucket.stations.length)}
          </p>
          <h3 className="mt-0.5 text-base font-semibold capitalize tracking-tight text-zinc-50">
            {label}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          aria-label="Закрити"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {bucket.stations.map(({ event, field }) => (
          <CalendarEventChip
            key={`${field.id}:${event.id}`}
            event={event}
            field={field}
            onClick={() => onEventClick(field, event)}
          />
        ))}
      </div>
    </div>
  );
}

/** Клітинка дня у розгорнутому місяці */
function DayCellExpanded({
  day,
  monthDate,
  bucket,
  selected,
  isDesktop,
  onSelect,
  onEventClick,
}: {
  day: Date | null;
  monthDate: Date;
  bucket?: DayBucket;
  selected: boolean;
  isDesktop: boolean;
  onSelect: (bucket: DayBucket) => void;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
}) {
  if (!day || !isSameMonth(day, monthDate)) {
    return <div className="min-h-[52px] rounded-lg lg:min-h-0" />;
  }

  const count = bucket?.stations.length ?? 0;
  const has = count > 0;
  const today = isToday(day);
  const types = bucket ? activeTypes(bucket.byType) : [];
  const primary = bucket ? dominantType(bucket.byType) : null;
  const primaryMeta = primary ? TYPE_META[primary] : null;
  const visibleStations = isDesktop ? (bucket?.stations ?? []) : [];

  function handleMobileTap() {
    if (!bucket) return;
    // 1 подія — відкрити деталі одразу; кілька — показати список
    if (bucket.stations.length === 1) {
      const { field, event } = bucket.stations[0]!;
      onEventClick(field, event);
    } else {
      onSelect(bucket);
    }
  }

  // На мобільному — завжди <button>, щоб iOS коректно обробляв tap
  if (!isDesktop) {
    return (
      <button
        type="button"
        disabled={!has}
        onClick={handleMobileTap}
        className={cn(
          "group relative flex min-h-0 w-full flex-col overflow-hidden rounded-lg border p-1.5 text-left transition",
          "min-h-[52px]",
          !has && "border-white/[0.04] bg-white/[0.01] disabled:opacity-100",
          has && primaryMeta && cn(primaryMeta.border, "bg-white/[0.03]"),
          has &&
            types.length > 1 &&
            "border-white/20 bg-gradient-to-br from-orange-500/8 via-emerald-500/6 to-sky-500/8",
          has && "active:scale-[0.96]",
          selected && primaryMeta && cn("ring-2", primaryMeta.ring),
          today && "ring-1 ring-emerald-300/50"
        )}
      >
        <div className="flex w-full shrink-0 items-center justify-between gap-1">
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums",
              today
                ? "bg-emerald-500 text-zinc-950"
                : has
                  ? "text-zinc-100"
                  : "text-zinc-600"
            )}
          >
            {format(day, "d")}
          </span>
          {has ? (
            <span className="flex items-center gap-px">
              {types.map((type) => (
                <span
                  key={type}
                  className={cn("size-1.5 rounded-full", TYPE_META[type].dot)}
                />
              ))}
            </span>
          ) : null}
        </div>
        {has && types.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-px">
            {types.map((type) => {
              const n = bucket?.byType[type] ?? 0;
              if (n <= 0) return null;
              return (
                <span
                  key={type}
                  className={cn(
                    "rounded-[4px] px-1 py-px text-[7px] font-bold leading-tight tracking-tight",
                    TYPE_META[type].soft
                  )}
                >
                  {TYPE_META[type].word}
                  {n > 1 ? ` ×${n}` : ""}
                </span>
              );
            })}
          </div>
        ) : null}
      </button>
    );
  }

  // Десктоп — клітинка = картка роботи; натискання — відкриття деталей
  const singleStation = visibleStations.length === 1 ? visibleStations[0] : null;

  return (
    <button
      type="button"
      disabled={!has}
      onClick={() => {
        if (singleStation) {
          onEventClick(singleStation.field, singleStation.event);
        } else if (bucket && visibleStations.length > 1) {
          // Відкрити перший — або можна додати попап; поки відкриваємо перший
          onEventClick(visibleStations[0]!.field, visibleStations[0]!.event);
        }
      }}
      className={cn(
        "group relative flex flex-col rounded-lg border p-1.5 text-left transition",
        "min-h-[72px]",
        !has && "border-white/[0.04] bg-white/[0.01] disabled:opacity-100",
        has && primaryMeta && cn("border-white/[0.06]", "ring-1 ring-inset", primaryMeta.ring, primaryMeta.bg),
        has && types.length > 1 && "border-white/[0.08] bg-gradient-to-br from-orange-500/8 via-emerald-500/6 to-sky-500/8 ring-1 ring-inset ring-white/15",
        has && "cursor-pointer hover:brightness-110 active:scale-[0.98]",
        today && "outline outline-1 outline-emerald-300/50"
      )}
    >
      {/* Верхній рядок: дата + крапки типів */}
      <div className="flex w-full shrink-0 items-center justify-between gap-1">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
            today
              ? "bg-emerald-500 text-zinc-950"
              : has
                ? "text-zinc-100"
                : "text-zinc-600"
          )}
        >
          {format(day, "d")}
        </span>
        {has ? (
          <span className="flex items-center gap-px">
            {types.map((type) => (
              <span
                key={type}
                className={cn("size-1.5 rounded-full", TYPE_META[type].dot)}
              />
            ))}
          </span>
        ) : null}
      </div>

      {/* Тіло: назва типу + кількість */}
      {has ? (
        <div className="mt-1 flex flex-1 flex-col gap-0.5">
          {types.map((type) => {
            const n = bucket?.byType[type] ?? 0;
            if (n <= 0) return null;
            const meta = TYPE_META[type];
            return (
              <span
                key={type}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1 py-px text-[9px] font-bold leading-tight",
                  meta.soft
                )}
              >
                {(() => { const Icon = meta.Icon; return <Icon className="size-2.5" strokeWidth={2.2} />; })()}
                {meta.word}
                {n > 1 ? ` ×${n}` : ""}
              </span>
            );
          })}
          {/* Назва операції, якщо одна */}
          {singleStation ? (
            <span className="mt-auto truncate text-[9px] font-medium leading-tight text-zinc-400">
              {singleStation.event.title}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

/** Анімований місячний календар зі свайпом */
function MonthCalendarBody({
  expanded,
  expandedCells,
  bucketsByIso,
  selectedBucket,
  isDesktop,
  swipeDir,
  onDaySelect,
  onEventClick,
}: {
  expanded: { index: number; monthDate: Date; count: number } | null;
  expandedCells: (Date | null)[];
  bucketsByIso: Map<string, DayBucket>;
  selectedBucket: DayBucket | null;
  isDesktop: boolean;
  swipeDir: number;
  onDaySelect: (iso: string) => void;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
}) {
  if (!expanded) return null;

  const variants = {
    enter: (d: number) => ({
      x: d > 0 ? "100%" : "-100%",
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({
      x: d > 0 ? "-100%" : "100%",
      opacity: 0,
    }),
  };

  return (
    <AnimatePresence custom={swipeDir} mode="popLayout" initial={false}>
      <motion.div
        key={`grid-${expanded.index}`}
        custom={swipeDir}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ type: "spring", stiffness: 380, damping: 40, mass: 0.9 }}
        className={cn(
          "flex flex-col",
          !isDesktop && "overflow-y-auto"
        )}
      >
        <div className="mb-2 grid shrink-0 grid-cols-7 gap-1.5 lg:gap-0.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-bold uppercase tracking-wider text-zinc-600"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5 lg:gap-1">
          {expandedCells.map((day, i) => {
            const iso = day ? format(day, "yyyy-MM-dd") : `pad-${i}`;
            return (
              <DayCellExpanded
                key={iso}
                day={day}
                monthDate={expanded.monthDate}
                bucket={
                  day ? bucketsByIso.get(format(day, "yyyy-MM-dd")) : undefined
                }
                selected={
                  day != null &&
                  selectedBucket != null &&
                  isSameDay(day, selectedBucket.date)
                }
                isDesktop={isDesktop}
                onSelect={(bucket) => onDaySelect(bucket.dateIso)}
                onEventClick={onEventClick}
              />
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Блок календаря для одного поля (власний стан) */
function FieldCalendarBlock({
  field,
  seasonYear,
  isDesktop,
  onEventClick,
  onAddClick,
  onExcelExport,
  onMonthExpand,
  hidden,
}: {
  field: FieldWithTimeline;
  seasonYear: number;
  isDesktop: boolean;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick: (field: FieldTimelineField) => void;
  onExcelExport: (field: FieldWithTimeline) => void;
  onMonthExpand?: (fieldId: string, expanded: boolean) => void;
  hidden?: boolean;
}) {
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  const [swipeDir, setSwipeDir] = useState(1);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const tf = useMemo(() => toTimelineField(field), [field]);
  const stations = useMemo(() => flattenStations([field]), [field]);

  const bucketsByIso = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const station of stations) {
      const existing = map.get(station.dateIso);
      if (existing) {
        existing.stations.push(station);
        existing.byType[station.event.type] += 1;
      } else {
        const [y, m, d] = station.dateIso.split("-").map(Number);
        map.set(station.dateIso, {
          date: new Date(y!, m! - 1, d!, 12, 0, 0, 0),
          dateIso: station.dateIso,
          stations: [station],
          byType: {
            equipment: station.event.type === "equipment" ? 1 : 0,
            inventory: station.event.type === "inventory" ? 1 : 0,
            scouting: station.event.type === "scouting" ? 1 : 0,
          },
        });
      }
    }
    for (const bucket of map.values()) {
      bucket.stations.sort((a, b) => {
        const byField = a.field.name.localeCompare(b.field.name, "uk");
        if (byField !== 0) return byField;
        return a.event.title.localeCompare(b.event.title, "uk");
      });
    }
    return map;
  }, [stations]);

  const months = useMemo(
    () =>
      AGRO_MONTH_OFFSETS.map((_, index) => {
        const monthDate = agroMonthDate(seasonYear, index);
        const prefix = format(monthDate, "yyyy-MM");
        let count = 0;
        const byType: DayBucket["byType"] = {
          equipment: 0,
          inventory: 0,
          scouting: 0,
        };
        for (const [iso, bucket] of bucketsByIso) {
          if (!iso.startsWith(prefix)) continue;
          count += bucket.stations.length;
          byType.equipment += bucket.byType.equipment;
          byType.inventory += bucket.byType.inventory;
          byType.scouting += bucket.byType.scouting;
        }
        return { index, monthDate, count, byType, prefix };
      }),
    [bucketsByIso, seasonYear]
  );

  const expanded = expandedMonth != null ? months[expandedMonth] : null;
  const expandedCells = useMemo(
    () => (expanded ? buildMonthGrid(expanded.monthDate) : []),
    [expanded]
  );

  const selectedBucket =
    selectedDayIso != null ? bucketsByIso.get(selectedDayIso) ?? null : null;

  function goToMonth(index: number) {
    if (index < 0 || index > 11) return;
    const dir = expandedMonth == null || index >= expandedMonth ? 1 : -1;
    setSwipeDir(dir);
    setExpandedMonth(index);
    setSelectedDayIso(null);
    onMonthExpand?.(field.fieldId, true);
  }

  function closeMonth() {
    setExpandedMonth(null);
    setSelectedDayIso(null);
    onMonthExpand?.(field.fieldId, false);
  }

  const [open, setOpen] = useState(false);

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/30", hidden && "hidden")}>
      {/* Заголовок поля — натискання = відкрити/закрити */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-white/[0.03] sm:p-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="size-3 shrink-0 rounded-full ring-1 ring-white/20"
            style={{ background: field.color || "#52525b" }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {field.fieldName}
            </p>
            <p className="text-xs text-zinc-500">
              {field.cropName}
              {field.area ? ` · ${field.area} га` : ""}
              {stations.length > 0
                ? ` · ${ukStationLabel(stations.length)}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Excel по цьому полю */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onExcelExport(field);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onExcelExport(field);
              }
            }}
            className={cn(
              "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200 active:scale-[0.95]",
              isDesktop ? "gap-1.5 px-3 py-1.5" : "size-8"
            )}
          >
            <FileSpreadsheet className="size-3.5" />
            {isDesktop ? <span className="text-xs font-medium">Excel</span> : null}
          </span>

          {/* Кнопка додати — кругла, зелений акцент */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onAddClick(tf);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onAddClick(tf);
              }
            }}
            className={cn(
              "inline-flex items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 transition hover:bg-emerald-500/20 hover:text-emerald-200 active:scale-[0.95]",
              isDesktop ? "gap-1.5 px-3 py-1.5" : "size-8"
            )}
          >
            <Plus className="size-3.5" />
            {isDesktop ? <span className="text-xs font-semibold">Додати</span> : null}
          </span>

          {/* Стрілка акордеону */}
          <ChevronDown
            className={cn(
              "size-4 text-zinc-500 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Тіло акордеону — плавне згортання */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.05] p-3 sm:p-4">
      {stations.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-600">
          Немає записів за сезон
        </p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {/* ──── РІЧНИЙ ОГЛЯД ──── */}
          {expanded == null ? (
            <motion.div
              key="year"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-950/60"
            >
              <div className="grid grid-cols-3 border-t border-l border-white/[0.07] md:grid-cols-4 xl:grid-cols-6">
                {months.map((month) => {
                  const active = month.count > 0;
                  return (
                    <button
                      key={month.prefix}
                      type="button"
                      onClick={() => goToMonth(month.index)}
                      className={cn(
                        "group flex flex-col border-b border-r border-white/[0.07]",
                        "p-2.5 text-left transition sm:p-3",
                        "hover:bg-white/[0.03] active:bg-white/[0.05]",
                        !active && "opacity-40"
                      )}
                    >
                      <div className="mb-1.5 flex items-baseline justify-between gap-1">
                        <p
                          className={cn(
                            "text-[12px] font-semibold capitalize tracking-tight sm:text-[13px]",
                            active ? "text-zinc-100" : "text-zinc-500"
                          )}
                        >
                          {format(month.monthDate, "LLL", { locale: uk })}
                        </p>
                        {active ? (
                          <span className="text-[9px] font-bold tabular-nums text-zinc-600">
                            {month.count}
                          </span>
                        ) : null}
                      </div>
                      <MonthMiniHeat
                        monthDate={month.monthDate}
                        buckets={bucketsByIso}
                      />
                      <div className="mt-2 flex h-px w-full overflow-hidden rounded-full">
                        {active ? (
                          TYPE_ORDER.map((type) => {
                            const n = month.byType[type];
                            if (n <= 0) return null;
                            const total =
                              month.byType.equipment +
                              month.byType.inventory +
                              month.byType.scouting;
                            return (
                              <span
                                key={type}
                                className={cn("h-full", TYPE_META[type].dot)}
                                style={{ width: `${(n / total) * 100}%` }}
                              />
                            );
                          })
                        ) : (
                          <span className="h-full w-full bg-white/[0.04]" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            /* ──── РОЗГОРНУТИЙ МІСЯЦЬ ──── */
            <motion.div
              key="month-expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col gap-3"
            >
              {/* Панель місяця */}
              <div
                className="flex flex-col rounded-2xl border border-white/[0.10] bg-zinc-950/80"
                onPointerDown={(e) => {
                  if (isDesktop) return;
                  pointerRef.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={(e) => {
                  if (isDesktop || !pointerRef.current) return;
                  const dx = e.clientX - pointerRef.current.x;
                  const dy = e.clientY - pointerRef.current.y;
                  pointerRef.current = null;
                  if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 48)
                    return;
                  const nextIdx =
                    dx < 0 ? expandedMonth! + 1 : expandedMonth! - 1;
                  goToMonth(nextIdx);
                }}
                onPointerCancel={() => {
                  pointerRef.current = null;
                }}
              >
                {/* Заголовок */}
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={closeMonth}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                  >
                    <ArrowLeft className="size-4" />
                    Рік
                  </button>

                  <div className="min-w-0 flex-1 text-center">
                    <p className="truncate text-sm font-semibold capitalize tracking-tight text-zinc-50">
                      {format(expanded.monthDate, "LLLL yyyy", { locale: uk })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={expandedMonth === 0}
                      onClick={() => goToMonth(expandedMonth! - 1)}
                      className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition disabled:opacity-30 hover:bg-white/10"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={expandedMonth === 11}
                      onClick={() => goToMonth(expandedMonth! + 1)}
                      className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition disabled:opacity-30 hover:bg-white/10"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Сітка */}
                <div className="p-2 sm:p-3">
                  <MonthCalendarBody
                    expanded={expanded}
                    expandedCells={expandedCells}
                    bucketsByIso={bucketsByIso}
                    selectedBucket={selectedBucket}
                    isDesktop={isDesktop}
                    swipeDir={swipeDir}
                    onDaySelect={(iso) => setSelectedDayIso(iso)}
                    onEventClick={onEventClick}
                  />
                </div>
              </div>

              {/* Мобільна панель дня */}
              {!isDesktop ? (
                <AnimatePresence mode="wait">
                  {selectedBucket ? (
                    <motion.div
                      key={selectedBucket.dateIso}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{
                        duration: 0.2,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <DayStationsPanel
                        bucket={selectedBucket}
                        onClose={() => setSelectedDayIso(null)}
                        onEventClick={onEventClick}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function OperationsYearCalendar({
  fields,
  seasonYear,
  isLoading,
  searchQuery = "",
  onEventClick,
  onAddClick,
  onFieldExcelExport,
}: {
  fields: FieldWithTimeline[];
  seasonYear: number;
  isLoading?: boolean;
  searchQuery?: string;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick: (field: FieldTimelineField) => void;
  onFieldExcelExport: (field: FieldWithTimeline) => void;
}) {
  const isDesktop = !useIsMobile();
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const cropGroups = useMemo(() => groupTimelineByCrop(fields), [fields]);
  const isSearchMode = Boolean(searchQuery.trim());

  useEffect(() => {
    setSelectedCropId(null);
    setFocusedFieldId(null);
  }, [fields, searchQuery]);

  useEffect(() => {
    if (!isDesktop || isSearchMode || cropGroups.length === 0) return;
    setSelectedCropId((prev) => prev ?? cropGroups[0]!.id);
  }, [isDesktop, isSearchMode, cropGroups]);

  const activeGroup =
    cropGroups.find((group) => group.id === selectedCropId) ??
    cropGroups[0] ??
    null;
  const listedFields = isSearchMode ? fields : (activeGroup?.fields ?? fields);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[180px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
          />
        ))}
      </div>
    );
  }

  const legend = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {TYPE_ORDER.map((type) => (
        <span
          key={type}
          className="inline-flex items-center gap-1.5 text-[10px] font-medium text-zinc-500"
        >
          <span className={cn("size-2 rounded-full", TYPE_META[type].dot)} />
          {TYPE_META[type].label}
        </span>
      ))}
    </div>
  );

  const fieldList = listedFields.map((field) => (
    <FieldCalendarBlock
      key={field.fieldId}
      field={field}
      seasonYear={seasonYear}
      isDesktop={isDesktop}
      onEventClick={onEventClick}
      onAddClick={onAddClick}
      onExcelExport={onFieldExcelExport}
      onMonthExpand={(id, expanded) =>
        setFocusedFieldId(expanded ? id : null)
      }
      hidden={focusedFieldId != null && focusedFieldId !== field.fieldId}
    />
  ));

  if (isSearchMode) {
    return (
      <div className="flex flex-col gap-4 pb-6">
        {legend}
        {fieldList}
      </div>
    );
  }

  if (isDesktop) {
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
                onSelect={() => {
                  setSelectedCropId(group.id);
                  setFocusedFieldId(null);
                }}
              />
            ))}
          </div>
        </aside>
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-auto pb-6"
          data-chronicle-scroll
        >
          {legend}
          {fieldList}
        </div>
      </div>
    );
  }

  if (!selectedCropId) {
    return (
      <div className="space-y-3 pb-6">
        {legend}
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

  return (
    <div className="flex flex-col gap-3 pb-6">
      <button
        type="button"
        onClick={() => {
          setSelectedCropId(null);
          setFocusedFieldId(null);
        }}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
      >
        <ChevronLeft className="size-4" />
        Усі культури
      </button>

      {activeGroup ? (
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
      ) : null}

      {legend}
      {fieldList}
    </div>
  );
}

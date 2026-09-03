"use client";

import { useMemo, useState } from "react";
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
  CalendarDays,
  Camera,
  PackageMinus,
  Tractor,
  X,
} from "lucide-react";

import { MetroStationCard } from "@/components/dashboard/operations-metro-map";
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
import { ukStationLabel } from "@/lib/uk-plural";
import { cn } from "@/lib/utils";

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

function buildMonthGrid(monthDate: Date): (Date | null)[] {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });
  const pad = mondayIndex(start);
  const cells: (Date | null)[] = Array.from({ length: pad }, () => null);
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
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

function MonthMiniHeat({
  monthDate,
  buckets,
}: {
  monthDate: Date;
  buckets: Map<string, DayBucket>;
}) {
  const cells = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  return (
    <div className="grid grid-cols-7 gap-px">
      {cells.map((day, i) => {
        if (!day || !isSameMonth(day, monthDate)) {
          return <div key={`e-${i}`} className="aspect-square rounded-[2px]" />;
        }
        const iso = format(day, "yyyy-MM-dd");
        const bucket = buckets.get(iso);
        const types = bucket ? activeTypes(bucket.byType) : [];
        if (types.length === 0) {
          return (
            <div
              key={iso}
              className="aspect-square rounded-[2px] bg-white/[0.04]"
            />
          );
        }
        if (types.length === 1) {
          return (
            <div
              key={iso}
              className={cn(
                "aspect-square rounded-[2px] ring-1 ring-inset ring-white/10",
                TYPE_META[types[0]!].heat
              )}
              title={`${types[0]} · ${bucket!.stations.length}`}
            />
          );
        }
        return (
          <div
            key={iso}
            className="grid aspect-square grid-cols-2 gap-px overflow-hidden rounded-[2px] ring-1 ring-inset ring-white/15"
            title={ukStationLabel(bucket!.stations.length)}
          >
            {types.slice(0, 4).map((type) => (
              <span key={type} className={cn("min-h-0 min-w-0", TYPE_META[type].heat)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DayCellExpanded({
  day,
  monthDate,
  bucket,
  selected,
  onSelect,
}: {
  day: Date | null;
  monthDate: Date;
  bucket?: DayBucket;
  selected: boolean;
  onSelect: (bucket: DayBucket) => void;
}) {
  if (!day || !isSameMonth(day, monthDate)) {
    return <div className="min-h-[72px] rounded-xl lg:min-h-[88px]" />;
  }

  const count = bucket?.stations.length ?? 0;
  const has = count > 0;
  const today = isToday(day);
  const types = bucket ? activeTypes(bucket.byType) : [];
  const primary = bucket ? dominantType(bucket.byType) : null;
  const primaryMeta = primary ? TYPE_META[primary] : null;
  const first = bucket?.stations[0];
  const tip =
    count === 1 && first
      ? first.event.title
      : count > 1
        ? `${ukStationLabel(count)}`
        : null;

  return (
    <button
      type="button"
      disabled={!has}
      onClick={() => {
        if (bucket) onSelect(bucket);
      }}
      className={cn(
        "group relative flex min-h-[72px] flex-col overflow-hidden rounded-xl border p-1.5 text-left transition lg:min-h-[88px] lg:rounded-2xl lg:p-2",
        !has && "border-transparent bg-transparent text-zinc-600",
        has && primaryMeta && cn(primaryMeta.border, primaryMeta.bg),
        has &&
          types.length > 1 &&
          "border-white/25 bg-gradient-to-br from-orange-500/12 via-emerald-500/10 to-sky-500/12",
        has && "hover:brightness-110 active:scale-[0.98]",
        selected && primaryMeta && cn("ring-2", primaryMeta.ring),
        selected && !primaryMeta && "ring-2 ring-white/30",
        today && !selected && !has && "ring-1 ring-white/20",
        today && !selected && has && "ring-1 ring-white/35"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "text-[11px] font-semibold tabular-nums lg:text-xs",
            has ? "text-zinc-50" : "text-zinc-600",
            today && "text-emerald-300"
          )}
        >
          {format(day, "d")}
        </span>
        {has && types.length > 0 ? (
          <span className="flex items-center gap-0.5">
            {types.map((type) => (
              <span
                key={type}
                className={cn("size-1.5 rounded-full lg:size-2", TYPE_META[type].dot)}
              />
            ))}
          </span>
        ) : null}
      </div>

      {has ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5">
          {tip ? (
            <span className="line-clamp-2 text-[9px] leading-tight font-medium text-zinc-200 lg:text-[10px]">
              {tip}
            </span>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center gap-0.5">
            {types.map((type) => {
              const n = bucket?.byType[type] ?? 0;
              if (n <= 0) return null;
              return (
                <span
                  key={type}
                  className={cn(
                    "rounded px-1 py-px text-[8px] font-bold tracking-wide uppercase lg:text-[9px]",
                    TYPE_META[type].soft
                  )}
                >
                  {TYPE_META[type].short}
                  {n > 1 ? ` ${n}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </button>
  );
}

function DayStationsPanel({
  bucket,
  onClose,
  onEventClick,
}: {
  bucket: DayBucket;
  onClose: () => void;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
}) {
  const label = format(bucket.date, "d MMMM yyyy", { locale: uk });

  return (
    <aside
      className={cn(
        "flex max-h-[48vh] flex-col overflow-hidden rounded-[1.5rem] border border-white/10",
        "bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]",
        "backdrop-blur-xl sm:max-h-none sm:min-h-0 sm:flex-1"
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3.5">
        <div>
          <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-400/90 uppercase">
            День
          </p>
          <h3 className="mt-0.5 text-base font-semibold tracking-tight text-zinc-50 capitalize">
            {label}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {ukStationLabel(bucket.stations.length)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          aria-label="Закрити день"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {bucket.stations.map(({ event, field }) => (
          <li key={`${field.id}:${event.id}`} className="space-y-1.5">
            <p className="px-0.5 text-[11px] font-medium text-zinc-500">
              {field.name}
              {field.crop ? (
                <span className="text-zinc-600"> · {field.crop}</span>
              ) : null}
            </p>
            <MetroStationCard
              event={event}
              compact
              fullWidth
              onClick={() => onEventClick(field, event)}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function OperationsYearCalendar({
  fields,
  seasonYear,
  isLoading,
  onEventClick,
}: {
  fields: FieldWithTimeline[];
  seasonYear: number;
  isLoading?: boolean;
  onEventClick: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
}) {
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);

  const stations = useMemo(() => flattenStations(fields), [fields]);

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

  function openMonth(index: number) {
    setExpandedMonth(index);
    setSelectedDayIso(null);
  }

  function closeMonth() {
    setExpandedMonth(null);
    setSelectedDayIso(null);
  }

  if (isLoading) {
    return (
      <div className="h-[420px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-auto"
      data-chronicle-scroll
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <CalendarDays className="size-3.5 text-emerald-400/80" />
          <span>
            Сезон {seasonYear}/{String(seasonYear + 1).slice(-2)} · бер–лют
          </span>
          <span className="text-zinc-600">·</span>
          <span className="font-medium text-zinc-400">
            {ukStationLabel(stations.length)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {expanded == null ? (
          <motion.div
            key="year"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4"
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {months.map((month) => {
                const active = month.count > 0;
                return (
                  <button
                    key={month.prefix}
                    type="button"
                    onClick={() => openMonth(month.index)}
                    className={cn(
                      "group flex flex-col text-left transition",
                      "rounded-xl p-1.5 -m-1.5 hover:bg-white/[0.04]",
                      !active && "opacity-55 hover:opacity-80"
                    )}
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
                      <p
                        className={cn(
                          "text-[13px] font-semibold capitalize tracking-tight",
                          active ? "text-zinc-100" : "text-zinc-500"
                        )}
                      >
                        {format(month.monthDate, "LLLL", { locale: uk })}
                      </p>
                      {active ? (
                        <span className="text-[10px] font-bold tabular-nums text-zinc-500">
                          {month.count}
                        </span>
                      ) : null}
                    </div>
                    <MonthMiniHeat
                      monthDate={month.monthDate}
                      buckets={bucketsByIso}
                    />
                    {active ? (
                      <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-white/5">
                        {TYPE_ORDER.map((type) => {
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
                        })}
                      </div>
                    ) : (
                      <div className="mt-1.5 h-1 rounded-full bg-transparent" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`month-${expanded.index}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row"
          >
            <div
              className={cn(
                "flex min-h-0 flex-[1.55] flex-col overflow-hidden rounded-2xl border border-white/12",
                "bg-zinc-950/80"
              )}
            >
              <div className="flex items-center gap-3 border-b border-white/5 px-3 py-3 sm:px-4">
                <button
                  type="button"
                  onClick={closeMonth}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                >
                  <ArrowLeft className="size-4" />
                  Рік
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold capitalize tracking-tight text-zinc-50 sm:text-lg">
                    {format(expanded.monthDate, "LLLL yyyy", { locale: uk })}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {ukStationLabel(expanded.count)} · натисніть день
                  </p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-1.5">
                  {WEEKDAYS.map((d) => (
                    <div
                      key={d}
                      className="text-center text-[10px] font-bold tracking-wider text-zinc-600 uppercase"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {expandedCells.map((day, i) => {
                    const iso = day ? format(day, "yyyy-MM-dd") : `pad-${i}`;
                    return (
                      <DayCellExpanded
                        key={iso}
                        day={day}
                        monthDate={expanded.monthDate}
                        bucket={
                          day
                            ? bucketsByIso.get(format(day, "yyyy-MM-dd"))
                            : undefined
                        }
                        selected={
                          day != null &&
                          selectedBucket != null &&
                          isSameDay(day, selectedBucket.date)
                        }
                        onSelect={(bucket) => setSelectedDayIso(bucket.dateIso)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <AnimatePresence mode="wait">
                {selectedBucket ? (
                  <motion.div
                    key={selectedBucket.dateIso}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.18 }}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    <DayStationsPanel
                      bucket={selectedBucket}
                      onClose={() => setSelectedDayIso(null)}
                      onEventClick={onEventClick}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="hidden flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center lg:flex"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-300">
                        Оберіть день
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Підсвічені дати мають станції — відкрийте деталі як у
                        розділі «Станції»
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  { label: string; dot: string; soft: string; ring: string; Icon: typeof Tractor }
> = {
  equipment: {
    label: "Наряди",
    dot: "bg-orange-400",
    soft: "bg-orange-500/20 text-orange-200",
    ring: "ring-orange-400/35",
    Icon: Tractor,
  },
  inventory: {
    label: "ТМЦ",
    dot: "bg-emerald-400",
    soft: "bg-emerald-500/20 text-emerald-200",
    ring: "ring-emerald-400/35",
    Icon: PackageMinus,
  },
  scouting: {
    label: "Скаутинг",
    dot: "bg-sky-400",
    soft: "bg-sky-500/20 text-sky-200",
    ring: "ring-sky-400/35",
    Icon: Camera,
  },
};

function agroMonthDate(seasonYear: number, monthIndex: number): Date {
  const month = AGRO_MONTH_OFFSETS[monthIndex]!;
  const year = month >= 2 ? seasonYear : seasonYear + 1;
  return new Date(year, month, 1, 12, 0, 0, 0);
}

function mondayIndex(date: Date): number {
  // getDay: 0=Sun … → Mon-first 0..6
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

function heatClass(count: number): string {
  if (count <= 0) return "bg-transparent";
  if (count === 1) return "bg-emerald-500/10";
  if (count === 2) return "bg-emerald-500/18";
  if (count <= 4) return "bg-emerald-500/28";
  return "bg-emerald-400/40";
}

function typeMixBar(byType: DayBucket["byType"]) {
  const total =
    byType.equipment + byType.inventory + byType.scouting;
  if (total <= 0) return null;
  return (
    <div className="mt-auto flex h-1 w-full overflow-hidden rounded-full bg-white/5">
      {byType.equipment > 0 ? (
        <span
          className="h-full bg-orange-400/80"
          style={{ width: `${(byType.equipment / total) * 100}%` }}
        />
      ) : null}
      {byType.inventory > 0 ? (
        <span
          className="h-full bg-emerald-400/80"
          style={{ width: `${(byType.inventory / total) * 100}%` }}
        />
      ) : null}
      {byType.scouting > 0 ? (
        <span
          className="h-full bg-sky-400/80"
          style={{ width: `${(byType.scouting / total) * 100}%` }}
        />
      ) : null}
    </div>
  );
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
    <div className="grid grid-cols-7 gap-[3px]">
      {cells.map((day, i) => {
        if (!day || !isSameMonth(day, monthDate)) {
          return <div key={`e-${i}`} className="aspect-square rounded-[3px]" />;
        }
        const iso = format(day, "yyyy-MM-dd");
        const bucket = buckets.get(iso);
        const count = bucket?.stations.length ?? 0;
        return (
          <div
            key={iso}
            className={cn(
              "aspect-square rounded-[3px] ring-1 ring-inset ring-white/[0.04]",
              heatClass(count),
              count > 0 && "shadow-[0_0_8px_-2px_rgba(52,211,153,0.45)]"
            )}
          />
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
    return <div className="min-h-[44px] rounded-xl sm:min-h-[56px]" />;
  }
  const count = bucket?.stations.length ?? 0;
  const has = count > 0;
  const today = isToday(day);

  return (
    <button
      type="button"
      disabled={!has}
      onClick={() => {
        if (bucket) onSelect(bucket);
      }}
      className={cn(
        "group relative flex min-h-[44px] flex-col rounded-xl border p-1.5 text-left transition sm:min-h-[56px] sm:rounded-2xl sm:p-2",
        has
          ? "border-white/10 bg-white/[0.03] hover:border-emerald-400/30 hover:bg-emerald-500/[0.08] active:scale-[0.98]"
          : "border-transparent bg-transparent text-zinc-600",
        selected && "border-emerald-400/50 bg-emerald-500/15 ring-1 ring-emerald-400/30",
        today && !selected && "ring-1 ring-white/20"
      )}
    >
      <span
        className={cn(
          "text-[11px] font-semibold tabular-nums sm:text-xs",
          has ? "text-zinc-100" : "text-zinc-600",
          today && "text-emerald-300"
        )}
      >
        {format(day, "d")}
      </span>
      {has ? (
        <>
          <div className="mt-1 flex flex-wrap gap-0.5">
            {(
              ["equipment", "inventory", "scouting"] as UnifiedTimelineEventType[]
            ).map((type) => {
              const n = bucket?.byType[type] ?? 0;
              if (n <= 0) return null;
              return (
                <span
                  key={type}
                  className={cn(
                    "inline-flex h-1.5 min-w-1.5 rounded-full sm:h-2 sm:min-w-2",
                    TYPE_META[type].dot,
                    n > 1 && "px-1"
                  )}
                />
              );
            })}
          </div>
          <span className="mt-auto hidden text-[9px] font-medium text-zinc-500 sm:block">
            {count}
          </span>
        </>
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
    <motion.aside
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "flex max-h-[42vh] flex-col overflow-hidden rounded-[1.5rem] border border-white/10",
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

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        {bucket.stations.map(({ event, field }) => {
          const meta = TYPE_META[event.type];
          const Icon = meta.Icon;
          return (
            <li key={`${field.id}:${event.id}`}>
              <button
                type="button"
                onClick={() => onEventClick(field, event)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition",
                  "hover:border-white/15 hover:bg-white/[0.06] active:scale-[0.99]"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
                    meta.soft,
                    meta.ring
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-50">
                    {event.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-400">
                    {field.name}
                    {event.subtitle ? ` · ${event.subtitle}` : ""}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                        meta.soft
                      )}
                    >
                      {meta.label}
                    </span>
                    {event.metric ? (
                      <span className="text-[11px] font-medium tabular-nums text-zinc-400">
                        {event.metric}
                      </span>
                    ) : null}
                    {event.cost > 0 ? (
                      <span className="text-[11px] font-medium tabular-nums text-zinc-500">
                        {new Intl.NumberFormat("uk-UA", {
                          maximumFractionDigits: 0,
                        }).format(event.cost)}{" "}
                        ₴
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.aside>
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-[140px] animate-pulse rounded-[1.35rem] border border-white/5 bg-white/[0.03] sm:h-[168px]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
          {(
            Object.keys(TYPE_META) as UnifiedTimelineEventType[]
          ).map((type) => (
            <span
              key={type}
              className="inline-flex items-center gap-1.5 text-[10px] font-medium text-zinc-500"
            >
              <span className={cn("size-1.5 rounded-full", TYPE_META[type].dot)} />
              {TYPE_META[type].label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} mode="popLayout">
          {expanded == null ? (
            <motion.div
              key="year"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-2 content-start gap-2 pb-2 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3"
            >
              {months.map((month) => {
                const active = month.count > 0;
                return (
                  <motion.button
                    key={month.prefix}
                    type="button"
                    layoutId={`month-card-${month.index}`}
                    onClick={() => openMonth(month.index)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.985 }}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-[1.35rem] border p-3 text-left sm:rounded-[1.5rem] sm:p-3.5",
                      "bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent",
                      "shadow-[0_16px_40px_-24px_rgba(0,0,0,0.8)] transition",
                      active
                        ? "border-white/12 hover:border-emerald-400/35"
                        : "border-white/6 opacity-70 hover:opacity-90"
                    )}
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -top-10 -right-8 size-28 rounded-full bg-emerald-500/10 blur-3xl transition group-hover:bg-emerald-400/15"
                    />
                    <div className="relative flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold tracking-[0.08em] text-zinc-500 uppercase">
                          {format(month.monthDate, "LLL", { locale: uk })}
                        </p>
                        <p className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-50 capitalize sm:text-xl">
                          {format(month.monthDate, "LLLL", { locale: uk })}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                          active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/5 text-zinc-600"
                        )}
                      >
                        {month.count}
                      </span>
                    </div>
                    <div className="relative mt-3">
                      <MonthMiniHeat
                        monthDate={month.monthDate}
                        buckets={bucketsByIso}
                      />
                    </div>
                    <div className="relative mt-3">
                      {typeMixBar(month.byType) ?? (
                        <div className="h-1 w-full rounded-full bg-white/[0.04]" />
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key={`month-${expanded.index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex min-h-0 flex-col gap-3 lg:h-full lg:flex-row"
            >
              <motion.div
                layoutId={`month-card-${expanded.index}`}
                className={cn(
                  "flex min-h-0 flex-[1.4] flex-col overflow-hidden rounded-[1.6rem] border border-white/12",
                  "bg-gradient-to-br from-zinc-900/90 via-zinc-950/95 to-black/80",
                  "shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
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
                          bucket={day ? bucketsByIso.get(format(day, "yyyy-MM-dd")) : undefined}
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
              </motion.div>

              <div className="flex min-h-0 flex-1 flex-col">
                <AnimatePresence mode="wait">
                  {selectedBucket ? (
                    <DayStationsPanel
                      key={selectedBucket.dateIso}
                      bucket={selectedBucket}
                      onClose={() => setSelectedDayIso(null)}
                      onEventClick={onEventClick}
                    />
                  ) : (
                    <motion.div
                      key="hint"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hidden flex-1 items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] px-6 text-center lg:flex"
                    >
                      <div>
                        <p className="text-sm font-medium text-zinc-300">
                          Оберіть день
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Підсвічені дати мають станції — відкрийте деталі одним
                          дотиком
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
    </div>
  );
}

"use client";

import { format, isToday, isYesterday } from "date-fns";
import { uk } from "date-fns/locale";
import {
  FlaskConical,
  Fuel,
  Package,
  Sprout,
  Tractor,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ChevronDown,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeFieldCrop } from "@/components/dashboard/field-passport-form";
import type {
  FieldWithTimeline,
  UnifiedTimelineEvent,
  UnifiedTimelineIcon,
} from "@/lib/field-timeline";
import { useFieldTimeline } from "@/lib/use-field-timeline";
import { cn } from "@/lib/utils";

function formatAreaHa(areaHa: number): string {
  const value = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: areaHa >= 100 ? 0 : 1,
  }).format(areaHa);
  return `${value} га`;
}

function formatEventDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: uk });
}

function lastActionLabel(events: UnifiedTimelineEvent[]): string {
  if (events.length === 0) return "Немає подій за сезон";

  const latest = events[0];
  const d = new Date(`${latest.date.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Остання дія: —";
  if (isToday(d)) return "Остання дія: Сьогодні";
  if (isYesterday(d)) return "Остання дія: Вчора";
  return `Остання дія: ${format(d, "d MMM", { locale: uk })}`;
}

function timelineIcon(icon: UnifiedTimelineIcon, type: UnifiedTimelineEvent["type"]) {
  if (type === "equipment") {
    return <Tractor className="size-4 shrink-0 text-orange-400" aria-hidden />;
  }

  switch (icon) {
    case "wheat":
      return <Sprout className="size-4 shrink-0 text-emerald-400" aria-hidden />;
    case "flask":
      return (
        <FlaskConical className="size-4 shrink-0 text-emerald-400" aria-hidden />
      );
    case "fuel":
      return <Fuel className="size-4 shrink-0 text-emerald-400" aria-hidden />;
    case "package":
    default:
      return <Package className="size-4 shrink-0 text-emerald-400" aria-hidden />;
  }
}

function TimelineEventRow({ event }: { event: UnifiedTimelineEvent }) {
  const dotClass =
    event.type === "equipment"
      ? "border-orange-500"
      : "border-emerald-500";

  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          "absolute -left-[9px] mt-1.5 size-4 rounded-full bg-zinc-950 border-2",
          dotClass
        )}
      />
      <div className="flex flex-col gap-1">
        <time
          className="text-xs text-muted-foreground"
          dateTime={event.date}
        >
          {formatEventDate(event.date)}
        </time>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {timelineIcon(event.icon, event.type)}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">
                {event.title}
              </p>
              <p className="truncate text-xs text-zinc-400">{event.subtitle}</p>
            </div>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-50">
            {event.metric}
          </p>
        </div>
      </div>
    </li>
  );
}

function FieldTimelineAccordionItem({ item }: { item: FieldWithTimeline }) {
  const { field, events } = item;
  const crop = normalizeFieldCrop(field.crop);

  return (
    <AccordionItem value={field.id} className="border-0">
      <AccordionTrigger
        className={cn(
          "group mb-3 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-md",
          "flex flex-col items-stretch gap-0 hover:no-underline",
          "data-[state=open]:border-white/15 data-[state=open]:bg-white/[0.07]"
        )}
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="truncate text-lg font-semibold tracking-tight text-zinc-50">
                {field.name}
              </h3>
              <span className="shrink-0 text-sm text-zinc-400">
                {formatAreaHa(field.areaHa)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="truncate text-sm text-zinc-300">{crop}</p>
              <p className="shrink-0 text-xs text-zinc-500">
                {lastActionLabel(events)}
              </p>
            </div>
          </div>
          <ChevronDown
            className="mt-1 size-4 shrink-0 text-zinc-500 transition-transform duration-300 ease-out group-data-[state=open]:text-zinc-300"
            aria-hidden
          />
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-1">
        {events.length === 0 ? (
          <p className="ml-4 border-l-2 border-zinc-800 py-2 pl-6 text-sm text-zinc-500 italic">
            Історія операцій порожня
          </p>
        ) : (
          <ol className="relative mt-2 ml-4 space-y-6 border-l-2 border-zinc-800 pb-4 pl-6">
            {events.map((event) => (
              <TimelineEventRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function OperationsMatrixSkeleton() {
  return (
    <div
      className="space-y-3"
      aria-busy="true"
      aria-label="Завантаження хронології"
    >
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="h-[5.25rem] w-full animate-pulse rounded-2xl border border-white/5 bg-white/10"
        />
      ))}
    </div>
  );
}

export function OperationsMatrixView() {
  const { fieldsWithTimeline, isLoading, error, season } = useFieldTimeline();

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-50">
      <header className="shrink-0 border-b border-white/5 px-4 pt-[max(0.75rem,var(--safe-top))] pb-3">
        <p className="text-[11px] font-medium tracking-[0.18em] text-zinc-500 uppercase">
          Field Operations Matrix
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
          Операційна хронологія
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Сезон {season} · техніка та списання ТМЦ
        </p>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4",
          "pb-[calc(var(--bottom-nav-height)+1rem)] md:pb-6"
        )}
      >
        {isLoading ? <OperationsMatrixSkeleton /> : null}

        {!isLoading && error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {!isLoading && !error ? (
          <Accordion
            type="single"
            collapsible
            className="w-full"
          >
            {fieldsWithTimeline.map((item) => (
              <FieldTimelineAccordionItem key={item.field.id} item={item} />
            ))}
          </Accordion>
        ) : null}

        {!isLoading && !error && fieldsWithTimeline.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-400">
            Активних полів не знайдено.
          </p>
        ) : null}
      </div>
    </section>
  );
}

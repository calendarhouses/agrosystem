"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import {
  FlaskConical,
  Fuel,
  LandPlot,
  MoreHorizontal,
  Package,
  Satellite,
  Tractor,
  Wallet,
  Edit3,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { FieldEvent } from "@/lib/field-events";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value))} ₴`;
}

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatEventDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: uk });
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Завантаження історії">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 rounded-2xl border border-[#E5DFD3]/80 bg-white/80 p-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationEventCard({
  event,
  onCorrect,
}: {
  event: Extract<FieldEvent, { type: "operation" }>;
  onCorrect?: (operationId: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
            {event.title}
          </p>
          {event.machinery ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {event.machinery}
            </p>
          ) : null}
          {event.closedByName || event.actorName ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              {event.closedByName || event.actorName}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <time className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-400">
            {formatEventDate(event.date)}
          </time>
          {onCorrect ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Дії з нарядом"
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => onCorrect(event.id)}
                >
                  <Edit3 className="h-4 w-4 text-zinc-500" />
                  Коригувати результати
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {event.areaHa > 0 ? (
          <Badge
            variant="secondary"
            className="h-6 gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800"
          >
            <LandPlot className="size-3!" />
            Зроблено: {formatQty(event.areaHa, "га")}
          </Badge>
        ) : null}
        {event.fuelUsedL > 0 ? (
          <Badge
            variant="secondary"
            className="h-6 gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700"
          >
            <Fuel className="size-3!" />
            Паливо: {formatQty(event.fuelUsedL, "л")}
          </Badge>
        ) : null}
        {event.wageUah > 0 ? (
          <Badge
            variant="secondary"
            className="h-6 gap-1 rounded-lg border border-violet-100 bg-violet-50 px-2 text-[11px] font-semibold text-violet-800"
          >
            <Wallet className="size-3!" />
            ЗП: {formatUah(event.wageUah)}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

function MaterialEventCard({ event }: { event: Extract<FieldEvent, { type: "material" }> }) {
  const isChem = event.category === "zzr";
  const Icon = isChem ? FlaskConical : Package;

  return (
    <article className="rounded-2xl border border-amber-200/70 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
            Внесення: {event.title}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{event.categoryLabel}</p>
          {event.actorName ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              {event.actorName}
            </p>
          ) : null}
        </div>
        <time className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-400">
          {formatEventDate(event.date)}
        </time>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="h-6 gap-1 rounded-lg border border-amber-100 bg-amber-50 px-2 text-[11px] font-semibold text-amber-900"
        >
          <Icon className="size-3!" />
          Кількість: {formatQty(event.qty, event.unit)}
        </Badge>
        {event.costUah > 0 ? (
          <span className="text-[11px] font-medium tabular-nums text-zinc-500">
            {formatUah(event.costUah)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function WialonFuelEventCard({
  event,
}: {
  event: Extract<FieldEvent, { type: "wialon_fuel" }>;
}) {
  return (
    <article className="rounded-2xl border border-sky-200/80 bg-sky-50/40 p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
            {event.title}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">Автоматично · ДРП Wialon</p>
        </div>
        <time className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-400">
          {formatEventDate(event.date)}
        </time>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="h-6 gap-1 rounded-lg border border-sky-100 bg-white px-2 text-[11px] font-semibold text-sky-900"
        >
          <Fuel className="size-3!" />
          {formatQty(event.fuelUsedL, "л")}
        </Badge>
        {event.fuelCostUah > 0 ? (
          <span className="text-[11px] font-medium tabular-nums text-zinc-500">
            {formatUah(event.fuelCostUah)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function TimelineItem({
  event,
  index,
  isLast,
  onCorrectOperation,
}: {
  event: FieldEvent;
  index: number;
  isLast: boolean;
  onCorrectOperation?: (operationId: string) => void;
}) {
  const isOp = event.type === "operation";
  const isWialon = event.type === "wialon_fuel";

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{
        duration: 0.28,
        delay: Math.min(index * 0.045, 0.35),
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative flex gap-3"
    >
      <div className="relative flex w-10 shrink-0 flex-col items-center">
        <span
          className={cn(
            "relative z-[1] inline-flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-[#F4F1EA]",
            isWialon
              ? "bg-sky-100 text-sky-800"
              : isOp
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
          )}
        >
          {isWialon ? (
            <Satellite className="h-4 w-4" />
          ) : isOp ? (
            <Tractor className="h-4 w-4" />
          ) : event.category === "zzr" ? (
            <FlaskConical className="h-4 w-4" />
          ) : (
            <Package className="h-4 w-4" />
          )}
        </span>
        {!isLast ? (
          <span
            className="absolute top-10 bottom-[-12px] w-px bg-[#D6D0C4]"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        {isWialon ? (
          <WialonFuelEventCard event={event} />
        ) : isOp ? (
          <OperationEventCard
            event={event}
            onCorrect={onCorrectOperation}
          />
        ) : (
          <MaterialEventCard event={event} />
        )}
      </div>
    </motion.li>
  );
}

export type FieldHistoryTimelineProps = {
  events: FieldEvent[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCorrectOperation?: (operationId: string) => void;
  emptyHint?: string;
  className?: string;
};

export function FieldHistoryTimeline({
  events,
  loading = false,
  error = null,
  onRetry,
  onCorrectOperation,
  emptyHint = "Списання ТМЦ, Wialon-паливо і закриті наряди зʼявляться тут автоматично.",
  className,
}: FieldHistoryTimelineProps) {
  if (loading && events.length === 0) {
    return (
      <div className={className}>
        <TimelineSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950",
          className
        )}
      >
        <p className="font-semibold">Не вдалося завантажити історію</p>
        <p className="mt-1 text-amber-900/80">{error}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 text-xs font-semibold underline-offset-2 hover:underline"
          >
            Спробувати знову
          </button>
        ) : null}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-12 text-center",
          className
        )}
      >
        <p className="text-sm font-semibold text-zinc-800">Поки порожньо</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{emptyHint}</p>
      </div>
    );
  }

  return (
    <ul className={cn("relative", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {events.map((event, index) => (
          <TimelineItem
            key={event.id}
            event={event}
            index={index}
            isLast={index === events.length - 1}
            onCorrectOperation={onCorrectOperation}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

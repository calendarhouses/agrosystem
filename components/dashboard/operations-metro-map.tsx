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
  Wheat,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { normalizeFieldCrop } from "@/components/dashboard/field-passport-form";
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
} from "@/lib/field-timeline";
import {
  timelineEventDateIso,
  toTimelineField,
} from "@/lib/field-timeline";
import {
  groupTimelineByCrop,
  normalizeFieldLineColor,
  TIMELINE_NO_CROP_LABEL,
  type TimelineCropGroup,
} from "@/lib/field-timeline-crops";
import { cn } from "@/lib/utils";

export type OperationsMetroVariant = "mobile" | "desktop";

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
  return format(date, "d MMM yyyy", { locale: uk });
}

function formatUah(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return uahFormatter.format(value);
}

function formatCostUah(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return uahFormatterPrecise.format(value);
}

function nodeBorderClass(type: UnifiedTimelineEventType): string {
  switch (type) {
    case "equipment":
      return "border-orange-400";
    case "inventory":
      return "border-emerald-400";
    case "scouting":
      return "border-blue-400";
  }
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

function EventTypeIcon({
  event,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  desktop?: boolean;
}) {
  const box = cn(
    "flex size-9 shrink-0 items-center justify-center rounded-xl border",
    desktop ? "border-zinc-200/80 bg-zinc-50" : "border-white/10 bg-white/[0.04]"
  );

  if (event.type === "equipment") {
    return (
      <div className={box}>
        <Tractor
          className={cn("size-4", desktop ? "text-orange-600" : "text-orange-400")}
          aria-hidden
        />
      </div>
    );
  }
  if (event.type === "scouting") {
    return (
      <div className={box}>
        <Search
          className={cn("size-4", desktop ? "text-blue-600" : "text-blue-400")}
          aria-hidden
        />
      </div>
    );
  }
  if (event.subtitle === "Насіння") {
    return (
      <div className={box}>
        <Sprout
          className={cn("size-4", desktop ? "text-emerald-700" : "text-emerald-400")}
          aria-hidden
        />
      </div>
    );
  }
  if (event.subtitle === "Добрива") {
    return (
      <div className={box}>
        <FlaskConical
          className={cn("size-4", desktop ? "text-emerald-700" : "text-emerald-400")}
          aria-hidden
        />
      </div>
    );
  }
  return (
    <div className={box}>
      <Package
        className={cn("size-4", desktop ? "text-emerald-700" : "text-emerald-400")}
        aria-hidden
      />
    </div>
  );
}

function TimelineEventDateRow({
  event,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  desktop?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-1">
      <time
        className={cn(
          "text-[10px] font-semibold tracking-[0.14em] uppercase",
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

function TimelineStandardEventCard({
  event,
  onClick,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
  desktop?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl p-3 text-left transition active:scale-[0.99]",
        desktop
          ? "border border-[#E5DFD3]/90 bg-white/90 shadow-sm hover:border-[#276749]/20 hover:shadow-md"
          : "border border-white/10 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]"
      )}
    >
      <TimelineEventDateRow event={event} desktop={desktop} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <EventTypeIcon event={event} desktop={desktop} />
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-sm font-semibold tracking-tight",
                desktop ? "text-zinc-900" : "text-zinc-100"
              )}
            >
              {event.title}
            </p>
            <p
              className={cn(
                "mt-0.5 truncate text-xs",
                desktop ? "text-zinc-500" : "text-zinc-400"
              )}
            >
              {event.subtitle}
            </p>
            <p
              className={cn(
                "mt-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase",
                event.type === "equipment"
                  ? desktop
                    ? "text-orange-600"
                    : "text-orange-400/90"
                  : desktop
                    ? "text-emerald-700"
                    : "text-emerald-400/90"
              )}
            >
              {eventTypeLabel(event.type)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-sm font-bold tabular-nums tracking-tight",
              desktop ? "text-zinc-900" : "text-zinc-50"
            )}
          >
            {event.metric ?? "—"}
          </p>
          <p
            className={cn(
              "mt-1 text-xs tabular-nums",
              desktop ? "text-red-600/80" : "text-red-400/80"
            )}
          >
            {formatCostUah(event.cost)}
          </p>
        </div>
      </div>
    </button>
  );
}

function TimelineScoutingEventCard({
  event,
  onClick,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
  desktop?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl p-3 text-left transition active:scale-[0.99]",
        desktop
          ? "border border-[#E5DFD3]/90 bg-white/90 shadow-sm hover:border-blue-200 hover:shadow-md"
          : "border border-white/10 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]"
      )}
    >
      <TimelineEventDateRow event={event} desktop={desktop} />

      {event.imageUrl ? (
        <img
          src={event.imageUrl}
          alt=""
          loading="lazy"
          className={cn(
            "mt-2 h-40 w-full rounded-xl border object-cover shadow-sm",
            desktop ? "border-zinc-200/80" : "border-white/10"
          )}
        />
      ) : (
        <div
          className={cn(
            "mt-2 flex h-40 w-full items-center justify-center rounded-xl border border-dashed",
            desktop
              ? "border-zinc-200 bg-zinc-50 text-zinc-400"
              : "border-white/10 bg-white/[0.02] text-zinc-500"
          )}
        >
          <Wheat className="size-8 opacity-40" aria-hidden />
        </div>
      )}

      {event.notes ? (
        <p
          className={cn(
            "mt-2 text-sm leading-relaxed",
            desktop ? "text-zinc-600" : "text-zinc-300"
          )}
        >
          {event.notes}
        </p>
      ) : null}
    </button>
  );
}

function TimelineEventCard({
  event,
  onClick,
  desktop,
}: {
  event: UnifiedTimelineEvent;
  onClick?: () => void;
  desktop?: boolean;
}) {
  if (event.type === "scouting") {
    return (
      <TimelineScoutingEventCard event={event} onClick={onClick} desktop={desktop} />
    );
  }
  return (
    <TimelineStandardEventCard event={event} onClick={onClick} desktop={desktop} />
  );
}

function TimelineEmptyState({
  onAdd,
  desktop,
}: {
  onAdd?: () => void;
  desktop?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div
        className={cn(
          "mb-4 flex size-14 items-center justify-center rounded-2xl border",
          desktop
            ? "border-[#E5DFD3] bg-[#F4F1EA]"
            : "border-white/10 bg-white/[0.04]"
        )}
      >
        <Package
          className={cn("size-6", desktop ? "text-zinc-400" : "text-zinc-500")}
          aria-hidden
        />
      </div>
      <p
        className={cn(
          "text-sm font-medium",
          desktop ? "text-zinc-700" : "text-zinc-300"
        )}
      >
        Історія операцій порожня
      </p>
      <p
        className={cn(
          "mt-1 max-w-[16rem] text-xs leading-relaxed",
          desktop ? "text-zinc-500" : "text-zinc-500"
        )}
      >
        Додайте наряд техніки, списання ТМЦ або звіт скаутингу
      </p>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition",
            desktop
              ? "border-[#E5DFD3] bg-white text-zinc-700 hover:bg-[#F4F1EA]"
              : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
          )}
        >
          <Plus className="size-4" />
          Додати першу позицію
        </button>
      ) : null}
    </div>
  );
}

function VerticalFieldTimeline({
  events,
  field,
  onEventClick,
  onAddClick,
  desktop,
}: {
  events: UnifiedTimelineEvent[];
  field: FieldTimelineField;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: () => void;
  desktop?: boolean;
}) {
  if (events.length === 0) {
    return <TimelineEmptyState onAdd={onAddClick} desktop={desktop} />;
  }

  return (
    <div
      className={cn("relative", desktop ? "px-1 pb-1" : "px-0 pb-1")}
      data-allow-pan="true"
    >
      {/* Лінія від верху блоку до низу останньої події */}
      <div
        className={cn(
          "absolute top-0 bottom-0 left-[7px] w-0 border-l-2",
          desktop ? "border-zinc-200" : "border-white/10"
        )}
        aria-hidden
      />

      <ul className="relative space-y-4">
        {events.map((event) => (
          <li key={event.id} className="relative pl-6">
            <span
              className={cn(
                "absolute top-5 -left-[9px] size-4 rounded-full border-2",
                desktop ? "bg-white" : "bg-zinc-950",
                nodeBorderClass(event.type)
              )}
              aria-hidden
            />
            <TimelineEventCard
              event={event}
              desktop={desktop}
              onClick={() => onEventClick?.(field, event)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetroFieldLine({
  item,
  onEventClick,
  onAddClick,
  variant = "mobile",
}: {
  item: FieldWithTimeline;
  onEventClick?: (field: FieldTimelineField, event: UnifiedTimelineEvent) => void;
  onAddClick?: (field: FieldTimelineField) => void;
  variant?: OperationsMetroVariant;
}) {
  const desktop = variant === "desktop";
  const field = toTimelineField(item);
  const accent = normalizeFieldLineColor(item.color);

  const events = useMemo(
    () =>
      [...item.events].sort((a, b) => b.date.getTime() - a.date.getTime()),
    [item.events]
  );

  return (
    <AccordionItem
      value={item.fieldId}
      className={cn(
        "overflow-hidden rounded-2xl border",
        desktop
          ? "border-[#E5DFD3]/90 bg-white/80 shadow-sm"
          : "border-white/10 bg-white/5 backdrop-blur-md"
      )}
    >
      <AccordionTrigger
        className={cn(
          "group w-full p-4 hover:no-underline [&>svg]:hidden",
          desktop ? "hover:bg-white/60" : "hover:bg-white/[0.03]"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start justify-between gap-4 pr-1">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex h-2 w-8 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <h3
                className={cn(
                  "truncate text-lg font-medium tracking-tight",
                  desktop ? "text-zinc-900" : "text-zinc-100"
                )}
              >
                {item.fieldName}
              </h3>
            </div>
            <p
              className={cn(
                "mt-1 text-sm",
                desktop ? "text-zinc-500" : "text-zinc-400"
              )}
            >
              {normalizeFieldCrop(item.cropName) || TIMELINE_NO_CROP_LABEL}
              <span className="mx-1.5 opacity-40">·</span>
              {formatAreaHa(item.area)}
            </p>
          </div>

          <div className="flex shrink-0 items-start gap-2">
            <div className="text-right">
              <p
                className={cn(
                  "text-base font-semibold tabular-nums tracking-tight",
                  desktop ? "text-red-600/90" : "text-red-400/90"
                )}
              >
                {formatUah(item.totalCost)}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[10px] tabular-nums",
                  desktop ? "text-zinc-400" : "text-zinc-500"
                )}
              >
                {item.area > 0 && item.totalCost > 0
                  ? `${formatCostUah(item.costPerHectare)}/га`
                  : "—/га"}
              </p>
            </div>

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
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              )}
              aria-label={`Додати позицію для ${item.fieldName}`}
            >
              <Plus className="size-4" />
            </button>

            <ChevronDown
              className={cn(
                "mt-1 size-5 shrink-0 transition-transform duration-300 group-data-[state=open]:rotate-180",
                desktop ? "text-zinc-400" : "text-zinc-500"
              )}
            />
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent
        className={cn("px-4 pb-4 pt-1", !desktop && "touch-pan-xy")}
        data-allow-pan="true"
      >
        <VerticalFieldTimeline
          events={events}
          field={field}
          desktop={desktop}
          onEventClick={onEventClick}
          onAddClick={() => onAddClick?.(field)}
        />
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
      : `${group.fieldCount} ${group.fieldCount === 1 ? "поле" : group.fieldCount < 5 ? "поля" : "полів"} · ${group.stationCount} ${group.stationCount === 1 ? "станція" : group.stationCount < 5 ? "станції" : "станцій"}`;

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
      {fields.map((item) => (
        <MetroFieldLine
          key={item.fieldId}
          item={item}
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
    <div className="space-y-3" aria-busy="true" aria-label="Завантаження хронології">
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-28 w-full animate-pulse rounded-2xl border",
            desktop
              ? "border-[#E5DFD3]/80 bg-white/60"
              : "border-white/10 bg-white/5"
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
                    {activeGroup.fieldCount}{" "}
                    {activeGroup.fieldCount === 1 ? "поле" : "полів"} ·{" "}
                    {activeGroup.stationCount}{" "}
                    {activeGroup.stationCount === 1 ? "станція" : "станцій"} ·{" "}
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
              {activeGroup.fieldCount}{" "}
              {activeGroup.fieldCount === 1 ? "поле" : "полів"} ·{" "}
              {activeGroup.stationCount}{" "}
              {activeGroup.stationCount === 1 ? "станція" : "станцій"} ·{" "}
              {formatAreaHa(activeGroup.totalAreaHa)}
            </p>
          </div>
        </div>
      </div>

      {fieldsPanel}
    </div>
  );
}

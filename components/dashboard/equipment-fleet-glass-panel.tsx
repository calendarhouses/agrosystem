"use client";

import type { ReactNode, TouchEvent as ReactTouchEvent } from "react";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Radar, Route, Tractor } from "lucide-react";

import {
  FleetDaySummaryBar,
  type FleetDaySummary,
  type FleetSummaryMetric,
} from "@/components/dashboard/fleet-day-summary-bar";
import {
  FleetAlertStrip,
  type FleetAlert,
  type FleetAlertKind,
} from "@/components/dashboard/fleet-alert-strip";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { FleetNonTrackedItem, FleetTrackedUnit } from "@/lib/equipment-fleet";
import type { FleetActiveOperation } from "@/lib/equipment-active-ops";
import { formatCountPlural } from "@/lib/plural";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

/** Висота мобільної шторки флоту (над нижнім меню) */
export const EQUIPMENT_MOBILE_DRAWER_SIZE =
  "h-[calc(88dvh-var(--app-bottom-inset))] max-h-[calc(88dvh-var(--app-bottom-inset))]";

const PEEK_SWIPE_UP_PX = 36;

function FleetPeekCue({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 right-3 z-10 -translate-y-1/2",
        "flex items-center justify-center text-emerald-800",
        className
      )}
    >
      <motion.span
        className="flex items-center justify-center"
        animate={{ y: [1, -3, 1] }}
        transition={{ duration: 1.45, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg width="15" height="18" viewBox="0 0 15 18" fill="none">
          <path
            d="M2.5 8.25 7.5 3.5l5 4.75"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.28"
          />
          <path
            d="M2.5 13.25 7.5 8.5l5 4.75"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </motion.span>
    </span>
  );
}

type FieldCtx = { name: string; isBase: boolean } | null;

export type UnitCardGlassProps = {
  unit: FleetTrackedUnit;
  field: FieldCtx;
  selected?: boolean;
  highlight?: FleetAlertKind | null;
  summaryHighlight?: boolean;
  dimmed?: boolean;
  listHovered?: boolean;
  onOpen: () => void;
  onHover?: (unitId: number | null) => void;
};

function opProgressPercent(op: FleetActiveOperation): number | null {
  const plan = op.areaPlan;
  const fact = op.areaFact;
  if (plan != null && plan > 0 && fact != null) {
    return Math.min(100, Math.round((fact / plan) * 100));
  }
  return null;
}

function ActiveOpFieldLink({
  fieldId,
  fieldName,
}: {
  fieldId: string | null;
  fieldName: string;
}) {
  if (!fieldId) return <span>{fieldName}</span>;
  return (
    <Link
      href={`/?field=${encodeURIComponent(fieldId)}`}
      onClick={(e) => e.stopPropagation()}
      className="underline decoration-emerald-500/50 underline-offset-2 hover:decoration-emerald-600"
    >
      {fieldName}
    </Link>
  );
}

export function UnitCardGlass({
  unit,
  field,
  selected,
  highlight,
  summaryHighlight,
  dimmed,
  listHovered,
  onOpen,
  onHover,
}: UnitCardGlassProps) {
  const activeOp = unit.activeOp ?? null;
  const progress = activeOp ? opProgressPercent(activeOp) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onHover?.(unit.id)}
      onMouseLeave={() => onHover?.(null)}
      data-unit-id={unit.id}
      className={cn(
        "group relative w-full rounded-2xl border p-3.5 text-left transition-all duration-300 touch-manipulation",
        "bg-white/55 backdrop-blur-md hover:bg-white/75 hover:shadow-lg",
        "active:scale-[0.99] md:active:scale-100",
        selected &&
          "border-emerald-500/70 bg-white/80 ring-2 ring-emerald-500/25 shadow-lg",
        !selected &&
          listHovered &&
          "border-emerald-500/60 bg-white/80 ring-2 ring-emerald-400/20 shadow-md",
        !selected &&
          summaryHighlight &&
          "border-emerald-600/50 ring-1 ring-emerald-500/20",
        !selected &&
          highlight === "idling" &&
          "border-rose-400/70 ring-1 ring-rose-300/30",
        !selected &&
          highlight === "offline" &&
          "border-amber-400/70 ring-1 ring-amber-300/30",
        !selected &&
          highlight === "fuel" &&
          "border-orange-500/70 ring-1 ring-orange-300/30",
        !selected && !highlight && activeOp && "border-emerald-400/60",
        !selected &&
          !highlight &&
          !activeOp &&
          !listHovered &&
          "border-white/40 shadow-sm",
        dimmed && "opacity-40 grayscale",
        !dimmed && !selected && "hover:-translate-y-0.5"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/60 bg-gradient-to-b from-white/90 to-zinc-100/80 shadow-inner">
          <Radar className="h-5 w-5 text-zinc-700" strokeWidth={1.5} />
          {activeOp ? (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-900">{unit.nm}</p>
          <p
            className={cn(
              "mt-0.5 truncate text-xs font-medium",
              field && !field.isBase ? "text-emerald-700" : "text-zinc-500"
            )}
          >
            {field?.name ?? "Поза полем"}
          </p>
        </div>
      </div>

      {activeOp ? (
        <div className="mt-3 space-y-2 rounded-xl border border-emerald-300/40 bg-emerald-50/60 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-900">
            <span aria-hidden>🚜</span>
            <span className="truncate">
              <ActiveOpFieldLink
                fieldId={activeOp.fieldId}
                fieldName={activeOp.fieldName}
              />
            </span>
            <span className="text-emerald-700/60">·</span>
            <span className="truncate text-green-800">{activeOp.implement}</span>
          </div>
          {progress != null ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold text-emerald-800/80 tabular-nums">
                <span>Виконання наряду</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-emerald-200/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[10px] font-semibold text-emerald-800/90">
              Наряд активний · площа не зафіксована
            </p>
          )}
        </div>
      ) : null}
    </button>
  );
}

const slideVariants = {
  enterFromRight: { x: 24, opacity: 0 },
  enterFromLeft: { x: -24, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exitToLeft: { x: -24, opacity: 0 },
  exitToRight: { x: 24, opacity: 0 },
};

type Props = {
  units: FleetTrackedUnit[];
  nonTracked: FleetNonTrackedItem[];
  towedEquipment: FleetNonTrackedItem[];
  fieldByUnitId: Map<number, FieldCtx>;
  sortedUnitIds: number[];
  unitAlertKinds: Map<number, Set<FleetAlertKind>>;
  summaryHighlightIds: Set<number> | null;
  alertFilter: FleetAlertKind | null;
  fleetAlerts: FleetAlert[];
  onAlertFilterChange: (kind: FleetAlertKind | null) => void;
  selectedUnitId: number | null;
  selectedUnitName?: string | null;
  fleetSummary: FleetDaySummary | null;
  fleetSummaryLoading: boolean;
  fleetSummarySyncHint?: "syncing" | "empty" | null;
  fleetSummaryDate: Date;
  summaryMetric: FleetSummaryMetric | null;
  loading: boolean;
  mobileExpanded: boolean;
  onMobileExpandedChange: (v: boolean) => void;
  onUnitOpen: (unit: FleetTrackedUnit) => void;
  onUnitHover?: (unitId: number | null) => void;
  listHoveredUnitId?: number | null;
  onBackToList: () => void;
  /** Моб: згорнути шторку і показати трек на карті */
  onShowTracker?: () => void;
  onSummaryDateChange: (d: Date) => void;
  onSummaryMetricSelect: (m: FleetSummaryMetric | null) => void;
  onSummaryRefresh?: () => void;
  /** Вміст Vehicle 360 для Master-Detail */
  detailContent: ReactNode;
};

export function EquipmentFleetGlassPanel({
  units,
  nonTracked,
  towedEquipment: _towedEquipment,
  fieldByUnitId,
  sortedUnitIds,
  unitAlertKinds,
  summaryHighlightIds,
  alertFilter,
  fleetAlerts,
  onAlertFilterChange,
  selectedUnitId,
  selectedUnitName,
  fleetSummary,
  fleetSummaryLoading,
  fleetSummarySyncHint = null,
  fleetSummaryDate,
  summaryMetric,
  loading,
  mobileExpanded,
  onMobileExpandedChange,
  onUnitOpen,
  onUnitHover,
  listHoveredUnitId = null,
  onBackToList,
  onShowTracker,
  onSummaryDateChange,
  onSummaryMetricSelect,
  onSummaryRefresh,
  detailContent,
}: Props) {
  const isMobile = useIsMobile();
  const peekSwipeRef = useRef<{ y: number; t: number } | null>(null);
  const drawerOpenedAtRef = useRef(0);

  const sortedUnits = sortedUnitIds
    .map((id) => units.find((u) => u.id === id))
    .filter(Boolean) as FleetTrackedUnit[];

  const showDetail = selectedUnitId != null;
  /** Повний snap лише коли явно розгорнули — деталі можна згорнути в peek над картою */
  const showFullSnap = isMobile && mobileExpanded;

  useEffect(() => {
    if (showFullSnap) drawerOpenedAtRef.current = Date.now();
  }, [showFullSnap]);

  function onPeekTouchStart(event: ReactTouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    peekSwipeRef.current = { y: touch.clientY, t: Date.now() };
  }

  function onPeekTouchEnd(event: ReactTouchEvent) {
    const start = peekSwipeRef.current;
    peekSwipeRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dy = start.y - touch.clientY;
    const dt = Date.now() - start.t;
    if (dy > PEEK_SWIPE_UP_PX && dt < 800) {
      event.preventDefault();
      onMobileExpandedChange(true);
    }
  }

  const listView = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/90 text-white shadow-md">
            <Radar className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight text-zinc-900">
              Диспетчерська
            </p>
            <p className="truncate text-[11px] font-medium text-zinc-500">
              {formatCountPlural(units.length, [
                "одиниця",
                "одиниці",
                "одиниць",
              ])}{" "}
              · GPS наживо
            </p>
          </div>
        </div>
      </div>

      {(fleetSummary || fleetSummaryLoading) && (
        <div className="border-b border-white/25 px-3 py-2" data-vaul-no-drag="">
          <FleetDaySummaryBar
            date={fleetSummaryDate}
            onDateChange={onSummaryDateChange}
            summary={fleetSummary}
            loading={fleetSummaryLoading}
            syncHint={fleetSummarySyncHint}
            activeMetric={summaryMetric}
            onMetricSelect={onSummaryMetricSelect}
            onRefresh={onSummaryRefresh}
            compact
          />
        </div>
      )}

      {!showDetail && !loading ? (
        <div className="border-b border-white/20 px-3 py-2" data-vaul-no-drag="">
          <FleetAlertStrip
            alerts={fleetAlerts}
            activeKind={alertFilter}
            onSelect={(kind) => {
              onAlertFilterChange(kind);
            }}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" data-vaul-no-drag="" data-allow-pan="true">
        <div className="space-y-2 px-3 py-3">
            {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/40 bg-white/55 p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-white/80" />
                    <div className="min-w-0 flex-1 space-y-2 pt-1">
                      <div className="h-3.5 w-[70%] animate-pulse rounded bg-zinc-300/70" />
                      <div className="h-3 w-[42%] animate-pulse rounded bg-zinc-300/50" />
                    </div>
                  </div>
                </div>
              ))
            : sortedUnits.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs font-medium text-zinc-500">
                  Немає техніки з GPS. Перевірте Wialon або зіставлення в
                  налаштуваннях.
                </p>
              )
            : sortedUnits.map((unit) => {
                const kinds = unitAlertKinds.get(unit.id);
                const inSummary = summaryHighlightIds?.has(unit.id) ?? false;
                const highlight =
                  !summaryHighlightIds &&
                  alertFilter &&
                  kinds?.has(alertFilter)
                    ? alertFilter
                    : null;
                const dimmed = summaryHighlightIds
                  ? !inSummary
                  : Boolean(alertFilter && !highlight);
                return (
                  <UnitCardGlass
                    key={unit.id}
                    unit={unit}
                    field={fieldByUnitId.get(unit.id) ?? null}
                    selected={false}
                    highlight={highlight}
                    summaryHighlight={inSummary}
                    dimmed={dimmed}
                    listHovered={listHoveredUnitId === unit.id}
                    onOpen={() => onUnitOpen(unit)}
                    onHover={onUnitHover}
                  />
                );
              })}
        </div>

        {nonTracked.length > 0 ? (
          <div className="px-3 pb-3">
            <div className="px-1 pt-1 pb-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Без трекера ({nonTracked.length})
              </h3>
            </div>
            <div className="space-y-2">
              {nonTracked.map((item) => (
                <div
                  key={`${item.source ?? "equipment"}:${item.equipmentId}`}
                  className={cn(
                    "rounded-xl border bg-white/55 px-3 py-2.5 backdrop-blur-md",
                    item.activeOp
                      ? "border-green-300/70 ring-1 ring-green-200/50"
                      : "border-white/40"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/60 bg-white/80 text-zinc-600">
                      <Tractor className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {item.name}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {item.code ? `${item.code} · ` : ""}
                        Без GPS
                      </p>
                    </div>
                  </div>
                  {item.activeOp ? (
                    <p className="mt-2 text-[11px] font-medium text-green-700">
                      В роботі · {item.activeOp.fieldName}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  const detailView = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/30 px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 min-h-11 flex-1 justify-start gap-1.5 px-2 text-sm font-semibold text-foreground hover:bg-white/60 md:h-8 md:min-h-0 md:flex-none"
            onClick={onBackToList}
          >
            <ArrowLeft className="h-4 w-4" />
            Назад до списку
          </Button>
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-zinc-500 hover:bg-white/60"
              aria-label="Згорнути шторку"
              onClick={() => onMobileExpandedChange(false)}
            >
              <ChevronDown className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
        {selectedUnitName ? (
          <div className="mt-1.5 flex items-center gap-2 px-2">
            <p className="min-w-0 flex-1 truncate text-base font-bold tracking-tight text-zinc-900">
              {selectedUnitName}
            </p>
            {isMobile && onShowTracker ? (
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm shadow-emerald-700/25 hover:bg-emerald-700"
                onClick={onShowTracker}
              >
                <Route className="h-3.5 w-3.5" />
                Трекер
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-3"
        data-vaul-no-drag=""
        data-allow-pan="true"
      >
        {detailContent}
      </div>
    </div>
  );

  const renderPanelBody = () => (
    <div className="relative h-full min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {showDetail ? (
          <motion.div
            key="detail"
            className="absolute inset-0 flex flex-col"
            variants={slideVariants}
            initial="enterFromRight"
            animate="center"
            exit="exitToRight"
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {detailView}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="absolute inset-0 flex flex-col"
            variants={slideVariants}
            initial="enterFromLeft"
            animate="center"
            exit="exitToLeft"
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {listView}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {/* ПК — без змін вигляду; на мобільному тіло лише в Drawer */}
      <aside
        className={cn(
          "pointer-events-auto absolute top-3 bottom-3 left-3 z-20 hidden w-[min(100%,400px)] flex-col overflow-hidden rounded-2xl border border-white/30 shadow-2xl md:flex",
          "bg-background/80 backdrop-blur-2xl"
        )}
      >
        {!isMobile ? renderPanelBody() : null}
      </aside>

      {/* Мобільна шторка — лише <768px */}
      {isMobile ? (
        <>
          {!showFullSnap ? (
            <button
              type="button"
              aria-expanded={false}
              aria-label={
                showDetail
                  ? `Відкрити картку ${selectedUnitName ?? "техніки"}`
                  : "Розгорнути список флоту"
              }
              className="pointer-events-auto fixed inset-x-0 z-[140] flex flex-col border-t border-white/40 bg-[#F4F1EA]/95 shadow-[0_-8px_30px_-12px_rgba(24,24,27,0.35)] backdrop-blur-xl touch-manipulation"
              style={{
                bottom: "var(--app-bottom-inset)",
                height: "var(--fields-peek-height, 4.75rem)",
                borderTopLeftRadius: "1.25rem",
                borderTopRightRadius: "1.25rem",
                touchAction: "pan-y",
              }}
              onTouchStart={onPeekTouchStart}
              onTouchEnd={onPeekTouchEnd}
              onClick={() => onMobileExpandedChange(true)}
            >
              <div
                className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-zinc-400/90"
                aria-hidden
              />
              <span className="relative flex min-h-0 flex-1 items-center gap-3 pr-14 pl-4 pb-2 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-700/25">
                  <Radar className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold leading-tight tracking-tight text-zinc-900">
                    {showDetail ? selectedUnitName || "Техніка" : "Флот"}
                  </span>
                  <span className="block truncate text-[11px] font-medium leading-tight text-zinc-500">
                    {showDetail
                      ? "Свайпніть вгору · деталі та журнал"
                      : loading
                        ? "Завантаження…"
                        : `${formatCountPlural(units.length, ["одиниця", "одиниці", "одиниць"])} · GPS наживо`}
                  </span>
                </span>
              </span>
              <FleetPeekCue />
            </button>
          ) : null}

          <Drawer
            open={showFullSnap}
            onOpenChange={(open) => {
              if (open) {
                drawerOpenedAtRef.current = Date.now();
                onMobileExpandedChange(true);
                return;
              }
              if (Date.now() - drawerOpenedAtRef.current < 400) return;
              onMobileExpandedChange(false);
            }}
            dismissible
            handleOnly
            modal={false}
            shouldScaleBackground={false}
            noBodyStyles
          >
            <DrawerContent
              showCloseButton={false}
              overlayClassName="!bg-transparent !opacity-0 !pointer-events-none"
              className={cn(
                EQUIPMENT_MOBILE_DRAWER_SIZE,
                "flex flex-col rounded-b-none border-x-0 border-t border-b-0 border-white/40 bg-[#F4F1EA] pb-0 shadow-none"
              )}
            >
              <DrawerTitle className="sr-only">
                {showDetail
                  ? selectedUnitName || "Картка техніки"
                  : "Список флоту"}
              </DrawerTitle>
              <DrawerHandle />
              {!showDetail ? (
                <button
                  type="button"
                  onClick={() => onMobileExpandedChange(false)}
                  className="flex w-full shrink-0 items-center justify-between border-b border-[#E5DFD3]/80 px-4 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Radar className="h-4 w-4 text-emerald-700" />
                    <span className="text-sm font-bold text-zinc-900">
                      Флот ({units.length})
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-zinc-500" />
                </button>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {renderPanelBody()}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      ) : null}
    </>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { AgroplanOperationBlock } from "@/components/dashboard/agroplan/agroplan-operation-block";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { groupBlocksByField } from "@/lib/agroplan/blocks";
import { filterFields, type AgroplanFilters } from "@/lib/agroplan/filters";
import {
  assignBlockLanes,
  maxLaneIndex,
  rowHeightForLaneCount,
} from "@/lib/agroplan/lanes";
import {
  buildNdviFieldFlags,
  buildNdviTimelineMarkers,
  filterClimateColumnsByViewport,
  type NdviTimelineMarker,
} from "@/lib/agroplan/ndvi-layer";
import {
  AGROPLAN_ZOOM_LEVELS,
  buildTimelineTicks,
  msToTimelineX,
  timelineXToMs,
  todayMarkerX,
  zoomFromWheelDelta,
  type SeasonWindow,
} from "@/lib/agroplan/timeline";
import {
  climateColumnClass,
  type DayClimateRisk,
} from "@/lib/agroplan/weather-risk";
import type { AgroForecastHour, AgroNdviAlert } from "@/lib/agronomy-engine";
import type { FleetActiveOperation } from "@/lib/equipment-active-ops";
import type { FarmField } from "@/lib/farm-fields";
import { todayKyivYmd, toKyivDayKey } from "@/lib/kyiv-date";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const AGROPLAN_ROW_HEIGHT = 72;
const STICKY_LABEL_W = 168;

export type AgroplanCanvasHandle = {
  scrollToToday: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
};

type Props = {
  fields: FarmField[];
  blocks: AgroplanBlock[];
  filters: AgroplanFilters;
  expandedFieldIds: Set<string>;
  selectedFieldIds?: Set<string>;
  selectedBlockId?: string | null;
  ndviAlerts?: readonly AgroNdviAlert[];
  season: SeasonWindow;
  dayRisks: Map<string, DayClimateRisk>;
  forecastHours: readonly AgroForecastHour[];
  activeOps: FleetActiveOperation[];
  zoomIndex: number;
  onZoomIndexChange: (index: number) => void;
  panMode: boolean;
  onSelectBlock: (block: AgroplanBlock) => void;
  onMoveBlock: (block: AgroplanBlock, startMs: number) => void;
  onResizeBlock?: (block: AgroplanBlock, durationHours: number) => void;
  onExpandAll?: () => void;
  canvasRef?: RefObject<AgroplanCanvasHandle | null>;
};

export function AgroplanCanvas({
  fields,
  blocks,
  filters,
  expandedFieldIds,
  selectedFieldIds,
  selectedBlockId,
  ndviAlerts = [],
  season,
  dayRisks,
  forecastHours,
  activeOps,
  zoomIndex,
  onZoomIndexChange,
  panMode,
  onSelectBlock,
  onMoveBlock,
  onResizeBlock,
  onExpandAll,
  canvasRef,
}: Props) {
  const zoom = AGROPLAN_ZOOM_LEVELS[zoomIndex]!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const panStart = useRef<{ x: number; y: number; sl: number; st: number } | null>(
    null
  );
  const [isPanning, setIsPanning] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const timelineWidth = season.totalWidthPx(zoom.pxPerHour);
  const contentWidth = STICKY_LABEL_W + timelineWidth;
  const ticks = useMemo(
    () => buildTimelineTicks(season, zoom),
    [season, zoom]
  );
  const todayX = todayMarkerX(season, zoom.pxPerHour);
  const blocksByField = useMemo(() => groupBlocksByField(blocks), [blocks]);

  const visibleFields = useMemo(() => {
    const filtered = filterFields(fields, blocksByField, filters);
    return filtered.filter((f) => expandedFieldIds.has(f.id));
  }, [fields, blocksByField, filters, expandedFieldIds]);

  const activeFieldIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of activeOps) {
      if (op.fieldId) set.add(op.fieldId);
    }
    return set;
  }, [activeOps]);

  const fieldRowMeta = useMemo(() => {
    const map = new Map<
      string,
      { height: number; lanes: Map<string, number> }
    >();
    for (const field of visibleFields) {
      const fieldBlocks = blocksByField.get(field.id) ?? [];
      const visible = fieldBlocks.filter((b) =>
        blocks.some((x) => x.id === b.id)
      );
      const lanes = assignBlockLanes(visible);
      const height = rowHeightForLaneCount(maxLaneIndex(lanes));
      map.set(field.id, { height, lanes });
    }
    return map;
  }, [visibleFields, blocksByField, blocks]);

  const climateColumns = useMemo(() => {
    const dayMs = 86_400_000;
    const cols: { x: number; width: number; level: DayClimateRisk["level"] }[] =
      [];
    for (let t = season.originMs; t < season.endMs; t += dayMs) {
      const ymd = toKyivDayKey(new Date(t));
      const risk = dayRisks.get(ymd)?.level ?? "none";
      if (risk === "none") continue;
      cols.push({
        x: STICKY_LABEL_W + msToTimelineX(t, season.originMs, zoom.pxPerHour),
        width: Math.max(1, dayMs / 3_600_000) * zoom.pxPerHour,
        level: risk,
      });
    }
    return cols;
  }, [season, zoom.pxPerHour, dayRisks]);

  const visibleClimateColumns = useMemo(
    () =>
      filterClimateColumnsByViewport(
        climateColumns,
        scrollLeft,
        viewportWidth || 800
      ),
    [climateColumns, scrollLeft, viewportWidth]
  );

  const ndviFieldFlags = useMemo(
    () => buildNdviFieldFlags(ndviAlerts),
    [ndviAlerts]
  );

  const ndviMarkers = useMemo((): NdviTimelineMarker[] => {
    if (!filters.showAnomalies) return [];
    return buildNdviTimelineMarkers(ndviAlerts, season, zoom.pxPerHour);
  }, [filters.showAnomalies, ndviAlerts, season, zoom.pxPerHour]);

  const visibleNdviMarkers = useMemo(
    () =>
      filterClimateColumnsByViewport(
        ndviMarkers,
        scrollLeft,
        viewportWidth || 800
      ),
    [ndviMarkers, scrollLeft, viewportWidth]
  );

  const dayGridLines = useMemo(() => {
    if (zoom.headerFormat === "month") return [];
    const dayMs = 86_400_000;
    const lines: number[] = [];
    for (let t = season.originMs; t <= season.endMs; t += dayMs) {
      lines.push(
        STICKY_LABEL_W + msToTimelineX(t, season.originMs, zoom.pxPerHour)
      );
    }
    return lines;
  }, [season, zoom]);

  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, STICKY_LABEL_W + todayX - el.clientWidth * 0.35);
  }, [todayX]);

  useEffect(() => {
    if (!canvasRef) return;
    canvasRef.current = { scrollToToday, scrollRef };
  }, [canvasRef, scrollToToday]);

  useEffect(() => {
    if (didInitialScroll.current || !scrollRef.current) return;
    didInitialScroll.current = true;
    scrollToToday();
  }, [scrollToToday]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      setScrollLeft(el.scrollLeft);
      setViewportWidth(el.clientWidth);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, []);

  function onWheel(e: React.WheelEvent) {
    if (e.shiftKey) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();

    const el = scrollRef.current;
    if (!el) {
      onZoomIndexChange(zoomFromWheelDelta(e.deltaY, zoomIndex));
      return;
    }

    const rect = el.getBoundingClientRect();
    const cursorX = e.clientX - rect.left + el.scrollLeft - STICKY_LABEL_W;
    const timeMs = timelineXToMs(
      Math.max(0, cursorX),
      season.originMs,
      zoom.pxPerHour
    );
    const nextIndex = zoomFromWheelDelta(e.deltaY, zoomIndex);
    if (nextIndex === zoomIndex) return;
    const nextZoom = AGROPLAN_ZOOM_LEVELS[nextIndex]!;
    onZoomIndexChange(nextIndex);
    requestAnimationFrame(() => {
      const nextEl = scrollRef.current;
      if (!nextEl) return;
      const newX = msToTimelineX(timeMs, season.originMs, nextZoom.pxPerHour);
      nextEl.scrollLeft = Math.max(
        0,
        STICKY_LABEL_W + newX - (e.clientX - rect.left)
      );
    });
  }

  function startPan(e: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
    setIsPanning(true);
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    const isMiddle = e.button === 1;
    const isPanLeft = panMode && e.button === 0;
    if (!isMiddle && !isPanLeft) return;
    if (isMiddle) e.preventDefault();
    startPan(e);
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (!panStart.current || !scrollRef.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    scrollRef.current.scrollLeft = panStart.current.sl - dx;
    scrollRef.current.scrollTop = panStart.current.st - dy;
  }

  function endPan(e: React.PointerEvent) {
    if (!panStart.current) return;
    scrollRef.current?.releasePointerCapture(e.pointerId);
    panStart.current = null;
    setIsPanning(false);
  }

  const panActive = panMode || isPanning;

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      className={cn(
        "custom-scrollbar relative min-w-0 flex-1 overflow-auto overscroll-none bg-background",
        panActive && (isPanning ? "cursor-grabbing" : "cursor-grab")
      )}
    >
      <div style={{ width: contentWidth }} className="relative min-h-full">
        {/* Header */}
        <div
          className="sticky top-0 z-40 flex h-10 border-b border-border/60 bg-card/90 backdrop-blur-md"
          style={{ width: contentWidth }}
        >
          <div
            className="sticky left-0 z-50 flex shrink-0 items-end border-r border-border/60 bg-card pb-1 pl-3"
            style={{ width: STICKY_LABEL_W }}
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {zoom.label}
            </span>
          </div>
          <div className="relative h-full flex-1">
            {visibleClimateColumns.map((col, i) => (
              <div
                key={`climate-${col.x}-${i}`}
                className={cn(
                  "pointer-events-none absolute inset-y-0",
                  climateColumnClass(col.level)
                )}
                style={{ left: col.x - STICKY_LABEL_W, width: col.width }}
              />
            ))}
            {visibleNdviMarkers.map((marker) => (
              <div
                key={marker.id}
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-violet-400/70 shadow-[0_0_10px_rgba(167,139,250,0.55)]"
                style={{ left: marker.x - STICKY_LABEL_W }}
                title={`NDVI ${marker.fieldName}: −${marker.dropPercent}% · ${marker.ymd}`}
              />
            ))}
            {ticks.map((tick) => (
              <div
                key={tick.ms}
                className="absolute top-0 flex h-full flex-col justify-end pb-1"
                style={{ left: tick.x }}
              >
                <span
                  className={cn(
                    "whitespace-nowrap pl-1 text-[10px]",
                    tick.major ? "text-foreground/80" : "text-muted-foreground"
                  )}
                >
                  {tick.label}
                </span>
              </div>
            ))}
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary/70"
              style={{ left: todayX }}
            />
          </div>
        </div>

        {dayGridLines.map((x, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-10 w-px bg-border/70"
            style={{ left: x }}
          />
        ))}

        {visibleFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20">
            <p className="text-sm text-muted-foreground">
              Розгорніть поля зліва, щоб побачити сезонний таймлайн
            </p>
            {onExpandAll ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onExpandAll}
              >
                Розгорнути всі поля
              </Button>
            ) : null}
          </div>
        ) : (
          visibleFields.map((field, rowIndex) => {
            const meta = fieldRowMeta.get(field.id)!;
            const fieldBlocks = (blocksByField.get(field.id) ?? []).filter(
              (b) => blocks.some((x) => x.id === b.id)
            );
            const isLive = activeFieldIds.has(field.id);
            const ndviFlag = ndviFieldFlags.get(field.id);
            const fieldSelected = selectedFieldIds?.has(field.id) ?? false;

            return (
              <div
                key={field.id}
                className={cn(
                  "flex border-b border-border/50",
                  rowIndex % 2 === 1 && "bg-muted/25"
                )}
                style={{ height: meta.height }}
              >
                <div
                  className={cn(
                    "sticky left-0 z-30 flex shrink-0 items-center border-r border-border/60 bg-card px-3",
                    fieldSelected && "bg-primary/5 ring-1 ring-inset ring-primary/20"
                  )}
                  style={{ width: STICKY_LABEL_W }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isLive ? (
                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                      ) : null}
                      {ndviFlag ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                          title={`NDVI −${ndviFlag.dropPercent}%${ndviFlag.zoneNote ? ` · ${ndviFlag.zoneNote}` : ""}`}
                        />
                      ) : null}
                      <p className="truncate text-xs font-medium text-foreground">
                        {field.name}
                      </p>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {field.crop || "—"}
                    </p>
                  </div>
                </div>

                <div className="relative min-w-0 flex-1">
                  {fieldBlocks.map((block) => {
                    const blockYmd = toKyivDayKey(new Date(block.startMs));
                    const isToday = blockYmd === todayKyivYmd();
                    const pulsing =
                      isToday &&
                      (isLive ||
                        block.operationStatus === "in_progress" ||
                        (block.source === "insight" &&
                          block.insight.status === "PERFECT_CONDITIONS"));

                    return (
                      <AgroplanOperationBlock
                        key={block.id}
                        block={block}
                        season={season}
                        pxPerHour={zoom.pxPerHour}
                        snapHours={zoom.snapHours}
                        originMs={season.originMs}
                        trackLeft={0}
                        lane={meta.lanes.get(block.id) ?? 0}
                        pulsing={pulsing}
                        selected={selectedBlockId === block.id}
                        panMode={panActive}
                        forecastHours={forecastHours}
                        dayRisks={dayRisks}
                        onSelect={onSelectBlock}
                        onMove={onMoveBlock}
                        onResize={onResizeBlock}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

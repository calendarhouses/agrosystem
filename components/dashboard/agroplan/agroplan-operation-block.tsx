"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";

import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { blockLaneHeight, blockLaneTop } from "@/lib/agroplan/lanes";
import { operationAccent, statusDotClass } from "@/lib/agroplan/theme";
import {
  clampMsToSeason,
  msToTimelineX,
  snapMsToGrid,
  type SeasonWindow,
} from "@/lib/agroplan/timeline";
import { evaluateDropWeatherRisk } from "@/lib/agroplan/weather-risk";
import type { AgroForecastHour } from "@/lib/agronomy-engine";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

function hapticWarning() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([18, 36, 18]);
  }
}

type Props = {
  block: AgroplanBlock;
  season: SeasonWindow;
  pxPerHour: number;
  snapHours: number;
  originMs: number;
  trackLeft: number;
  lane?: number;
  pulsing: boolean;
  selected?: boolean;
  panMode?: boolean;
  forecastHours: readonly AgroForecastHour[];
  dayRisks: Map<string, import("@/lib/agroplan/weather-risk").DayClimateRisk>;
  onSelect: (block: AgroplanBlock) => void;
  onMove: (block: AgroplanBlock, startMs: number) => void;
  onResize?: (block: AgroplanBlock, durationHours: number) => void;
};

export function AgroplanOperationBlock({
  block,
  season,
  pxPerHour,
  snapHours,
  originMs,
  trackLeft,
  lane = 0,
  pulsing,
  selected = false,
  panMode = false,
  forecastHours,
  dayRisks,
  onSelect,
  onMove,
  onResize,
}: Props) {
  const accent = operationAccent(
    block.insight.operationType,
    block.insight.kind
  );

  const [dragDeltaMs, setDragDeltaMs] = useState(0);
  const [resizeDeltaHours, setResizeDeltaHours] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [warnShake, setWarnShake] = useState(false);
  const dragStart = useRef<{ x: number; startMs: number } | null>(null);
  const resizeStart = useRef<{ x: number; durationHours: number } | null>(
    null
  );

  const displayStartMs = block.startMs + dragDeltaMs;
  const displayDurationHours = Math.max(
    1,
    Math.round((block.durationHours + resizeDeltaHours) * 2) / 2
  );
  const left =
    trackLeft + msToTimelineX(displayStartMs, originMs, pxPerHour);
  const width = Math.max(56, displayDurationHours * pxPerHour);
  const hasDeficit = block.insight.resourceStatus.status === "DEFICIT";
  const top = blockLaneTop(lane);
  const height = blockLaneHeight();
  const isAdjusting = dragging || resizing;

  const title = `${block.insight.operationName} · ${block.fieldName}${
    hasDeficit ? " · дефіцит ТМЦ" : ""
  }`;

  function onBodyPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (panMode || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, startMs: block.startMs };
    setDragging(true);
  }

  function onBodyPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !dragStart.current) return;
    e.stopPropagation();
    const deltaX = e.clientX - dragStart.current.x;
    const deltaMs = (deltaX / pxPerHour) * 3_600_000;
    const next = snapMsToGrid(
      dragStart.current.startMs + deltaMs,
      snapHours
    );
    setDragDeltaMs(next - block.startMs);
  }

  function finishDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !dragStart.current) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);

    const deltaX = e.clientX - dragStart.current.x;
    if (Math.abs(deltaX) < 4) {
      onSelect(block);
      dragStart.current = null;
      setDragDeltaMs(0);
      return;
    }

    const deltaMs = (deltaX / pxPerHour) * 3_600_000;
    let next = snapMsToGrid(
      dragStart.current.startMs + deltaMs,
      snapHours
    );
    next = clampMsToSeason(next, season);

    const verdict = evaluateDropWeatherRisk({
      operationId: block.insight.operationId,
      operationName: block.insight.operationName,
      targetMs: next,
      forecastHours,
      dayRisks,
    });

    if (verdict.risky) {
      setWarnShake(true);
      hapticWarning();
      window.setTimeout(() => setWarnShake(false), 700);
    }

    onMove(block, next);
    dragStart.current = null;
    setDragDeltaMs(0);
  }

  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (panMode || !onResize || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = { x: e.clientX, durationHours: block.durationHours };
    setResizing(true);
  }

  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing || !resizeStart.current || !onResize) return;
    e.stopPropagation();
    const deltaX = e.clientX - resizeStart.current.x;
    const deltaHours = deltaX / pxPerHour;
    setResizeDeltaHours(
      Math.max(
        1 - resizeStart.current.durationHours,
        Math.round(deltaHours * 2) / 2
      )
    );
  }

  function finishResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing || !resizeStart.current || !onResize) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setResizing(false);

    const deltaX = e.clientX - resizeStart.current.x;
    const deltaHours = deltaX / pxPerHour;
    const next = Math.max(
      1,
      Math.round((resizeStart.current.durationHours + deltaHours) * 2) / 2
    );
    if (next !== block.durationHours) {
      onResize(block, next);
    }
    resizeStart.current = null;
    setResizeDeltaHours(0);
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      title={title}
      layout={!isAdjusting}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(block);
      }}
      animate={
        warnShake
          ? { x: [0, -5, 5, -4, 4, 0] }
          : pulsing && !isAdjusting
            ? {
                boxShadow: [
                  "0 0 12px rgba(52,211,153,0.15)",
                  "0 0 22px rgba(52,211,153,0.35)",
                  "0 0 12px rgba(52,211,153,0.15)",
                ],
              }
            : { width, left }
      }
      transition={
        isAdjusting
          ? { duration: 0.05 }
          : pulsing
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : { type: "spring", stiffness: 420, damping: 34 }
      }
      className={cn(
        "absolute z-10 min-w-14 rounded-lg border bg-[#0f1218]/92 backdrop-blur-sm",
        accent.border,
        accent.glow,
        block.source === "insight" && "border-dashed opacity-92",
        block.source === "operation" && "border-solid bg-[#10141c]/95",
        block.operationStatus === "in_progress" &&
          "ring-1 ring-emerald-400/45",
        block.operationStatus === "completed" && "opacity-55",
        selected && "ring-2 ring-violet-400/55",
        isAdjusting &&
          "z-30 scale-[1.03] shadow-2xl ring-1 ring-white/20",
        warnShake && "border-rose-400/70 bg-rose-950/35",
        resizing && "ring-1 ring-violet-400/40"
      )}
      style={{ left, width, top, height }}
    >
      <div
        className={cn(
          "flex h-full cursor-grab items-start gap-1.5 overflow-hidden px-2 py-1 active:cursor-grabbing",
          dragging && "cursor-grabbing"
        )}
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          setDragging(false);
          dragStart.current = null;
          setDragDeltaMs(0);
        }}
      >
        <span
          className={cn(
            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
            statusDotClass(block.insight.status)
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[11px] font-medium leading-tight tracking-wide",
              accent.text
            )}
          >
            {block.insight.operationName}
          </p>
          {width > 80 ? (
            <p className="truncate text-[10px] text-zinc-500">
              {toKyivDayKey(new Date(displayStartMs))}
              {displayDurationHours > 1
                ? ` · ${displayDurationHours} год`
                : ""}
            </p>
          ) : null}
        </div>
        {hasDeficit ? (
          <span
            className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
            title="Дефіцит ТМЦ"
          />
        ) : null}
      </div>
      {onResize ? (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Змінити тривалість"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={() => {
            setResizing(false);
            resizeStart.current = null;
            setResizeDeltaHours(0);
          }}
          className={cn(
            "absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize rounded-r-lg",
            "bg-gradient-to-l from-white/10 to-transparent hover:from-violet-400/30",
            resizing && "from-violet-400/40"
          )}
        />
      ) : null}
    </motion.div>
  );
}

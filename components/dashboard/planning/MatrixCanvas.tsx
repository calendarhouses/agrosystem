"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, CloudRain } from "lucide-react";

import { TaskPill } from "@/components/dashboard/planning/TaskPill";
import { useMatrixWeather } from "@/components/dashboard/planning/use-matrix-weather";
import { useTaskResourceDeficits } from "@/components/dashboard/planning/use-task-deficits";
import {
  buildMatrixFlatRows,
  type MatrixFlatRow,
} from "@/lib/planning/field-clusters";
import {
  buildMatrixDayColumns,
  type MatrixDayColumn,
} from "@/lib/planning/matrix-days";
import { matrixCellDropId } from "@/lib/planning/dnd-ids";
import {
  layoutTaskPills,
  pillIntersectsVisibleRange,
} from "@/lib/planning/task-pill-layout";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

const FIELD_COL_W = 176;
const DAY_COL_W = 44;
const HEADER_H = 52;
const CLUSTER_ROW_H = 34;
const FIELD_ROW_H = 52;
const DAY_COUNT = 90;
const PILL_LANE_H = 14;
const PILL_TOP = 14;

export function MatrixCanvas() {
  const fields = usePlanningStore((s) => s.fields);
  const scheduledTasks = usePlanningStore((s) => s.scheduledTasks);
  const selectedTask = usePlanningStore((s) => s.selectedTask);
  const activeDragItem = usePlanningStore((s) => s.activeDragItem);
  const loading = usePlanningStore((s) => s.loading);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(
    () => new Set()
  );

  const days = useMemo(() => buildMatrixDayColumns(DAY_COUNT), []);
  const today = todayKyivYmd();
  const precipByDay = useMatrixWeather();
  const resourceDeficits = useTaskResourceDeficits(scheduledTasks, fields);

  const flatRows = useMemo(
    () =>
      buildMatrixFlatRows({
        fields,
        scheduledTasks,
        collapsedClusters,
      }),
    [fields, scheduledTasks, collapsedClusters]
  );

  const tasksByFieldId = useMemo(() => {
    const map = new Map<string, typeof scheduledTasks>();
    for (const task of scheduledTasks) {
      if (!task.scheduledYmd) continue;
      const list = map.get(task.fieldId) ?? [];
      list.push(task);
      map.set(task.fieldId, list);
    }
    return map;
  }, [scheduledTasks]);

  const highlightFieldId = activeDragItem?.fieldId ?? null;

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      flatRows[index]?.type === "cluster" ? CLUSTER_ROW_H : FIELD_ROW_H,
    overscan: 6,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: days.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DAY_COL_W,
    overscan: 4,
  });

  const virtualColumns = columnVirtualizer.getVirtualItems();
  const visibleColumnStart = virtualColumns[0]?.index ?? 0;
  const visibleColumnEnd =
    virtualColumns[virtualColumns.length - 1]?.index ?? days.length - 1;

  const toggleCluster = useCallback((label: string) => {
    setCollapsedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const totalBodyHeight = rowVirtualizer.getTotalSize();
  const totalDaysWidth = columnVirtualizer.getTotalSize();
  const matrixWidth = FIELD_COL_W + totalDaysWidth;
  const matrixHeight = HEADER_H + totalBodyHeight;

  const fieldRowCount = flatRows.filter((r) => r.type === "field").length;

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">Матриця сезону</h1>
          <p className="text-xs text-zinc-500">
            {scheduledTasks.length} заплановано · {fieldRowCount} полів ·{" "}
            {DAY_COUNT} днів
          </p>
        </div>
        {activeDragItem ? (
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300">
            {activeDragItem.operationName}
          </span>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="custom-scrollbar min-h-0 flex-1 overflow-auto"
      >
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
            Завантаження…
          </div>
        ) : flatRows.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            Немає полів для відображення
          </p>
        ) : (
          <div
            style={{ width: matrixWidth, height: matrixHeight }}
            className="relative"
          >
            <MatrixDateHeader
              days={days}
              today={today}
              precipByDay={precipByDay}
              columnVirtualizer={columnVirtualizer}
              totalDaysWidth={totalDaysWidth}
            />

            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              if (!row) return null;

              const rowDimmed =
                highlightFieldId != null &&
                !rowMatchesHighlight(row, highlightFieldId);

              const fieldTasks =
                row.type === "field"
                  ? (tasksByFieldId.get(row.field.id) ?? [])
                  : [];
              const pillLayouts = layoutTaskPills(fieldTasks, days).filter(
                (layout) =>
                  pillIntersectsVisibleRange(
                    layout,
                    visibleColumnStart,
                    visibleColumnEnd
                  )
              );

              return (
                <div
                  key={virtualRow.key}
                  className={cn(
                    "absolute left-0 flex border-b border-zinc-800/70 transition-opacity duration-200 ease-out",
                    rowDimmed && "opacity-30"
                  )}
                  style={{
                    top: HEADER_H + virtualRow.start,
                    height: virtualRow.size,
                    width: matrixWidth,
                  }}
                >
                  <MatrixRowLabel
                    row={row}
                    collapsed={collapsedClusters.has(
                      row.type === "cluster" ? row.label : row.clusterLabel
                    )}
                    onToggleCluster={toggleCluster}
                  />

                  <div
                    className="relative shrink-0"
                    style={{ width: totalDaysWidth, height: virtualRow.size }}
                  >
                    {row.type === "field"
                      ? columnVirtualizer
                          .getVirtualItems()
                          .map((virtualCol) => {
                            const day = days[virtualCol.index];
                            if (!day) return null;

                            return (
                              <div
                                key={virtualCol.key}
                                className="absolute top-0"
                                style={{
                                  left: virtualCol.start,
                                  width: virtualCol.size,
                                  height: virtualRow.size,
                                }}
                              >
                                <MatrixCell
                                  fieldId={row.field.id}
                                  dateYmd={day.ymd}
                                  isToday={day.ymd === today}
                                />
                              </div>
                            );
                          })
                      : null}

                    {row.type === "field"
                      ? pillLayouts.map((layout) => (
                          <TaskPill
                            key={layout.task.id}
                            task={layout.task}
                            left={
                              layout.startIndex * DAY_COL_W + 3
                            }
                            top={PILL_TOP + layout.lane * PILL_LANE_H}
                            width={
                              layout.spanDays * DAY_COL_W - 6
                            }
                            selected={selectedTask?.id === layout.task.id}
                            resourceDeficit={
                              resourceDeficits.get(layout.task.id) ?? false
                            }
                            completionPct={layout.task.completionPct ?? 0}
                          />
                        ))
                      : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function rowMatchesHighlight(
  row: MatrixFlatRow,
  highlightFieldId: string
): boolean {
  if (row.type === "field") return row.field.id === highlightFieldId;
  return row.fieldIds.includes(highlightFieldId);
}

function MatrixDateHeader({
  days,
  today,
  precipByDay,
  columnVirtualizer,
  totalDaysWidth,
}: {
  days: MatrixDayColumn[];
  today: string;
  precipByDay: ReadonlyMap<string, { precipitationMm: number }>;
  columnVirtualizer: ReturnType<
    typeof useVirtualizer<HTMLDivElement, Element>
  >;
  totalDaysWidth: number;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm"
      style={{ height: HEADER_H, width: FIELD_COL_W + totalDaysWidth }}
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-end border-r border-zinc-800 bg-zinc-950 px-3 pb-2"
        style={{ width: FIELD_COL_W, height: HEADER_H }}
      >
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          Поле / дата
        </span>
      </div>

      <div
        className="relative shrink-0"
        style={{ width: totalDaysWidth, height: HEADER_H }}
      >
        {columnVirtualizer.getVirtualItems().map((virtualCol) => {
          const day = days[virtualCol.index];
          if (!day) return null;

          const precip = precipByDay.get(day.ymd)?.precipitationMm ?? 0;
          const isToday = day.ymd === today;
          const isMonthStart = day.shortLabel === "1";

          return (
            <div
              key={virtualCol.key}
              className={cn(
                "absolute top-0 flex flex-col items-center justify-end border-r border-zinc-800/80 px-0.5 pb-1.5 pt-1",
                isToday && "bg-emerald-500/[0.08]"
              )}
              style={{
                left: virtualCol.start,
                width: virtualCol.size,
                height: HEADER_H,
              }}
            >
              {isMonthStart ? (
                <span className="mb-0.5 truncate text-[8px] font-medium uppercase tracking-wide text-zinc-500">
                  {day.label.split(" ")[1]?.slice(0, 3) ?? ""}
                </span>
              ) : (
                <span className="mb-0.5 h-2" aria-hidden />
              )}
              <span className="text-[9px] text-zinc-600">{day.dow}</span>
              <span
                className={cn(
                  "text-[11px] font-medium tabular-nums",
                  isToday ? "text-emerald-300" : "text-zinc-300"
                )}
              >
                {day.shortLabel}
              </span>
              <span className="mt-0.5 flex h-3 items-center justify-center">
                {precip > 0 ? (
                  <CloudRain
                    className="size-2.5 text-sky-400/80"
                    aria-label={`Опади ${precip.toFixed(1)} мм`}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatrixRowLabel({
  row,
  collapsed,
  onToggleCluster,
}: {
  row: MatrixFlatRow;
  collapsed: boolean;
  onToggleCluster: (label: string) => void;
}) {
  if (row.type === "cluster") {
    return (
      <button
        type="button"
        onClick={() => onToggleCluster(row.label)}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-zinc-800 bg-zinc-900/80 px-3 text-left transition-colors hover:bg-zinc-900"
        style={{ width: FIELD_COL_W }}
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-zinc-500 transition-transform duration-200",
            collapsed && "-rotate-90"
          )}
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-zinc-300">
            {row.label}
          </p>
          <p className="text-[9px] text-zinc-600">
            {row.fieldIds.length} полів
          </p>
        </div>
      </button>
    );
  }

  return (
    <div
      className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-zinc-800 bg-zinc-950 px-3"
      style={{ width: FIELD_COL_W }}
    >
      <p className="truncate text-xs font-medium text-zinc-200">
        {row.field.name}
      </p>
      <p className="truncate text-[10px] text-zinc-500">
        {row.field.crop || "—"}
      </p>
    </div>
  );
}

function MatrixCell({
  fieldId,
  dateYmd,
  isToday,
}: {
  fieldId: string;
  dateYmd: string;
  isToday: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: matrixCellDropId(fieldId, dateYmd),
  });

  return (
    <div
      ref={setNodeRef}
      style={{ width: DAY_COL_W }}
      className={cn(
        "relative h-full shrink-0 border-r border-zinc-800/40 transition-colors",
        isToday && "bg-emerald-500/[0.03]",
        isOver && "bg-emerald-500/[0.14] ring-1 ring-inset ring-emerald-500/35"
      )}
    />
  );
}

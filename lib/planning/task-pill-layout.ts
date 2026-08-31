import type { PlanningTask } from "@/lib/planning/types";

import { dayIndexInMatrix, taskSpanDays } from "./matrix-days";

export type TaskPillLayout = {
  task: PlanningTask;
  startIndex: number;
  spanDays: number;
  lane: number;
};

/** Розкладка pills по «доріжках», щоб уникнути накладання */
export function layoutTaskPills(
  tasks: readonly PlanningTask[],
  days: readonly { ymd: string }[]
): TaskPillLayout[] {
  const scheduled = tasks
    .filter((task) => task.scheduledYmd)
    .sort((a, b) => a.scheduledYmd!.localeCompare(b.scheduledYmd!));

  const laneEnds: number[] = [];
  const layouts: TaskPillLayout[] = [];

  for (const task of scheduled) {
    const startIndex = dayIndexInMatrix(days, task.scheduledYmd!);
    if (startIndex < 0) continue;

    const spanDays = taskSpanDays(task);
    const endIndex = startIndex + spanDays - 1;

    let lane = laneEnds.findIndex((end) => end < startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endIndex);
    } else {
      laneEnds[lane] = endIndex;
    }

    layouts.push({ task, startIndex, spanDays, lane });
  }

  return layouts;
}

export function pillIntersectsVisibleRange(
  layout: TaskPillLayout,
  visibleStart: number,
  visibleEnd: number
): boolean {
  const endIndex = layout.startIndex + layout.spanDays - 1;
  return endIndex >= visibleStart && layout.startIndex <= visibleEnd;
}

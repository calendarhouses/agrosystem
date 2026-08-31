import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

import type { PlanningTask } from "@/lib/planning/types";

export type MatrixDayColumn = {
  ymd: string;
  label: string;
  shortLabel: string;
  dow: string;
};

const UKR_WEEKDAY = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/** Щоденні колонки від сьогодні (Europe/Kyiv) */
export function buildMatrixDayColumns(count = 90): MatrixDayColumn[] {
  let ymd = todayKyivYmd();
  const cols: MatrixDayColumn[] = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(`${ymd}T12:00:00`);
    const dow = UKR_WEEKDAY[date.getDay()] ?? "";
    cols.push({
      ymd,
      label: date.toLocaleDateString("uk-UA", {
        day: "numeric",
        month: "short",
      }),
      shortLabel: String(date.getDate()),
      dow,
    });
    ymd = shiftKyivYmd(ymd, 1);
  }

  return cols;
}

export function taskOnDay(task: PlanningTask, dayYmd: string): boolean {
  if (!task.scheduledYmd) return false;
  if (task.scheduledYmd === dayYmd) return true;

  const span = taskSpanDays(task);
  const endYmd = shiftKyivYmd(task.scheduledYmd, span - 1);
  return dayYmd >= task.scheduledYmd && dayYmd <= endYmd;
}

export function taskSpanDays(task: PlanningTask): number {
  return Math.max(1, Math.round(task.durationDays));
}

export function taskEndYmd(task: PlanningTask): string | null {
  if (!task.scheduledYmd) return null;
  return shiftKyivYmd(task.scheduledYmd, taskSpanDays(task) - 1);
}

export function dayIndexInMatrix(
  days: readonly { ymd: string }[],
  ymd: string
): number {
  return days.findIndex((day) => day.ymd === ymd);
}

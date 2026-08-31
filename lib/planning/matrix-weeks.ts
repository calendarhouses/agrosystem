import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

import type { MatrixWeekColumn } from "@/lib/planning/types";

const UKR_WEEKDAY = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/** 16 тижневих колонок від поточного понеділка */
export function buildMatrixWeekColumns(count = 16): MatrixWeekColumn[] {
  const today = todayKyivYmd();
  const d = new Date(`${today}T12:00:00`);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  let ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const cols: MatrixWeekColumn[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(`${ymd}T12:00:00`);
    const dow = UKR_WEEKDAY[date.getDay()] ?? "";
    cols.push({
      ymd,
      label: date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }),
      shortLabel: `${dow} ${date.getDate()}`,
    });
    ymd = shiftKyivYmd(ymd, 7);
  }
  return cols;
}

export function taskInWeek(taskYmd: string, weekStartYmd: string): boolean {
  const end = shiftKyivYmd(weekStartYmd, 6);
  return taskYmd >= weekStartYmd && taskYmd <= end;
}

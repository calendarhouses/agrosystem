import type { PlanningTask } from "@/lib/planning/types";

export type PlanningTaskAccent = "sowing" | "harvest" | "default";

export function inferTaskAccent(task: PlanningTask): PlanningTaskAccent {
  const type = task.operationType?.toLowerCase() ?? "";
  const name = task.operationName.toLowerCase();

  if (type === "збір" || name.includes("збір") || name.includes("harvest")) {
    return "harvest";
  }
  if (
    type === "тмц" ||
    name.includes("посів") ||
    name.includes("десикац") ||
    name.includes("ззр") ||
    name.includes("sow")
  ) {
    return "sowing";
  }
  return "default";
}

export function taskAccentClass(accent: PlanningTaskAccent): string {
  if (accent === "harvest") return "bg-amber-500";
  if (accent === "sowing") return "bg-emerald-500";
  return "bg-zinc-600";
}

export function taskPillGradientClass(accent: PlanningTaskAccent): string {
  if (accent === "harvest") {
    return "bg-gradient-to-r from-amber-500/40 via-amber-600/28 to-orange-700/22";
  }
  if (accent === "sowing") {
    return "bg-gradient-to-r from-emerald-500/40 via-emerald-600/28 to-teal-700/22";
  }
  return "bg-gradient-to-r from-cyan-500/35 via-zinc-600/22 to-zinc-700/18";
}

export function taskPillBorderClass(accent: PlanningTaskAccent): string {
  if (accent === "harvest") return "border-amber-500/35";
  if (accent === "sowing") return "border-emerald-500/35";
  return "border-cyan-500/30";
}

/** "3 дні", "1 день", "5 днів" */
export function formatDurationDays(days: number): string {
  const n = Math.max(1, Math.round(days));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} дні`;
  }
  return `${n} днів`;
}

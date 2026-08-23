import type { DayAnalyticsPayload } from "@/lib/equipment-day-analytics";

export type UtilizationKind = "work" | "idle" | "off";

export type UtilizationSegment = {
  kind: UtilizationKind;
  hours: number;
  percent: number;
  label: string;
};

const KIND_META: Record<
  UtilizationKind,
  { label: string; color: string; bg: string }
> = {
  work: {
    label: "В роботі",
    color: "bg-emerald-500",
    bg: "bg-emerald-500/90",
  },
  idle: {
    label: "Холостий хід",
    color: "bg-amber-400",
    bg: "bg-amber-400/90",
  },
  off: {
    label: "Вимкнено",
    color: "bg-zinc-300",
    bg: "bg-zinc-300/90",
  },
};

export function utilizationKindMeta(kind: UtilizationKind) {
  return KIND_META[kind];
}

/** Денний ККД: робота / холостий / вимкнено (24 год). */
export function buildDayUtilization(
  analytics: DayAnalyticsPayload
): UtilizationSegment[] {
  const work = Math.max(0, analytics.summary.workHours);
  const idle = Math.max(0, analytics.summary.hoursIdling);
  const tracked = work + idle;
  const off = Math.max(0, 24 - tracked);
  const total = work + idle + off || 24;

  const round = (v: number) => Math.round(v * 10) / 10;
  const pct = (h: number) => Math.round((h / total) * 1000) / 10;

  const segments = [
    {
      kind: "work" as const,
      hours: round(work),
      percent: pct(work),
      label: KIND_META.work.label,
    },
    {
      kind: "idle" as const,
      hours: round(idle),
      percent: pct(idle),
      label: KIND_META.idle.label,
    },
    {
      kind: "off" as const,
      hours: round(off),
      percent: pct(off),
      label: KIND_META.off.label,
    },
  ].filter((s) => s.percent > 0);

  // Повний день вимкнено / немає даних — світло-сіра смуга на 100%
  if (segments.length === 0) {
    return [
      {
        kind: "off" as const,
        hours: 24,
        percent: 100,
        label: KIND_META.off.label,
      },
    ];
  }

  // Нормалізація до 100% (поправка на округлення)
  const sumPct = segments.reduce((acc, s) => acc + s.percent, 0);
  if (sumPct > 0 && Math.abs(sumPct - 100) > 0.05) {
    const last = segments[segments.length - 1];
    last.percent = Math.round((last.percent + (100 - sumPct)) * 10) / 10;
  }

  return segments;
}

export function formatUtilizationHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 хв";
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes <= 0) return `${hours} год`;
  return `${hours}г ${minutes}хв`;
}

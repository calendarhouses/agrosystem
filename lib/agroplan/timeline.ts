import { kyivDayBoundsUnix, todayKyivYmd } from "@/lib/kyiv-date";

export type AgroplanZoomLevel = {
  id: "season" | "week" | "day" | "hour";
  label: string;
  pxPerHour: number;
  snapHours: number;
  headerFormat: "month" | "week" | "day" | "hour";
};

export const AGROPLAN_ZOOM_LEVELS: readonly AgroplanZoomLevel[] = [
  {
    id: "season",
    label: "Сезон",
    pxPerHour: 0.12,
    snapHours: 24,
    headerFormat: "month",
  },
  {
    id: "week",
    label: "Тиждень",
    pxPerHour: 1.1,
    snapHours: 6,
    headerFormat: "week",
  },
  {
    id: "day",
    label: "День",
    pxPerHour: 5.5,
    snapHours: 1,
    headerFormat: "day",
  },
  {
    id: "hour",
    label: "Година",
    pxPerHour: 42,
    snapHours: 0.5,
    headerFormat: "hour",
  },
] as const;

const MONTH_LABELS_UK = [
  "Січ",
  "Лют",
  "Бер",
  "Кві",
  "Тра",
  "Чер",
  "Лип",
  "Сер",
  "Вер",
  "Жов",
  "Лис",
  "Гру",
] as const;

export type SeasonWindow = {
  originMs: number;
  endMs: number;
  totalHours: number;
  totalWidthPx: (pxPerHour: number) => number;
};

/** Вікно сезону: січень поточного року → березень наступного */
export function buildSeasonWindow(now = new Date()): SeasonWindow {
  const year = now.getFullYear();
  const originYmd = `${year}-01-01`;
  const endYmd = `${year + 1}-03-31`;
  const { fromUnix: originUnix } = kyivDayBoundsUnix(originYmd);
  const { toUnix: endUnix } = kyivDayBoundsUnix(endYmd);
  const originMs = originUnix * 1000;
  const endMs = (endUnix + 1) * 1000;
  const totalHours = (endMs - originMs) / 3_600_000;
  return {
    originMs,
    endMs,
    totalHours,
    totalWidthPx(pxPerHour: number) {
      return totalHours * pxPerHour;
    },
  };
}

export function msToTimelineX(
  ms: number,
  originMs: number,
  pxPerHour: number
): number {
  return ((ms - originMs) / 3_600_000) * pxPerHour;
}

export function timelineXToMs(
  x: number,
  originMs: number,
  pxPerHour: number
): number {
  return originMs + (x / pxPerHour) * 3_600_000;
}

export function snapMsToGrid(ms: number, snapHours: number): number {
  if (snapHours <= 0) return ms;
  const snapMs = snapHours * 3_600_000;
  return Math.round(ms / snapMs) * snapMs;
}

export function clampMsToSeason(
  ms: number,
  season: SeasonWindow
): number {
  return Math.min(season.endMs - 3_600_000, Math.max(season.originMs, ms));
}

export type TimelineTick = {
  ms: number;
  x: number;
  label: string;
  major: boolean;
};

export function buildTimelineTicks(
  season: SeasonWindow,
  zoom: AgroplanZoomLevel
): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  const dayMs = 86_400_000;
  const startDay = Math.floor(season.originMs / dayMs) * dayMs;

  if (zoom.headerFormat === "month") {
    for (let y = new Date(season.originMs).getFullYear(); y <= new Date(season.endMs).getFullYear(); y++) {
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(y, m, 1));
        const ms = d.getTime();
        if (ms < season.originMs || ms > season.endMs) continue;
        ticks.push({
          ms,
          x: msToTimelineX(ms, season.originMs, zoom.pxPerHour),
          label: MONTH_LABELS_UK[m]!,
          major: m === 0,
        });
      }
    }
    return ticks;
  }

  const stepHours =
    zoom.headerFormat === "hour"
      ? 1
      : zoom.headerFormat === "day"
        ? 24
        : 24 * 7;
  const stepMs = stepHours * 3_600_000;

  for (let t = startDay; t <= season.endMs; t += stepMs) {
    if (t < season.originMs) continue;
    const date = new Date(t);
    let label = "";
    if (zoom.headerFormat === "hour") {
      label = `${String(date.getHours()).padStart(2, "0")}:00`;
    } else if (zoom.headerFormat === "day") {
      label = `${date.getDate()} ${MONTH_LABELS_UK[date.getMonth()]}`;
    } else {
      label = `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    ticks.push({
      ms: t,
      x: msToTimelineX(t, season.originMs, zoom.pxPerHour),
      label,
      major: zoom.headerFormat !== "hour" || date.getHours() % 6 === 0,
    });
  }
  return ticks;
}

export function todayMarkerX(
  season: SeasonWindow,
  pxPerHour: number,
  now = new Date()
): number {
  const { fromUnix } = kyivDayBoundsUnix(todayKyivYmd(now));
  return msToTimelineX(fromUnix * 1000, season.originMs, pxPerHour);
}

export function zoomFromWheelDelta(deltaY: number, currentIndex: number): number {
  const next = deltaY < 0 ? currentIndex + 1 : currentIndex - 1;
  return Math.max(0, Math.min(AGROPLAN_ZOOM_LEVELS.length - 1, next));
}

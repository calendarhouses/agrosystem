import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { booleanPointInPolygon, point } from "@turf/turf";

import type { FieldGeometry } from "@/lib/farm-fields";
import type { WialonTrackLineFeature, WialonUnit } from "@/lib/wialon";

export type FieldTechDateRange = {
  from: Date;
  to: Date;
};

export type TechInFieldEntry = {
  id: string;
  name: string;
  speedKmh: number;
  statusLabel: string;
  isMoving: boolean;
};

/** Візит техніки на полі (з треку або live) */
export type FieldTechVisit = {
  id: string;
  unitId: number;
  unitName: string;
  startUnix: number;
  endUnix: number;
  distanceKm: number;
  isLive: boolean;
  speedKmh: number | null;
  timeRangeLabel: string;
  durationLabel: string;
};

export type FieldTechSeason = {
  year: number;
  label: string;
  isCurrent: boolean;
};

type FieldLike = {
  geometry?: FieldGeometry | null;
};

const MIN_VISIT_SEC = 120;
const CHUNK_DAYS = 7;

/** Агросезон: 1 березня → останній день лютого наступного року */
export function seasonDateRange(
  year: number,
  now = new Date()
): FieldTechDateRange {
  const from = new Date(year, 2, 1, 0, 0, 0, 0);
  const to = new Date(year + 1, 2, 0, 23, 59, 59, 999);
  const cappedTo = to.getTime() > now.getTime() ? now : to;
  return { from, to: cappedTo };
}

/** Швидке вікно: останні N днів у межах сезону (не весь рік). */
export function recentWindowInSeason(
  season: FieldTechDateRange,
  days = 7
): FieldTechDateRange {
  const to = new Date(season.to);
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  if (from.getTime() < season.from.getTime()) {
    return { from: new Date(season.from), to };
  }
  return { from, to };
}

/** Тижневі чанки сезону — від новіших до старіших (для прогресивного UI). */
export function seasonWeekChunksNewestFirst(
  season: FieldTechDateRange
): FieldTechDateRange[] {
  const chunks = splitDateRangeChunks(
    Math.floor(season.from.getTime() / 1000),
    Math.floor(season.to.getTime() / 1000),
    CHUNK_DAYS
  );
  return chunks
    .map((c) => ({
      from: new Date(c.from * 1000),
      to: new Date(c.to * 1000),
    }))
    .reverse();
}

export function listFieldTechSeasons(now = new Date()): FieldTechSeason[] {
  const currentYear =
    now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return [0, 1, 2].map((offset) => {
    const year = currentYear - offset;
    return {
      year,
      label: `Сезон ${year}`,
      isCurrent: offset === 0,
    };
  });
}

export function currentSeasonYear(now = new Date()): number {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

function toPolygonFeature(
  geometry: FieldGeometry
): Feature<Polygon | MultiPolygon> | null {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }
  return { type: "Feature", properties: {}, geometry };
}

function haversineKm(a: Position, b: Position): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return 0;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatVisitClock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatVisitDay(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "short",
  });
}

export function formatVisitDuration(startUnix: number, endUnix: number): string {
  const totalMin = Math.max(0, Math.round((endUnix - startUnix) / 60));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes === 0) return `${hours} год`;
  return `${hours} год ${minutes} хв`;
}

export function formatVisitTimeRange(startUnix: number, endUnix: number): string {
  const sameDay =
    new Date(startUnix * 1000).toDateString() ===
    new Date(endUnix * 1000).toDateString();
  if (sameDay) {
    return `${formatVisitDay(startUnix)}, ${formatVisitClock(startUnix)} – ${formatVisitClock(endUnix)}`;
  }
  return `${formatVisitDay(startUnix)} ${formatVisitClock(startUnix)} – ${formatVisitDay(endUnix)} ${formatVisitClock(endUnix)}`;
}

/**
 * Розбиває діапазон на чанки (щоб Wialon messages/load_interval не захлинувся).
 */
export function splitDateRangeChunks(
  fromUnix: number,
  toUnix: number,
  chunkDays = CHUNK_DAYS
): Array<{ from: number; to: number }> {
  if (toUnix < fromUnix) return [];
  const step = chunkDays * 24 * 60 * 60;
  const chunks: Array<{ from: number; to: number }> = [];
  let cursor = fromUnix;
  while (cursor <= toUnix) {
    const end = Math.min(cursor + step - 1, toUnix);
    chunks.push({ from: cursor, to: end });
    cursor = end + 1;
  }
  return chunks;
}

/**
 * Сесії перебування юніта всередині полігону поля за точками треку.
 */
export function analyzeTrackVisitsInField(
  track: WialonTrackLineFeature | null | undefined,
  geometry: FieldGeometry | null | undefined,
  unitName: string
): FieldTechVisit[] {
  const polygon = geometry ? toPolygonFeature(geometry) : null;
  if (!polygon || !track) return [];

  const coords = track.geometry.coordinates ?? [];
  const times = track.properties.times ?? [];
  const unitId = track.properties.unitId;
  if (coords.length < 2 || times.length < 2) return [];

  type Raw = {
    startUnix: number;
    endUnix: number;
    startIndex: number;
    endIndex: number;
  };

  const insideFlags: boolean[] = coords.map((coord) => {
    const lng = coord[0];
    const lat = coord[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    try {
      return booleanPointInPolygon(point([lng, lat]), polygon);
    } catch {
      return false;
    }
  });

  const raw: Raw[] = [];
  let current: Raw | null = null;

  for (let i = 0; i < coords.length; i++) {
    const unix = times[i];
    if (unix == null || !Number.isFinite(unix)) continue;
    const inside = insideFlags[i];

    if (inside) {
      if (!current) {
        current = {
          startUnix: unix,
          endUnix: unix,
          startIndex: i,
          endIndex: i,
        };
      } else {
        current.endUnix = unix;
        current.endIndex = i;
      }
    } else if (current) {
      raw.push(current);
      current = null;
    }
  }
  if (current) raw.push(current);

  return raw
    .filter((session) => session.endUnix - session.startUnix >= MIN_VISIT_SEC)
    .map((session, order) => {
      let distanceKm = 0;
      for (let i = session.startIndex + 1; i <= session.endIndex; i++) {
        distanceKm += haversineKm(coords[i - 1], coords[i]);
      }
      return {
        id: `${unitId}-${session.startUnix}-${order}`,
        unitId,
        unitName,
        startUnix: session.startUnix,
        endUnix: session.endUnix,
        distanceKm: Math.round(distanceKm * 10) / 10,
        isLive: false,
        speedKmh: null,
        timeRangeLabel: formatVisitTimeRange(session.startUnix, session.endUnix),
        durationLabel: formatVisitDuration(session.startUnix, session.endUnix),
      };
    });
}

export function mergeTrackChunks(
  tracks: WialonTrackLineFeature[]
): WialonTrackLineFeature | null {
  const parts = tracks.filter(
    (t) => (t.geometry.coordinates?.length ?? 0) > 0
  );
  if (parts.length === 0) return null;

  const coordinates: Position[] = [];
  const times: number[] = [];
  const unitId = parts[0].properties.unitId;

  for (const part of parts) {
    const coords = part.geometry.coordinates;
    const partTimes = part.properties.times ?? [];
    for (let i = 0; i < coords.length; i++) {
      const t = partTimes[i];
      const c = coords[i];
      if (t == null || !c) continue;
      const lastT = times[times.length - 1];
      if (lastT != null && t <= lastT) continue;
      coordinates.push(c);
      times.push(t);
    }
  }

  if (coordinates.length < 2) return null;

  return {
    type: "Feature",
    properties: { pointCount: coordinates.length, unitId, times },
    geometry: { type: "LineString", coordinates },
  };
}

/**
 * Техніка всередині полігону поля (live GPS + Turf).
 */
export function calculateTechInField(
  field: FieldLike | null | undefined,
  units: WialonUnit[],
  _dateRange?: FieldTechDateRange | null
): TechInFieldEntry[] {
  const geometry = field?.geometry;
  const polygon = geometry ? toPolygonFeature(geometry) : null;
  if (!polygon) return [];

  return units
    .filter((unit) => {
      const pos = unit.pos;
      if (!pos) return false;
      const lng = Number(pos.x);
      const lat = Number(pos.y);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      if (lng <= 0 || lat <= 0) return false;
      try {
        return booleanPointInPolygon(point([lng, lat]), polygon);
      } catch {
        return false;
      }
    })
    .map((unit) => {
      const speedKmh = Math.max(0, Math.round(Number(unit.pos?.s ?? 0)));
      return {
        id: String(unit.id),
        name: unit.nm,
        speedKmh,
        isMoving: speedKmh > 0,
        statusLabel: speedKmh > 0 ? "Працює зараз" : "Зараз на полі",
      };
    })
    .sort((a, b) => b.speedKmh - a.speedKmh);
}

/** Live-юніти → візити для єдиного списку історії */
export function liveUnitsToVisits(entries: TechInFieldEntry[]): FieldTechVisit[] {
  const now = Math.floor(Date.now() / 1000);
  return entries.map((entry) => ({
    id: `live-${entry.id}`,
    unitId: Number(entry.id),
    unitName: entry.name,
    startUnix: now,
    endUnix: now,
    distanceKm: 0,
    isLive: true,
    speedKmh: entry.speedKmh,
    timeRangeLabel: entry.statusLabel,
    durationLabel: entry.isMoving ? "У русі" : "На полі",
  }));
}

export function summarizeVisits(visits: FieldTechVisit[]) {
  const uniqueUnits = new Set(visits.map((v) => v.unitId));
  const live = visits.filter((v) => v.isLive);
  const archived = visits.filter((v) => !v.isLive);
  const totalDistance = archived.reduce((sum, v) => sum + v.distanceKm, 0);
  const totalSec = archived.reduce(
    (sum, v) => sum + Math.max(0, v.endUnix - v.startUnix),
    0
  );
  return {
    totalVisits: archived.length,
    uniqueUnits: uniqueUnits.size,
    liveCount: live.length,
    totalDistanceKm: Math.round(totalDistance * 10) / 10,
    totalHours: Math.round((totalSec / 3600) * 10) / 10,
  };
}

export function summarizeTechInField(entries: TechInFieldEntry[]) {
  const active = entries.filter((e) => e.isMoving).length;
  const avgSpeed =
    entries.length === 0
      ? 0
      : Math.round(
          entries.reduce((sum, e) => sum + e.speedKmh, 0) / entries.length
        );
  return {
    total: entries.length,
    active,
    idle: entries.length - active,
    avgSpeed,
  };
}

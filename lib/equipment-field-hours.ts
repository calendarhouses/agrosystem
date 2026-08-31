/**
 * Час «на полях» з GPS-семплів і Wialon-геозон — та сама логіка, що в картці техніки
 * (журнал локацій), а не farm_fields з БД.
 */

import { booleanPointInPolygon, bbox as turfBbox } from "@turf/turf";
import type { Feature, FeatureCollection, Polygon } from "geojson";

import { hoursFromSessionSpans } from "@/lib/equipment-day-analytics";
import type { WialonGeofenceProperties } from "@/lib/wialon";

export type GpsTimeSample = { lng: number; lat: number; t: number };

type GeofenceCollection = FeatureCollection<Polygon, WialonGeofenceProperties>;
type LocationSessionKind = "field" | "base" | "road";

const MIN_LOCATION_SESSION_SEC = 5 * 60;
const MAX_LOCATION_SESSION_GAP_SEC = 20 * 60;
const LOCATION_SAMPLE_STEP_SEC = 45;

function isBaseGeofenceName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("база") ||
    lower.includes("левада") ||
    lower.includes("двор") ||
    lower.includes("двір") ||
    lower.includes("склад")
  );
}

type PreparedGeofence = {
  feature: Feature<Polygon, WialonGeofenceProperties>;
  id: string;
  kind: Exclude<LocationSessionKind, "road">;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function prepareGeofences(geofences: GeofenceCollection): PreparedGeofence[] {
  const prepared: PreparedGeofence[] = [];
  for (const feature of geofences.features) {
    if (feature.geometry?.type !== "Polygon") continue;
    const rawName = feature.properties?.name?.trim();
    if (!rawName) continue;
    try {
      const [minX, minY, maxX, maxY] = turfBbox(feature);
      if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) continue;
      prepared.push({
        feature,
        id:
          feature.properties?.id ??
          String(feature.properties?.wialon_id ?? rawName),
        kind: isBaseGeofenceName(rawName) ? "base" : "field",
        minX,
        minY,
        maxX,
        maxY,
      });
    } catch {
      // skip invalid polygon
    }
  }
  return prepared;
}

function locatePointInGeofences(
  lng: number,
  lat: number,
  prepared: PreparedGeofence[],
  hintIndex: number
): { zone: PreparedGeofence | null; index: number } {
  const tryIndex = (index: number): PreparedGeofence | null => {
    const zone = prepared[index];
    if (!zone) return null;
    if (
      lng < zone.minX ||
      lng > zone.maxX ||
      lat < zone.minY ||
      lat > zone.maxY
    ) {
      return null;
    }
    try {
      return booleanPointInPolygon([lng, lat], zone.feature) ? zone : null;
    } catch {
      return null;
    }
  };

  if (hintIndex >= 0) {
    const hinted = tryIndex(hintIndex);
    if (hinted) return { zone: hinted, index: hintIndex };
  }

  for (let i = 0; i < prepared.length; i++) {
    if (i === hintIndex) continue;
    const zone = tryIndex(i);
    if (zone) return { zone, index: i };
  }
  return { zone: null, index: -1 };
}

function sessionKey(zone: PreparedGeofence | null): string {
  return zone ? `g:${zone.id}:${zone.kind}` : "road";
}

/**
 * Сумарні години на полях (лише kind=field), як у DayShiftSummary на картці техніки.
 * @param maxHours — зазвичай work_hours: не можна бути на полі довше за робочий день
 */
export function hoursOnFieldFromGpsSamples(
  samples: GpsTimeSample[],
  geofences: GeofenceCollection,
  maxHours?: number
): number {
  if (samples.length < 2 || geofences.features.length === 0) return 0;

  const prepared = prepareGeofences(geofences);
  if (prepared.length === 0) return 0;

  const sorted = [...samples]
    .filter(
      (s) =>
        Number.isFinite(s.t) &&
        Number.isFinite(s.lng) &&
        Number.isFinite(s.lat)
    )
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return 0;

  type Sample = {
    unix: number;
    key: string;
    kind: LocationSessionKind;
  };

  const thinned: Sample[] = [];
  let lastSampleUnix = -Infinity;
  let hintIndex = -1;
  const lastIdx = sorted.length - 1;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const isLast = i === lastIdx;
    if (!isLast && s.t - lastSampleUnix < LOCATION_SAMPLE_STEP_SEC) continue;

    const located = locatePointInGeofences(s.lng, s.lat, prepared, hintIndex);
    hintIndex = located.index;
    const kind: LocationSessionKind = located.zone?.kind ?? "road";
    thinned.push({
      unix: s.t,
      key: sessionKey(located.zone),
      kind,
    });
    lastSampleUnix = s.t;
  }

  if (thinned.length === 0) return 0;

  type RawSession = {
    key: string;
    kind: LocationSessionKind;
    startUnix: number;
    endUnix: number;
  };

  const raw: RawSession[] = [];
  let current: RawSession = {
    key: thinned[0]!.key,
    kind: thinned[0]!.kind,
    startUnix: thinned[0]!.unix,
    endUnix: thinned[0]!.unix,
  };

  for (let i = 1; i < thinned.length; i++) {
    const sample = thinned[i]!;
    if (sample.key === current.key) {
      const gapSec = sample.unix - current.endUnix;
      if (gapSec > MAX_LOCATION_SESSION_GAP_SEC) {
        raw.push({ ...current });
        current = {
          key: sample.key,
          kind: sample.kind,
          startUnix: sample.unix,
          endUnix: sample.unix,
        };
        continue;
      }
      current.endUnix = sample.unix;
      continue;
    }
    raw.push({ ...current });
    current = {
      key: sample.key,
      kind: sample.kind,
      startUnix: sample.unix,
      endUnix: sample.unix,
    };
  }
  raw.push(current);

  const filtered = raw.filter(
    (session) => session.endUnix - session.startUnix >= MIN_LOCATION_SESSION_SEC
  );

  const merged: RawSession[] = [];
  for (const session of filtered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === session.key) {
      prev.endUnix = session.endUnix;
      continue;
    }
    merged.push({ ...session });
  }

  let hours = hoursFromSessionSpans(merged).hoursOnField;
  if (maxHours != null && Number.isFinite(maxHours) && maxHours > 0) {
    hours = Math.min(hours, maxHours);
  }
  return hours;
}

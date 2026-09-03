/**
 * Кеш геозон Wialon (рідко змінюються) + single-flight для boot /api/wialon.
 */

import type { FeatureCollection, Polygon } from "geojson";

import {
  getWialonGeofences,
  getWialonUnits,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
  type WialonGeofenceProperties,
  type WialonUnit,
} from "@/lib/wialon";
import { getCachedWialonUnitsLive } from "@/lib/wialon-live-cache";

const GEOFENCES_TTL_MS = 5 * 60 * 1000;
const BOOT_TTL_MS = 20_000;

type GeofenceCache = {
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>;
  fetchedAt: number;
};

type BootCache = {
  units: WialonUnit[];
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>;
  fetchedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __agrosystemWialonGeofencesCache: GeofenceCache | null | undefined;
  // eslint-disable-next-line no-var
  var __agrosystemWialonGeofencesInflight:
    | Promise<FeatureCollection<Polygon, WialonGeofenceProperties>>
    | null
    | undefined;
  // eslint-disable-next-line no-var
  var __agrosystemWialonBootCache: BootCache | null | undefined;
  // eslint-disable-next-line no-var
  var __agrosystemWialonBootInflight: Promise<BootCache> | null | undefined;
}

async function fetchGeofences(): Promise<
  FeatureCollection<Polygon, WialonGeofenceProperties>
> {
  const eid = await wialonLogin();
  const resources = await getWialonGeofences(eid);
  return wialonResourcesToGeofenceGeoJSON(resources);
}

export async function getCachedWialonGeofences(): Promise<
  FeatureCollection<Polygon, WialonGeofenceProperties>
> {
  const now = Date.now();
  const cached = globalThis.__agrosystemWialonGeofencesCache ?? null;
  if (cached && now - cached.fetchedAt < GEOFENCES_TTL_MS) {
    return cached.geofences;
  }

  const existing = globalThis.__agrosystemWialonGeofencesInflight;
  if (existing) return existing;

  const promise = fetchGeofences()
    .then((geofences) => {
      globalThis.__agrosystemWialonGeofencesCache = {
        geofences,
        fetchedAt: Date.now(),
      };
      return geofences;
    })
    .finally(() => {
      globalThis.__agrosystemWialonGeofencesInflight = null;
    });

  globalThis.__agrosystemWialonGeofencesInflight = promise;
  return promise;
}

/**
 * Boot: юніти (з датчиками, рідше) + геозони.
 * Паралельні логіни зливаються в один inflight; короткий TTL знімає шквал при 3+ F5.
 */
export async function getCachedWialonBoot(options?: {
  /** Без calc_last_message — швидше; позиції все одно свіжі */
  lightUnits?: boolean;
}): Promise<BootCache> {
  const lightUnits = options?.lightUnits === true;
  const now = Date.now();
  const cached = globalThis.__agrosystemWialonBootCache ?? null;
  if (cached && now - cached.fetchedAt < BOOT_TTL_MS) {
    return cached;
  }

  const existing = globalThis.__agrosystemWialonBootInflight;
  if (existing) return existing;

  const promise = (async () => {
    const [units, geofences] = await Promise.all([
      lightUnits
        ? getCachedWialonUnitsLive().then((r) => r.units)
        : wialonLogin().then((eid) =>
            getWialonUnits(eid, { withSensorCalc: true })
          ),
      getCachedWialonGeofences(),
    ]);

    const entry: BootCache = {
      units,
      geofences,
      fetchedAt: Date.now(),
    };
    globalThis.__agrosystemWialonBootCache = entry;
    return entry;
  })().finally(() => {
    globalThis.__agrosystemWialonBootInflight = null;
  });

  globalThis.__agrosystemWialonBootInflight = promise;
  return promise;
}

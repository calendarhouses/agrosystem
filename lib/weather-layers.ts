/** Регіональний вітер (Open-Meteo) + Live-радар опадів (RainViewer) */

import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
} from "geojson";

export type WeatherHourPoint = {
  time: string;
  precipitationMm: number;
  precipProbability: number;
  windSpeedMs: number;
  windDirectionDeg: number;
};

export type RainViewerFrame = {
  time: number;
  path: string;
};

export type WeatherStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type RegionalStationSeries = WeatherStation & {
  speed: number[];
  dir: number[];
};

export type RegionalWeatherField = {
  times: string[];
  stations: RegionalStationSeries[];
};

export const UA_WEATHER_STATIONS: WeatherStation[] = [
  { id: "kyiv-city", name: "Київ", lat: 50.45, lng: 30.52 },
  { id: "kyiv-obl", name: "Київська", lat: 50.0, lng: 30.2 },
  { id: "lviv", name: "Львівська", lat: 49.84, lng: 24.03 },
  { id: "kharkiv", name: "Харківська", lat: 49.99, lng: 36.23 },
  { id: "odesa", name: "Одеська", lat: 46.48, lng: 30.73 },
  { id: "dnipro", name: "Дніпропетровська", lat: 48.46, lng: 35.05 },
  { id: "zaporizhzhia", name: "Запорізька", lat: 47.84, lng: 35.14 },
  { id: "vinnytsia", name: "Вінницька", lat: 49.23, lng: 28.47 },
  { id: "poltava", name: "Полтавська", lat: 49.59, lng: 34.55 },
  { id: "chernihiv", name: "Чернігівська", lat: 51.5, lng: 31.29 },
  { id: "sumy", name: "Сумська", lat: 50.91, lng: 34.8 },
  { id: "zhytomyr", name: "Житомирська", lat: 50.25, lng: 28.66 },
  { id: "cherkasy", name: "Черкаська", lat: 49.44, lng: 32.06 },
  { id: "khmelnytskyi", name: "Хмельницька", lat: 49.42, lng: 26.99 },
  { id: "rivne", name: "Рівненська", lat: 50.62, lng: 26.25 },
  { id: "ternopil", name: "Тернопільська", lat: 49.55, lng: 25.59 },
  { id: "ivano-frankivsk", name: "Івано-Франківська", lat: 48.92, lng: 24.71 },
  { id: "zakarpattia", name: "Закарпатська", lat: 48.62, lng: 22.29 },
  { id: "chernivtsi", name: "Чернівецька", lat: 48.29, lng: 25.94 },
  { id: "volyn", name: "Волинська", lat: 50.75, lng: 25.34 },
  { id: "mykolaiv", name: "Миколаївська", lat: 46.97, lng: 32.0 },
  { id: "kherson", name: "Херсонська", lat: 46.64, lng: 32.62 },
  { id: "kirovohrad", name: "Кіровоградська", lat: 48.51, lng: 32.26 },
  { id: "donetsk", name: "Донецька", lat: 48.02, lng: 37.8 },
  { id: "luhansk", name: "Луганська", lat: 48.57, lng: 39.31 },
];

export function formatHourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatUnixLabel(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function rainTimeAtProgress(
  frames: RainViewerFrame[],
  progress: number
): number {
  if (!frames.length) return 0;
  if (frames.length === 1) return frames[0]!.time;
  const max = frames.length - 1;
  const p = Math.max(0, Math.min(max, progress));
  const i0 = Math.floor(p);
  const i1 = Math.min(max, i0 + 1);
  const t = p - i0;
  return Math.round(lerp(frames[i0]!.time, frames[i1]!.time, t));
}

export function hourTimeAtProgress(times: string[], progress: number): string {
  if (!times.length) return "";
  if (times.length === 1) return times[0]!;
  const max = times.length - 1;
  const p = Math.max(0, Math.min(max, progress));
  const i0 = Math.floor(p);
  const i1 = Math.min(max, i0 + 1);
  const t = p - i0;
  const a = new Date(times[i0]!).getTime();
  const b = new Date(times[i1]!).getTime();
  return new Date(Math.round(lerp(a, b, t))).toISOString();
}

export function indexClosestToNow(hours: WeatherHourPoint[]): number {
  if (!hours.length) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  hours.forEach((hour, index) => {
    const diff = Math.abs(new Date(hour.time).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  return best;
}

export function indexClosestRainFrame(frames: RainViewerFrame[]): number {
  if (!frames.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  let best = frames.length - 1;
  let bestDiff = Infinity;
  frames.forEach((frame, index) => {
    const diff = Math.abs(frame.time - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  return best;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

/** Live-радар: лише fact past + nowcast (без 12-год екстраполяції) */
export async function fetchRainViewerFrames(
  signal?: AbortSignal
): Promise<{ host: string; frames: RainViewerFrame[] }> {
  const response = await fetch(
    "https://api.rainviewer.com/public/weather-maps.json",
    { signal, cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(`RainViewer HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    host?: string;
    radar?: {
      past?: Array<{ time: number; path: string }>;
      nowcast?: Array<{ time: number; path: string }>;
    };
  };

  const host = (data.host ?? "https://tilecache.rainviewer.com").replace(
    /\/$/,
    ""
  );
  const past = data.radar?.past ?? [];
  const nowcast = data.radar?.nowcast ?? [];
  const frames = [...past, ...nowcast].filter(
    (frame) => frame?.path && Number.isFinite(frame.time)
  );

  if (!frames.length) {
    throw new Error("Немає кадрів Live-радару");
  }

  return { host, frames };
}

/** tileSize у Source має бути 256 */
export function rainTileUrl(host: string, path: string): string {
  const base = host.replace(/\/$/, "");
  const tilePath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tilePath}/256/{z}/{x}/{y}/2/1_1.png`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

let windCache: { at: number; field: RegionalWeatherField } | null = null;
const WIND_CACHE_MS = 15 * 60 * 1000;

/** Вітер −2…+10 год по областях України */
export async function fetchRegionalWeatherField(
  signal?: AbortSignal
): Promise<RegionalWeatherField> {
  const now = Date.now();
  if (windCache && now - windCache.at < WIND_CACHE_MS) {
    return windCache.field;
  }

  const stations = UA_WEATHER_STATIONS;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", stations.map((s) => s.lat).join(","));
  url.searchParams.set("longitude", stations.map((s) => s.lng).join(","));
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m");
  url.searchParams.set("past_hours", "2");
  url.searchParams.set("forecast_hours", "10");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch(url.toString(), { signal, cache: "no-store" });
    lastStatus = response.status;
    if (response.status === 429) {
      await sleep(1200 * (attempt + 1), signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const data = (await response.json()) as
      | Array<{
          hourly?: {
            time?: string[];
            wind_speed_10m?: number[];
            wind_direction_10m?: number[];
          };
        }>
      | {
          hourly?: {
            time?: string[];
            wind_speed_10m?: number[];
            wind_direction_10m?: number[];
          };
        };

    const rows = Array.isArray(data) ? data : [data];
    const times = (rows[0]?.hourly?.time ?? []).slice(0, 12);
    const series: RegionalStationSeries[] = stations.map((station, index) => {
      const row = rows[index];
      return {
        ...station,
        speed: (row?.hourly?.wind_speed_10m ?? [])
          .slice(0, 12)
          .map((v) => Number(v) || 0),
        dir: (row?.hourly?.wind_direction_10m ?? [])
          .slice(0, 12)
          .map((v) => Number(v) || 0),
      };
    });

    const field: RegionalWeatherField = { times, stations: series };
    windCache = { at: now, field };
    return field;
  }

  throw new Error(
    lastStatus === 429
      ? "Забагато запитів до погоди. Зачекайте хвилину й спробуйте знову."
      : `Open-Meteo HTTP ${lastStatus}`
  );
}

export function nearestStation(
  field: RegionalWeatherField,
  lat: number,
  lng: number
): RegionalStationSeries {
  let best = field.stations[0]!;
  let bestDist = Infinity;
  for (const station of field.stations) {
    const d = (station.lat - lat) ** 2 + (station.lng - lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = station;
    }
  }
  return best;
}

export function windAtLocation(
  field: RegionalWeatherField,
  lat: number,
  lng: number,
  index: number,
  blend = 0
): { speed: number; dir: number } {
  const station = nearestStation(field, lat, lng);
  const i0 = Math.max(0, Math.min(field.times.length - 1, index));
  const i1 = Math.min(field.times.length - 1, i0 + 1);
  const t = Math.max(0, Math.min(1, blend));
  return {
    speed: lerp(station.speed[i0] ?? 0, station.speed[i1] ?? 0, t),
    dir: lerpAngleDeg(station.dir[i0] ?? 0, station.dir[i1] ?? 0, t),
  };
}

export function timelineFromRegionalWeather(
  field: RegionalWeatherField,
  lat: number,
  lng: number
): WeatherHourPoint[] {
  const station = nearestStation(field, lat, lng);
  return field.times.map((time, index) => ({
    time,
    precipitationMm: 0,
    precipProbability: 0,
    windSpeedMs: station.speed[index] ?? 0,
    windDirectionDeg: station.dir[index] ?? 0,
  }));
}

/** Кінець вектора вітру (градуси, м/с → зміщення на карті) */
function windVectorEnd(
  lng: number,
  lat: number,
  dirDeg: number,
  speedMs: number
): [number, number] {
  const towardDeg = (dirDeg + 180) % 360;
  const scale = Math.min(1.35, 0.55 + speedMs / 12);
  const distDeg = (0.045 * scale) / Math.max(0.55, Math.cos((lat * Math.PI) / 180));
  const rad = (towardDeg * Math.PI) / 180;
  return [lng + distDeg * Math.sin(rad), lat + distDeg * Math.cos(rad)];
}

/** Сітка стрілок вітру над Україною для шару карти */
export function buildWindGridLinesGeoJSON(
  field: RegionalWeatherField,
  progress: number,
  options?: { stepDeg?: number }
): FeatureCollection<LineString, { speed: number; dir: number }> {
  const len = Math.max(0, field.times.length - 1);
  const p = Math.max(0, Math.min(len, progress));
  const index = Math.floor(p);
  const blend = p - index;
  const step = options?.stepDeg ?? 0.65;

  const features: Feature<LineString, { speed: number; dir: number }>[] = [];

  for (let lat = 44.2; lat <= 52.4; lat += step) {
    for (let lng = 22.1; lng <= 40.2; lng += step) {
      const { speed, dir } = windAtLocation(field, lat, lng, index, blend);
      if (speed < 0.15) continue;
      const [endLng, endLat] = windVectorEnd(lng, lat, dir, speed);
      features.push({
        type: "Feature",
        properties: { speed, dir },
        geometry: {
          type: "LineString",
          coordinates: [
            [lng, lat],
            [endLng, endLat],
          ],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/** @deprecated — опади на карті тепер лише Live-радар */
export function precipFieldToGeoJSON(
  _field: RegionalWeatherField,
  _index: number,
  _blend = 0
): FeatureCollection<Point, { mm: number }> {
  return { type: "FeatureCollection", features: [] };
}

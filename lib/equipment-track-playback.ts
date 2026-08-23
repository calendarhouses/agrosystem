import type { Position } from "geojson";

import type { WialonTrackLineFeature } from "@/lib/wialon";

/** Крок progress за кадр (~60 FPS) при 1x */
export const PLAYBACK_STEP_PER_FRAME = 0.05;

export const PLAYBACK_SPEEDS = [1, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Тривалість follow-камери: на високій швидкості майже без інерції */
export function playbackFollowDurationMs(speed: PlaybackSpeed): number {
  if (speed >= 10) return 0;
  if (speed >= 5) return 40;
  return 180;
}

/** Трохи ширший кадр на 5x/10x, щоб трек не «відставав» візуально від іконки */
export function playbackFollowZoom(speed: PlaybackSpeed): number {
  if (speed >= 10) return 13.4;
  if (speed >= 5) return 14.4;
  return 15.6;
}

export function trackPointCount(track: WialonTrackLineFeature | null): number {
  return track?.geometry.coordinates.length ?? 0;
}

export function trackMaxProgress(track: WialonTrackLineFeature | null): number {
  return Math.max(trackPointCount(track) - 1, 0);
}

export function interpolateTrackPoint(
  coordinates: Position[],
  progress: number
): Position | null {
  if (coordinates.length === 0) return null;
  if (progress <= 0) return coordinates[0] ?? null;
  const lastIdx = coordinates.length - 1;
  if (progress >= lastIdx) return coordinates[lastIdx] ?? null;

  const idx = Math.floor(progress);
  const frac = progress - idx;
  const a = coordinates[idx];
  const b = coordinates[idx + 1];
  if (!a || !b) return null;
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

export function buildPlayedLineFeature(
  track: WialonTrackLineFeature | null,
  progress: number
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!track) return null;
  const coordinates = track.geometry.coordinates;
  if (coordinates.length < 2) return null;

  const played: Position[] = [];
  const endIdx = Math.min(Math.floor(progress), coordinates.length - 1);
  for (let i = 0; i <= endIdx; i += 1) {
    played.push(coordinates[i]!);
  }
  const tip = interpolateTrackPoint(coordinates, progress);
  if (tip && played.length > 0) {
    const last = played[played.length - 1]!;
    if (last[0] !== tip[0] || last[1] !== tip[1]) {
      played.push(tip);
    }
  }

  if (played.length < 2) return null;

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: played },
  };
}

export function progressUnixTime(
  track: WialonTrackLineFeature | null,
  progress: number
): number | null {
  const times = track?.properties.times ?? [];
  if (times.length === 0) return null;
  const idx = Math.min(Math.round(progress), times.length - 1);
  const value = times[idx];
  return value != null && Number.isFinite(value) ? value : null;
}

export function formatTrackClock(unix: number | null | undefined): string {
  if (unix == null || !Number.isFinite(unix) || unix <= 0) return "--:--";
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

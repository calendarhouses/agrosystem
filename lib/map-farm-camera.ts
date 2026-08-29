import type { Map as MapboxMap } from "mapbox-gl";

import { FARM_BASE_LOCATION } from "@/lib/farm-base-location";

export type MapCameraPadding =
  | number
  | { top?: number; bottom?: number; left?: number; right?: number };

/** [west, south, east, north] */
export type LngLatBoundsTuple = [number, number, number, number];

/** [[minLng, minLat], [maxLng, maxLat]] */
export type LngLatBoundsCorners = [[number, number], [number, number]];

export function cornersToBoundsTuple(
  bounds: LngLatBoundsCorners
): LngLatBoundsTuple {
  const [[west, south], [east, north]] = bounds;
  return [west, south, east, north];
}

function normalizeBounds(
  bounds: LngLatBoundsTuple | LngLatBoundsCorners
): LngLatBoundsTuple {
  if (bounds.length === 2) {
    return cornersToBoundsTuple(bounds);
  }
  return bounds;
}

function expandBounds(bounds: LngLatBoundsTuple, pad = 0.002): LngLatBoundsTuple {
  let [west, south, east, north] = bounds;
  if (east - west < 0.004) {
    const mid = (west + east) / 2;
    west = mid - 0.002;
    east = mid + 0.002;
  }
  if (north - south < 0.004) {
    const mid = (south + north) / 2;
    south = mid - 0.002;
    north = mid + 0.002;
  }
  return [west - pad, south - pad, east + pad, north + pad];
}

/**
 * Камера як у мобільних Полях: zoom під bounds, центр — база (Іванівка),
 * якщо вона в межах; інакше — геометричний центр.
 */
export function focusMapAroundFarmAnchor(
  map: MapboxMap,
  bounds: LngLatBoundsTuple | LngLatBoundsCorners,
  options?: { padding?: MapCameraPadding; maxZoom?: number; duration?: number }
) {
  const [west, south, east, north] = expandBounds(normalizeBounds(bounds));
  const padding = options?.padding ?? 80;
  const duration = options?.duration ?? 850;
  const easing = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  let fittedZoom: number | undefined;
  try {
    fittedZoom = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding, maxZoom: options?.maxZoom ?? 14 }
    )?.zoom;
  } catch {
    fittedZoom = undefined;
  }
  if (fittedZoom == null || !Number.isFinite(fittedZoom)) return;

  const top = typeof padding === "number" ? padding : (padding.top ?? 0);
  const bottom = typeof padding === "number" ? padding : (padding.bottom ?? 0);

  const boundsCenterLng = (west + east) / 2;
  const boundsCenterLat = (south + north) / 2;
  const anchorLng = FARM_BASE_LOCATION.longitude;
  const anchorLat = FARM_BASE_LOCATION.latitude;
  const padLng = Math.max((east - west) * 0.15, 0.02);
  const padLat = Math.max((north - south) * 0.15, 0.015);
  const anchorInBounds =
    anchorLng >= west - padLng &&
    anchorLng <= east + padLng &&
    anchorLat >= south - padLat &&
    anchorLat <= north + padLat;

  map.easeTo({
    center: anchorInBounds
      ? [anchorLng, anchorLat]
      : [boundsCenterLng, boundsCenterLat],
    zoom: fittedZoom,
    offset: [0, -(bottom - top) / 2],
    duration,
    essential: true,
    easing,
  });
}

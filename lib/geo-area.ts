import area from "@turf/area";
import type { Feature, Geometry, Position } from "geojson";

/** Площа полігону в гектарах (геодезична) */
export function hectaresFromFeature(
  feature: Feature<Geometry> | null | undefined
): number {
  if (!feature?.geometry) return 0;
  if (
    feature.geometry.type !== "Polygon" &&
    feature.geometry.type !== "MultiPolygon"
  ) {
    return 0;
  }

  const squareMeters = area(feature);
  return Math.round((squareMeters / 10_000) * 100) / 100;
}

function walkPositions(
  geometry: Geometry,
  visit: (position: Position) => void
) {
  if (geometry.type === "Point") {
    visit(geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    for (const position of geometry.coordinates) visit(position);
    return;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      for (const position of ring) visit(position);
    }
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const position of ring) visit(position);
      }
    }
  }
}

/** [west, south, east, north] */
export type LngLatBoundsTuple = [number, number, number, number];

export function boundsFromGeometry(
  geometry: Geometry | null | undefined
): LngLatBoundsTuple | null {
  if (!geometry) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  walkPositions(geometry, ([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  });

  if (!Number.isFinite(west)) return null;
  return [west, south, east, north];
}

export function mergeBounds(
  boundsList: Array<LngLatBoundsTuple | null | undefined>
): LngLatBoundsTuple | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const bounds of boundsList) {
    if (!bounds) continue;
    west = Math.min(west, bounds[0]);
    south = Math.min(south, bounds[1]);
    east = Math.max(east, bounds[2]);
    north = Math.max(north, bounds[3]);
  }

  if (!Number.isFinite(west)) return null;
  return [west, south, east, north];
}

export function centerFromBounds(
  bounds: LngLatBoundsTuple
): { longitude: number; latitude: number } {
  return {
    longitude: (bounds[0] + bounds[2]) / 2,
    latitude: (bounds[1] + bounds[3]) / 2,
  };
}

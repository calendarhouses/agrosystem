import { center } from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon } from "geojson";

/** Центр полігону поля [lng, lat] через Turf */
export function fieldCentroid(
  geometry: Geometry | null | undefined
): { longitude: number; latitude: number } | null {
  if (
    !geometry ||
    (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
  ) {
    return null;
  }

  try {
    const feature: Feature<Polygon | MultiPolygon> = {
      type: "Feature",
      properties: {},
      geometry,
    };
    const point = center(feature);
    const [longitude, latitude] = point.geometry.coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { longitude, latitude };
  } catch {
    return null;
  }
}

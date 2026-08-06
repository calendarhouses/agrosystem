import type { FeatureCollection } from "geojson";

/** Межі карти — лише Україна [SW, NE] */
export const UKRAINE_MAX_BOUNDS: [[number, number], [number, number]] = [
  [22.137, 44.386],
  [40.228, 52.379],
];

/** Початковий вигляд — Київська область */
export const FIELDS_MAP_INITIAL_VIEW = {
  longitude: 30.2,
  latitude: 50.0,
  zoom: 13.5,
} as const;

/** GPS-маркер техніки всередині Поля 1 */
export const TRACTOR_GPS = {
  longitude: 30.1865,
  latitude: 50.01,
} as const;

/**
 * GeoJSON полігонів полів поруч із початковими координатами.
 * Колір у properties — Iron & Premium Clay.
 */
export const FIELDS_GEOJSON: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "field-1",
      properties: {
        id: "field-1",
        name: "Поле 1",
        crop: "Соя",
        color: "#276749",
        areaHa: 45,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [30.175, 50.015],
            [30.195, 50.018],
            [30.198, 50.005],
            [30.178, 50.002],
            [30.175, 50.015],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "field-2",
      properties: {
        id: "field-2",
        name: "Поле 2",
        crop: "Кукурудза",
        color: "#C05621",
        areaHa: 62,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [30.2, 50.016],
            [30.225, 50.019],
            [30.228, 50.004],
            [30.202, 50.001],
            [30.2, 50.016],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "field-3",
      properties: {
        id: "field-3",
        name: "Поле 3",
        crop: "Пшениця",
        color: "#D69E2E",
        areaHa: 38,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [30.185, 49.998],
            [30.21, 50.0],
            [30.212, 49.988],
            [30.187, 49.986],
            [30.185, 49.998],
          ],
        ],
      },
    },
  ],
};

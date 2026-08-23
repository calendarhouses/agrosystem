import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { area as turfArea, booleanPointInPolygon } from "@turf/turf";

import {
  FIELDS,
  type AccentTone,
  type Field,
} from "@/lib/dashboard-data";
import type {
  FarmField,
  FieldGeometry,
} from "@/lib/farm-fields";
import { cleanFieldName } from "@/lib/bas-field-names";
import { FIELDS_GEOJSON } from "@/lib/fields-geojson";
import type { WialonGeofenceProperties, WialonUnit } from "@/lib/wialon";

export type MapFieldSource = "demo" | "saved" | "wialon";

/** Єдина модель поля для списку / інспектора / карти */
export type MapFieldItem = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
  color: string;
  description: string;
  source: MapFieldSource;
  geometry: FieldGeometry | null;
  demoField?: Field;
  farmField?: FarmField;
};

const DEMO_COLORS: Record<AccentTone, string> = {
  lime: "#276749",
  amber: "#D69E2E",
  orange: "#C05621",
};

function demoGeometry(fieldId: string): FieldGeometry | null {
  const feature = FIELDS_GEOJSON.features.find(
    (item) => item.properties?.id === fieldId || item.id === fieldId
  );
  if (!feature?.geometry) return null;
  if (
    feature.geometry.type === "Polygon" ||
    feature.geometry.type === "MultiPolygon"
  ) {
    return feature.geometry;
  }
  return null;
}

export function demoToMapItem(field: Field): MapFieldItem {
  return {
    id: field.id,
    name: field.name,
    crop: field.crop,
    areaHa: field.areaHa,
    color: DEMO_COLORS[field.accent],
    description: "",
    source: "demo",
    geometry: demoGeometry(field.id),
    demoField: field,
  };
}

export function farmToMapItem(field: FarmField): MapFieldItem {
  return {
    id: field.id,
    name: cleanFieldName(field.name) || field.name,
    crop: field.crop,
    areaHa: field.areaHa,
    color: field.color,
    description: "",
    source: "saved",
    geometry: field.geometry,
    farmField: field,
  };
}

/** Площа полігону в га через Turf (як у ТЗ) */
export function areaHaFromFeature(feature: Feature): number {
  try {
    return Number((turfArea(feature) / 10_000).toFixed(2));
  } catch {
    return 0;
  }
}

export function geofenceToMapItem(
  feature: Feature<Polygon, WialonGeofenceProperties>
): MapFieldItem | null {
  if (feature.geometry?.type !== "Polygon") return null;
  const props = feature.properties;
  const id = props?.id ?? String(feature.id ?? "");
  if (!id) return null;

  return {
    id,
    name: cleanFieldName(props.name || props.id || "Поле") || "Поле",
    crop: "",
    areaHa: areaHaFromFeature(feature),
    color: props.color || "#276749",
    description: (props.description ?? "").trim(),
    source: "wialon",
    geometry: feature.geometry,
  };
}

/** Техніка, чиї координати лежать всередині полігону поля */
export function unitsInsideField(
  units: WialonUnit[],
  geometry: FieldGeometry | null | undefined
): WialonUnit[] {
  if (
    !geometry ||
    (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
  ) {
    return [];
  }

  const polygon: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry,
  };

  return units.filter((unit) => {
    const pos = unit.pos;
    if (!pos) return false;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
    if (pos.x <= 0 || pos.y <= 0) return false;
    try {
      return booleanPointInPolygon([pos.x, pos.y], polygon);
    } catch {
      return false;
    }
  });
}

/**
 * Список ділянок: геозони Wialon (+ збережені з Supabase).
 * Паспорт з БД накладається на Wialon за wialon_zone_id (без дублів).
 * Демо-мок — лише коли завантаження вже завершилось і геозон немає.
 */
export function buildMapFieldList(
  saved: FarmField[],
  geofences?: FeatureCollection<Polygon, WialonGeofenceProperties> | null,
  options?: { allowDemoFallback?: boolean }
): MapFieldItem[] {
  const allowDemo = options?.allowDemoFallback !== false;
  const passportByWialonId = new Map<string, FarmField>();
  const standaloneSaved: FarmField[] = [];

  for (const field of saved) {
    const zoneId = field.wialonZoneId?.trim();
    if (zoneId) {
      passportByWialonId.set(zoneId, field);
    } else {
      standaloneSaved.push(field);
    }
  }

  const fromWialon = (geofences?.features ?? [])
    .map((feature) => {
      const base = geofenceToMapItem(
        feature as Feature<Polygon, WialonGeofenceProperties>
      );
      if (!base) return null;
      const passport = passportByWialonId.get(base.id);
      if (!passport) return base;
      return {
        ...base,
        name: cleanFieldName(passport.name) || passport.name,
        crop: passport.crop,
        areaHa: passport.areaHa,
        color: passport.color,
        geometry: passport.geometry ?? base.geometry,
        source: "saved" as const,
        farmField: passport,
      };
    })
    .filter((item): item is MapFieldItem => item != null);

  const base =
    fromWialon.length > 0
      ? fromWialon
      : allowDemo
        ? FIELDS.map(demoToMapItem)
        : [];

  const items = [...base, ...standaloneSaved.map(farmToMapItem)];
  return items.sort(compareMapFields);
}

/** Алфавіт за текстовою частиною, потім № поля. */
function compareMapFields(a: MapFieldItem, b: MapFieldItem): number {
  const keyA = fieldSortKey(a.name);
  const keyB = fieldSortKey(b.name);
  const byAlpha = keyA.alpha.localeCompare(keyB.alpha, "uk", {
    sensitivity: "base",
  });
  if (byAlpha !== 0) return byAlpha;
  if (keyA.num !== keyB.num) return keyA.num - keyB.num;
  return a.name.localeCompare(b.name, "uk", { numeric: true });
}

function fieldSortKey(name: string): { alpha: string; num: number } {
  const cleaned = cleanFieldName(name) || name;
  const num = fieldNumber(cleaned);
  const alpha = cleaned
    .replace(/№/g, " ")
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("uk");
  return { alpha: alpha || cleaned.toLocaleLowerCase("uk"), num };
}

/** Номер з назви «Поле 12» → 12; без номера — в кінець */
export function fieldNumber(name: string): number {
  const match = name.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Наступний вільний номер для нового поля */
export function nextFieldNumber(items: MapFieldItem[]): number {
  let max = 0;
  for (const item of items) {
    const n = fieldNumber(item.name);
    if (Number.isFinite(n) && n < Number.MAX_SAFE_INTEGER) {
      max = Math.max(max, n);
    }
  }
  return max + 1;
}

/** Адаптер у Field для існуючого sheet (економіка — live з складу) */
export function mapItemToSheetField(item: MapFieldItem): Field {
  if (item.demoField) {
    return {
      ...item.demoField,
      economics: {
        costPerHaUsd: 0,
        fuelUsedL: 0,
        expectedRevenueUsd: 0,
      },
      timeline: [],
    };
  }

  return {
    id: item.id,
    name: item.name,
    crop: item.crop,
    areaHa: item.areaHa,
    status: "active",
    mapPositionClass: "",
    accent: "lime",
    economics: {
      costPerHaUsd: 0,
      fuelUsedL: 0,
      expectedRevenueUsd: 0,
    },
    timeline: [],
  };
}

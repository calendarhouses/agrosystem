import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { area as turfArea, booleanPointInPolygon } from "@turf/turf";

import {
  FIELD_ANALYTICS,
  FIELDS,
  type AccentTone,
  type Field,
  type FieldAnalytics,
} from "@/lib/dashboard-data";
import type { FarmField, FieldGeometry } from "@/lib/farm-fields";
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
    name: field.name,
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
    name: props.name || props.id || "Поле",
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
        name: passport.name,
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
  return items.sort((a, b) => {
    const numA = fieldNumber(a.name);
    const numB = fieldNumber(b.name);
    if (numA !== numB) return numA - numB;
    return a.name.localeCompare(b.name, "uk");
  });
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

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Аналітика для sheet: демо з моків, збережені — розумний stub */
export function analyticsForMapField(item: MapFieldItem): FieldAnalytics {
  if (item.source === "demo" && FIELD_ANALYTICS[item.id]) {
    return FIELD_ANALYTICS[item.id];
  }

  const seed = hashSeed(item.id);
  const profitability = 18 + (seed % 28);
  const yieldForecast = Math.round((1.8 + (seed % 20) / 10) * 10) / 10;

  return {
    yieldForecastTHa: yieldForecast,
    profitabilityPercent: profitability,
    profitSeries: [
      { month: "Бер", profit: Math.max(4, profitability - 22) },
      { month: "Кві", profit: Math.max(6, profitability - 16) },
      { month: "Тра", profit: Math.max(10, profitability - 10) },
      { month: "Чер", profit: Math.max(12, profitability - 6) },
      { month: "Лип", profit: Math.max(14, profitability - 3) },
      { month: "Сер", profit: profitability },
    ],
    costsPerHa: [
      { label: "Насіння", perHaUsd: 36 + (seed % 12) },
      { label: "Дизель", perHaUsd: 12 + (seed % 8) },
      { label: "Добрива", perHaUsd: 30 + (seed % 14) },
      { label: "ЗЗР", perHaUsd: 18 + (seed % 10) },
      { label: "Робоча сила", perHaUsd: 14 + (seed % 9) },
    ],
    agroHistory: [
      {
        id: `${item.id}-h1`,
        dateLabel: "Цього сезону",
        title: `Посів · ${item.crop}`,
        status: "completed",
        icon: "tractor",
      },
      {
        id: `${item.id}-h2`,
        dateLabel: "Нещодавно",
        title: "Агромоніторинг контуру",
        status: "completed",
        icon: "droplet",
      },
      {
        id: `${item.id}-h3`,
        dateLabel: "Сьогодні",
        title: "Очікування вікна обробки",
        status: "waiting",
        icon: "cloud",
      },
    ],
  };
}

/** Адаптер у Field для існуючого sheet */
export function mapItemToSheetField(item: MapFieldItem): Field {
  if (item.demoField) return item.demoField;

  const costs = analyticsForMapField(item).costsPerHa;
  const costPerHaUsd = costs.reduce((sum, row) => sum + row.perHaUsd, 0);

  return {
    id: item.id,
    name: item.name,
    crop: item.crop,
    areaHa: item.areaHa,
    status: "active",
    mapPositionClass: "",
    accent: "lime",
    economics: {
      costPerHaUsd,
      fuelUsedL: Math.round(item.areaHa * 8.5),
      expectedRevenueUsd: Math.round(item.areaHa * 980),
    },
    timeline: analyticsForMapField(item).agroHistory,
  };
}

import {
  FIELD_ANALYTICS,
  FIELDS,
  type AccentTone,
  type Field,
  type FieldAnalytics,
} from "@/lib/dashboard-data";
import type { FarmField, FieldGeometry } from "@/lib/farm-fields";
import { FIELDS_GEOJSON } from "@/lib/fields-geojson";

export type MapFieldSource = "demo" | "saved";

/** Єдина модель поля для списку / інспектора / карти */
export type MapFieldItem = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
  color: string;
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
    source: "saved",
    geometry: field.geometry,
    farmField: field,
  };
}

export function buildMapFieldList(saved: FarmField[]): MapFieldItem[] {
  const items = [...FIELDS.map(demoToMapItem), ...saved.map(farmToMapItem)];
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

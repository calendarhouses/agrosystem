/**
 * Агро-Радар engine — інсайти: погода + склад + техніка + пріоритет + NDVI.
 */

import {
  findCropOperationById,
  operationsForMonth,
  resolveCropDictionaryEntry,
  type CropOperation,
  type IdealConditions,
} from "@/lib/agronomy-dictionary";
import {
  evaluateFleetStatus,
  type AgroFleetUnit,
  type FleetStatus,
} from "@/lib/agronomy-fleet";
import {
  estimateOperationCost,
  evaluateResourceStatus,
  type AgroInventoryItem,
  type EstimatedCostBreakdown,
  type ResourceStatus,
} from "@/lib/agronomy-resources";

export type AgroActiveField = {
  id: string;
  name: string;
  crop: string;
  areaHa?: number;
};

export type AgroCurrentWeather = {
  tempC: number;
  windMs: number;
  soilTempC?: number | null;
  isRaining?: boolean;
  weatherCode?: number;
  precipitationMm?: number;
};

/** Короткий зріз години прогнозу для «вікно закривається» */
export type AgroForecastHour = {
  time: string;
  tempC: number;
  windMs: number;
  precipitationMm: number;
  weatherCode: number;
};

export type AgroNdviAlert = {
  id: string;
  fieldId: string;
  fieldName: string;
  crop: string;
  areaHa?: number;
  dropPercent: number;
  zoneNote: string | null;
  detectedAt: string;
};

export type AgroInsightStatus =
  | "PERFECT_CONDITIONS"
  | "WAITING_WEATHER"
  | "PLANNING";

export type InsightFieldRef = {
  id: string;
  name: string;
  areaHa?: number;
};

export type InsightCardKind = "operation" | "anomaly";

export type InsightCardData = {
  id: string;
  kind: InsightCardKind;
  operationId: string;
  operationName: string;
  operationType: CropOperation["type"];
  crop: string;
  cropKey: string;
  fields: InsightFieldRef[];
  status: AgroInsightStatus;
  explanation: string;
  targetMonth: number;
  targetYear: number;
  resourceStatus: ResourceStatus;
  estimatedCost: EstimatedCostBreakdown;
  fleetStatus: FleetStatus;
  /** Вага ризику для сортування в колонці */
  riskScore: number;
  /** Топ пріоритет у колонці */
  isCriticalPriority: boolean;
  /** NDVI: % падіння */
  ndviDropPercent?: number;
  ndviZoneNote?: string | null;
};

export type GenerateAgroInsightsInput = {
  activeFields: readonly AgroActiveField[];
  targetMonth: number;
  targetYear: number;
  currentWeather?: AgroCurrentWeather | null;
  now?: Date;
  inventory?: readonly AgroInventoryItem[] | null;
  fuelPriceUah?: number;
  fleet?: readonly AgroFleetUnit[] | null;
  /** Прогноз на ~48 год — для +30 risk якщо вікно закривається */
  forecastHours?: readonly AgroForecastHour[] | null;
  ndviAlerts?: readonly AgroNdviAlert[] | null;
};

export type {
  ResourceStatus,
  EstimatedCostBreakdown,
  AgroInventoryItem,
  FleetStatus,
  AgroFleetUnit,
};

function isRainyWeather(weather: {
  isRaining?: boolean;
  precipitationMm?: number;
  weatherCode?: number;
}): boolean {
  if (typeof weather.isRaining === "boolean") return weather.isRaining;
  if (
    typeof weather.precipitationMm === "number" &&
    Number.isFinite(weather.precipitationMm) &&
    weather.precipitationMm > 0.2
  ) {
    return true;
  }
  const code = weather.weatherCode;
  if (typeof code !== "number") return false;
  return (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code === 95 ||
    code === 96 ||
    code === 99
  );
}

type ConditionCheck = {
  ok: boolean;
  blockers: string[];
  positives: string[];
};

function evaluateIdealConditions(
  conditions: IdealConditions,
  weather: AgroCurrentWeather
): ConditionCheck {
  const blockers: string[] = [];
  const positives: string[] = [];
  const raining = isRainyWeather(weather);

  if (conditions.requiresNoRain === true) {
    if (raining) blockers.push("очікується дощ — відкладіть роботи / ЗЗР");
    else positives.push("без дощу");
  } else if (conditions.requiresNoRain === false && raining) {
    positives.push("волого (дощ не блокує)");
  }

  if (typeof conditions.minSoilTemp === "number") {
    const soil = weather.soilTempC;
    if (soil == null || !Number.isFinite(soil)) {
      blockers.push("немає даних про температуру ґрунту");
    } else if (soil < conditions.minSoilTemp) {
      blockers.push(
        `ґрунт ${formatTemp(soil)} — холодно (потрібно ≥ ${conditions.minSoilTemp}°C)`
      );
    } else {
      positives.push(`температура ґрунту ${formatTemp(soil)}, ідеально`);
    }
  }

  if (typeof conditions.maxAirTemp === "number") {
    const air = weather.tempC;
    if (!Number.isFinite(air)) {
      blockers.push("немає даних про температуру повітря");
    } else if (air > conditions.maxAirTemp) {
      blockers.push(
        `повітря ${formatTemp(air)} — занадто тепло (макс. ${conditions.maxAirTemp}°C)`
      );
    } else {
      positives.push(`повітря ${formatTemp(air)}`);
    }
  }

  if (typeof conditions.maxWind === "number") {
    const wind = weather.windMs;
    if (!Number.isFinite(wind)) {
      blockers.push("немає даних про вітер");
    } else if (wind > conditions.maxWind) {
      blockers.push(
        `вітер ${formatWind(wind)} — засильний (макс. ${conditions.maxWind} м/с)`
      );
    } else {
      positives.push(`вітер ${formatWind(wind)}`);
    }
  }

  return { ok: blockers.length === 0, blockers, positives };
}

function formatTemp(c: number): string {
  const rounded = Math.round(c * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°C`;
}

function formatWind(ms: number): string {
  return `${Math.round(ms * 10) / 10} м/с`;
}

function planningExplanation(month: number): string {
  if (month >= 9 && month <= 11) return "Планування на осінь";
  if (month >= 3 && month <= 5) return "Планування на весну";
  if (month >= 6 && month <= 8) return "Планування на літо";
  return "Стратегічне планування";
}

function buildExplanation(
  status: AgroInsightStatus,
  check: ConditionCheck | null,
  targetMonth: number,
  operationName: string
): string {
  if (status === "PLANNING" || !check) return planningExplanation(targetMonth);

  if (status === "PERFECT_CONDITIONS") {
    if (check.positives.length > 0) {
      const head = check.positives[0]!;
      if (head.includes("ґрунту")) {
        return `${capitalize(head)} для «${operationName}»`;
      }
      return `${capitalize(check.positives.join(", "))} — діяти зараз`;
    }
    return "Умови збігаються з ідеальними — діяти зараз";
  }

  const rainBlock = check.blockers.find((b) => b.includes("дощ"));
  if (rainBlock) {
    return `Очікується дощ, відкладіть ${shortOpLabel(operationName)}`;
  }
  if (check.blockers.length > 0) return capitalize(check.blockers[0]!);
  return "Очікування погодного вікна";
}

function shortOpLabel(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes("гербіцид") ||
    lower.includes("ззр") ||
    lower.includes("десик")
  ) {
    return "ЗЗР";
  }
  return name;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function totalAreaHa(fields: InsightFieldRef[]): number {
  return fields.reduce((sum, f) => {
    const a = f.areaHa;
    return sum + (typeof a === "number" && Number.isFinite(a) ? a : 0);
  }, 0);
}

function isPlantProtection(operationName: string): boolean {
  const n = operationName.toLowerCase();
  return (
    n.includes("гербіцид") ||
    n.includes("ззр") ||
    n.includes("десик") ||
    n.includes("захист") ||
    n.includes("фунгіцид") ||
    n.includes("інсектицид")
  );
}

/**
 * Чи прогноз на найближчі ~30 год ламає ідеальні умови операції.
 */
export function weatherWindowClosesSoon(
  conditions: IdealConditions,
  forecastHours: readonly AgroForecastHour[] | null | undefined,
  now = new Date()
): boolean {
  if (!forecastHours?.length) return false;
  const horizonMs = 30 * 60 * 60 * 1000;
  const until = now.getTime() + horizonMs;

  for (const hour of forecastHours) {
    const t = new Date(hour.time).getTime();
    if (!Number.isFinite(t) || t < now.getTime() || t > until) continue;

    if (conditions.requiresNoRain === true && isRainyWeather(hour)) {
      return true;
    }
    if (
      typeof conditions.maxWind === "number" &&
      hour.windMs > conditions.maxWind
    ) {
      return true;
    }
    if (
      typeof conditions.maxAirTemp === "number" &&
      hour.tempC > conditions.maxAirTemp
    ) {
      return true;
    }
  }
  return false;
}

export function computeRiskScore(input: {
  operationName: string;
  areaHa: number;
  windowClosesSoon: boolean;
  kind?: InsightCardKind;
  ndviDropPercent?: number;
}): number {
  if (input.kind === "anomaly") {
    const drop = input.ndviDropPercent ?? 10;
    return 200 + Math.min(100, Math.round(drop * 2));
  }

  let score = 0;
  if (isPlantProtection(input.operationName)) score += 50;
  score += Math.floor(Math.max(0, input.areaHa) / 100) * 20;
  if (input.windowClosesSoon) score += 30;
  return score;
}

const EMPTY_RESOURCE: ResourceStatus = {
  status: "OK",
  requiredQty: 0,
  availableQty: 0,
  item: null,
  itemRefKey: null,
  unit: "",
  unitPriceUah: 0,
  deficitQty: 0,
};

const EMPTY_FLEET: FleetStatus = {
  status: "AVAILABLE",
  availableCount: 0,
  requiredCount: 1,
  unitLabel: "агрегати",
  totalMatching: 0,
};

function enrichOperationCard(
  base: Omit<
    InsightCardData,
    | "resourceStatus"
    | "estimatedCost"
    | "fleetStatus"
    | "riskScore"
    | "isCriticalPriority"
    | "kind"
  >,
  inventory: readonly AgroInventoryItem[],
  fleet: readonly AgroFleetUnit[],
  fuelPriceUah: number,
  windowClosesSoon: boolean
): InsightCardData {
  const area = totalAreaHa(base.fields);
  const resourceStatus = evaluateResourceStatus(
    area,
    base.operationName,
    base.operationType,
    inventory,
    base.cropKey
  );
  const fleetStatus = evaluateFleetStatus(
    area,
    base.operationName,
    base.operationType,
    fleet
  );
  const estimatedCost = estimateOperationCost({
    totalAreaHa: area,
    operationName: base.operationName,
    resource: resourceStatus,
    fuelPriceUah,
  });
  const riskScore = computeRiskScore({
    operationName: base.operationName,
    areaHa: area,
    windowClosesSoon,
    kind: "operation",
  });

  return {
    ...base,
    kind: "operation",
    resourceStatus,
    estimatedCost,
    fleetStatus,
    riskScore,
    isCriticalPriority: false,
  };
}

function buildAnomalyCards(
  alerts: readonly AgroNdviAlert[],
  targetMonth: number,
  targetYear: number
): InsightCardData[] {
  return alerts.map((alert) => {
    const area = alert.areaHa ?? 0;
    const zone = alert.zoneNote?.trim() || "на полі";
    const riskScore = computeRiskScore({
      operationName: "Скаутинг NDVI",
      areaHa: area,
      windowClosesSoon: false,
      kind: "anomaly",
      ndviDropPercent: alert.dropPercent,
    });

    return {
      id: `ndvi-anomaly|${alert.id}`,
      kind: "anomaly" as const,
      operationId: "ndvi-scouting",
      operationName: `Падіння вегетації (NDVI) — ${alert.fieldName}`,
      operationType: "Робота" as const,
      crop: alert.crop || "—",
      cropKey: "anomaly",
      fields: [
        {
          id: alert.fieldId,
          name: alert.fieldName,
          areaHa: alert.areaHa,
        },
      ],
      status: "PERFECT_CONDITIONS" as const,
      explanation: `Супутник зафіксував зниження біомаси на ${Math.round(alert.dropPercent)}% у ${zone}. Ризик хвороби або шкідників.`,
      targetMonth,
      targetYear,
      resourceStatus: EMPTY_RESOURCE,
      estimatedCost: {
        totalUah: 0,
        tmcUah: 0,
        fuelUah: 0,
        fuelLiters: 0,
        areaHa: area,
      },
      fleetStatus: { ...EMPTY_FLEET, availableCount: 1, status: "AVAILABLE" },
      riskScore,
      isCriticalPriority: true,
      ndviDropPercent: alert.dropPercent,
      ndviZoneNote: alert.zoneNote,
    };
  });
}

type GroupKey = string;

type InsightAccumulator = Omit<
  InsightCardData,
  | "resourceStatus"
  | "estimatedCost"
  | "fleetStatus"
  | "riskScore"
  | "isCriticalPriority"
  | "kind"
>;

/**
 * Генерує картки інсайтів + NDVI-аномалії.
 * Сортування всередині колонок — за riskScore (вище = перше).
 */
export function generateAgroInsights(
  input: GenerateAgroInsightsInput
): InsightCardData[] {
  const {
    activeFields,
    targetMonth,
    targetYear,
    currentWeather = null,
    now = new Date(),
    inventory = [],
    fuelPriceUah = 50,
    fleet = [],
    forecastHours = null,
    ndviAlerts = [],
  } = input;

  if (targetMonth < 1 || targetMonth > 12) return [];

  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const isCurrentMonth =
    targetMonth === currentMonth && targetYear === currentYear;
  const useWeather = isCurrentMonth && currentWeather != null;
  const stock = inventory ?? [];
  const park = fleet ?? [];

  const groups = new Map<GroupKey, InsightAccumulator>();

  for (const field of activeFields) {
    const entry = resolveCropDictionaryEntry(field.crop);
    if (!entry) continue;

    const ops = operationsForMonth(entry, targetMonth);
    for (const op of ops) {
      let status: AgroInsightStatus;
      let check: ConditionCheck | null = null;

      if (useWeather && currentWeather) {
        check = evaluateIdealConditions(op.idealConditions, currentWeather);
        status = check.ok ? "PERFECT_CONDITIONS" : "WAITING_WEATHER";
      } else {
        status = "PLANNING";
      }

      const explanation = buildExplanation(
        status,
        check,
        targetMonth,
        op.name
      );

      const key: GroupKey = `${op.id}|${entry.key}|${status}|${targetMonth}|${targetYear}`;
      const existing = groups.get(key);
      const fieldRef: InsightFieldRef = {
        id: field.id,
        name: field.name,
        areaHa: field.areaHa,
      };

      if (existing) {
        if (!existing.fields.some((f) => f.id === field.id)) {
          existing.fields.push(fieldRef);
        }
        continue;
      }

      groups.set(key, {
        id: key,
        operationId: op.id,
        operationName: op.name,
        operationType: op.type,
        crop: entry.labelUk,
        cropKey: entry.key,
        fields: [fieldRef],
        status,
        explanation,
        targetMonth,
        targetYear,
      });
    }
  }

  const operationCards = Array.from(groups.values()).map((base) => {
    const dictOp = findCropOperationById(base.operationId);
    const closes = weatherWindowClosesSoon(
      dictOp?.idealConditions ?? {},
      forecastHours,
      now
    );
    return enrichOperationCard(base, stock, park, fuelPriceUah, closes);
  });

  // NDVI → лише в «Діяти зараз» для поточного місяця
  const anomalyCards =
    isCurrentMonth && ndviAlerts && ndviAlerts.length > 0
      ? buildAnomalyCards(ndviAlerts, targetMonth, targetYear)
      : [];

  const cards = [...anomalyCards, ...operationCards];

  const statusOrder: Record<AgroInsightStatus, number> = {
    PERFECT_CONDITIONS: 0,
    WAITING_WEATHER: 1,
    PLANNING: 2,
  };

  cards.sort((a, b) => {
    const byStatus = statusOrder[a.status] - statusOrder[b.status];
    if (byStatus !== 0) return byStatus;
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    if (a.kind !== b.kind) return a.kind === "anomaly" ? -1 : 1;
    return a.operationName.localeCompare(b.operationName, "uk");
  });

  // Критичний пріоритет — топ-карти в PERFECT (або score ≥ 70)
  const perfect = cards.filter((c) => c.status === "PERFECT_CONDITIONS");
  const criticalIds = new Set(
    perfect
      .filter((c, i) => i < 2 || c.riskScore >= 70 || c.kind === "anomaly")
      .map((c) => c.id)
  );

  for (const card of cards) {
    card.isCriticalPriority = criticalIds.has(card.id);
  }

  return cards;
}

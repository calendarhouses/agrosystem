import {
  findCropOperationById,
  findCropOperationByWorkType,
  type IdealConditions,
} from "@/lib/agronomy-dictionary";
import type { AgroForecastHour } from "@/lib/agronomy-engine";
import { kyivDayBoundsUnix, toKyivDayKey } from "@/lib/kyiv-date";

export type DayClimateRisk = {
  ymd: string;
  level: "none" | "rain" | "frost" | "storm";
};

function isRainyCode(code: number): boolean {
  return (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code === 95 ||
    code === 96 ||
    code === 99
  );
}

function isStormCode(code: number): boolean {
  return code === 95 || code === 96 || code === 99;
}

/** Агрегація ризику по днях з прогнозу (без «зимового ковдра» на весь сезон) */
export function buildDayClimateRisks(input: {
  forecastHours: readonly AgroForecastHour[] | null | undefined;
  seasonYmds: readonly string[];
}): Map<string, DayClimateRisk> {
  const map = new Map<string, DayClimateRisk>();
  for (const ymd of input.seasonYmds) {
    map.set(ymd, { ymd, level: "none" });
  }

  for (const hour of input.forecastHours ?? []) {
    const t = new Date(hour.time);
    if (!Number.isFinite(t.getTime())) continue;
    const ymd = toKyivDayKey(t);
    const prev = map.get(ymd) ?? { ymd, level: "none" as const };
    let level = prev.level;
    if (isStormCode(hour.weatherCode)) level = "storm";
    else if (
      level !== "storm" &&
      (isRainyCode(hour.weatherCode) || hour.precipitationMm > 0.5)
    ) {
      level = "rain";
    }
    if (hour.tempC <= -2 && level !== "storm") level = "frost";
    map.set(ymd, { ymd, level });
  }

  return map;
}

function isRainyWeather(input: {
  precipitationMm?: number;
  weatherCode?: number;
}): boolean {
  if (
    typeof input.precipitationMm === "number" &&
    input.precipitationMm > 0.2
  ) {
    return true;
  }
  const code = input.weatherCode;
  return typeof code === "number" && isRainyCode(code);
}

export type DropWeatherVerdict = {
  risky: boolean;
  reason: string | null;
};

/** Чи небезпечно переносити операцію на обраний день (локальна евристика) */
export function evaluateDropWeatherRisk(input: {
  operationId: string;
  operationName?: string;
  targetMs: number;
  forecastHours: readonly AgroForecastHour[] | null | undefined;
  dayRisks: Map<string, DayClimateRisk>;
}): DropWeatherVerdict {
  const op =
    findCropOperationById(input.operationId) ??
    (input.operationName
      ? findCropOperationByWorkType(input.operationName)
      : null);
  const conditions: IdealConditions = op?.idealConditions ?? {};
  const ymd = toKyivDayKey(new Date(input.targetMs));
  const { fromUnix, toUnix } = kyivDayBoundsUnix(ymd);
  const dayRisk = input.dayRisks.get(ymd);

  if (conditions.requiresNoRain === true) {
    if (dayRisk?.level === "rain" || dayRisk?.level === "storm") {
      return {
        risky: true,
        reason: "Дощ у цей день — ризик для ЗЗР / обробки",
      };
    }
    for (const hour of input.forecastHours ?? []) {
      const t = new Date(hour.time).getTime() / 1000;
      if (t < fromUnix || t > toUnix) continue;
      if (isRainyWeather(hour)) {
        return {
          risky: true,
          reason: "Прогноз дощу — перевірте вікно",
        };
      }
    }
  }

  if (dayRisk?.level === "frost" && typeof conditions.minSoilTemp === "number") {
    return {
      risky: true,
      reason: "Ризик заморозків у цей день",
    };
  }

  return { risky: false, reason: null };
}

export function climateColumnClass(level: DayClimateRisk["level"]): string {
  if (level === "storm") return "bg-rose-500/[0.12]";
  if (level === "rain") return "bg-rose-400/[0.07]";
  if (level === "frost") return "bg-sky-400/[0.06]";
  return "";
}

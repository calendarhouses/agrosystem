/**
 * Автономні супер-фічі диспетчера LEVADIUS:
 * паливний штурман, аудит якості, погодний ризик, польова рація.
 */

import "server-only";

import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCurrentActor } from "@/lib/app-actor";
import { logActivity } from "@/lib/activity-log";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import {
  FUEL_L_PER_HA,
  fuelLitersPerHa,
} from "@/lib/field-operation-norms";
import { resolveFieldCoordinates } from "@/lib/field-weather-context";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { broadcastTelegram } from "@/lib/telegram";
import {
  fetchPlanningWeather,
  isSprayOperationType,
  type PlanningWeatherHour,
} from "@/lib/weather";
import { getCachedWialonUnitsFull } from "@/lib/wialon-live-cache";
import {
  getWialonUnitTrackBundle,
  hasValidWialonPosition,
  parseWialonUnitTelemetry,
  wialonLogin,
  type WialonUnit,
} from "@/lib/wialon";
import { createServiceSupabase } from "@/lib/supabase/server";

const HOURS_LEFT_THRESHOLD = 1.5;
const TANKER_SPEED_KMH = 40;
const FUEL_ALERT_COOLDOWN_MS = 90 * 60 * 1000;
const WEATHER_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const SPEED_VIOLATION_MARGIN = 0.5; // км/год над лімітом
const SYSTEMATIC_SPEED_RATIO = 0.15; // ≥15% семплів над лімітом
const FUEL_OVERUSE_RATIO = 0.2;

/** Макс. робоча швидкість агрегата (км/год) за типом операції / знаряддя */
export const MAX_WORK_SPEED_KMH: Record<string, number> = {
  посів: 10,
  сівба: 10,
  дискування: 12,
  дисковк: 12,
  оранка: 8,
  культивація: 12,
  "внесення ззр": 12,
  обприск: 12,
  "внесення добрив": 15,
  збирання: 8,
  default: 14,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function maxSpeedForWorkType(workType: string, implementType?: string | null): number {
  const hay = `${workType} ${implementType ?? ""}`.toLowerCase();
  for (const [key, limit] of Object.entries(MAX_WORK_SPEED_KMH)) {
    if (key === "default") continue;
    if (hay.includes(key)) return limit;
  }
  if (implementType) {
    const t = implementType.toLowerCase();
    if (t.includes("sprayer") || t.includes("обприск")) return 12;
    if (t.includes("seeder") || t.includes("сівал")) return 10;
    if (t.includes("plow") || t.includes("плуг")) return 8;
    if (t.includes("harrow") || t.includes("диск")) return 12;
  }
  return MAX_WORK_SPEED_KMH.default;
}

function isWeatherSensitiveOp(workType: string): boolean {
  const t = workType.trim().toLowerCase();
  return (
    isSprayOperationType(workType) ||
    t.includes("добрив") ||
    t.includes("посів") ||
    t.includes("сівб")
  );
}

function resolveFuelNormLPerHa(workType: string): number {
  if (FUEL_L_PER_HA[workType] != null) return FUEL_L_PER_HA[workType]!;
  const lower = workType.toLowerCase();
  for (const [key, rate] of Object.entries(FUEL_L_PER_HA)) {
    if (lower.includes(key.toLowerCase().slice(0, 5))) return rate;
  }
  if (lower.includes("посів") || lower.includes("сівб")) return FUEL_L_PER_HA.Посів;
  if (lower.includes("оран")) return FUEL_L_PER_HA.Оранка;
  if (lower.includes("диск")) return FUEL_L_PER_HA.Дискування;
  if (lower.includes("ззр") || lower.includes("обприск"))
    return FUEL_L_PER_HA["Внесення ЗЗР"];
  if (lower.includes("добрив")) return FUEL_L_PER_HA["Внесення добрив"];
  if (lower.includes("збир")) return FUEL_L_PER_HA.Збирання;
  if (lower.includes("культив")) return FUEL_L_PER_HA.Культивація;
  return fuelLitersPerHa(workType);
}

function appBaseUrl(): string {
  const pub = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (pub) return pub;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── 1. Predictive refuel ────────────────────────────────────────────

export type PredictiveRefuelAlert = {
  equipmentId: string;
  equipmentName: string;
  fieldId: string | null;
  fieldName: string | null;
  currentFuel: number;
  litersPerHour: number;
  hoursLeft: number;
  nearestTankerId: string | null;
  nearestTankerName: string | null;
  tankerDistanceKm: number | null;
  tankerEtaHours: number | null;
  alertMessage: string;
};

function estimateLitersPerHour(params: {
  currentFuel: number;
  watchFuel: number | null;
  watchAt: string | null;
  dayFuelConsumed: number | null;
  dayWorkHours: number | null;
}): number {
  const now = Date.now();
  if (
    params.watchFuel != null &&
    params.watchAt &&
    params.watchFuel > params.currentFuel
  ) {
    const elapsedH = (now - Date.parse(params.watchAt)) / 3_600_000;
    if (elapsedH >= 0.15 && elapsedH <= 3) {
      const burn = (params.watchFuel - params.currentFuel) / elapsedH;
      if (burn > 2 && burn < 90) return round1(burn);
    }
  }
  if (
    params.dayFuelConsumed != null &&
    params.dayFuelConsumed > 0 &&
    params.dayWorkHours != null &&
    params.dayWorkHours > 0.25
  ) {
    const rate = params.dayFuelConsumed / params.dayWorkHours;
    if (rate > 2 && rate < 90) return round1(rate);
  }
  return 18; // типовий трактор під навантаженням
}

export async function checkPredictiveRefuelNeeds(params?: {
  supabase?: SupabaseClient;
}): Promise<{
  ok: true;
  checked: number;
  alerts: PredictiveRefuelAlert[];
  message: string;
}> {
  const supabase = params?.supabase ?? createServiceSupabase();
  const today = todayKyivYmd();

  const { data: ops, error } = await supabase
    .from("field_operations")
    .select(
      `
      id, field_id, work_type, status, equipment_id, machinery,
      farm_fields ( id, name, canonical_name ),
      equipment:equipment_id ( id, name, wialon_id, is_active, type )
    `
    )
    .eq("status", "in_progress")
    .not("equipment_id", "is", null)
    .limit(100);

  if (error) throw new Error(error.message);

  const live = await getCachedWialonUnitsFull().catch(() => ({
    units: [] as WialonUnit[],
  }));
  const units = live.units ?? [];
  const unitById = new Map(units.map((u) => [Number(u.id), u]));

  const tankerUnits = units.filter(
    (u) =>
      hasValidWialonPosition(u) &&
      isFuelDeliveryUnit(u.nm ?? "")
  );

  const eqIds = (ops ?? [])
    .map((o) => (o.equipment_id ? String(o.equipment_id) : ""))
    .filter(Boolean);

  const [{ data: watches }, { data: dayStats }] = await Promise.all([
    eqIds.length
      ? supabase
          .from("levadius_telemetry_watch")
          .select("equipment_id, last_fuel_liters, last_fuel_at")
          .in("equipment_id", eqIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    eqIds.length
      ? supabase
          .from("wialon_equipment_day_stats")
          .select("equipment_id, fuel_consumed, work_hours")
          .eq("date", today)
          .in("equipment_id", eqIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const watchByEq = new Map(
    (watches ?? []).map((w) => [String(w.equipment_id), w])
  );
  const dayByEq = new Map(
    (dayStats ?? []).map((d) => [String(d.equipment_id), d])
  );

  const alerts: PredictiveRefuelAlert[] = [];
  let checked = 0;

  for (const op of ops ?? []) {
    const eqRel = Array.isArray(op.equipment) ? op.equipment[0] : op.equipment;
    if (!eqRel || (eqRel as { is_active?: boolean }).is_active === false) {
      continue;
    }
    const equipmentId = String((eqRel as { id: string }).id);
    const equipmentName = String((eqRel as { name?: string }).name ?? "Техніка");
    const wialonId = (eqRel as { wialon_id?: number | null }).wialon_id;
    if (wialonId == null || !(Number(wialonId) > 0)) continue;

    const unit = unitById.get(Number(wialonId));
    if (!unit) continue;
    if (isFuelDeliveryUnit(unit.nm ?? "", equipmentName)) continue;

    const telemetry = parseWialonUnitTelemetry(unit);
    const currentFuel = telemetry.fuelLiters;
    if (currentFuel == null || !(currentFuel > 0)) continue;

    checked += 1;
    const watch = watchByEq.get(equipmentId) as
      | { last_fuel_liters?: number | null; last_fuel_at?: string | null }
      | undefined;
    const day = dayByEq.get(equipmentId) as
      | { fuel_consumed?: number | null; work_hours?: number | null }
      | undefined;

    const litersPerHour = estimateLitersPerHour({
      currentFuel,
      watchFuel:
        watch?.last_fuel_liters != null
          ? Number(watch.last_fuel_liters)
          : null,
      watchAt: watch?.last_fuel_at ?? null,
      dayFuelConsumed:
        day?.fuel_consumed != null ? Number(day.fuel_consumed) : null,
      dayWorkHours: day?.work_hours != null ? Number(day.work_hours) : null,
    });

    const hoursLeft = round1(currentFuel / Math.max(litersPerHour, 1));
    if (hoursLeft >= HOURS_LEFT_THRESHOLD) continue;

    const fieldRel = Array.isArray(op.farm_fields)
      ? op.farm_fields[0]
      : op.farm_fields;
    const fieldId = op.field_id ? String(op.field_id) : null;
    const fieldName = fieldRel
      ? String(
          (fieldRel as { canonical_name?: string }).canonical_name ||
            (fieldRel as { name?: string }).name ||
            "Поле"
        )
      : null;

    let nearestTankerId: string | null = null;
    let nearestTankerName: string | null = null;
    let tankerDistanceKm: number | null = null;
    let tankerEtaHours: number | null = null;

    if (hasValidWialonPosition(unit) && tankerUnits.length > 0) {
      const tLat = unit.pos!.y;
      const tLng = unit.pos!.x;
      let best = Infinity;
      for (const tanker of tankerUnits) {
        const d = haversineKm(
          tLat,
          tLng,
          tanker.pos!.y,
          tanker.pos!.x
        );
        if (d < best) {
          best = d;
          nearestTankerId = String(tanker.id);
          nearestTankerName = String(tanker.nm ?? "Бензовоз");
          tankerDistanceKm = round1(d);
          tankerEtaHours = round1(d / TANKER_SPEED_KMH);
        }
      }
    }

    const alertMessage = [
      `⚠️ Паливо: «${equipmentName}»`,
      fieldName ? `на «${fieldName}»` : null,
      `залишок ${round1(currentFuel)} л (~${hoursLeft} год при ${litersPerHour} л/год).`,
      nearestTankerName && tankerDistanceKm != null
        ? `Найближчий заправник «${nearestTankerName}» ~${tankerDistanceKm} км (ETA ~${tankerEtaHours} год).`
        : "Активного бензовоза поруч не знайдено.",
    ]
      .filter(Boolean)
      .join(" ");

    alerts.push({
      equipmentId,
      equipmentName,
      fieldId,
      fieldName,
      currentFuel: round1(currentFuel),
      litersPerHour,
      hoursLeft,
      nearestTankerId,
      nearestTankerName,
      tankerDistanceKm,
      tankerEtaHours,
      alertMessage,
    });
  }

  return {
    ok: true,
    checked,
    alerts,
    message:
      alerts.length === 0
        ? `Перевірено ${checked} машин у роботі — критичного палива немає.`
        : `Паливний штурман: **${alerts.length}** тривог (перевірено ${checked}).`,
  };
}

// ── 2. Audit operation quality ──────────────────────────────────────

export type OperationQualityAudit = {
  operationId: string;
  fieldId: string | null;
  fieldName: string | null;
  workType: string;
  averageSpeed: number | null;
  maxSpeed: number | null;
  speedLimitKmh: number;
  speedViolationsCount: number;
  speedSamples: number;
  fuelFactLPerHa: number | null;
  fuelNormLPerHa: number;
  fuelDeltaLiters: number | null;
  fuelDeltaPercent: number | null;
  hasViolations: boolean;
  warningSummary: string;
};

export async function auditOperationQuality(params: {
  supabase: SupabaseClient;
  operationId?: string | null;
  fieldId?: string | null;
}): Promise<
  | { ok: true; audits: OperationQualityAudit[]; message: string }
  | { ok: false; error: string; status: string }
> {
  let query = params.supabase
    .from("field_operations")
    .select(
      `
      id, client_key, field_id, work_type, status, area_fact, fuel_fact,
      equipment_id, implement, implement_id, started_at, occurred_at,
      farm_fields ( id, name, canonical_name ),
      equipment:equipment_id ( id, name, wialon_id ),
      implements:implement_id ( id, name, type )
    `
    )
    .limit(20);

  if (params.operationId?.trim()) {
    const id = params.operationId.trim();
    if (isUuid(id)) {
      query = query.or(`id.eq.${id},client_key.eq.${id}`);
    } else {
      query = query.eq("client_key", id);
    }
  } else if (params.fieldId) {
    query = query
      .eq("field_id", params.fieldId)
      .in("status", ["in_progress", "completed"])
      .order("occurred_at", { ascending: false })
      .limit(5);
  } else {
    return {
      ok: false,
      status: "needs_slots",
      error: "Вкажи operationId або fieldIdOrName.",
    };
  }

  const { data: ops, error } = await query;
  if (error) {
    return { ok: false, status: "error", error: error.message };
  }
  if (!ops?.length) {
    return {
      ok: false,
      status: "not_found",
      error: "Наряд(и) для аудиту не знайдено.",
    };
  }

  const audits: OperationQualityAudit[] = [];

  for (const op of ops) {
    const workType = String(op.work_type ?? "");
    const implRel = Array.isArray(op.implements)
      ? op.implements[0]
      : op.implements;
    const speedLimit = maxSpeedForWorkType(
      workType,
      implRel ? String((implRel as { type?: string }).type ?? "") : null
    );

    const fieldRel = Array.isArray(op.farm_fields)
      ? op.farm_fields[0]
      : op.farm_fields;
    const fieldName = fieldRel
      ? String(
          (fieldRel as { canonical_name?: string }).canonical_name ||
            (fieldRel as { name?: string }).name ||
            ""
        )
      : null;

    const eqRel = Array.isArray(op.equipment) ? op.equipment[0] : op.equipment;
    const wialonId = eqRel
      ? Number((eqRel as { wialon_id?: number | null }).wialon_id)
      : NaN;

    let averageSpeed: number | null = null;
    let maxSpeed: number | null = null;
    let speedViolationsCount = 0;
    let speedSamples = 0;

    if (Number.isFinite(wialonId) && wialonId > 0) {
      const startIso =
        (op.started_at && String(op.started_at)) ||
        (op.occurred_at && String(op.occurred_at)) ||
        null;
      const fromUnix = startIso
        ? Math.floor(Date.parse(startIso) / 1000)
        : Math.floor(Date.now() / 1000) - 8 * 3600;
      const toUnix = Math.floor(Date.now() / 1000);
      try {
        const eid = await wialonLogin();
        const bundle = await getWialonUnitTrackBundle(
          eid,
          wialonId,
          fromUnix,
          toUnix
        );
        const speeds: number[] = [];
        for (const s of bundle.analytics.samples) {
          if (Number.isFinite(s.speed) && s.speed > 0.5) {
            speeds.push(s.speed);
            if (s.speed > speedLimit + SPEED_VIOLATION_MARGIN) {
              speedViolationsCount += 1;
            }
          }
        }
        speedSamples = speeds.length;
        if (speeds.length > 0) {
          averageSpeed = round1(
            speeds.reduce((a, b) => a + b, 0) / speeds.length
          );
          maxSpeed = round1(Math.max(...speeds));
        }
      } catch (err) {
        console.warn(
          "[auditOperationQuality] track",
          err instanceof Error ? err.message : err
        );
      }
    }

    const areaFact = Number(op.area_fact) || 0;
    const fuelFact = Number(op.fuel_fact) || 0;
    const fuelNorm = resolveFuelNormLPerHa(workType);
    let fuelFactLPerHa: number | null = null;
    let fuelDeltaLiters: number | null = null;
    let fuelDeltaPercent: number | null = null;
    if (areaFact > 0.05 && fuelFact > 0) {
      fuelFactLPerHa = round2(fuelFact / areaFact);
      const expected = fuelNorm * areaFact;
      fuelDeltaLiters = round1(fuelFact - expected);
      fuelDeltaPercent = round1(((fuelFact - expected) / expected) * 100);
    }

    const speedSystematic =
      speedSamples >= 20 &&
      speedViolationsCount / speedSamples >= SYSTEMATIC_SPEED_RATIO;
    const fuelOver =
      fuelDeltaPercent != null && fuelDeltaPercent > FUEL_OVERUSE_RATIO * 100;
    const hasViolations = speedSystematic || fuelOver;

    const warnings: string[] = [];
    if (speedSystematic) {
      warnings.push(
        `Швидкість: сер. ${averageSpeed} / макс ${maxSpeed} км/год (ліміт ${speedLimit}), порушень ${speedViolationsCount}/${speedSamples}`
      );
    } else if (maxSpeed != null && maxSpeed > speedLimit + 2) {
      warnings.push(
        `Пік швидкості ${maxSpeed} км/год при ліміті ${speedLimit} (епізодично)`
      );
    }
    if (fuelOver) {
      warnings.push(
        `Витрата ДП ${fuelFactLPerHa} л/га vs норма ${fuelNorm} (+${fuelDeltaPercent}%)`
      );
    }
    if (warnings.length === 0) {
      warnings.push("Істотних порушень технології не виявлено.");
    }

    if (hasViolations) {
      await params.supabase
        .from("field_operations")
        .update({ has_violations: true })
        .eq("id", op.id)
        .then(({ error: flagErr }) => {
          if (
            flagErr &&
            !flagErr.message?.includes("has_violations") &&
            flagErr.code !== "42703"
          ) {
            console.warn("[auditOperationQuality] flag:", flagErr.message);
          }
        });
    }

    audits.push({
      operationId: String(op.client_key || op.id),
      fieldId: op.field_id ? String(op.field_id) : null,
      fieldName,
      workType,
      averageSpeed,
      maxSpeed,
      speedLimitKmh: speedLimit,
      speedViolationsCount,
      speedSamples,
      fuelFactLPerHa,
      fuelNormLPerHa: fuelNorm,
      fuelDeltaLiters,
      fuelDeltaPercent,
      hasViolations,
      warningSummary: warnings.join(" · "),
    });
  }

  return {
    ok: true,
    audits,
    message: `Аудит якості: ${audits.length} наряд(ів), порушень: ${audits.filter((a) => a.hasViolations).length}.`,
  };
}

// ── 3. Weather risk ─────────────────────────────────────────────────

export type WeatherRiskAlert = {
  operationId: string;
  fieldId: string | null;
  fieldName: string;
  operationType: string;
  rainETA: string | null;
  rainMm: number | null;
  windGusts: string | null;
  windGustMs: number | null;
  urgentAction: "pause_work_order" | "monitor";
  alertMessage: string;
};

function hoursUntilIso(iso: string): number {
  return Math.max(0, (Date.parse(iso) - Date.now()) / 3_600_000);
}

function formatHoursLeft(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} хв`;
  return `${round1(h)} год`;
}

export async function checkWeatherRiskForActiveJobs(params?: {
  supabase?: SupabaseClient;
}): Promise<{
  ok: true;
  checked: number;
  alerts: WeatherRiskAlert[];
  message: string;
}> {
  const supabase = params?.supabase ?? createServiceSupabase();
  const { data: ops, error } = await supabase
    .from("field_operations")
    .select(
      `
      id, client_key, field_id, work_type, status,
      farm_fields ( id, name, canonical_name, geometry )
    `
    )
    .in("status", ["in_progress", "assigned"])
    .limit(80);

  if (error) throw new Error(error.message);

  const alerts: WeatherRiskAlert[] = [];
  let checked = 0;
  const coordsCache = new Map<
    string,
    { latitude: number; longitude: number } | null
  >();

  for (const op of ops ?? []) {
    const workType = String(op.work_type ?? "");
    if (!isWeatherSensitiveOp(workType)) continue;

    const fieldRel = Array.isArray(op.farm_fields)
      ? op.farm_fields[0]
      : op.farm_fields;
    const fieldId = op.field_id ? String(op.field_id) : null;
    const fieldName = fieldRel
      ? String(
          (fieldRel as { canonical_name?: string }).canonical_name ||
            (fieldRel as { name?: string }).name ||
            "Поле"
        )
      : "Поле";
    if (!fieldId) continue;

    checked += 1;
    let coords = coordsCache.get(fieldId);
    if (coords === undefined) {
      coords = await resolveFieldCoordinates(supabase, fieldId);
      coordsCache.set(fieldId, coords);
    }
    if (!coords) continue;

    let hourly: PlanningWeatherHour[] = [];
    try {
      const plan = await fetchPlanningWeather(
        coords.latitude,
        coords.longitude
      );
      const now = Date.now();
      hourly = plan.hourly
        .filter((h) => {
          const t = Date.parse(h.time);
          return Number.isFinite(t) && t >= now - 20 * 60_000;
        })
        .slice(0, 4);
    } catch (err) {
      console.warn(
        "[checkWeatherRisk]",
        fieldName,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    const isSpray = isSprayOperationType(workType);
    let rainHit: PlanningWeatherHour | null = null;
    let windHit: PlanningWeatherHour | null = null;

    for (const h of hourly) {
      if (h.precipitationMm >= 2 || h.precipProbability >= 75) {
        if (!rainHit) rainHit = h;
      }
      const gust = h.windGustMs ?? h.windMs;
      if (isSpray && gust != null && gust > 5) {
        if (!windHit) windHit = h;
      } else if (!isSpray && gust != null && gust > 8 && h.precipitationMm >= 1) {
        if (!windHit) windHit = h;
      }
    }

    if (!rainHit && !windHit) continue;

    const urgent =
      isSpray && (rainHit != null || windHit != null)
        ? ("pause_work_order" as const)
        : rainHit && rainHit.precipitationMm >= 2
          ? ("pause_work_order" as const)
          : ("monitor" as const);

    const rainETA = rainHit
      ? formatHoursLeft(hoursUntilIso(rainHit.time))
      : null;
    const windGustMs = windHit
      ? windHit.windGustMs ?? windHit.windMs
      : null;

    const alertMessage = [
      `🌦 Погода: «${fieldName}» · ${workType}.`,
      rainHit
        ? `Опади ~${round1(rainHit.precipitationMm)} мм через ${rainETA}.`
        : null,
      windGustMs != null
        ? `Пориви вітру ${round1(windGustMs)} м/с.`
        : null,
      urgent === "pause_work_order"
        ? "Рекомендація: терміново зупинити наряд (неефективне внесення)."
        : "Слідкувати за умовами.",
    ]
      .filter(Boolean)
      .join(" ");

    alerts.push({
      operationId: String(op.client_key || op.id),
      fieldId,
      fieldName,
      operationType: workType,
      rainETA,
      rainMm: rainHit ? round1(rainHit.precipitationMm) : null,
      windGusts: windGustMs != null ? `${round1(windGustMs)} m/s` : null,
      windGustMs: windGustMs != null ? round1(windGustMs) : null,
      urgentAction: urgent,
      alertMessage,
    });
  }

  return {
    ok: true,
    checked,
    alerts,
    message:
      alerts.length === 0
        ? `Погодний ризик: перевірено ${checked} чутливих нарядів — критичних вікон немає.`
        : `Погодний ризик: **${alerts.length}** тривог (перевірено ${checked}).`,
  };
}

// ── 4. Voice / radio incident ───────────────────────────────────────

const VOICE_PARSE_SCHEMA = z.object({
  equipmentHint: z
    .string()
    .nullable()
    .describe("Назва/номер техніки з тексту або null"),
  fieldHint: z
    .string()
    .nullable()
    .describe("Назва поля / урочища або null"),
  partOrMaterial: z
    .string()
    .nullable()
    .describe("Запчастина / матеріал (РВТ, підшипник, мастило) або null"),
  issueSummary: z
    .string()
    .describe("Короткий опис проблеми українською (1–2 речення)"),
  severity: z.enum(["info", "breakdown", "urgent"]),
  shouldPauseWorkOrder: z.boolean(),
  quantityHint: z.number().nullable().optional(),
});

export type VoiceDispatchResult = {
  identifiedMachine: { id: string; name: string } | null;
  identifiedField: { id: string; name: string } | null;
  issueSummary: string;
  inventoryDraft: {
    itemHint: string | null;
    quantity: number | null;
    note: string;
    kind: "parts_request" | "service_call";
  };
  status: "recorded" | "needs_clarification" | "error";
  maintenanceStatus: string | null;
  logId: string | null;
  pausedNoteApplied: boolean;
  parsed: z.infer<typeof VOICE_PARSE_SCHEMA>;
};

async function fuzzyFindEquipment(
  supabase: SupabaseClient,
  hint: string
): Promise<{ id: string; name: string } | null> {
  const safe = hint.replaceAll(",", " ").trim();
  if (!safe) return null;
  if (isUuid(safe)) {
    const { data } = await supabase
      .from("equipment")
      .select("id, name")
      .eq("id", safe)
      .maybeSingle();
    return data
      ? { id: String(data.id), name: String(data.name) }
      : null;
  }
  const { data } = await supabase
    .from("equipment")
    .select("id, name, code")
    .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
    .limit(5);
  if (!data?.length) return null;
  if (data.length === 1) {
    return { id: String(data[0]!.id), name: String(data[0]!.name) };
  }
  // Prefer exact-ish match
  const lower = safe.toLowerCase();
  const exact = data.find(
    (d) =>
      String(d.name).toLowerCase().includes(lower) ||
      String(d.code ?? "").toLowerCase() === lower
  );
  const pick = exact ?? data[0]!;
  return { id: String(pick.id), name: String(pick.name) };
}

async function fuzzyFindField(
  supabase: SupabaseClient,
  hint: string
): Promise<{ id: string; name: string } | null> {
  const safe = hint.replaceAll(",", " ").trim();
  if (!safe) return null;
  if (isUuid(safe)) {
    const { data } = await supabase
      .from("farm_fields")
      .select("id, name, canonical_name")
      .eq("id", safe)
      .maybeSingle();
    if (!data) return null;
    return {
      id: String(data.id),
      name: String(data.canonical_name || data.name),
    };
  }
  const { data } = await supabase
    .from("farm_fields")
    .select("id, name, canonical_name")
    .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
    .limit(5);
  if (!data?.length) return null;
  const row = data[0]!;
  return {
    id: String(row.id),
    name: String(row.canonical_name || row.name),
  };
}

export async function parseFieldVoiceDispatch(params: {
  supabase: SupabaseClient;
  rawVoiceTranscript: string;
  model: LanguageModel;
  applyActions?: boolean;
}): Promise<
  | { ok: true; result: VoiceDispatchResult; message: string }
  | { ok: false; error: string; status: string }
> {
  const transcript = params.rawVoiceTranscript.trim();
  if (transcript.length < 3) {
    return {
      ok: false,
      status: "error",
      error: "Порожній або занадто короткий текст рації.",
    };
  }

  let parsed: z.infer<typeof VOICE_PARSE_SCHEMA>;
  try {
    const out = await generateObject({
      model: params.model,
      schema: VOICE_PARSE_SCHEMA,
      prompt: [
        "Ти диспетчер LEVADIUS. Розбери повідомлення з поля (суржик/укр/рос).",
        "Витягни: техніку, поле, запчастину/матеріал, чи треба зупиняти наряд, severity.",
        "Не вигадуй конкретні UUID. issueSummary — чітко українською.",
        "",
        `Текст: """${transcript.slice(0, 2000)}"""`,
      ].join("\n"),
    });
    parsed = out.object;
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося розпарсити повідомлення рації",
    };
  }

  const machine = parsed.equipmentHint
    ? await fuzzyFindEquipment(params.supabase, parsed.equipmentHint)
    : null;
  const field = parsed.fieldHint
    ? await fuzzyFindField(params.supabase, parsed.fieldHint)
    : null;

  const inventoryDraft = {
    itemHint: parsed.partOrMaterial,
    quantity: parsed.quantityHint ?? (parsed.partOrMaterial ? 1 : null),
    note: parsed.issueSummary,
    kind:
      parsed.severity === "urgent" || parsed.severity === "breakdown"
        ? ("service_call" as const)
        : ("parts_request" as const),
  };

  if (!machine && !field) {
    return {
      ok: true,
      result: {
        identifiedMachine: null,
        identifiedField: null,
        issueSummary: parsed.issueSummary,
        inventoryDraft,
        status: "needs_clarification",
        maintenanceStatus: null,
        logId: null,
        pausedNoteApplied: false,
        parsed,
      },
      message: `Рація: потрібне уточнення. ${parsed.issueSummary}`,
    };
  }

  const apply = params.applyActions !== false;
  let maintenanceStatus: string | null = null;
  let logId: string | null = null;
  let pausedNoteApplied = false;

  if (apply && machine && parsed.severity !== "info") {
    const nextStatus =
      parsed.severity === "urgent" ? "breakdown" : "in_repair";
    const { error: stErr } = await params.supabase
      .from("equipment")
      .update({
        maintenance_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", machine.id);
    if (
      stErr &&
      (stErr.message?.includes("maintenance_status") ||
        stErr.message?.includes("check") ||
        stErr.code === "23514")
    ) {
      // fallback: service_due якщо constraint ще старий
      await params.supabase
        .from("equipment")
        .update({
          maintenance_status: "service_due",
          updated_at: new Date().toISOString(),
        })
        .eq("id", machine.id);
      maintenanceStatus = "service_due";
    } else if (!stErr) {
      maintenanceStatus = nextStatus;
    }

    const actor = await getCurrentActor();
    const { data: logRow } = await params.supabase
      .from("equipment_maintenance_logs")
      .insert({
        equipment_id: machine.id,
        service_type: "breakdown_report",
        service_interval_hours: 250,
        notes: [
          `[Рація] ${parsed.issueSummary}`,
          field ? `Поле: ${field.name}` : null,
          parsed.partOrMaterial
            ? `Потрібно: ${parsed.partOrMaterial}`
            : null,
          `Сирий текст: ${transcript.slice(0, 500)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        actor_id: actor.id || null,
        actor_name: actor.label,
      })
      .select("id")
      .maybeSingle();
    logId = logRow?.id ? String(logRow.id) : null;

    await logActivity({
      actor,
      action: "create",
      entityType: "equipment_maintenance",
      entityId: machine.id,
      summary: `${actor.label} зафіксував поломку з рації: ${machine.name}`,
      meta: { fieldId: field?.id, severity: parsed.severity },
    });
  }

  if (apply && (parsed.shouldPauseWorkOrder || parsed.severity === "urgent")) {
    let opQuery = params.supabase
      .from("field_operations")
      .select("id, notes, status")
      .eq("status", "in_progress")
      .limit(5);
    if (machine) opQuery = opQuery.eq("equipment_id", machine.id);
    else if (field) opQuery = opQuery.eq("field_id", field.id);
    const { data: activeOps } = await opQuery;
    for (const op of activeOps ?? []) {
      const noteLine = `[Рація ${new Date().toISOString()}] ${parsed.issueSummary}`;
      const prev =
        typeof (op as { notes?: string }).notes === "string"
          ? String((op as { notes?: string }).notes)
          : "";
      const { error: noteErr } = await params.supabase
        .from("field_operations")
        .update({ notes: prev ? `${prev}\n${noteLine}` : noteLine })
        .eq("id", op.id);
      if (!noteErr) pausedNoteApplied = true;
      else if (
        noteErr.message?.includes("notes") ||
        noteErr.code === "42703"
      ) {
        // колонки notes може не бути — ігноруємо
      }
    }
  }

  return {
    ok: true,
    result: {
      identifiedMachine: machine,
      identifiedField: field,
      issueSummary: parsed.issueSummary,
      inventoryDraft,
      status: "recorded",
      maintenanceStatus,
      logId,
      pausedNoteApplied,
      parsed,
    },
    message: [
      `Рація зафіксована: ${parsed.issueSummary}`,
      machine ? `Техніка: ${machine.name}` : null,
      field ? `Поле: ${field.name}` : null,
      inventoryDraft.itemHint
        ? `Заявка: ${inventoryDraft.itemHint}`
        : null,
    ]
      .filter(Boolean)
      .join(". "),
  };
}

// ── Watchdog runner ─────────────────────────────────────────────────

async function shouldSendAlert(
  supabase: SupabaseClient,
  alertKey: string,
  kind: string,
  cooldownMs: number,
  payload: Record<string, unknown>,
  dryRun: boolean
): Promise<boolean> {
  const { data } = await supabase
    .from("levadius_dispatch_alert_dedupe")
    .select("last_sent_at")
    .eq("alert_key", alertKey)
    .maybeSingle();

  if (data?.last_sent_at) {
    const age = Date.now() - Date.parse(String(data.last_sent_at));
    if (Number.isFinite(age) && age < cooldownMs) return false;
  }

  if (dryRun) return true;

  await supabase.from("levadius_dispatch_alert_dedupe").upsert({
    alert_key: alertKey,
    alert_kind: kind,
    payload,
    last_sent_at: new Date().toISOString(),
  });
  return true;
}

export async function runSmartDispatchWatchdog(options?: {
  dryRun?: boolean;
}): Promise<{
  fuelChecked: number;
  weatherChecked: number;
  fuelAlerts: PredictiveRefuelAlert[];
  weatherAlerts: WeatherRiskAlert[];
  telegram: { ok: boolean; sent: number; error?: string };
}> {
  const dryRun = options?.dryRun === true;
  const supabase = createServiceSupabase();
  const base = appBaseUrl();

  const [fuel, weather] = await Promise.all([
    checkPredictiveRefuelNeeds({ supabase }),
    checkWeatherRiskForActiveJobs({ supabase }),
  ]);

  const fuelToSend: PredictiveRefuelAlert[] = [];
  for (const a of fuel.alerts) {
    const key = `fuel:${a.equipmentId}`;
    const ok = await shouldSendAlert(
      supabase,
      key,
      "predictive_refuel",
      FUEL_ALERT_COOLDOWN_MS,
      { ...a },
      dryRun
    );
    if (ok) fuelToSend.push(a);
  }

  const weatherToSend: WeatherRiskAlert[] = [];
  for (const a of weather.alerts) {
    const key = `weather:${a.operationId}`;
    const ok = await shouldSendAlert(
      supabase,
      key,
      "weather_risk",
      WEATHER_ALERT_COOLDOWN_MS,
      { ...a },
      dryRun
    );
    if (ok) weatherToSend.push(a);
  }

  let telegram: { ok: boolean; sent: number; error?: string } = {
    ok: true,
    sent: 0,
  };

  if (!dryRun && (fuelToSend.length > 0 || weatherToSend.length > 0)) {
    const lines: string[] = ["🚦 LEVADIUS · Smart Dispatch"];
    for (const a of fuelToSend) lines.push(a.alertMessage);
    for (const a of weatherToSend) lines.push(a.alertMessage);

    const buttons: Array<Array<{ text: string; url: string }>> = [
      [
        { text: "Техніка", url: `${base}/equipment` },
        { text: "Хронологія", url: `${base}/operations` },
      ],
    ];
    if (fuelToSend[0]?.nearestTankerId) {
      buttons.push([
        {
          text: "Бензовоз на карті",
          url: `${base}/equipment?id=${fuelToSend[0].nearestTankerId}`,
        },
      ]);
    }

    telegram = await broadcastTelegram(lines.join("\n\n"), {
      inlineKeyboard: buttons,
    });
  }

  return {
    fuelChecked: fuel.checked,
    weatherChecked: weather.checked,
    fuelAlerts: dryRun ? fuel.alerts : fuelToSend,
    weatherAlerts: dryRun ? weather.alerts : weatherToSend,
    telegram,
  };
}

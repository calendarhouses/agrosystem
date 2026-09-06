/**
 * Операції флоту / каталогу техніки для LEVADIUS (Крок B).
 */

import "server-only";

import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createLocalEquipment as createLocalEquipmentAction,
  saveEquipmentFuelTank,
  saveEquipmentWialon,
  saveImplementWorkingWidth,
  syncEquipmentFromBas,
  autoMapWialon,
  toggleEquipmentActive,
} from "@/app/admin/equipment/actions";
import type { DayAnalyticsPayload } from "@/lib/equipment-day-analytics";
import {
  buildSmartAlerts,
  isUnitCurrentlyIdle,
  type SmartAlert,
} from "@/lib/equipment-smart-alerts";
import type { FleetTrackedUnit } from "@/lib/equipment-fleet";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import type { LocalEquipmentType } from "@/lib/equipment-local";
import { LOCAL_EQUIPMENT_TYPE_OPTIONS } from "@/lib/equipment-local";
import { kyivDayBoundsUnix, todayKyivYmd } from "@/lib/kyiv-date";
import { getCachedWialonGeofences } from "@/lib/wialon-boot-cache";
import { getCachedWialonUnitsFull } from "@/lib/wialon-live-cache";
import {
  loadFleetDaySummaryFromDb,
  loadUnitDayStatsFromDb,
  todayKyivYmd as syncTodayKyivYmd,
} from "@/lib/wialon-equipment-day-sync";
import {
  getWialonUnitTrackBundle,
  hasValidWialonPosition,
  listWialonUnitBasics,
  wialonLogin,
  type WialonGeofenceProperties,
  type WialonTrackLineFeature,
  type WialonUnit,
} from "@/lib/wialon";
import { createServiceSupabase } from "@/lib/supabase/server";

function isBaseGeofenceName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("база") ||
    lower.includes("левада") ||
    lower.includes("двор") ||
    lower.includes("двір") ||
    lower.includes("склад")
  );
}

function classifyLiveUnit(
  unit: WialonUnit,
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>
): "in_field" | "at_base" | "in_transit" | "unknown" {
  if (!hasValidWialonPosition(unit)) return "unknown";
  const lng = unit.pos!.x;
  const lat = unit.pos!.y;
  const pt = point([lng, lat]);
  for (const feature of geofences.features) {
    if (feature.geometry?.type !== "Polygon") continue;
    try {
      if (!booleanPointInPolygon(pt, feature as Feature<Polygon>)) continue;
      const name = String(feature.properties?.name ?? "");
      return isBaseGeofenceName(name) ? "at_base" : "in_field";
    } catch {
      /* skip */
    }
  }
  return "in_transit";
}

async function sumDayWorkMetrics(
  supabase: SupabaseClient,
  dateYmd: string
): Promise<{ fuelBurned: number; workHours: number }> {
  const { data, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select("fuel_consumed, work_hours")
    .eq("date", dateYmd)
    .limit(2000);
  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.code === "42703"
    ) {
      return { fuelBurned: 0, workHours: 0 };
    }
    throw new Error(error.message);
  }
  let fuelBurned = 0;
  let workHours = 0;
  for (const row of data ?? []) {
    fuelBurned += Number(row.fuel_consumed) || 0;
    workHours += Number(row.work_hours) || 0;
  }
  return {
    fuelBurned: Math.round(fuelBurned * 10) / 10,
    workHours: Math.round(workHours * 10) / 10,
  };
}

async function loadUnitFuelConsumed(
  supabase: SupabaseClient,
  wialonUnitId: number,
  dateYmd: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select("fuel_consumed")
    .eq("wialon_unit_id", wialonUnitId)
    .eq("date", dateYmd)
    .maybeSingle();
  if (error || !data) return null;
  const n = Number(data.fuel_consumed);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

function avgMaxSpeedFromTrack(
  track: WialonTrackLineFeature | null,
  samples: DayAnalyticsPayload["samples"]
): { avgSpeedKmh: number | null; maxSpeedKmh: number | null } {
  const speeds: number[] = [];
  for (const s of samples) {
    if (Number.isFinite(s.speed) && s.speed > 0) speeds.push(s.speed);
  }
  if (speeds.length === 0 && track?.properties) {
    // немає швидкостей у семплах
  }
  if (speeds.length === 0) {
    return { avgSpeedKmh: null, maxSpeedKmh: null };
  }
  const max = Math.max(...speeds);
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  return {
    avgSpeedKmh: Math.round(avg * 10) / 10,
    maxSpeedKmh: Math.round(max * 10) / 10,
  };
}

type LocationVisit = {
  kind: "field" | "base" | "road";
  name: string;
  startIso: string;
  endIso: string;
  durationMin: number;
};

function buildGeofenceVisitsFromSamples(
  samples: Array<{ lng: number; lat: number; t: number }>,
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>
): LocationVisit[] {
  if (samples.length < 2 || geofences.features.length === 0) return [];

  const prepared = geofences.features
    .filter((f) => f.geometry?.type === "Polygon")
    .map((f) => ({
      feature: f as Feature<Polygon, WialonGeofenceProperties>,
      name: String(f.properties?.name ?? "Зона").trim() || "Зона",
      kind: (isBaseGeofenceName(String(f.properties?.name ?? ""))
        ? "base"
        : "field") as "field" | "base",
    }));

  const sorted = [...samples]
    .filter(
      (s) =>
        Number.isFinite(s.t) &&
        Number.isFinite(s.lng) &&
        Number.isFinite(s.lat)
    )
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return [];

  const locate = (lng: number, lat: number) => {
    const pt = point([lng, lat]);
    for (const z of prepared) {
      try {
        if (booleanPointInPolygon(pt, z.feature)) return z;
      } catch {
        /* skip */
      }
    }
    return null;
  };

  type Raw = {
    kind: "field" | "base" | "road";
    name: string;
    start: number;
    end: number;
  };
  const raw: Raw[] = [];
  let cur: Raw | null = null;

  for (const s of sorted) {
    const zone = locate(s.lng, s.lat);
    const kind = zone?.kind ?? "road";
    const name = zone?.name ?? "Дорога / поза зонами";
    if (!cur) {
      cur = { kind, name, start: s.t, end: s.t };
      continue;
    }
    if (cur.kind === kind && cur.name === name) {
      cur.end = s.t;
      continue;
    }
    raw.push(cur);
    cur = { kind, name, start: s.t, end: s.t };
  }
  if (cur) raw.push(cur);

  return raw
    .filter((r) => r.end - r.start >= 5 * 60)
    .slice(0, 40)
    .map((r) => ({
      kind: r.kind,
      name: r.name,
      startIso: new Date(r.start * 1000).toISOString(),
      endIso: new Date(r.end * 1000).toISOString(),
      durationMin: Math.round((r.end - r.start) / 60),
    }));
}

export async function buildFleetDaySummary(params: {
  supabase: SupabaseClient;
  date?: string | null;
  includeAlerts?: boolean;
}): Promise<{
  date: string;
  totalActive: number;
  totalUnits: number;
  inFieldCount: number;
  inTransitCount: number;
  atBaseCount: number;
  totalMileageKm: number;
  totalEngineHours: number;
  totalIdleHours: number;
  totalHoursOnField: number;
  totalFuelBurnedLiters: number;
  drainEvents: number;
  source: string;
  alerts: Array<{
    id: string;
    kind: string;
    unitId: number;
    unitName: string;
    title: string;
    detail: string;
    severity: string;
  }>;
}> {
  const dateYmd =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date.trim())
      ? params.date.trim()
      : todayKyivYmd();

  const [summary, dayMetrics, liveResult, geofences] = await Promise.all([
    loadFleetDaySummaryFromDb(dateYmd),
    sumDayWorkMetrics(params.supabase, dateYmd).catch(() => ({
      fuelBurned: 0,
      workHours: 0,
    })),
    getCachedWialonUnitsFull().catch(() => ({
      units: [] as WialonUnit[],
      fetchedAt: 0,
      fromCache: true,
      stale: true,
    })),
    getCachedWialonGeofences().catch(
      () =>
        ({
          type: "FeatureCollection",
          features: [],
        }) as FeatureCollection<Polygon, WialonGeofenceProperties>
    ),
  ]);

  const live = liveResult.units ?? [];

  let inFieldCount = 0;
  let inTransitCount = 0;
  let atBaseCount = 0;
  const tracked: FleetTrackedUnit[] = [];

  for (const unit of live) {
    if (isFuelDeliveryUnit(unit.nm ?? "")) continue;
    const status = classifyLiveUnit(unit, geofences);
    if (status === "in_field") inFieldCount += 1;
    else if (status === "at_base") atBaseCount += 1;
    else if (status === "in_transit") inTransitCount += 1;

    if (hasValidWialonPosition(unit)) {
      tracked.push({
        ...unit,
        equipmentId: "",
        fuelTankVolume: null,
        equipmentType: "other",
        equipmentCode: null,
      });
    }
  }

  let alerts: SmartAlert[] = [];
  if (params.includeAlerts !== false) {
    const drainEventsByUnitId = new Map<number, number>();
    for (const u of summary.unitStats ?? []) {
      if (u.drainEvents > 0) {
        drainEventsByUnitId.set(u.wialonUnitId, u.drainEvents);
      }
    }
    alerts = buildSmartAlerts({
      units: tracked,
      drainEventsByUnitId,
      alertDayKey: dateYmd,
    });

    for (const u of summary.unitStats ?? []) {
      if (u.hoursIdling < 0.5) continue;
      if (alerts.some((a) => a.unitId === u.wialonUnitId && a.kind === "long_idle")) {
        continue;
      }
      const liveUnit = live.find((x) => Number(x.id) === u.wialonUnitId);
      if (liveUnit && classifyLiveUnit(liveUnit, geofences) === "at_base") {
        continue;
      }
      const name =
        (liveUnit?.nm && String(liveUnit.nm)) || `Unit ${u.wialonUnitId}`;
      alerts.push({
        id: `idle-db:${u.wialonUnitId}:${dateYmd}`,
        kind: "long_idle",
        unitId: u.wialonUnitId,
        unitName: name,
        title: "Довгий простій",
        detail: `Холостий хід ~${u.hoursIdling} год за день (поза базою / без live-бази).`,
        severity: u.hoursIdling >= 1 ? "warning" : "info",
        lng: null,
        lat: null,
        createdAt: Date.now(),
      });
    }
  }

  return {
    date: dateYmd,
    totalActive: summary.unitsActive,
    totalUnits: summary.unitsTotal,
    inFieldCount,
    inTransitCount,
    atBaseCount,
    totalMileageKm: summary.distanceKm,
    totalEngineHours:
      dayMetrics.workHours > 0
        ? dayMetrics.workHours
        : Math.round((summary.hoursOnField + summary.hoursIdling) * 10) / 10,
    totalIdleHours: summary.hoursIdling,
    totalHoursOnField: summary.hoursOnField,
    totalFuelBurnedLiters: dayMetrics.fuelBurned,
    drainEvents: summary.drainEvents,
    source: summary.source,
    alerts: alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      unitId: a.unitId,
      unitName: a.unitName,
      title: a.title,
      detail: a.detail,
      severity: a.severity,
    })),
  };
}

export async function buildEquipmentDayTrack(params: {
  supabase: SupabaseClient;
  equipmentId: string;
  equipmentName: string;
  wialonId: number | null;
  date?: string | null;
}): Promise<
  | {
      ok: true;
      date: string;
      equipmentId: string;
      equipmentName: string;
      wialonUnitId: number;
      distanceKm: number;
      workHours: number;
      idleHours: number;
      hoursOnField: number;
      avgSpeedKmh: number | null;
      maxSpeedKmh: number | null;
      fuelBurnedLiters: number | null;
      fuelFilledLiters: number | null;
      drainEvents: number;
      visits: LocationVisit[];
      source: string;
    }
  | { ok: false; error: string }
> {
  const dateYmd =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date.trim())
      ? params.date.trim()
      : todayKyivYmd();

  if (params.wialonId == null || !(params.wialonId > 0)) {
    return {
      ok: false,
      error: `У «${params.equipmentName}» немає привʼязки Wialon (has_tracker=false). Спочатку linkEquipmentWialonUnit.`,
    };
  }

  const unitId = params.wialonId;
  const { fromUnix, toUnix } = kyivDayBoundsUnix(dateYmd);
  const nowUnix = Math.floor(Date.now() / 1000);
  const timeTo = Math.min(toUnix, nowUnix);

  const [dbStats, fuelConsumed, geofences] = await Promise.all([
    loadUnitDayStatsFromDb(unitId, dateYmd),
    loadUnitFuelConsumed(params.supabase, unitId, dateYmd),
    getCachedWialonGeofences().catch(
      () =>
        ({
          type: "FeatureCollection",
          features: [],
        }) as FeatureCollection<Polygon, WialonGeofenceProperties>
    ),
  ]);

  let distanceKm = dbStats.distanceKm;
  let workHours = dbStats.workHours;
  let idleHours = dbStats.hoursIdling;
  let hoursOnField = dbStats.hoursOnField;
  let fuelBurned = fuelConsumed;
  let fuelFilled: number | null = null;
  let avgSpeedKmh: number | null = null;
  let maxSpeedKmh: number | null = null;
  let visits: LocationVisit[] = [];
  let source: string = dbStats.source;

  try {
    const eid = await wialonLogin();
    const bundle = await getWialonUnitTrackBundle(
      eid,
      unitId,
      fromUnix,
      timeTo
    );
    const summary = bundle.analytics.summary;
    if (summary.distanceKm > 0) distanceKm = summary.distanceKm;
    if (summary.workHours > 0) workHours = summary.workHours;
    if (summary.hoursIdling > 0) idleHours = summary.hoursIdling;
    if (summary.fuelConsumed != null && summary.fuelConsumed > 0) {
      fuelBurned = Math.round(summary.fuelConsumed * 10) / 10;
    }
    if (summary.fuelFilled > 0) {
      fuelFilled = Math.round(summary.fuelFilled * 10) / 10;
    }
    const speeds = avgMaxSpeedFromTrack(
      bundle.track,
      bundle.analytics.samples
    );
    avgSpeedKmh = speeds.avgSpeedKmh;
    maxSpeedKmh = speeds.maxSpeedKmh;

    const gpsSamples = bundle.analytics.samples.map((s) => ({
      lng: s.lng,
      lat: s.lat,
      t: s.t,
    }));
    visits = buildGeofenceVisitsFromSamples(gpsSamples, geofences);
    source = "wialon+db";
  } catch (error) {
    console.error(
      "[agent-equipment-ops] track bundle",
      error instanceof Error ? error.message : error
    );
  }

  return {
    ok: true,
    date: dateYmd,
    equipmentId: params.equipmentId,
    equipmentName: params.equipmentName,
    wialonUnitId: unitId,
    distanceKm: Math.round(distanceKm * 10) / 10,
    workHours: Math.round(workHours * 10) / 10,
    idleHours: Math.round(idleHours * 10) / 10,
    hoursOnField: Math.round(hoursOnField * 10) / 10,
    avgSpeedKmh,
    maxSpeedKmh,
    fuelBurnedLiters: fuelBurned,
    fuelFilledLiters: fuelFilled,
    drainEvents: dbStats.drainEvents,
    visits,
    source,
  };
}

export async function createLocalEquipmentForAgent(params: {
  name: string;
  type: string;
  inventoryNumber?: string | null;
  fuelTankCapacity?: number | null;
  initialMotohours?: number | null;
  workScope?: "field" | "base";
}): Promise<
  | {
      ok: true;
      id: string;
      name: string;
      type: string;
      code: string | null;
      fuelTankVolume: number | null;
      currentMotohours: number;
      hasTracker: false;
      workScope: "field" | "base";
    }
  | { ok: false; error: string }
> {
  const allowed = new Set(
    LOCAL_EQUIPMENT_TYPE_OPTIONS.map((o) => o.id)
  );
  const typeRaw = String(params.type ?? "other").trim().toLowerCase();
  const type = allowed.has(typeRaw as LocalEquipmentType)
    ? (typeRaw as LocalEquipmentType)
    : "other";

  const created = await createLocalEquipmentAction({
    name: params.name,
    type,
    workScope: params.workScope ?? "field",
    code: params.inventoryNumber?.trim() || null,
    fuelTankVolume: params.fuelTankCapacity ?? null,
  });

  if (!created.ok) return created;

  const mh = Number(params.initialMotohours ?? 0);
  const supabase = createServiceSupabase();
  if (Number.isFinite(mh) && mh >= 0) {
    const { error } = await supabase
      .from("equipment")
      .update({
        current_motohours: Math.round(mh * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", created.id);
    if (error && !error.message?.includes("current_motohours")) {
      console.error("[createLocalEquipment] motohours", error.message);
    }
  }

  return {
    ok: true,
    id: created.id,
    name: created.name,
    type,
    code: params.inventoryNumber?.trim() || null,
    fuelTankVolume: params.fuelTankCapacity ?? null,
    currentMotohours: Number.isFinite(mh) && mh >= 0 ? mh : 0,
    hasTracker: false,
    workScope: created.workScope,
  };
}

export async function linkEquipmentWialonForAgent(params: {
  equipmentId: string;
  wialonUnitId: number;
}): Promise<
  | { ok: true; wialonUnitId: number; wialonName: string | null }
  | { ok: false; error: string }
> {
  if (!Number.isFinite(params.wialonUnitId) || params.wialonUnitId <= 0) {
    return { ok: false, error: "Некоректний wialonUnitId." };
  }

  let wialonName: string | null = null;
  try {
    const eid = await wialonLogin();
    const basics = await listWialonUnitBasics(eid);
    const found = basics.find((u) => u.id === params.wialonUnitId);
    wialonName = found?.nm?.trim() || null;
  } catch {
    /* імʼя необовʼязкове */
  }

  const saved = await saveEquipmentWialon({
    equipmentId: params.equipmentId,
    wialonId: params.wialonUnitId,
    wialonName,
  });
  if (!saved.ok) return saved;

  return {
    ok: true,
    wialonUnitId: params.wialonUnitId,
    wialonName,
  };
}

export async function unlinkEquipmentWialonForAgent(params: {
  equipmentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return saveEquipmentWialon({
    equipmentId: params.equipmentId,
    wialonId: null,
    wialonName: null,
  });
}

export async function updateImplementWidthForAgent(params: {
  supabase: SupabaseClient;
  implementIdOrName: string;
  workingWidthMeters: number;
}): Promise<
  | {
      ok: true;
      implementId: string;
      implementName: string;
      workingWidthMeters: number;
    }
  | {
      ok: false;
      status: "not_found" | "ambiguous" | "error";
      error: string;
      candidates?: { id: string; name: string }[];
    }
> {
  const width = Number(params.workingWidthMeters);
  if (!Number.isFinite(width) || width <= 0 || width > 999) {
    return {
      ok: false,
      status: "error",
      error: "Робоча ширина має бути від 0+ до 999 м.",
    };
  }

  const lookup = params.implementIdOrName.trim();
  let implement: { id: string; name: string } | null = null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      lookup
    );

  if (isUuid) {
    const { data, error } = await params.supabase
      .from("implements")
      .select("id, name")
      .eq("id", lookup)
      .maybeSingle();
    if (error) {
      return { ok: false, status: "error", error: error.message };
    }
    if (data) implement = { id: String(data.id), name: String(data.name) };
  } else {
    const { data, error } = await params.supabase
      .from("implements")
      .select("id, name")
      .ilike("name", `%${lookup.replaceAll(",", " ")}%`)
      .order("name")
      .limit(5);
    if (error) {
      return { ok: false, status: "error", error: error.message };
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      return {
        ok: false,
        status: "not_found",
        error: `Знаряддя «${lookup}» не знайдено.`,
      };
    }
    if (rows.length > 1) {
      const exact = rows.find(
        (r) =>
          String(r.name).trim().toLowerCase() === lookup.toLowerCase()
      );
      if (exact) {
        implement = { id: String(exact.id), name: String(exact.name) };
      } else {
        return {
          ok: false,
          status: "ambiguous",
          error: `Кілька знарядь для «${lookup}». Уточни назву.`,
          candidates: rows.map((r) => ({
            id: String(r.id),
            name: String(r.name),
          })),
        };
      }
    } else {
      implement = {
        id: String(rows[0]!.id),
        name: String(rows[0]!.name),
      };
    }
  }

  if (!implement) {
    return {
      ok: false,
      status: "not_found",
      error: `Знаряддя «${lookup}» не знайдено.`,
    };
  }

  const saved = await saveImplementWorkingWidth({
    implementId: implement.id,
    workingWidthM: width,
  });
  if (!saved.ok) {
    return { ok: false, status: "error", error: saved.error };
  }

  return {
    ok: true,
    implementId: implement.id,
    implementName: implement.name,
    workingWidthMeters: Math.round(width * 100) / 100,
  };
}

export async function toggleEquipmentActiveForAgent(params: {
  equipmentId: string;
  isActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return toggleEquipmentActive({
    equipmentId: params.equipmentId,
    isActive: params.isActive,
  });
}

export async function updateEquipmentFuelTankForAgent(params: {
  equipmentId: string;
  tankCapacityLiters: number;
}): Promise<{ ok: true; fuelTankVolume: number } | { ok: false; error: string }> {
  const liters = Number(params.tankCapacityLiters);
  if (!Number.isFinite(liters) || liters <= 0) {
    return { ok: false, error: "Обʼєм бака має бути > 0 л." };
  }
  const saved = await saveEquipmentFuelTank({
    equipmentId: params.equipmentId,
    fuelTankVolume: liters,
  });
  if (!saved.ok) return saved;
  return { ok: true, fuelTankVolume: Math.round(liters * 100) / 100 };
}

export async function syncEquipmentCatalogFromBasForAgent(): Promise<
  | {
      ok: true;
      equipmentUpserted: number;
      implementsUpserted: number;
      message: string;
    }
  | { ok: false; error: string }
> {
  const result = await syncEquipmentFromBas();
  if (!result.ok) return result;
  return {
    ok: true,
    equipmentUpserted: result.data.equipment.upserted,
    implementsUpserted: result.data.implements.upserted,
    message: `BAS sync: техніка ${result.data.equipment.upserted}, знаряддя ${result.data.implements.upserted}.`,
  };
}

export async function autoMapEquipmentWialonForAgent(): Promise<
  | {
      ok: true;
      mapped: number;
      details: Array<{
        wialonId: number;
        wialonName: string;
        equipmentId: string;
        equipmentName: string;
      }>;
      message: string;
    }
  | { ok: false; error: string }
> {
  const result = await autoMapWialon();
  if (!result.ok) return result;
  const details = result.data.details ?? [];
  return {
    ok: true,
    mapped: details.length,
    details,
    message:
      details.length > 0
        ? `Авто-маппінг Wialon: привʼязано **${details.length}** одиниць.`
        : "Авто-маппінг: нових однозначних збігів немає.",
  };
}

export { syncTodayKyivYmd };

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
} from "react";
import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  bbox as turfBbox,
  booleanPointInPolygon,
} from "@turf/turf";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Loader2,
  MapPin,
  Printer,
  Route,
  UserCircle,
  MoreHorizontal,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import {
  EquipmentCommandMap,
  type EquipmentCommandMapHandle,
} from "@/components/dashboard/equipment-command-map";
import { EquipmentFleetGlassPanel } from "@/components/dashboard/equipment-fleet-glass-panel";
import { EquipmentTrackPlaybackPanel } from "@/components/dashboard/equipment-track-playback-panel";
import {
  FuelSparkline,
  UtilizationTimelineBar,
} from "@/components/dashboard/equipment-vehicle-360-dashboard";
import { EquipmentSmartAlertsCenter } from "@/components/dashboard/equipment-smart-alerts-center";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DayShiftSummary } from "@/components/dashboard/day-shift-summary";
import {
  type FleetAlert,
  type FleetAlertKind,
} from "@/components/dashboard/fleet-alert-strip";
import {
  emptyFleetByMetric,
  type FleetDaySummary,
  type FleetSummaryMetric,
} from "@/components/dashboard/fleet-day-summary-bar";
import {
  buildDriverShiftHistory,
  EMPTY_DAY_ANALYTICS,
  formatDriverLabel,
  hoursFromSessionSpans,
  normalizeDriverCode,
  type DayAnalyticsPayload,
  type DriverShiftSpan,
  type FuelDrainEvent,
} from "@/lib/equipment-day-analytics";
import {
  isFuelCritical,
  patchFleetGps,
  type FleetNonTrackedItem,
  type FleetTrackedUnit,
} from "@/lib/equipment-fleet";
import type { FleetActiveOperation } from "@/lib/equipment-active-ops";
import { attachActiveOpsToFleet } from "@/lib/equipment-active-ops";
import {
  buildSmartAlerts,
  isUnitCurrentlyIdle,
  type SmartAlert,
} from "@/lib/equipment-smart-alerts";
import type {
  WialonGeofenceProperties,
  WialonTrackLineFeature,
  WialonUnit,
  WialonUnitTelemetry,
} from "@/lib/wialon";
import { EMPTY_TRACK_LINE, parseWialonUnitTelemetry, unitHasFuelSensor } from "@/lib/wialon";
import { useLiveWialonUnits } from "@/lib/use-live-wialon-units";
import { useEquipmentTrackPlayback } from "@/lib/use-equipment-track-playback";
import {
  COMMAND_CENTER_MAP_AREA_CLASS,
  commandCenterFitPadding,
} from "@/lib/equipment-command-center-layout";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import {
  calendarDateToYmd,
  kyivDayBoundsUnix,
  toKyivDayKey,
  todayKyivYmd,
} from "@/lib/kyiv-date";
import {
  exportDayJournalCsv,
  exportDayJournalXlsx,
  printDayJournalReport,
} from "@/lib/equipment-export";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import { progressUnixTime } from "@/lib/equipment-track-playback";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OFFLINE_ALERT_SEC = 30 * 60;
const CRITICAL_FUEL_RATIO = 0.15;

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** GPS Wialon інколи дає абсурдну швидкість для агротехніки */
const MAX_PLAUSIBLE_AGRO_SPEED_KMH = 100;

type GeofenceCollection = FeatureCollection<Polygon, WialonGeofenceProperties>;

const EMPTY_GEOFENCES: GeofenceCollection = {
  type: "FeatureCollection",
  features: [],
};

const NO_DATA = "Немає даних";

/** Розбір датчиків / лічильників Wialon для UI «Техніка». */
function parseUnitSensors(unit: WialonUnit): WialonUnitTelemetry {
  return parseWialonUnitTelemetry(unit);
}

/** База / левада / двір — не польова робота */
function isBaseGeofenceName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("база") ||
    lower.includes("левада") ||
    lower.includes("двір") ||
    lower.includes("двор") ||
    lower.includes("склад")
  );
}

const ROAD_LOCATION_NAME = "У дорозі / Поза межами полів";
/** Ігноруємо мікро-заїзди коротші за 5 хв */
const MIN_LOCATION_SESSION_SEC = 5 * 60;
/** Семплінг точок треку — не частіше ніж раз на N секунд */
const LOCATION_SAMPLE_STEP_SEC = 45;

type LocationSessionKind = "field" | "base" | "road";

type LocationSession = {
  id: string;
  geofenceId: string | null;
  name: string;
  kind: LocationSessionKind;
  startUnix: number;
  endUnix: number;
  startIndex: number;
  endIndex: number;
  center: [number, number];
  bounds: [[number, number], [number, number]] | null;
};

function expandBounds(
  bounds: [[number, number], [number, number]],
  minSpanDeg = 0.003
): [[number, number], [number, number]] {
  let [[minX, minY], [maxX, maxY]] = bounds;
  if (maxX - minX < minSpanDeg) {
    const mid = (minX + maxX) / 2;
    minX = mid - minSpanDeg / 2;
    maxX = mid + minSpanDeg / 2;
  }
  if (maxY - minY < minSpanDeg) {
    const mid = (minY + maxY) / 2;
    minY = mid - minSpanDeg / 2;
    maxY = mid + minSpanDeg / 2;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

type PreparedGeofence = {
  feature: Feature<Polygon, WialonGeofenceProperties>;
  id: string;
  name: string;
  kind: Exclude<LocationSessionKind, "road">;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function formatGeofenceDisplayName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return ROAD_LOCATION_NAME;
  return trimmed.toLowerCase().includes("база") ? "База" : trimmed;
}

function prepareGeofences(geofences: GeofenceCollection): PreparedGeofence[] {
  const prepared: PreparedGeofence[] = [];
  for (const feature of geofences.features) {
    if (feature.geometry?.type !== "Polygon") continue;
    const rawName = feature.properties?.name?.trim();
    if (!rawName) continue;
    try {
      const [minX, minY, maxX, maxY] = turfBbox(feature);
      if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) continue;
      prepared.push({
        feature,
        id: feature.properties?.id ?? String(feature.properties?.wialon_id ?? rawName),
        name: formatGeofenceDisplayName(rawName),
        kind: isBaseGeofenceName(rawName) ? "base" : "field",
        minX,
        minY,
        maxX,
        maxY,
      });
    } catch {
      // skip invalid
    }
  }
  return prepared;
}

function locatePointInGeofences(
  lng: number,
  lat: number,
  prepared: PreparedGeofence[],
  hintIndex: number
): { zone: PreparedGeofence | null; index: number } {
  const tryIndex = (index: number): PreparedGeofence | null => {
    const zone = prepared[index];
    if (!zone) return null;
    if (lng < zone.minX || lng > zone.maxX || lat < zone.minY || lat > zone.maxY) {
      return null;
    }
    try {
      return booleanPointInPolygon([lng, lat], zone.feature) ? zone : null;
    } catch {
      return null;
    }
  };

  if (hintIndex >= 0) {
    const hinted = tryIndex(hintIndex);
    if (hinted) return { zone: hinted, index: hintIndex };
  }

  for (let i = 0; i < prepared.length; i++) {
    if (i === hintIndex) continue;
    const zone = tryIndex(i);
    if (zone) return { zone, index: i };
  }
  return { zone: null, index: -1 };
}

function sessionKey(zone: PreparedGeofence | null): string {
  return zone ? `g:${zone.id}` : "road";
}

function boundsFromCoords(
  coords: Position[],
  from: number,
  to: number
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = from; i <= to; i++) {
    const c = coords[i];
    if (!c) continue;
    const x = c[0];
    const y = c[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/** Аналіз треку → послідовні сесії в геозонах (оптимізовано семплінгом + bbox). */
function buildLocationSessions(
  track: WialonTrackLineFeature | null,
  geofences: GeofenceCollection
): LocationSession[] {
  const coordinates = track?.geometry?.coordinates ?? [];
  const times = track?.properties?.times ?? [];
  if (coordinates.length < 2 || times.length < 2) return [];

  const prepared = prepareGeofences(geofences);
  const samples: Array<{
    index: number;
    unix: number;
    key: string;
    zone: PreparedGeofence | null;
  }> = [];

  let lastSampleUnix = -Infinity;
  let hintIndex = -1;
  const lastIdx = coordinates.length - 1;

  for (let i = 0; i < coordinates.length; i++) {
    const unix = times[i];
    const coord = coordinates[i];
    if (unix == null || !Number.isFinite(unix) || !coord) continue;
    const isLast = i === lastIdx;
    if (!isLast && unix - lastSampleUnix < LOCATION_SAMPLE_STEP_SEC) continue;

    const lng = coord[0];
    const lat = coord[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const located = locatePointInGeofences(lng, lat, prepared, hintIndex);
    hintIndex = located.index;
    samples.push({
      index: i,
      unix,
      key: sessionKey(located.zone),
      zone: located.zone,
    });
    lastSampleUnix = unix;
  }

  if (samples.length === 0) return [];

  type RawSession = {
    key: string;
    zone: PreparedGeofence | null;
    startUnix: number;
    endUnix: number;
    startIndex: number;
    endIndex: number;
  };

  const raw: RawSession[] = [];
  let current = {
    key: samples[0].key,
    zone: samples[0].zone,
    startUnix: samples[0].unix,
    endUnix: samples[0].unix,
    startIndex: samples[0].index,
    endIndex: samples[0].index,
  };

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.key === current.key) {
      current.endUnix = sample.unix;
      current.endIndex = sample.index;
      continue;
    }
    raw.push({ ...current });
    current = {
      key: sample.key,
      zone: sample.zone,
      startUnix: sample.unix,
      endUnix: sample.unix,
      startIndex: sample.index,
      endIndex: sample.index,
    };
  }
  raw.push(current);

  const filtered = raw.filter(
    (session) => session.endUnix - session.startUnix >= MIN_LOCATION_SESSION_SEC
  );

  // Зливаємо сусідні однакові зони після відсікання мікро-сесій
  const merged: RawSession[] = [];
  for (const session of filtered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === session.key) {
      prev.endUnix = session.endUnix;
      prev.endIndex = session.endIndex;
      continue;
    }
    merged.push({ ...session });
  }

  return merged.map((session, order) => {
    const bounds = boundsFromCoords(
      coordinates,
      session.startIndex,
      session.endIndex
    );
    const mid = coordinates[
      Math.floor((session.startIndex + session.endIndex) / 2)
    ];
    const center: [number, number] = mid
      ? [mid[0], mid[1]]
      : bounds
        ? [
            (bounds[0][0] + bounds[1][0]) / 2,
            (bounds[0][1] + bounds[1][1]) / 2,
          ]
        : [0, 0];

    return {
      id: `${session.key}-${session.startUnix}-${order}`,
      geofenceId: session.zone?.id ?? null,
      name: session.zone?.name ?? ROAD_LOCATION_NAME,
      kind: session.zone?.kind ?? "road",
      startUnix: session.startUnix,
      endUnix: session.endUnix,
      startIndex: session.startIndex,
      endIndex: session.endIndex,
      center,
      bounds,
    };
  });
}

function formatSessionClock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSessionDuration(startUnix: number, endUnix: number): string {
  const totalMin = Math.max(0, Math.round((endUnix - startUnix) / 60));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes <= 0) return `${hours} год`;
  return `${hours} год ${minutes} хв`;
}

function LocationJournalTimeline({
  sessions,
  loading,
  selectedId,
  onSelect,
}: {
  sessions: LocationSession[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (session: LocationSession) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[#E5DFD3]/80 bg-white/60 px-4 py-5 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
        Аналіз локацій…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E5DFD3] bg-white/40 px-4 py-5 text-center">
        <MapPin className="mx-auto mb-2 h-5 w-5 text-zinc-300" strokeWidth={1.5} />
        <p className="text-sm font-medium text-zinc-500">
          За цей день немає сесій довше 5 хв
        </p>
      </div>
    );
  }

  const fieldCount = sessions.filter((s) => s.kind === "field").length;
  const totalMin = sessions.reduce(
    (sum, s) => sum + Math.max(0, Math.round((s.endUnix - s.startUnix) / 60)),
    0
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-gradient-to-b from-white to-[#F4F1EA]/80 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5DFD3]/70 px-4 py-2.5">
        <p className="text-sm font-bold text-zinc-900">Журнал локацій</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {fieldCount} пол.
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 tabular-nums">
            {Math.floor(totalMin / 60)}г {totalMin % 60}хв
          </span>
        </div>
      </div>

      <ol className="relative m-0 list-none space-y-1 p-3">
        {sessions.map((session, index) => {
          const isLast = index === sessions.length - 1;
          const selected = selectedId === session.id;
          const Icon =
            session.kind === "field"
              ? MapPin
              : session.kind === "base"
                ? Gauge
                : Route;
          const tone =
            session.kind === "field"
              ? {
                  dot: "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]",
                  icon: "bg-emerald-50 text-emerald-700 border-emerald-100",
                  card: selected
                    ? "border-emerald-300 bg-emerald-50/80 shadow-sm"
                    : "border-transparent bg-white/70 hover:border-emerald-200 hover:bg-emerald-50/50",
                }
              : {
                  dot: "bg-zinc-400 shadow-[0_0_0_4px_rgba(161,161,170,0.18)]",
                  icon: "bg-zinc-100 text-zinc-600 border-zinc-200/80",
                  card: selected
                    ? "border-zinc-300 bg-zinc-100 shadow-sm"
                    : "border-transparent bg-white/50 hover:border-zinc-200 hover:bg-zinc-50",
                };

          return (
            <li key={session.id} className="relative flex gap-3">
              <div className="relative flex w-3 shrink-0 flex-col items-center pt-4">
                <span className={cn("z-10 h-2.5 w-2.5 rounded-full", tone.dot)} />
                {!isLast ? (
                  <span
                    aria-hidden
                    className="absolute top-7 bottom-[-6px] w-px bg-gradient-to-b from-zinc-300 to-zinc-200"
                  />
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => onSelect(session)}
                className={cn(
                  "mb-1 flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
                  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25",
                  tone.card
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                    tone.icon
                  )}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold tracking-wide text-zinc-500 tabular-nums uppercase">
                      {formatSessionClock(session.startUnix)} –{" "}
                      {formatSessionClock(session.endUnix)}
                    </p>
                    <span className="shrink-0 rounded-md bg-zinc-900/5 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 tabular-nums">
                      {formatSessionDuration(session.startUnix, session.endUnix)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-bold text-zinc-900">
                    {session.name}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function hasFuelData(liters: number | null | undefined): boolean {
  return liters != null && Number.isFinite(liters) && liters !== 0;
}

/** Data-first: активний наряд → паливо → рух → запалювання */
function compareUnitsByPriority(a: FleetTrackedUnit, b: FleetTrackedUnit): number {
  const aOp = a.activeOp ? 1 : 0;
  const bOp = b.activeOp ? 1 : 0;
  if (aOp !== bOp) return bOp - aOp;

  const aTelemetry = parseUnitSensors(a);
  const bTelemetry = parseUnitSensors(b);

  const aFuel = hasFuelData(aTelemetry.fuelLiters) ? 1 : 0;
  const bFuel = hasFuelData(bTelemetry.fuelLiters) ? 1 : 0;
  if (aFuel !== bFuel) return bFuel - aFuel;

  const aMoving = getSanitizedSpeed(a).isMoving ? 1 : 0;
  const bMoving = getSanitizedSpeed(b).isMoving ? 1 : 0;
  if (aMoving !== bMoving) return bMoving - aMoving;

  const aIgnition = aTelemetry.ignition === true ? 1 : 0;
  const bIgnition = bTelemetry.ignition === true ? 1 : 0;
  if (aIgnition !== bIgnition) return bIgnition - aIgnition;

  return a.nm.localeCompare(b.nm, "uk");
}

type FieldContext = {
  name: string;
  isBase: boolean;
};

function getCurrentField(
  unit: WialonUnit,
  geofences: GeofenceCollection
): FieldContext | null {
  const pos = unit.pos;
  if (
    !pos ||
    !Number.isFinite(pos.x) ||
    !Number.isFinite(pos.y) ||
    pos.x <= 0 ||
    pos.y <= 0
  ) {
    return null;
  }

  for (const feature of geofences.features) {
    if (feature.geometry?.type !== "Polygon") continue;
    try {
      if (booleanPointInPolygon([pos.x, pos.y], feature)) {
        const rawName = feature.properties?.name?.trim();
        if (!rawName) return null;
        const isBase = isBaseGeofenceName(rawName);
        return {
          name: rawName.toLowerCase().includes("база") ? "База" : rawName,
          isBase,
        };
      }
    } catch {
      // skip invalid polygon
    }
  }
  return null;
}

type SpeedState = {
  raw: number;
  /** null = похибка GPS */
  value: number | null;
  isGpsError: boolean;
  isMoving: boolean;
};

function getSanitizedSpeed(unit: WialonUnit): SpeedState {
  const raw = unit.pos?.s ?? 0;
  if (!Number.isFinite(raw) || raw < 0) {
    return { raw: 0, value: 0, isGpsError: false, isMoving: false };
  }
  if (raw > MAX_PLAUSIBLE_AGRO_SPEED_KMH) {
    return { raw, value: null, isGpsError: true, isMoving: false };
  }
  return {
    raw,
    value: raw,
    isGpsError: false,
    isMoving: raw > 0,
  };
}

type UnitMotionStatus =
  | { kind: "gps-error" }
  | { kind: "moving"; speedKmh: number }
  | { kind: "idling" }
  | { kind: "off" };

function getUnitMotionStatus(unit: WialonUnit): UnitMotionStatus {
  const speed = getSanitizedSpeed(unit);
  const isEngineOn = parseUnitSensors(unit).ignition === true;
  const isIdling = isEngineOn && unit.pos?.s === 0;

  if (speed.isGpsError) return { kind: "gps-error" };
  if (isIdling) return { kind: "idling" };
  if (speed.isMoving && speed.value != null) {
    return { kind: "moving", speedKmh: speed.value };
  }
  return { kind: "off" };
}

function UnitStatusBadge({ unit }: { unit: WialonUnit }) {
  const status = getUnitMotionStatus(unit);

  if (status.kind === "idling") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
        Холостий хід
      </div>
    );
  }

  if (status.kind === "moving") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        В русі: {status.speedKmh} км/год
      </div>
    );
  }

  if (status.kind === "gps-error") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
        Похибка GPS
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
      Вимкнено
    </div>
  );
}

function formatLastContact(unixSec?: number): string {
  if (!unixSec || !Number.isFinite(unixSec)) return NO_DATA;
  const date = new Date(unixSec * 1000);
  if (Number.isNaN(date.getTime())) return NO_DATA;
  return date.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLiters(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("uk-UA")} л`;
}

function formatMileage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return `${Math.round(value).toLocaleString("uk-UA")} км`;
}

function formatEngineHours(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return `${Math.round(value).toLocaleString("uk-UA")} год`;
}

function formatVoltage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return `${value.toFixed(1)} V`;
}

function formatSatellites(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return `${value}`;
}

function getDriverCode(unit: WialonUnit): string | null {
  const fromRoot = (unit as { p?: { drvr_code?: unknown } }).p?.drvr_code;
  const fromLmsg = unit.lmsg?.p?.drvr_code;
  return normalizeDriverCode(fromRoot ?? fromLmsg);
}

function getDriverProfile(unit: WialonUnit): {
  code: string;
  label: string;
} | null {
  const code = getDriverCode(unit);
  if (!code) return null;
  return { code, label: formatDriverLabel(code) };
}

function formatDriverClock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Механізатор + історія — рендериться лише якщо є хоч якісь дані */
function MechanicPresenceBlock({
  current,
  history,
  compact,
}: {
  current: { code: string; label: string } | null;
  history: DriverShiftSpan[];
  compact?: boolean;
}) {
  if (!current && history.length === 0) return null;

  if (compact) {
    return (
      <div className="mt-2 flex items-center gap-2 text-zinc-900">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm">
          <UserCircle className="h-4 w-4" strokeWidth={1.4} />
        </div>
        <p className="truncate text-sm font-medium text-zinc-900">
          {current?.label ?? history[history.length - 1]?.label}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-gradient-to-b from-white to-[#F4F1EA]/70 shadow-sm">
      <div className="border-b border-[#E5DFD3]/70 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          Механізатор
        </p>
        {current ? (
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <UserCircle className="h-5 w-5" strokeWidth={1.4} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-zinc-900">
                {current.label}
              </p>
              <p className="truncate text-xs text-zinc-500">
                Зараз за технікою · {current.code}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm font-medium text-zinc-600">
            Зараз ключ не зчитано — є історія за день
          </p>
        )}
      </div>

      {history.length > 0 ? (
        <div className="px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Історія змін за день
          </p>
          <ul className="space-y-1.5">
            {history.map((span) => (
              <li
                key={`${span.code}-${span.startUnix}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E5DFD3]/70 bg-white/80 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {span.label}
                  </p>
                  <p className="text-[11px] text-zinc-500 tabular-nums">
                    {formatDriverClock(span.startUnix)} –{" "}
                    {formatDriverClock(span.endUnix)}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
                  зміна
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ActiveOpFieldLink({
  fieldId,
  fieldName,
  className,
}: {
  fieldId: string | null;
  fieldName: string;
  className?: string;
}) {
  if (!fieldId) {
    return <span className={className}>{fieldName}</span>;
  }
  return (
    <Link
      href={`/?field=${encodeURIComponent(fieldId)}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "underline decoration-emerald-600/40 underline-offset-2 hover:decoration-emerald-700",
        className
      )}
    >
      {fieldName}
    </Link>
  );
}

function UnitActiveOpBadge({ op }: { op: FleetActiveOperation }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg border border-emerald-300/80 bg-gradient-to-r from-emerald-50 to-green-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 shadow-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden>🚜</span>
      <span>Працює:</span>
      <ActiveOpFieldLink fieldId={op.fieldId} fieldName={op.fieldName} />
      <span className="font-medium text-emerald-800/80">|</span>
      <span className="font-medium text-green-800">
        Знаряддя: {op.implement || "—"}
      </span>
    </div>
  );
}

function TelemetryTile({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#E5DFD3]/80 bg-gradient-to-b from-white/70 to-[#EBE5D9]/50 px-3.5 py-3.5",
        "shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]",
        "transition-colors duration-200 hover:bg-white"
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        <Icon className="h-3.5 w-3.5 text-[#C05621]" />
        {label}
      </div>
      <p
        className={cn(
          "text-sm font-bold tabular-nums text-zinc-900",
          valueClassName
        )}
      >
        {value}
      </p>
    </div>
  );
}

function formatTrackDateLabel(date: Date): string {
  return format(date, "d MMMM yyyy", { locale: uk });
}

function startOfMonthUnix(date: Date): number {
  return Math.floor(
    new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime() /
      1000
  );
}

function endOfMonthUnix(date: Date): number {
  return Math.floor(
    new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    ).getTime() / 1000
  );
}

/** Кеш днів із треком: unitId|YYYY-MM → Set(YYYY-MM-DD) */
const trackDaysCache = new Map<string, Set<string>>();

function TrackCalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<
  NonNullable<
    NonNullable<ComponentProps<typeof Calendar>["components"]>["DayButton"]
  >
>) {
  const showStatus =
    !modifiers.outside &&
    !modifiers.disabled &&
    (modifiers.hasTrack || modifiers.noTrack);

  return (
    <Button
      variant="ghost"
      size="icon"
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      className={cn(
        "relative flex aspect-square size-auto w-full min-w-7 flex-col items-center justify-center gap-0 rounded-lg border-0 p-0 text-xs font-medium text-zinc-800",
        "transition-all duration-200 hover:bg-[#E5DFD3]/55",
        modifiers.today &&
          !modifiers.selected &&
          "bg-white ring-1 ring-[#E5DFD3] shadow-sm",
        modifiers.selected &&
          "bg-[#276749] text-white shadow-[0_4px_12px_rgba(39,103,73,0.25)] hover:bg-[#276749] hover:text-white",
        modifiers.outside && "text-zinc-300 opacity-50",
        modifiers.disabled && "text-zinc-300 opacity-40",
        className
      )}
      {...props}
    >
      <span className="leading-none">{day.date.getDate()}</span>
      {showStatus ? (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 h-1 w-1 rounded-full transition-colors",
            modifiers.selected
              ? "bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.7)]"
              : modifiers.hasTrack
                ? "bg-[#276749] shadow-[0_0_6px_rgba(39,103,73,0.55)]"
                : "bg-zinc-300"
          )}
        />
      ) : (
        <span aria-hidden className="mt-0.5 h-1 w-1" />
      )}
    </Button>
  );
}

function TrackDatePicker({
  date,
  unitId,
  onChange,
}: {
  date: Date;
  unitId: number;
  onChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(date));
  const [daysWithTrack, setDaysWithTrack] = useState<Set<string>>(
    () => new Set()
  );
  const [monthLoaded, setMonthLoaded] = useState(false);
  const [monthLoading, setMonthLoading] = useState(true);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  // v2 — після фільтра GPS-дрейфу (швидкість ≥ 2 км/год)
  const cacheKey = `v2|${unitId}|${month.getFullYear()}-${month.getMonth()}`;
  const showCalendarGrid = monthLoaded && !monthLoading;

  const shiftMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    const nextKey = `v2|${unitId}|${next.getFullYear()}-${next.getMonth()}`;
    setMonth(next);
    if (trackDaysCache.has(nextKey)) {
      setDaysWithTrack(trackDaysCache.get(nextKey)!);
      setMonthLoaded(true);
      setMonthLoading(false);
    } else {
      setMonthLoaded(false);
      setMonthLoading(true);
      setDaysWithTrack(new Set());
    }
  };

  useEffect(() => {
    if (!open) return;

    const cached = trackDaysCache.get(cacheKey);
    if (cached) {
      setDaysWithTrack(cached);
      setMonthLoaded(true);
      setMonthLoading(false);
      return;
    }

    const controller = new AbortController();
    setMonthLoading(true);
    setMonthLoaded(false);

    const from = startOfMonthUnix(month);
    const to = endOfMonthUnix(month);
    const params = new URLSearchParams({
      unitId: String(unitId),
      from: String(from),
      to: String(to),
      analytics: "0",
    });

    fetch(`/api/wialon/track?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          track?: WialonTrackLineFeature;
        };
        const times = data.track?.properties?.times ?? [];
        const dayCounts = new Map<string, number>();
        for (const unix of times) {
          if (!Number.isFinite(unix) || unix <= 0) continue;
          const key = toKyivDayKey(new Date(unix * 1000));
          dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
        }
        const withTrack = new Set<string>();
        for (const [key, count] of dayCounts) {
          if (count >= 2) withTrack.add(key);
        }
        trackDaysCache.set(cacheKey, withTrack);
        setDaysWithTrack(withTrack);
        setMonthLoaded(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setDaysWithTrack(new Set());
        setMonthLoaded(true);
        console.error(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMonthLoading(false);
      });

    return () => controller.abort();
  }, [open, cacheKey, month, unitId]);

  useEffect(() => {
    if (open) {
      const next = new Date(date.getFullYear(), date.getMonth(), 1);
      setMonth(next);
      const key = `v2|${unitId}|${next.getFullYear()}-${next.getMonth()}`;
      if (trackDaysCache.has(key)) {
        setDaysWithTrack(trackDaysCache.get(key)!);
        setMonthLoaded(true);
        setMonthLoading(false);
      } else {
        setMonthLoaded(false);
        setMonthLoading(true);
        setDaysWithTrack(new Set());
      }
    }
  }, [open, date, unitId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex items-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 py-1.5 text-sm text-zinc-700 shadow-sm",
          "h-11 min-h-11 outline-none transition-all hover:border-[#276749]/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#276749]/25 md:h-auto md:min-h-0"
        )}
      >
        <CalendarIcon size={16} className="shrink-0 text-[#276749]" />
        <span className="font-medium">{formatTrackDateLabel(date)}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sheetOnMobile={false}
        sideOffset={8}
        className="z-[220] w-[min(100vw-1.5rem,22.5rem)] overflow-hidden rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-[0_20px_50px_rgba(28,25,23,0.14)]"
        data-vaul-no-drag=""
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#E5DFD3]/80 px-3 py-2.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-800"
            aria-label="Попередній місяць"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold capitalize text-zinc-800">
            {format(month, "LLLL yyyy", { locale: uk })}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-800"
            aria-label="Наступний місяць"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="px-2.5 py-2">
          {showCalendarGrid ? (
            <Calendar
              mode="single"
              month={month}
              onMonthChange={setMonth}
              selected={date}
              onSelect={(next) => {
                if (!next) return;
                onChange(next);
                setOpen(false);
              }}
              disabled={{ after: today }}
              hideNavigation
              modifiers={{
                hasTrack: (day) => daysWithTrack.has(calendarDateToYmd(day)),
                noTrack: (day) => {
                  if (day > today) return false;
                  return !daysWithTrack.has(calendarDateToYmd(day));
                },
              }}
              components={{
                DayButton: TrackCalendarDayButton,
              }}
              className="w-full rounded-xl bg-transparent p-0 [--cell-size:2.5rem]"
              classNames={{
                today: "bg-transparent",
                month: "flex w-full flex-col gap-1",
                month_caption: "hidden",
                nav: "hidden",
                weekdays: "flex",
                weekday: "flex-1 text-[0.7rem] font-medium text-zinc-400",
                week: "mt-0.5 flex w-full",
              }}
            />
          ) : (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[#276749]" />
              <p className="text-xs font-medium text-zinc-500">
                Завантаження днів…
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#E5DFD3]/80 bg-white/50 px-3 py-2">
          <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#276749] shadow-[0_0_6px_rgba(39,103,73,0.55)]" />
              Є трек
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
              Немає
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Моніторинг техніки — довідник equipment + GPS Wialon */
export function EquipmentView() {
  const searchParams = useSearchParams();
  const [units, setUnits] = useState<FleetTrackedUnit[]>([]);
  const [nonTracked, setNonTracked] = useState<FleetNonTrackedItem[]>([]);
  const [towedEquipment, setTowedEquipment] = useState<FleetNonTrackedItem[]>(
    []
  );
  const [geofences, setGeofences] =
    useState<GeofenceCollection>(EMPTY_GEOFENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<FleetTrackedUnit | null>(
    null
  );
  const [mobileFleetExpanded, setMobileFleetExpanded] = useState(false);
  const commandMapRef = useRef<EquipmentCommandMapHandle | null>(null);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const alertsBootstrappedRef = useRef(false);
  const [listHoveredUnitId, setListHoveredUnitId] = useState<number | null>(
    null
  );
  const hoverIntentRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewedUnitIdRef = useRef<number | null>(null);
  /** Завжди «сьогодні» (Kyiv) — для дзвіночка, незалежно від календаря KPI */
  const [alertUnitStats, setAlertUnitStats] = useState<
    Array<{ wialonUnitId: number; hoursIdling: number; drainEvents: number }>
  >([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [trackDate, setTrackDate] = useState(() => new Date());
  const [fleetSummaryDate, setFleetSummaryDate] = useState(() => new Date());
  const [fleetSummary, setFleetSummary] = useState<FleetDaySummary | null>(
    null
  );
  const [fleetSummaryLoading, setFleetSummaryLoading] = useState(false);
  const [fleetSummarySource, setFleetSummarySource] = useState<
    "db" | "empty" | null
  >(null);
  const [fleetSummaryRefreshToken, setFleetSummaryRefreshToken] = useState(0);
  const [fleetSummaryTick, setFleetSummaryTick] = useState(0);
  const fleetSummaryForceRefreshRef = useRef(false);
  const fleetSummaryCacheRef = useRef(new Map<string, FleetDaySummary>());
  const dayBundleCacheRef = useRef(
    new Map<
      string,
      {
        track: WialonTrackLineFeature;
        analytics: DayAnalyticsPayload;
        fetchedAt: number;
      }
    >()
  );
  const [trackBundleTick, setTrackBundleTick] = useState(0);
  /** Live idle-since (unix sec) по флоту — для long_idle у дзвіночку */
  const idleSinceByUnitIdRef = useRef(new Map<number, number>());
  const [idleClock, setIdleClock] = useState(0);
  const [trackGeoJSON, setTrackGeoJSON] =
    useState<WialonTrackLineFeature | null>(null);
  const [dayAnalytics, setDayAnalytics] =
    useState<DayAnalyticsPayload>(EMPTY_DAY_ANALYTICS);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<FleetAlertKind | null>(null);
  const [summaryMetric, setSummaryMetric] =
    useState<FleetSummaryMetric | null>(null);
  const { units: liveWialonUnits, error: liveGpsError } = useLiveWialonUnits({
    enabled: !loading && units.length > 0,
    intervalMs: 15_000,
    // Не передаємо `units` як seed — це створювало Maximum update depth
  });

  useEffect(() => {
    if (liveWialonUnits.length === 0) return;
    setUnits((prev) => patchFleetGps(prev, liveWialonUnits));
  }, [liveWialonUnits]);

  /** Флот-wide: фіксуємо початок поточного idle з live GPS */
  useEffect(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const map = idleSinceByUnitIdRef.current;
    const activeIds = new Set(units.map((u) => u.id));
    let changed = false;

    for (const id of [...map.keys()]) {
      if (!activeIds.has(id)) {
        map.delete(id);
        changed = true;
      }
    }

    for (const unit of units) {
      if (isUnitCurrentlyIdle(unit)) {
        if (!map.has(unit.id)) {
          map.set(unit.id, nowSec);
          changed = true;
        }
      } else if (map.has(unit.id)) {
        map.delete(unit.id);
        changed = true;
      }
    }

    if (changed) setIdleClock((n) => n + 1);
  }, [units]);

  /** Перерахунок алертів раз на хвилину — поріг 1 год без зміни GPS */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdleClock((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /** Стабільний ключ — GPS-поллінг не перезапускає KPI sync */
  const fleetUnitIdsKey = units.map((u) => u.id).join(",");

  const selectedUnitId = selectedUnit?.id ?? null;
  const liveSelectedUnit = useMemo(() => {
    if (selectedUnitId == null) return null;
    return units.find((u) => u.id === selectedUnitId) ?? selectedUnit;
  }, [units, selectedUnitId, selectedUnit]);

  const playback = useEquipmentTrackPlayback(
    trackGeoJSON,
    selectedUnitId != null
  );

  useEffect(() => {
    const controller = new AbortController();
    type FleetResponse = {
      ok?: boolean;
      tracked?: FleetTrackedUnit[];
      nonTracked?: FleetNonTrackedItem[];
      towedEquipment?: FleetNonTrackedItem[];
      geofences?: GeofenceCollection;
      error?: string;
      wialonError?: string | null;
    };

    const applyFleet = (data: FleetResponse) => {
      setUnits(data.tracked ?? []);
      setNonTracked(data.nonTracked ?? []);
      setTowedEquipment(data.towedEquipment ?? []);
      setGeofences(
        data.geofences?.type === "FeatureCollection"
          ? data.geofences
          : EMPTY_GEOFENCES
      );
      if (data.wialonError && (data.tracked?.length ?? 0) === 0) {
        setError(data.wialonError);
      } else {
        setError(null);
      }
    };

    const stale = peekAppCacheStale<FleetResponse>("api:equipment:fleet");
    const fresh = peekAppCache<FleetResponse>("api:equipment:fleet");
    if (fresh?.ok !== false && (fresh?.tracked || stale?.tracked)) {
      applyFleet(fresh ?? stale!);
      setLoading(false);
      if (fresh) return () => controller.abort();
    } else {
      setLoading(true);
    }
    setError(null);

    cachedFetchJson<FleetResponse>(
      "api:equipment:fleet",
      "/api/equipment/fleet",
      undefined,
      { signal: controller.signal, force: !fresh }
    )
      .then(({ data }) => {
        if (data.ok === false) {
          throw new Error(data.error || "Не вдалося завантажити флот");
        }
        applyFleet(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (stale?.tracked) {
          applyFleet(stale);
          return;
        }
        setUnits([]);
        setNonTracked([]);
        setTowedEquipment([]);
        setGeofences(EMPTY_GEOFENCES);
        setError(err instanceof Error ? err.message : "Помилка завантаження");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  /** Оновлення бейджів нарядів без повного перезавантаження флоту */
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();

    const refreshOps = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetch("/api/equipment/active-ops", {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const data = (await response.json()) as {
            ok?: boolean;
            operations?: FleetActiveOperation[];
          };
          if (!response.ok || data.ok === false || !Array.isArray(data.operations)) {
            return;
          }
          const ops = data.operations;
          setUnits((prev) => {
            const next = attachActiveOpsToFleet(prev, [], [], ops).tracked;
            return next;
          });
          setNonTracked((prev) =>
            attachActiveOpsToFleet([], prev, [], ops).nonTracked
          );
          setTowedEquipment((prev) =>
            attachActiveOpsToFleet([], [], prev, ops).towedEquipment
          );
        })
        .catch(() => {
          /* silent */
        });
    };

    const timer = window.setInterval(refreshOps, 60_000);
    document.addEventListener("visibilitychange", refreshOps);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOps);
    };
  }, [loading]);

  /** Deep-link з карти полів: /equipment?id={unitId} */
  useEffect(() => {
    if (loading || units.length === 0) return;
    const raw = searchParams.get("id");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    const unit = units.find((u) => u.id === id);
    if (unit) setSelectedUnit(unit);
  }, [loading, units, searchParams]);

  /** Трек + аналітика обраної одиниці за trackDate */
  useEffect(() => {
    if (selectedUnitId == null) {
      setTrackGeoJSON(null);
      setDayAnalytics(EMPTY_DAY_ANALYTICS);
      setTrackError(null);
      setTrackLoading(false);
      setSelectedSessionId(null);
      return;
    }

    const daySource = trackDate;
    const dayKey = calendarDateToYmd(daySource);
    const isToday = dayKey === todayKyivYmd();
    const cacheKey = `${selectedUnitId}:${dayKey}`;
    const TODAY_BUNDLE_TTL_MS = 2.5 * 60 * 1000;
    const cached = dayBundleCacheRef.current.get(cacheKey);
    const cacheFresh =
      cached != null &&
      (!isToday || Date.now() - cached.fetchedAt < TODAY_BUNDLE_TTL_MS);

    if (cacheFresh && cached) {
      setTrackGeoJSON(cached.track);
      setDayAnalytics(cached.analytics);
      setTrackError(null);
      setTrackLoading(false);

      let ttlTimer: ReturnType<typeof setTimeout> | undefined;
      if (isToday) {
        const remaining = Math.max(
          1_000,
          TODAY_BUNDLE_TTL_MS - (Date.now() - cached.fetchedAt)
        );
        ttlTimer = setTimeout(() => {
          dayBundleCacheRef.current.delete(cacheKey);
          setTrackBundleTick((n) => n + 1);
        }, remaining);
      }
      return () => {
        if (ttlTimer) clearTimeout(ttlTimer);
      };
    }

    const controller = new AbortController();
    const { fromUnix: from, toUnix: to } = kyivDayBoundsUnix(dayKey);
    let ttlTimer: ReturnType<typeof setTimeout> | undefined;

    setTrackLoading(true);
    setTrackError(null);
    setTrackGeoJSON(null);
    setDayAnalytics(EMPTY_DAY_ANALYTICS);
    setSelectedSessionId(null);

    const params = new URLSearchParams({
      unitId: String(selectedUnitId),
      from: String(from),
      to: String(to),
    });

    fetch(`/api/wialon/track?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          track?: WialonTrackLineFeature;
          analytics?: DayAnalyticsPayload;
          error?: string;
        };
        if (!response.ok || !data.track) {
          throw new Error(data.error || "Не вдалося завантажити трек");
        }
        const analytics = data.analytics ?? EMPTY_DAY_ANALYTICS;
        dayBundleCacheRef.current.set(cacheKey, {
          track: data.track,
          analytics,
          fetchedAt: Date.now(),
        });
        setTrackGeoJSON(data.track);
        setDayAnalytics(analytics);
        if (isToday) {
          ttlTimer = setTimeout(() => {
            dayBundleCacheRef.current.delete(cacheKey);
            setTrackBundleTick((n) => n + 1);
          }, TODAY_BUNDLE_TTL_MS);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setTrackGeoJSON(EMPTY_TRACK_LINE);
        setDayAnalytics(EMPTY_DAY_ANALYTICS);
        setTrackError(
          err instanceof Error ? err.message : "Помилка завантаження треку"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrackLoading(false);
      });

    return () => {
      controller.abort();
      if (ttlTimer) clearTimeout(ttlTimer);
    };
  }, [selectedUnitId, trackDate, trackBundleTick]);

  /** Підсумок флоту: БД + sync з Wialon якщо порожньо / застаріло / refresh */
  useEffect(() => {
    if (loading || units.length === 0) return;

    const dayKey = calendarDateToYmd(fleetSummaryDate);
    const isToday = dayKey === todayKyivYmd();
    const ignoreDrainIds = units
      .filter((u) => isFuelDeliveryUnit(u.nm))
      .map((u) => u.id);
    const cacheKey = `${dayKey}|nodrain:${ignoreDrainIds.join(",")}`;
    const forceRefresh = fleetSummaryForceRefreshRef.current;
    if (forceRefresh) fleetSummaryForceRefreshRef.current = false;
    const cached = forceRefresh || isToday
      ? undefined
      : fleetSummaryCacheRef.current.get(cacheKey);
    if (cached?.byMetric) {
      setFleetSummary(cached);
      setFleetSummarySource("db");
      setFleetSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    setFleetSummaryLoading(true);
    setFleetSummarySource(null);

    const params = new URLSearchParams({
      date: dayKey,
      unitIds: units.map((u) => u.id).join(","),
      syncIfEmpty: "1",
    });
    if (forceRefresh) params.set("refresh", "1");
    if (ignoreDrainIds.length > 0) {
      params.set("ignoreDrainIds", ignoreDrainIds.join(","));
    }
    fetch(`/api/equipment/fleet-day-summary?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          unitsActive?: number;
          unitsTotal?: number;
          distanceKm?: number;
          hoursOnField?: number;
          hoursIdling?: number;
          drainEvents?: number;
          byMetric?: FleetDaySummary["byMetric"];
          source?: "db" | "empty";
          syncedAt?: string | null;
          truncated?: boolean;
          unitStats?: Array<{
            wialonUnitId: number;
            hoursIdling: number;
            drainEvents: number;
          }>;
          error?: string;
        };
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || "Не вдалося завантажити підсумок");
        }
        const next: FleetDaySummary = {
          unitsActive: data.unitsActive ?? 0,
          unitsTotal: data.unitsTotal ?? units.length,
          distanceKm: data.distanceKm ?? 0,
          hoursOnField: data.hoursOnField ?? 0,
          hoursIdling: data.hoursIdling ?? 0,
          drainEvents: data.drainEvents ?? 0,
          byMetric: data.byMetric ?? emptyFleetByMetric(),
          syncedAt: data.syncedAt ?? null,
          truncated: data.truncated === true,
        };
        if (data.source === "db" && !isToday) {
          fleetSummaryCacheRef.current.set(cacheKey, next);
        }
        setFleetSummary(next);
        setFleetSummarySource(data.source ?? "empty");
        if (isToday && data.unitStats) {
          setAlertUnitStats(data.unitStats);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setFleetSummary({
          unitsActive: 0,
          unitsTotal: units.length,
          distanceKm: 0,
          hoursOnField: 0,
          hoursIdling: 0,
          drainEvents: 0,
          byMetric: emptyFleetByMetric(),
        });
        setFleetSummarySource("empty");
      })
      .finally(() => {
        if (!controller.signal.aborted) setFleetSummaryLoading(false);
      });

    return () => controller.abort();
  }, [
    fleetUnitIdsKey,
    fleetSummaryDate,
    loading,
    fleetSummaryRefreshToken,
    fleetSummaryTick,
  ]);

  /** Дзвіночок: сьогоднішні unitStats, якщо KPI дивиться на інший день */
  useEffect(() => {
    if (loading || units.length === 0) return;
    if (calendarDateToYmd(fleetSummaryDate) === todayKyivYmd()) return;

    const dayKey = todayKyivYmd();
    const ignoreDrainIds = units
      .filter((u) => isFuelDeliveryUnit(u.nm))
      .map((u) => u.id);
    const controller = new AbortController();
    const params = new URLSearchParams({
      date: dayKey,
      unitIds: units.map((u) => u.id).join(","),
    });
    if (ignoreDrainIds.length > 0) {
      params.set("ignoreDrainIds", ignoreDrainIds.join(","));
    }

    fetch(`/api/equipment/fleet-day-summary?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          unitStats?: Array<{
            wialonUnitId: number;
            hoursIdling: number;
            drainEvents: number;
          }>;
        };
        if (!response.ok || data.ok === false) return;
        setAlertUnitStats(data.unitStats ?? []);
      })
      .catch(() => {
        /* silent — KPI уже показує стан */
      });

    return () => controller.abort();
  }, [units, loading, fleetSummaryDate]);

  /** Автооновлення KPI сьогодні кожні 15 хв */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (calendarDateToYmd(fleetSummaryDate) !== todayKyivYmd()) return;
      setFleetSummaryTick((n) => n + 1);
    }, 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [fleetSummaryDate]);

  useEffect(() => {
    setSummaryMetric(null);
    setAlertFilter(null);
  }, [fleetSummaryDate]);

  const sortedUnits = useMemo(
    () => [...units].sort(compareUnitsByPriority),
    [units]
  );

  const fieldByUnitId = useMemo(() => {
    const map = new Map<number, FieldContext | null>();
    for (const unit of units) {
      map.set(unit.id, getCurrentField(unit, geofences));
    }
    return map;
  }, [units, geofences]);

  const unitAlertKinds = useMemo(() => {
    const map = new Map<number, Set<FleetAlertKind>>();
    const nowSec = Math.floor(Date.now() / 1000);
    for (const unit of units) {
      const kinds = new Set<FleetAlertKind>();
      const telemetry = parseUnitSensors(unit);
      const motion = getUnitMotionStatus(unit);
      if (motion.kind === "idling") kinds.add("idling");
      const lastT = unit.pos?.t;
      if (
        lastT == null ||
        !Number.isFinite(lastT) ||
        nowSec - lastT > OFFLINE_ALERT_SEC
      ) {
        kinds.add("offline");
      }
      if (
        unitHasFuelSensor(unit) &&
        isFuelCritical(
          telemetry.fuelLiters,
          unit.fuelTankVolume,
          CRITICAL_FUEL_RATIO
        )
      ) {
        kinds.add("fuel");
      }
      if (kinds.size > 0) map.set(unit.id, kinds);
    }
    return map;
  }, [units]);

  const fleetAlerts = useMemo(() => {
    let idling = 0;
    let offline = 0;
    let fuel = 0;
    for (const kinds of unitAlertKinds.values()) {
      if (kinds.has("idling")) idling += 1;
      if (kinds.has("offline")) offline += 1;
      if (kinds.has("fuel")) fuel += 1;
    }
    const alerts: FleetAlert[] = [];
    if (idling > 0) {
      alerts.push({
        kind: "idling",
        count: idling,
        label: "в холостому",
        detail: "Двигун увімкнено, техніка не рухається",
      });
    }
    if (offline > 0) {
      alerts.push({
        kind: "offline",
        count: offline,
        label: "без звʼязку",
        detail: "Немає GPS-контакту понад 30 хв",
      });
    }
    if (fuel > 0) {
      alerts.push({
        kind: "fuel",
        count: fuel,
        label: "паливо критично",
        detail: "Рівень палива нижче 15% бака",
      });
    }
    return alerts;
  }, [unitAlertKinds]);

  const selectedField = liveSelectedUnit
    ? fieldByUnitId.get(liveSelectedUnit.id) ?? null
    : null;
  const selectedTelemetry = liveSelectedUnit
    ? parseUnitSensors(liveSelectedUnit)
    : null;
  const selectedDriver = liveSelectedUnit
    ? getDriverProfile(liveSelectedUnit)
    : null;
  const driverHistory = useMemo(
    () => buildDriverShiftHistory(dayAnalytics.samples),
    [dayAnalytics.samples]
  );

  const locationSessions = useMemo(
    () =>
      !trackLoading ? buildLocationSessions(trackGeoJSON, geofences) : [],
    [geofences, trackGeoJSON, trackLoading]
  );

  const sessionTimeHours = useMemo(
    () => hoursFromSessionSpans(locationSessions),
    [locationSessions]
  );

  const summaryHighlightIds = useMemo(() => {
    if (!summaryMetric || !fleetSummary) return null;
    return new Set(fleetSummary.byMetric[summaryMetric] ?? []);
  }, [summaryMetric, fleetSummary]);

  const analyticsByUnitId = useMemo(() => {
    const map = new Map<number, DayAnalyticsPayload>();
    if (liveSelectedUnit && dayAnalytics.samples.length > 0) {
      map.set(liveSelectedUnit.id, dayAnalytics);
    }
    return map;
  }, [liveSelectedUnit, dayAnalytics]);

  const fleetSummarySyncHint = useMemo((): "syncing" | "empty" | null => {
    if (fleetSummaryLoading && !fleetSummary) return "syncing";
    if (fleetSummaryLoading && fleetSummarySource === "empty") return "syncing";
    if (!fleetSummaryLoading && fleetSummarySource === "empty") return "empty";
    return null;
  }, [fleetSummaryLoading, fleetSummary, fleetSummarySource]);

  const drainEventsByUnitId = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of alertUnitStats) {
      if (row.drainEvents > 0) {
        map.set(row.wialonUnitId, row.drainEvents);
      }
    }
    return map;
  }, [alertUnitStats]);

  const idleSinceByUnitId = useMemo(
    () => new Map(idleSinceByUnitIdRef.current),
    [idleClock]
  );

  const smartAlerts = useMemo(
    () =>
      buildSmartAlerts({
        units,
        analyticsByUnitId,
        idleSinceByUnitId,
        drainEventsByUnitId,
        alertDayKey: todayKyivYmd(),
      }),
    [units, analyticsByUnitId, idleSinceByUnitId, drainEventsByUnitId]
  );

  const isDesktopMapLayout = useMediaQuery("(min-width: 768px)");
  const isMobile = useIsMobile();
  const mapFitPadding = useMemo(
    () => commandCenterFitPadding(isDesktopMapLayout),
    [isDesktopMapLayout]
  );

  const openUnitFromList = (unit: FleetTrackedUnit) => {
    setSelectedSessionId(null);
    setTrackDate(fleetSummaryDate);
    setSelectedUnit(unit);
    setMobileFleetExpanded(true);
    commandMapRef.current?.flyToUnit(unit.id, { pitch: 45, zoom: 16 });
  };

  const showUnitTrackerOnMap = () => {
    setMobileFleetExpanded(false);
    playback.setIsPlaying(false);
    playback.setProgress(0);
    const coords = trackGeoJSON?.geometry?.coordinates;
    if (coords && coords.length >= 2) {
      let minLng = coords[0]![0]!;
      let minLat = coords[0]![1]!;
      let maxLng = minLng;
      let maxLat = minLat;
      for (const c of coords) {
        const lng = c[0]!;
        const lat = c[1]!;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      commandMapRef.current?.fitBounds(
        expandBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          0.002
        ),
        { padding: mapFitPadding, maxZoom: 16, pitch: 40 }
      );
      return;
    }
    if (selectedUnitId != null) {
      commandMapRef.current?.flyToUnit(selectedUnitId, { pitch: 45, zoom: 15 });
    }
  };

  const backToFleetList = () => {
    playback.setIsPlaying(false);
    playback.setProgress(0);
    setSelectedUnit(null);
    setSelectedSessionId(null);
    commandMapRef.current?.fitAllUnits();
  };

  const focusMainMap = (
    center: [number, number],
    bounds: [[number, number], [number, number]] | null
  ) => {
    const padding = mapFitPadding;
    if (bounds) {
      const expanded = expandBounds(bounds, 0.004);
      commandMapRef.current?.fitBounds(expanded, {
        padding,
        maxZoom: 17,
        pitch: 40,
      });
      return;
    }
    commandMapRef.current?.fitBounds(
      expandBounds(
        [
          [center[0] - 0.0015, center[1] - 0.0015],
          [center[0] + 0.0015, center[1] + 0.0015],
        ],
        0.004
      ),
      { padding, maxZoom: 17, pitch: 40 }
    );
  };

  const handlePlaybackProgressChange = (value: number) => {
    playback.setIsPlaying(false);
    playback.setProgress(value);
  };

  const showPlaybackMarker =
    playback.isPlaying || playback.progress > 0;

  /** Бензовоз роздає паливо — «злив» не показуємо й не алертимо */
  const displayFuelEvents = useMemo(() => {
    if (liveSelectedUnit && isFuelDeliveryUnit(liveSelectedUnit.nm)) {
      return [];
    }
    return dayAnalytics.fuelEvents;
  }, [dayAnalytics.fuelEvents, liveSelectedUnit]);

  const handleSmartAlertClick = (alert: SmartAlert) => {
    const unit = units.find((u) => u.id === alert.unitId);
    if (!unit) return;
    openUnitFromList(unit);
  };

  /**
   * Тости лише для НОВИХ критичних подій (злив), після початкового bootstrap.
   * GPS loss / long idle — тільки в дзвіночку, без спаму при завантаженні.
   */
  useEffect(() => {
    if (!alertsBootstrappedRef.current) {
      for (const alert of smartAlerts) {
        seenAlertIdsRef.current.add(alert.id);
      }
      // Bootstrap після першого осмисленого списку (або порожнього після load)
      if (!loading) {
        alertsBootstrappedRef.current = true;
      }
      return;
    }

    for (const alert of smartAlerts) {
      if (seenAlertIdsRef.current.has(alert.id)) continue;
      seenAlertIdsRef.current.add(alert.id);

      if (alert.kind !== "fuel_drain" || alert.severity !== "critical") {
        continue;
      }

      toast.error(alert.title, {
        description: alert.detail,
        duration: 8000,
        action: {
          label: "Відкрити",
          onClick: () => {
            const unit = units.find((u) => u.id === alert.unitId);
            if (unit) openUnitFromList(unit);
          },
        },
      });
    }
    // openUnitFromList стабільний за поведінкою; units потрібен для action
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast лише на зміну alerts
  }, [smartAlerts, loading, units]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  /** Затримка 1с — анімація лише якщо курсор реально «завис», не пролетів повз */
  const scheduleListHover = useCallback(
    (unitId: number | null) => {
      hoverIntentRef.current = unitId;
      clearHoverTimer();
      const delay = unitId != null ? 1000 : 150;
      hoverTimerRef.current = setTimeout(() => {
        setListHoveredUnitId(hoverIntentRef.current);
        hoverTimerRef.current = null;
      }, delay);
    },
    [clearHoverTimer]
  );

  useEffect(() => {
    return () => clearHoverTimer();
  }, [clearHoverTimer]);

  useEffect(() => {
    if (selectedUnitId != null) {
      clearHoverTimer();
      setListHoveredUnitId(null);
      lastPreviewedUnitIdRef.current = null;
      return;
    }
    if (listHoveredUnitId == null) {
      lastPreviewedUnitIdRef.current = null;
      return;
    }
    if (lastPreviewedUnitIdRef.current === listHoveredUnitId) return;

    const unit = units.find((u) => u.id === listHoveredUnitId);
    if (!unit?.pos) return;

    lastPreviewedUnitIdRef.current = listHoveredUnitId;
    commandMapRef.current?.previewUnitFocus(listHoveredUnitId);
  }, [listHoveredUnitId, selectedUnitId, units, clearHoverTimer]);

  const sortedUnitIds = useMemo(
    () => sortedUnits.map((u) => u.id),
    [sortedUnits]
  );

  return (
    <div className="absolute inset-0 overflow-hidden">
      <EquipmentCommandMap
        ref={commandMapRef}
        units={units}
        geofences={geofences}
        selectedUnitId={selectedUnitId}
        listHoveredUnitId={
          selectedUnitId == null ? listHoveredUnitId : null
        }
        trackGeoJSON={trackGeoJSON}
        trackLoading={trackLoading}
        playbackProgress={playback.progress}
        followPlayback={playback.isPlaying}
        playbackSpeed={playback.playbackSpeed}
        showPlaybackMarker={showPlaybackMarker}
        onUnitClick={openUnitFromList}
        dataLoading={loading}
        fitPadding={mapFitPadding}
      />

      <div
        className={cn(
          COMMAND_CENTER_MAP_AREA_CLASS,
          "pointer-events-none z-30 flex flex-col items-center justify-end px-3",
          "pb-[calc(var(--app-bottom-inset)+var(--fields-peek-height,4.75rem)+0.75rem)] md:pb-6"
        )}
      >
        <EquipmentTrackPlaybackPanel
          visible={
            selectedUnitId != null &&
            (!isMobile || !mobileFleetExpanded)
          }
          isPlaying={playback.isPlaying}
          onTogglePlay={playback.togglePlay}
          progress={playback.progress}
          onProgressChange={handlePlaybackProgressChange}
          maxProgress={playback.maxProgress}
          playbackSpeed={playback.playbackSpeed}
          onSpeedChange={playback.setPlaybackSpeed}
          startUnix={playback.startUnix}
          endUnix={playback.endUnix}
          currentUnix={playback.currentUnix}
          unixAtProgress={(p) => progressUnixTime(trackGeoJSON, p)}
          disabled={playback.disabled}
          loading={trackLoading}
          className="max-w-full"
        />
      </div>

      {error ? (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-orange-300/60 bg-orange-50/90 px-4 py-2 text-sm font-medium text-orange-900 shadow-lg backdrop-blur-md">
          {error}
        </div>
      ) : null}

      {!error && liveGpsError ? (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 max-w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-amber-300/60 bg-amber-50/90 px-4 py-2 text-sm font-medium text-amber-950 shadow-lg backdrop-blur-md">
          GPS: {liveGpsError}
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute z-30",
          // Не тягнути COMMAND_CENTER_MAP_AREA_CLASS (inset-y-0) — він збиває top і
          // кладе дзвіночок під Dynamic Island / зарядку.
          "top-[max(0.75rem,calc(var(--safe-top)+0.55rem))]",
          "right-[max(0.75rem,env(safe-area-inset-right,0px))]",
          "md:top-3 md:right-3"
        )}
      >
        <div className="flex justify-end">
          <EquipmentSmartAlertsCenter
            alerts={smartAlerts}
            onAlertClick={handleSmartAlertClick}
          />
        </div>
      </div>

      <EquipmentFleetGlassPanel
        units={units}
        nonTracked={nonTracked}
        towedEquipment={towedEquipment}
        fieldByUnitId={fieldByUnitId}
        sortedUnitIds={sortedUnitIds}
        unitAlertKinds={unitAlertKinds}
        summaryHighlightIds={summaryHighlightIds}
        alertFilter={alertFilter}
        fleetAlerts={fleetAlerts}
        onAlertFilterChange={(kind) => {
          setSummaryMetric(null);
          setAlertFilter(kind);
        }}
        selectedUnitId={selectedUnitId}
        selectedUnitName={liveSelectedUnit?.nm ?? null}
        fleetSummary={fleetSummary}
        fleetSummaryLoading={fleetSummaryLoading}
        fleetSummarySyncHint={fleetSummarySyncHint}
        fleetSummaryDate={fleetSummaryDate}
        summaryMetric={summaryMetric}
        loading={loading}
        mobileExpanded={mobileFleetExpanded}
        onMobileExpandedChange={setMobileFleetExpanded}
        onUnitOpen={openUnitFromList}
        onUnitHover={scheduleListHover}
        listHoveredUnitId={
          selectedUnitId == null ? listHoveredUnitId : null
        }
        onBackToList={backToFleetList}
        onShowTracker={showUnitTrackerOnMap}
        onSummaryDateChange={(next) => {
          setFleetSummaryDate(next);
          setTrackDate(next);
        }}
        onSummaryMetricSelect={(metric) => {
          setAlertFilter(null);
          setSummaryMetric(metric);
          if (metric != null && selectedUnitId != null) {
            playback.setIsPlaying(false);
            playback.setProgress(0);
            setSelectedUnit(null);
            setSelectedSessionId(null);
          }
        }}
        onSummaryRefresh={() => {
          fleetSummaryCacheRef.current.clear();
          fleetSummaryForceRefreshRef.current = true;
          setFleetSummaryRefreshToken((n) => n + 1);
        }}
        detailContent={
          liveSelectedUnit && selectedTelemetry ? (
            <div className="flex flex-col gap-2.5 pb-4 md:gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <UnitStatusBadge unit={liveSelectedUnit} />
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  LIVE
                </span>
              </div>

              {liveSelectedUnit.activeOp ? (
                <UnitActiveOpBadge op={liveSelectedUnit.activeOp} />
              ) : null}

              <UtilizationTimelineBar
                analytics={dayAnalytics}
                loading={trackLoading}
                dateLabel={formatTrackDateLabel(trackDate)}
              />
              <FuelSparkline
                analytics={dayAnalytics}
                fuelEvents={displayFuelEvents}
                loading={trackLoading}
                liveLiters={
                  unitHasFuelSensor(liveSelectedUnit)
                    ? selectedTelemetry.fuelLiters
                    : null
                }
                tankVolume={liveSelectedUnit.fuelTankVolume}
                capacityLabel={
                  isFuelDeliveryUnit(liveSelectedUnit.nm)
                    ? "Цистерна"
                    : "Бак"
                }
                hasFuelSensor={
                  unitHasFuelSensor(liveSelectedUnit) ||
                  dayAnalytics.summary.hasFuelSensor
                }
              />

              <MechanicPresenceBlock
                current={selectedDriver}
                history={driverHistory}
              />

              <div className="grid grid-cols-2 gap-2">
                <TelemetryTile
                  icon={Gauge}
                  label="Швидкість"
                  value={
                    getSanitizedSpeed(liveSelectedUnit).value != null
                      ? `${Math.round(getSanitizedSpeed(liveSelectedUnit).value!)} км/год`
                      : NO_DATA
                  }
                />
                <TelemetryTile
                  icon={Fuel}
                  label="Паливо"
                  value={
                    unitHasFuelSensor(liveSelectedUnit)
                      ? formatLiters(selectedTelemetry.fuelLiters)
                      : "Немає датчика"
                  }
                />
                <TelemetryTile
                  icon={Clock}
                  label="Звʼязок"
                  value={formatLastContact(liveSelectedUnit.pos?.t)}
                />
                <TelemetryTile
                  icon={MapPin}
                  label="Локація"
                  value={selectedField?.name ?? "Поза полем"}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-sm font-semibold text-zinc-900">Журнал дня</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TrackDatePicker
                    date={trackDate}
                    unitId={liveSelectedUnit.id}
                    onChange={(next) => {
                      setTrackDate(next);
                      setFleetSummaryDate(next);
                    }}
                  />
                  {/* Мобільний: експорти в меню; ПК — як було */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E5DFD3] bg-white/90 text-zinc-600 shadow-sm md:hidden"
                      aria-label="Експорт журналу"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      sideOffset={8}
                      className="z-[220] min-w-44"
                      data-vaul-no-drag=""
                    >
                      <DropdownMenuItem
                        className="gap-2"
                        disabled={trackLoading || locationSessions.length === 0}
                        onClick={() => {
                          exportDayJournalCsv({
                            unitName: liveSelectedUnit.nm,
                            dateLabel: formatTrackDateLabel(trackDate),
                            fileDate: calendarDateToYmd(trackDate),
                            sessions: locationSessions,
                            summary: dayAnalytics.summary,
                            hoursOnField: sessionTimeHours.hoursOnField,
                            hoursOnRoad: sessionTimeHours.hoursOnRoad,
                            hoursAtBase: sessionTimeHours.hoursAtBase,
                            fuelEvents: displayFuelEvents,
                          });
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2"
                        disabled={trackLoading}
                        onClick={() => {
                          exportDayJournalXlsx({
                            unitName: liveSelectedUnit.nm,
                            dateLabel: formatTrackDateLabel(trackDate),
                            fileDate: calendarDateToYmd(trackDate),
                            sessions: locationSessions,
                            summary: dayAnalytics.summary,
                            hoursOnField: sessionTimeHours.hoursOnField,
                            hoursOnRoad: sessionTimeHours.hoursOnRoad,
                            hoursAtBase: sessionTimeHours.hoursAtBase,
                            fuelEvents: displayFuelEvents,
                          });
                        }}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Excel
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2"
                        disabled={trackLoading}
                        onClick={() => {
                          printDayJournalReport({
                            unitName: liveSelectedUnit.nm,
                            dateLabel: formatTrackDateLabel(trackDate),
                            fileDate: calendarDateToYmd(trackDate),
                            sessions: locationSessions,
                            summary: dayAnalytics.summary,
                            hoursOnField: sessionTimeHours.hoursOnField,
                            hoursOnRoad: sessionTimeHours.hoursOnRoad,
                            hoursAtBase: sessionTimeHours.hoursAtBase,
                            fuelEvents: displayFuelEvents,
                          });
                        }}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Друк
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="hidden items-center gap-0.5 rounded-xl border border-[#E5DFD3] bg-white/90 p-0.5 shadow-sm md:flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={trackLoading || locationSessions.length === 0}
                      title="Експорт CSV"
                      aria-label="Експорт CSV"
                      onClick={() => {
                        exportDayJournalCsv({
                          unitName: liveSelectedUnit.nm,
                          dateLabel: formatTrackDateLabel(trackDate),
                          fileDate: calendarDateToYmd(trackDate),
                          sessions: locationSessions,
                          summary: dayAnalytics.summary,
                          hoursOnField: sessionTimeHours.hoursOnField,
                          hoursOnRoad: sessionTimeHours.hoursOnRoad,
                          hoursAtBase: sessionTimeHours.hoursAtBase,
                          fuelEvents: displayFuelEvents,
                        });
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={trackLoading}
                      title="Експорт Excel"
                      aria-label="Експорт Excel"
                      onClick={() => {
                        exportDayJournalXlsx({
                          unitName: liveSelectedUnit.nm,
                          dateLabel: formatTrackDateLabel(trackDate),
                          fileDate: calendarDateToYmd(trackDate),
                          sessions: locationSessions,
                          summary: dayAnalytics.summary,
                          hoursOnField: sessionTimeHours.hoursOnField,
                          hoursOnRoad: sessionTimeHours.hoursOnRoad,
                          hoursAtBase: sessionTimeHours.hoursAtBase,
                          fuelEvents: displayFuelEvents,
                        });
                      }}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={trackLoading}
                      title="Друк"
                      aria-label="Друк журналу"
                      onClick={() => {
                        printDayJournalReport({
                          unitName: liveSelectedUnit.nm,
                          dateLabel: formatTrackDateLabel(trackDate),
                          fileDate: calendarDateToYmd(trackDate),
                          sessions: locationSessions,
                          summary: dayAnalytics.summary,
                          hoursOnField: sessionTimeHours.hoursOnField,
                          hoursOnRoad: sessionTimeHours.hoursOnRoad,
                          hoursAtBase: sessionTimeHours.hoursAtBase,
                          fuelEvents: displayFuelEvents,
                        });
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              {trackError ? (
                <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                  {trackError}
                </p>
              ) : null}
              <DayShiftSummary
                summary={{
                  ...dayAnalytics.summary,
                  hasFuelSensor:
                    unitHasFuelSensor(liveSelectedUnit) ||
                    dayAnalytics.summary.hasFuelSensor,
                }}
                hoursOnField={sessionTimeHours.hoursOnField}
                hoursOnRoad={sessionTimeHours.hoursOnRoad}
                hoursAtBase={sessionTimeHours.hoursAtBase}
                fuelEvents={displayFuelEvents}
                loading={trackLoading}
                dateLabel={formatTrackDateLabel(trackDate)}
                liveFuelLiters={
                  parseUnitSensors(liveSelectedUnit).fuelLiters
                }
                onFuelEventClick={(event: FuelDrainEvent) => {
                  setSelectedSessionId(null);
                  focusMainMap([event.lng, event.lat], null);
                  if (isMobile) setMobileFleetExpanded(false);
                }}
              />
              <LocationJournalTimeline
                sessions={locationSessions}
                loading={trackLoading}
                selectedId={selectedSessionId}
                onSelect={(session) => {
                  setSelectedSessionId(session.id);
                  playback.setIsPlaying(false);
                  playback.setProgress(session.endIndex);
                  focusMainMap(session.center, session.bounds);
                  if (isMobile) setMobileFleetExpanded(false);
                }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="h-20 animate-pulse rounded-xl bg-white/50" />
              <div className="h-28 animate-pulse rounded-xl bg-white/50" />
              <div className="h-24 animate-pulse rounded-xl bg-white/50" />
            </div>
          )
        }
      />
    </div>
  );
}

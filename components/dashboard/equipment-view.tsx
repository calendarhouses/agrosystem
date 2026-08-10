"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  bbox as turfBbox,
  bearing as turfBearing,
  booleanPointInPolygon,
  point as turfPoint,
} from "@turf/turf";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Battery,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Fuel,
  Gauge,
  KeyRound,
  Loader2,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radar,
  Route,
  Satellite,
  Timer,
  Tractor,
  Truck,
  UserCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import MapboxMap, {
  Layer,
  Marker,
  NavigationControl,
  Source,
} from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DayShiftSummary } from "@/components/dashboard/day-shift-summary";
import {
  FleetAlertStrip,
  type FleetAlert,
  type FleetAlertKind,
} from "@/components/dashboard/fleet-alert-strip";
import {
  emptyFleetByMetric,
  FleetDaySummaryBar,
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
  exportDayJournalCsv,
  exportDayJournalXlsx,
  printDayJournalReport,
} from "@/lib/equipment-export";
import type {
  WialonGeofenceProperties,
  WialonTrackLineFeature,
  WialonUnit,
  WialonUnitTelemetry,
} from "@/lib/wialon";
import {
  DEFAULT_TRACTOR_TANK_LITERS,
  EMPTY_TRACK_LINE,
  parseWialonUnitTelemetry,
} from "@/lib/wialon";
import { cn } from "@/lib/utils";

const OFFLINE_ALERT_SEC = 30 * 60;
const CRITICAL_FUEL_RATIO = 0.15;

const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/**
 * Lucide Tractor — вид збоку, «капот» вправо.
 * turf.bearing: 0 = північ. При повороті >90° іконка стає догори дриґом —
 * тоді дзеркалимо по X, щоб колеса лишались знизу.
 */
function getMarkerOrientation(bearing: number): {
  rotation: number;
  scaleX: number;
} {
  let rotation = bearing - 90;
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;

  let scaleX = 1;
  if (Math.abs(rotation) > 90) {
    rotation -= Math.sign(rotation) * 180;
    scaleX = -1;
  }

  return { rotation, scaleX };
}

/** GPS Wialon інколи дає абсурдну швидкість для агротехніки */
const MAX_PLAUSIBLE_AGRO_SPEED_KMH = 100;

/** Крок progress за кадр (~60 FPS) при 1x */
const PLAYBACK_STEP_PER_FRAME = 0.05;

/** Інтервал ТО (заміна масла/фільтрів), мотогодини */
const SERVICE_INTERVAL = 250;

/** Паралельні запити аналітики для підсумку флоту */
const FLEET_SUMMARY_CONCURRENCY = 3;

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

function getVehicleIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  if (lower.includes("бензовоз")) return Truck;
  return Tractor;
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

type MapFocusTarget = {
  key: number;
  center: [number, number];
  bounds: [[number, number], [number, number]] | null;
  startIndex?: number;
  endIndex?: number;
};

type SheetPanel = "info" | "live" | "history";

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
  onExportCsv,
  onExportXlsx,
  onExportPdf,
}: {
  sessions: LocationSession[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (session: LocationSession) => void;
  onExportCsv?: () => void;
  onExportXlsx?: () => void;
  onExportPdf?: () => void;
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
      <div className="flex flex-col gap-3 border-b border-[#E5DFD3]/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-zinc-900">Журнал локацій</p>
          <p className="text-xs text-zinc-500">
            Натисніть сесію — покажемо на карті
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {fieldCount} пол.
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
            {Math.floor(totalMin / 60)}г {totalMin % 60}хв
          </span>
          {onExportXlsx ? (
            <button
              type="button"
              onClick={onExportXlsx}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E5DFD3] bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700 outline-none focus-visible:outline-none"
              title="Експорт Excel"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Excel
            </button>
          ) : null}
          {onExportCsv ? (
            <button
              type="button"
              onClick={onExportCsv}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E5DFD3] bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700 outline-none focus-visible:outline-none"
              title="Експорт CSV"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          ) : null}
          {onExportPdf ? (
            <button
              type="button"
              onClick={onExportPdf}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E5DFD3] bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700 outline-none focus-visible:outline-none"
              title="Друк / PDF"
            >
              <FileText className="h-3 w-3" />
              PDF
            </button>
          ) : null}
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

function VehicleGlyph({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Icon = getVehicleIcon(name);
  return (
    <Icon
      size={size}
      strokeWidth={1.2}
      className={className}
      absoluteStrokeWidth
    />
  );
}

function hasFuelData(liters: number | null | undefined): boolean {
  return liters != null && Number.isFinite(liters) && liters !== 0;
}

/** Data-first: паливо → рух → запалювання */
function compareUnitsByPriority(a: WialonUnit, b: WialonUnit): number {
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

type MaintenanceStatus = "critical" | "warning" | "good";

type MaintenanceInfo = {
  hoursSinceLastService: number;
  hoursToNextService: number;
  progressPercent: number;
  status: MaintenanceStatus;
};

function getMaintenanceInfo(
  engineHours: number | null | undefined
): MaintenanceInfo | null {
  if (engineHours == null || !Number.isFinite(engineHours) || engineHours < 0) {
    return null;
  }

  const hoursSinceLastService = engineHours % SERVICE_INTERVAL;
  const hoursToNextService = SERVICE_INTERVAL - hoursSinceLastService;
  const progressPercent = Math.min(
    Math.max((hoursSinceLastService / SERVICE_INTERVAL) * 100, 0),
    100
  );

  let status: MaintenanceStatus = "good";
  if (hoursToNextService <= 30) status = "critical";
  else if (hoursToNextService <= 70) status = "warning";

  return {
    hoursSinceLastService,
    hoursToNextService,
    progressPercent,
    status,
  };
}

function fuelProgressPercent(liters: number | null): number | null {
  if (liters == null || !Number.isFinite(liters) || liters < 0) return null;
  return Math.min((liters / DEFAULT_TRACTOR_TANK_LITERS) * 100, 100);
}

function hasValidPosition(unit: WialonUnit): boolean {
  const pos = unit.pos;
  return (
    !!pos &&
    Number.isFinite(pos.x) &&
    Number.isFinite(pos.y) &&
    pos.x > 0 &&
    pos.y > 0
  );
}

function FleetStatChip({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "neutral" | "live" | "field";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-sm",
        tone === "live" && value > 0
          ? "border-emerald-200/80 bg-emerald-50/90"
          : tone === "field" && value > 0
            ? "border-emerald-200/70 bg-white"
            : "border-zinc-200/80 bg-white/90"
      )}
    >
      <span
        className={cn(
          "text-sm font-extrabold tabular-nums",
          tone === "live" && value > 0
            ? "text-emerald-700"
            : tone === "field" && value > 0
              ? "text-emerald-700"
              : "text-zinc-900"
        )}
      >
        {value}
      </span>
      <span className="text-xs font-medium text-zinc-500">{label}</span>
    </div>
  );
}

type UnitCardProps = {
  unit: WialonUnit;
  field: FieldContext | null;
  onOpen: () => void;
  highlight?: FleetAlertKind | null;
  /** Підсвітка з підсумку зміни флоту */
  summaryHighlight?: boolean;
  dimmed?: boolean;
};

function UnitCard({
  unit,
  field,
  onOpen,
  highlight = null,
  summaryHighlight = false,
  dimmed = false,
}: UnitCardProps) {
  const telemetry = parseUnitSensors(unit);
  const fuelPct = fuelProgressPercent(telemetry.fuelLiters);
  const hasFuel = telemetry.fuelLiters != null && Number.isFinite(telemetry.fuelLiters);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    if (!hasFuel || fuelPct == null) {
      setBarWidth(0);
      return;
    }
    setBarWidth(0);
    const id = requestAnimationFrame(() => {
      setBarWidth(fuelPct);
    });
    return () => cancelAnimationFrame(id);
  }, [fuelPct, hasFuel, unit.id]);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-unit-id={unit.id}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-sm",
        "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30",
        summaryHighlight &&
          "border-[#276749] ring-2 ring-[#276749]/25 hover:border-[#22543d]",
        !summaryHighlight &&
          highlight === "idling" &&
          "border-rose-400 ring-2 ring-rose-200/80 hover:border-rose-500",
        !summaryHighlight &&
          highlight === "offline" &&
          "border-amber-400 ring-2 ring-amber-200/80 hover:border-amber-500",
        !summaryHighlight &&
          highlight === "fuel" &&
          "border-[#C05621] ring-2 ring-[#E8C4B0] hover:border-[#C05621]",
        !summaryHighlight &&
          !highlight &&
          "border-zinc-200/60 hover:border-emerald-500/40",
        dimmed && "opacity-35 grayscale-[0.35]"
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-gradient-to-b from-white to-zinc-50 text-zinc-700 shadow-sm">
            <VehicleGlyph name={unit.nm} />
          </div>
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-base leading-snug font-bold break-words text-zinc-900">
              {unit.nm}
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <UnitStatusBadge unit={unit} />
        </div>
      </div>

      {/* Location */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-1.5 text-sm",
          field && !field.isBase
            ? "font-medium text-emerald-700"
            : "font-medium text-zinc-500"
        )}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="break-words">
          {field ? field.name : "Поза полем"}
        </span>
      </div>

      {/* Fuel */}
      {hasFuel && fuelPct != null ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold tabular-nums text-zinc-900">
              Паливо:{" "}
              {Math.round(telemetry.fuelLiters!).toLocaleString("uk-UA")} л
            </span>
            <span className="text-sm font-medium text-zinc-400 tabular-nums">
              {Math.round(fuelPct)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100 shadow-inner">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-1000 ease-out",
                fuelPct < 20
                  ? "bg-gradient-to-r from-red-500 to-orange-400"
                  : "bg-gradient-to-r from-emerald-500 to-emerald-400"
              )}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm font-medium text-zinc-400">
          Паливо: {NO_DATA}
        </p>
      )}
    </button>
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

function toLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
          const key = toLocalDayKey(new Date(unix * 1000));
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
          "outline-none transition-all hover:border-[#276749]/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#276749]/25"
        )}
      >
        <CalendarIcon size={16} className="shrink-0 text-[#276749]" />
        <span className="font-medium">{formatTrackDateLabel(date)}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[260px] overflow-hidden rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-[0_20px_50px_rgba(28,25,23,0.14)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#E5DFD3]/80 px-2.5 py-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-800"
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
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-800"
            aria-label="Наступний місяць"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="px-1.5 py-1.5">
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
                hasTrack: (day) => daysWithTrack.has(toLocalDayKey(day)),
                noTrack: (day) => {
                  if (day > today) return false;
                  return !daysWithTrack.has(toLocalDayKey(day));
                },
              }}
              components={{
                DayButton: TrackCalendarDayButton,
              }}
              className="w-full rounded-xl bg-transparent p-0 [--cell-size:1.75rem]"
              classNames={{
                today: "bg-transparent",
                month: "flex w-full flex-col gap-1",
                month_caption: "hidden",
                nav: "hidden",
                weekdays: "flex",
                weekday: "flex-1 text-[0.65rem] font-medium text-zinc-400",
                week: "mt-0.5 flex w-full",
              }}
            />
          ) : (
            <div className="flex h-[176px] flex-col items-center justify-center gap-2">
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

function formatTrackClock(unix: number | null | undefined): string {
  if (unix == null || !Number.isFinite(unix) || unix <= 0) return "--:--";
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TrackPlayerPanel({
  isPlaying,
  onTogglePlay,
  progress,
  onProgressChange,
  playbackSpeed,
  onSpeedChange,
  maxProgress,
  currentUnixTime,
  startUnixTime,
  endUnixTime,
  disabled,
}: {
  isPlaying: boolean;
  onTogglePlay: () => void;
  progress: number;
  onProgressChange: (value: number) => void;
  playbackSpeed: PlaybackSpeed;
  onSpeedChange: (value: PlaybackSpeed) => void;
  maxProgress: number;
  currentUnixTime: number | null;
  startUnixTime: number | null;
  endUnixTime: number | null;
  disabled?: boolean;
}) {
  const safeMax = Math.max(maxProgress, 0);
  const safeProgress = Math.min(Math.max(progress, 0), safeMax);

  return (
    <div className="absolute right-4 bottom-4 left-4 z-10 flex flex-col gap-2 rounded-xl border border-zinc-200/50 bg-white/90 p-3 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={isPlaying ? "Пауза" : "Відтворення"}
          disabled={disabled || safeMax <= 0}
          onClick={onTogglePlay}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </button>

        <div className="min-w-0">
          <span className="font-mono text-sm font-bold text-zinc-900 tabular-nums">
            {formatTrackClock(currentUnixTime)}
          </span>
          <p className="text-xs text-zinc-500 tabular-nums">
            {formatTrackClock(startUnixTime)} – {formatTrackClock(endUnixTime)}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {PLAYBACK_SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onSpeedChange(value)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40",
                playbackSpeed === value
                  ? "bg-zinc-200 text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
              )}
            >
              {value}x
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={safeMax || 0}
        step={0.01}
        value={safeProgress}
        disabled={disabled || safeMax <= 0}
        onChange={(event) => onProgressChange(Number(event.target.value))}
        className="h-1.5 w-full appearance-none rounded-full bg-zinc-200 accent-amber-500 disabled:opacity-40"
        aria-label="Шкала часу маршруту"
      />
    </div>
  );
}

function startOfLocalDayUnix(date: Date): number {
  return Math.floor(
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0
    ).getTime() / 1000
  );
}

function endOfLocalDayUnix(date: Date): number {
  return Math.floor(
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999
    ).getTime() / 1000
  );
}

function EquipmentMiniMap({
  unit,
  fieldName,
  geofences,
  trackGeoJSON,
  trackLoading,
  trackError,
  mapMode,
  focusTarget,
}: {
  unit: WialonUnit;
  fieldName: string | null;
  geofences: GeofenceCollection;
  trackGeoJSON: WialonTrackLineFeature | null;
  trackLoading: boolean;
  trackError: string | null;
  mapMode: "live" | "history";
  focusTarget?: MapFocusTarget | null;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const lastSmoothedBearingRef = useRef(0);
  const chaseTargetRef = useRef<{
    center: Position;
    bearing: number;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [followCamera, setFollowCamera] = useState(true);
  const [focusedSegment, setFocusedSegment] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const track = trackGeoJSON ?? EMPTY_TRACK_LINE;
  const coordinates = track.geometry.coordinates;
  const times = track.properties.times ?? [];
  const pointCount = coordinates.length;
  const maxProgress = Math.max(pointCount - 1, 0);
  const showHistoryTrack = mapMode === "history" && pointCount >= 2;
  const trackFetchSettled = trackGeoJSON != null || trackError != null;
  const showEmptyTrackOverlay =
    mapMode === "history" &&
    !trackLoading &&
    trackFetchSettled &&
    (Boolean(trackError) || pointCount < 2);

  // Новий трек → з початку
  useEffect(() => {
    setProgress(0);
    setIsPlaying(false);
    setFollowCamera(true);
    setFocusedSegment(null);
  }, [trackGeoJSON, unit.id]);

  useEffect(() => {
    if (mapMode !== "history") {
      setIsPlaying(false);
    }
  }, [mapMode]);

  // Playback loop — ~60 FPS, дробовий progress
  useEffect(() => {
    if (!isPlaying || mapMode !== "history" || pointCount < 2) return;

    let rafId = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      setProgress((prev) => {
        if (prev >= maxProgress) {
          queueMicrotask(() => setIsPlaying(false));
          return maxProgress;
        }
        const next = Math.min(
          prev + PLAYBACK_STEP_PER_FRAME * playbackSpeed,
          maxProgress
        );
        if (next >= maxProgress) {
          queueMicrotask(() => setIsPlaying(false));
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [isPlaying, playbackSpeed, mapMode, pointCount, maxProgress]);

  const currentIndex = Math.min(Math.floor(progress), maxProgress);
  const nextIndex = Math.min(currentIndex + 1, maxProgress);
  const fraction = showHistoryTrack ? progress - currentIndex : 0;

  const currentPoint = useMemo((): Position | null => {
    if (!showHistoryTrack || pointCount < 2) return null;
    const from = coordinates[currentIndex];
    const to = coordinates[nextIndex];
    if (!from || !to) return null;
    return [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
    ];
  }, [
    coordinates,
    currentIndex,
    fraction,
    nextIndex,
    pointCount,
    showHistoryTrack,
  ]);

  const currentUnixTime = useMemo(() => {
    if (times.length === 0) return null;
    const t0 = times[currentIndex];
    const t1 = times[nextIndex] ?? t0;
    if (t0 == null || !Number.isFinite(t0)) return null;
    if (t1 == null || !Number.isFinite(t1)) return t0;
    return t0 + (t1 - t0) * fraction;
  }, [currentIndex, fraction, nextIndex, times]);

  const startUnixTime = times.length > 0 ? times[0] : null;
  const endUnixTime = times.length > 0 ? times[times.length - 1] : null;

  // Look-ahead bearing — стабільний вектор без GPS-jitter
  const smoothedBearing = useMemo(() => {
    if (!currentPoint || !showHistoryTrack || pointCount < 2) {
      return lastSmoothedBearingRef.current;
    }
    const lookAheadIndex = Math.min(
      Math.floor(progress) + 8,
      pointCount - 1
    );
    const lookAheadPoint = coordinates[lookAheadIndex];
    if (!lookAheadPoint) return lastSmoothedBearingRef.current;
    if (
      currentPoint[0] === lookAheadPoint[0] &&
      currentPoint[1] === lookAheadPoint[1]
    ) {
      return lastSmoothedBearingRef.current;
    }
    try {
      const next = turfBearing(
        turfPoint(currentPoint),
        turfPoint(lookAheadPoint)
      );
      lastSmoothedBearingRef.current = next;
      return next;
    } catch {
      return lastSmoothedBearingRef.current;
    }
  }, [coordinates, currentPoint, pointCount, progress, showHistoryTrack]);

  useEffect(() => {
    if (!currentPoint) return;
    chaseTargetRef.current = {
      center: currentPoint,
      bearing: smoothedBearing,
    };
  }, [currentPoint, smoothedBearing]);

  const trailFeature = useMemo(() => {
    if (!showHistoryTrack || !currentPoint) return EMPTY_TRACK_LINE;
    const trackLineCoords = [
      ...coordinates.slice(0, currentIndex + 1),
      currentPoint,
    ];
    const lineCoords =
      trackLineCoords.length >= 2
        ? trackLineCoords
        : trackLineCoords.length === 1
          ? [trackLineCoords[0], trackLineCoords[0]]
          : [];
    return {
      ...track,
      properties: {
        ...track.properties,
        pointCount: lineCoords.length,
        times: times.slice(0, currentIndex + 1),
      },
      geometry: {
        type: "LineString" as const,
        coordinates: lineCoords,
      },
    };
  }, [
    coordinates,
    currentIndex,
    currentPoint,
    showHistoryTrack,
    times,
    track,
  ]);

  const sessionHighlightFeature = useMemo(() => {
    if (!showHistoryTrack || !focusedSegment) return null;
    const { startIndex, endIndex } = focusedSegment;
    const sliced = coordinates.slice(startIndex, endIndex + 1);
    if (sliced.length < 2) {
      if (sliced.length === 1) {
        return {
          ...track,
          properties: { ...track.properties, pointCount: 2 },
          geometry: {
            type: "LineString" as const,
            coordinates: [sliced[0], sliced[0]],
          },
        };
      }
      return null;
    }
    return {
      ...track,
      properties: { ...track.properties, pointCount: sliced.length },
      geometry: {
        type: "LineString" as const,
        coordinates: sliced,
      },
    };
  }, [coordinates, focusedSegment, showHistoryTrack, track]);

  useEffect(() => {
    setMapReady(false);
  }, [unit.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !showHistoryTrack) return;

    try {
      const [minX, minY, maxX, maxY] = turfBbox(track);
      if (
        ![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))
      ) {
        return;
      }
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 40, duration: 1000, maxZoom: 16 }
      );
      setFollowCamera(true);
    } catch {
      // порожній / невалідний трек — не ламаємо карту
    }
  }, [mapReady, showHistoryTrack, track, unit.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mapMode !== "live" || !unit.pos) return;
    map.flyTo({
      center: [unit.pos.x, unit.pos.y],
      zoom: 15,
      bearing: 0,
      duration: 800,
    });
  }, [mapMode, mapReady, unit.id, unit.pos]);

  // Фокус із журналу локацій — сегмент + камера
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusTarget || mapMode !== "history") return;

    setIsPlaying(false);
    setFollowCamera(false);

    if (
      focusTarget.startIndex != null &&
      focusTarget.endIndex != null &&
      focusTarget.endIndex >= focusTarget.startIndex
    ) {
      setFocusedSegment({
        startIndex: focusTarget.startIndex,
        endIndex: focusTarget.endIndex,
      });
      setProgress(focusTarget.endIndex);
    } else {
      setFocusedSegment(null);
    }

    mapShellRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    const runFocus = () => {
      if (focusTarget.bounds) {
        const [[minX, minY], [maxX, maxY]] = expandBounds(focusTarget.bounds);
        map.fitBounds(
          [
            [minX, minY],
            [maxX, maxY],
          ],
          { padding: 56, duration: 1200, maxZoom: 16.5 }
        );
        return;
      }
      map.flyTo({
        center: focusTarget.center,
        zoom: 15.5,
        pitch: is3D ? 75 : 0,
        duration: 1200,
      });
    };

    // Дати шару сегмента намалюватись перед анімацією камери
    const timer = window.setTimeout(runFocus, 40);
    return () => window.clearTimeout(timer);
  }, [focusTarget, is3D, mapMode, mapReady]);

  // Chase camera — throttle easeTo, Mapbox сам дотягує (гумова стрічка)
  useEffect(() => {
    if (
      !mapReady ||
      !isPlaying ||
      !followCamera ||
      mapMode !== "history"
    ) {
      return;
    }

    const CHASE_INTERVAL_MS = 500;

    const applyChase = () => {
      const map = mapRef.current;
      const target = chaseTargetRef.current;
      if (!map || !target) return;

      map.easeTo({
        center: [target.center[0], target.center[1]],
        bearing: is3D ? target.bearing : 0,
        pitch: is3D ? 75 : 0,
        zoom: is3D ? 17.5 : map.getZoom(),
        duration: 1000,
        easing: (t) => t,
        animate: true,
      });
    };

    applyChase();
    const intervalId = window.setInterval(applyChase, CHASE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [followCamera, is3D, isPlaying, mapMode, mapReady]);

  // Pitch поза follow: пауза / live / перемикач 2D/3D
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (isPlaying && mapMode === "history" && followCamera) return;

    map.easeTo({
      pitch: mapMode === "history" && is3D ? 75 : 0,
      ...(mapMode === "live" ? { bearing: 0 } : {}),
      duration: 800,
    });
  }, [followCamera, is3D, isPlaying, mapMode, mapReady]);

  if (!hasValidPosition(unit) || !unit.pos) {
    return (
      <div className="mt-2 flex h-64 items-center justify-center rounded-xl border border-zinc-200 bg-[#EBE5D9]/50 text-sm text-zinc-500 shadow-inner">
        {NO_DATA}
      </div>
    );
  }

  if (!token) {
    return (
      <div className="mt-2 flex h-64 items-center justify-center rounded-xl border border-zinc-200 bg-[#EBE5D9]/50 px-4 text-center text-sm text-zinc-500 shadow-inner">
        Додайте NEXT_PUBLIC_MAPBOX_TOKEN у .env.local
      </div>
    );
  }

  const { x: longitude, y: latitude } = unit.pos;
  const markerLongitude =
    mapMode === "history" && currentPoint ? currentPoint[0] : longitude;
  const markerLatitude =
    mapMode === "history" && currentPoint ? currentPoint[1] : latitude;
  const showHudMarker = mapMode === "history" && is3D;
  const tractorOrientation = getMarkerOrientation(
    mapMode === "history" ? smoothedBearing : 0
  );
  const MarkerIcon = getVehicleIcon(unit.nm);

  return (
    <div
      ref={mapShellRef}
      className="relative mt-2 h-72 w-full overflow-hidden rounded-xl border border-zinc-200 shadow-inner"
    >
      <div className="h-full w-full">
        <MapboxMap
          ref={mapRef}
          key={unit.id}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
          initialViewState={{ longitude, latitude, zoom: 15, pitch: 0, bearing: 0 }}
          pitch={mapMode === "history" && is3D ? 75 : 0}
          terrain={{
            source: "mapbox-dem",
            exaggeration: mapMode === "history" && is3D ? 1.5 : 0,
          }}
          dragRotate
          pitchWithRotate={false}
          attributionControl={false}
          onLoad={() => setMapReady(true)}
          onDragStart={() => {
            if (mapMode === "history" && isPlaying) {
              setFollowCamera(false);
            }
          }}
          style={{ width: "100%", height: "100%" }}
        >
          <Source
            id="mapbox-dem"
            type="raster-dem"
            url="mapbox://mapbox.mapbox-terrain-dem-v1"
            tileSize={512}
            maxzoom={14}
          />

          <Source id="equipment-geofences" type="geojson" data={geofences}>
            <Layer
              id="equipment-geofences-fill"
              type="fill"
              paint={{
                "fill-color": ["coalesce", ["get", "color"], "#276749"],
                "fill-opacity":
                  mapMode === "history" && is3D ? 0.05 : 0.3,
              }}
            />
            <Layer
              id="equipment-geofences-outline"
              type="line"
              paint={{
                "line-color": ["coalesce", ["get", "color"], "#276749"],
                "line-width": 2,
              }}
            />
          </Source>

          {showHistoryTrack ? (
            <Source id="equipment-track-full" type="geojson" data={track}>
              <Layer
                id="equipment-track-full-line"
                type="line"
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color": "#fbbf24",
                  "line-width": 2,
                  "line-opacity": 0.35,
                }}
              />
            </Source>
          ) : null}

          {showHistoryTrack && sessionHighlightFeature ? (
            <Source
              id="equipment-track-session"
              type="geojson"
              data={sessionHighlightFeature}
            >
              <Layer
                id="equipment-track-session-glow"
                type="line"
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color": "#34d399",
                  "line-width": 10,
                  "line-opacity": 0.35,
                  "line-blur": 3,
                }}
              />
              <Layer
                id="equipment-track-session-line"
                type="line"
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color": "#10b981",
                  "line-width": 4,
                  "line-opacity": 1,
                }}
              />
            </Source>
          ) : null}

          {showHistoryTrack && !sessionHighlightFeature ? (
            <Source id="equipment-track" type="geojson" data={trailFeature}>
              <Layer
                id="equipment-track-glow"
                type="line"
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color": "#f59e0b",
                  "line-width": 8,
                  "line-opacity": 0.3,
                  "line-blur": 4,
                }}
              />
              <Layer
                id="equipment-track-line"
                type="line"
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color": "#fb923c",
                  "line-width": 3,
                  "line-opacity": 1,
                }}
              />
            </Source>
          ) : null}

          <NavigationControl position="bottom-right" showCompass={false} />
          <Marker
            longitude={markerLongitude}
            latitude={markerLatitude}
            anchor="center"
            rotation={showHudMarker ? smoothedBearing : 0}
            pitchAlignment={showHudMarker ? "map" : "viewport"}
            rotationAlignment={showHudMarker ? "map" : "viewport"}
          >
            {showHudMarker ? (
              <div className="relative flex items-center justify-center">
                <div
                  className="absolute h-12 w-12 animate-ping rounded-full bg-amber-500/20"
                  style={{ transform: "scaleX(1) scaleY(1)" }}
                />
                <Navigation
                  size={28}
                  className="-rotate-45 fill-amber-500 text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                />
              </div>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-white text-zinc-800 shadow-[0_0_15px_rgba(0,0,0,0.3)]">
                {/* rotate і scaleX окремо: разом transition стискає іконку через scaleX(0) */}
                <div
                  className="flex items-center justify-center"
                  style={
                    mapMode === "history"
                      ? {
                          transform: `rotate(${tractorOrientation.rotation}deg)`,
                          transition: "transform 0.15s linear",
                        }
                      : undefined
                  }
                >
                  <div
                    className="flex items-center justify-center"
                    style={
                      mapMode === "history"
                        ? { transform: `scaleX(${tractorOrientation.scaleX})` }
                        : undefined
                    }
                  >
                    <MarkerIcon size={18} strokeWidth={1.5} />
                  </div>
                </div>
              </div>
            )}
          </Marker>
        </MapboxMap>
      </div>

      {mapMode === "history" ? (
        <button
          type="button"
          onClick={() => setIs3D((prev) => !prev)}
          className="absolute top-3 right-3 z-10 rounded-md border border-zinc-200 bg-white/90 p-2 text-xs font-bold text-zinc-700 shadow-sm backdrop-blur-md hover:bg-white"
          aria-label={is3D ? "Увімкнути 2D" : "Увімкнути 3D"}
          title={is3D ? "2D вигляд" : "3D дрон"}
        >
          {is3D ? "2D" : "3D"}
        </button>
      ) : null}

      <div className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-md">
        {fieldName || "Точні координати"}
      </div>
      {mapMode === "history" && trackLoading ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/45 backdrop-blur-[2px]">
          <div className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/95 px-4 py-3 text-sm font-semibold text-zinc-700 shadow-xl">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            Завантаження треку…
          </div>
        </div>
      ) : null}

      {showEmptyTrackOverlay ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/55 backdrop-blur-[3px]">
          <div className="mx-4 max-w-[260px] rounded-2xl border border-white/20 bg-white/95 px-5 py-4 text-center shadow-2xl">
            <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <Route className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-bold text-zinc-900">
              {trackError ? "Не вдалося завантажити трек" : "Маршруту немає"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {trackError || "За цей день маршруту немає"}
            </p>
          </div>
        </div>
      ) : null}

      {mapMode === "history" && !showEmptyTrackOverlay && !trackLoading ? (
        <TrackPlayerPanel
          isPlaying={isPlaying}
          onTogglePlay={() => {
            if (pointCount < 2) return;
            setFocusedSegment(null);
            if (progress >= maxProgress) {
              setProgress(0);
              setFollowCamera(true);
              setIsPlaying(true);
              return;
            }
            setIsPlaying((prev) => {
              const next = !prev;
              if (next) setFollowCamera(true);
              return next;
            });
          }}
          progress={progress}
          onProgressChange={(value) => {
            setIsPlaying(false);
            setFocusedSegment(null);
            setProgress(value);
          }}
          playbackSpeed={playbackSpeed}
          onSpeedChange={setPlaybackSpeed}
          maxProgress={maxProgress}
          currentUnixTime={currentUnixTime}
          startUnixTime={startUnixTime}
          endUnixTime={endUnixTime}
          disabled={trackLoading || pointCount < 2}
        />
      ) : null}
    </div>
  );
}

/** Моніторинг техніки — Wialon + гео-контекст + телеметрія */
export function EquipmentView() {
  const searchParams = useSearchParams();
  const [units, setUnits] = useState<WialonUnit[]>([]);
  const [geofences, setGeofences] =
    useState<GeofenceCollection>(EMPTY_GEOFENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<WialonUnit | null>(null);
  const [sheetPanel, setSheetPanel] = useState<SheetPanel>("info");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [trackDate, setTrackDate] = useState(() => new Date());
  const [fleetSummaryDate, setFleetSummaryDate] = useState(() => new Date());
  const [fleetSummary, setFleetSummary] = useState<FleetDaySummary | null>(
    null
  );
  const [fleetSummaryLoading, setFleetSummaryLoading] = useState(false);
  const fleetSummaryCacheRef = useRef(new Map<string, FleetDaySummary>());
  const dayBundleCacheRef = useRef(
    new Map<
      string,
      { track: WialonTrackLineFeature; analytics: DayAnalyticsPayload }
    >()
  );
  const [trackGeoJSON, setTrackGeoJSON] =
    useState<WialonTrackLineFeature | null>(null);
  const [dayAnalytics, setDayAnalytics] =
    useState<DayAnalyticsPayload>(EMPTY_DAY_ANALYTICS);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(
    null
  );
  const [alertFilter, setAlertFilter] = useState<FleetAlertKind | null>(null);
  const [summaryMetric, setSummaryMetric] =
    useState<FleetSummaryMetric | null>(null);
  const mapMode: "live" | "history" =
    sheetPanel === "history" ? "history" : "live";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/wialon", { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          units?: WialonUnit[];
          geofences?: GeofenceCollection;
          error?: string;
        };
        if (!response.ok || !Array.isArray(data.units)) {
          throw new Error(data.error || "Не вдалося завантажити техніку");
        }
        setUnits(data.units);
        setGeofences(
          data.geofences?.type === "FeatureCollection"
            ? data.geofences
            : EMPTY_GEOFENCES
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setUnits([]);
        setGeofences(EMPTY_GEOFENCES);
        setError(err instanceof Error ? err.message : "Помилка завантаження");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

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

  /** Трек + аналітика: для «Інфо» (механізатор) і «Трек» */
  useEffect(() => {
    if (!selectedUnit) {
      setTrackGeoJSON(null);
      setDayAnalytics(EMPTY_DAY_ANALYTICS);
      setTrackError(null);
      setTrackLoading(false);
      setSheetPanel("info");
      setSelectedSessionId(null);
      setMapFocusTarget(null);
      return;
    }

    if (sheetPanel === "live") {
      setTrackLoading(false);
      return;
    }

    const cacheKey = `${selectedUnit.id}:${toLocalDayKey(trackDate)}`;
    const cached = dayBundleCacheRef.current.get(cacheKey);
    if (cached) {
      setTrackGeoJSON(cached.track);
      setDayAnalytics(cached.analytics);
      setTrackError(null);
      setTrackLoading(false);
      return;
    }

    const controller = new AbortController();
    const from = startOfLocalDayUnix(trackDate);
    const to = endOfLocalDayUnix(trackDate);

    setTrackLoading(true);
    setTrackError(null);
    setTrackGeoJSON(null);
    setDayAnalytics(EMPTY_DAY_ANALYTICS);
    if (sheetPanel === "history") {
      setMapFocusTarget(null);
      setSelectedSessionId(null);
    }

    const params = new URLSearchParams({
      unitId: String(selectedUnit.id),
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
        });
        setTrackGeoJSON(data.track);
        setDayAnalytics(analytics);
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

    return () => controller.abort();
  }, [selectedUnit, trackDate, sheetPanel]);

  /** Агрегат флоту за обрану дату */
  useEffect(() => {
    if (loading || units.length === 0) return;

    const dayKey = toLocalDayKey(fleetSummaryDate);
    const cached = fleetSummaryCacheRef.current.get(dayKey);
    if (cached?.byMetric) {
      setFleetSummary(cached);
      setFleetSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    const from = startOfLocalDayUnix(fleetSummaryDate);
    const to = endOfLocalDayUnix(fleetSummaryDate);
    setFleetSummaryLoading(true);

    const fetchUnitDay = async (unitId: number) => {
      const params = new URLSearchParams({
        unitId: String(unitId),
        from: String(from),
        to: String(to),
      });
      const response = await fetch(`/api/wialon/track?${params}`, {
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        ok?: boolean;
        track?: WialonTrackLineFeature;
        analytics?: DayAnalyticsPayload;
      };
      if (!response.ok || !data.track) return null;
      return data;
    };

    (async () => {
      let distanceKm = 0;
      let hoursIdling = 0;
      let hoursOnField = 0;
      let drainEvents = 0;
      let unitsActive = 0;
      const byMetric = emptyFleetByMetric();

      for (let i = 0; i < units.length; i += FLEET_SUMMARY_CONCURRENCY) {
        if (controller.signal.aborted) return;
        const batch = units.slice(i, i + FLEET_SUMMARY_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (unit) => {
            const data = await fetchUnitDay(unit.id).catch(() => null);
            return { unitId: unit.id, data };
          })
        );
        for (const { unitId, data } of results) {
          if (!data?.analytics) continue;
          const { summary, fuelEvents } = data.analytics;
          distanceKm += summary.distanceKm;
          hoursIdling += summary.hoursIdling;
          drainEvents += fuelEvents.length;

          if (summary.distanceKm > 0.05 || summary.workHours > 0.05) {
            unitsActive += 1;
            byMetric.active.push(unitId);
          }
          if (summary.distanceKm > 0.05) {
            byMetric.distance.push(unitId);
          }
          if (summary.hoursIdling > 0) {
            byMetric.idling.push(unitId);
          }
          if (fuelEvents.length > 0) {
            byMetric.drain.push(unitId);
          }
          if (data.track) {
            const sessions = buildLocationSessions(data.track, geofences);
            const fieldH = hoursFromSessionSpans(sessions).hoursOnField;
            hoursOnField += fieldH;
            if (fieldH > 0) {
              byMetric.onField.push(unitId);
            }
          }
        }
      }

      if (controller.signal.aborted) return;

      const next: FleetDaySummary = {
        unitsActive,
        unitsTotal: units.length,
        distanceKm,
        hoursOnField,
        hoursIdling,
        drainEvents,
        byMetric,
      };
      fleetSummaryCacheRef.current.set(dayKey, next);
      setFleetSummary(next);
      setFleetSummaryLoading(false);
    })().catch((err: unknown) => {
      if (controller.signal.aborted) return;
      console.error(err);
      setFleetSummaryLoading(false);
    });

    return () => controller.abort();
  }, [units, fleetSummaryDate, loading, geofences]);

  useEffect(() => {
    setSummaryMetric(null);
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

  const fleetStats = useMemo(() => {
    let onBase = 0;
    let onField = 0;
    let moving = 0;
    for (const unit of units) {
      if (getSanitizedSpeed(unit).isMoving) moving += 1;
      const loc = fieldByUnitId.get(unit.id);
      if (!loc) continue;
      if (loc.isBase) onBase += 1;
      else onField += 1;
    }
    return {
      total: units.length,
      onBase,
      moving,
      onField,
    };
  }, [units, fieldByUnitId]);

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
        telemetry.fuelLiters != null &&
        Number.isFinite(telemetry.fuelLiters) &&
        telemetry.fuelLiters / DEFAULT_TRACTOR_TANK_LITERS < CRITICAL_FUEL_RATIO
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

  const selectedField = selectedUnit
    ? fieldByUnitId.get(selectedUnit.id) ?? null
    : null;
  const selectedTelemetry = selectedUnit
    ? parseUnitSensors(selectedUnit)
    : null;
  const selectedEngineOn = selectedTelemetry?.ignition === true;
  const selectedDriver = selectedUnit
    ? getDriverProfile(selectedUnit)
    : null;
  const driverHistory = useMemo(
    () => buildDriverShiftHistory(dayAnalytics.samples),
    [dayAnalytics.samples]
  );
  const selectedMaintenance = selectedTelemetry
    ? getMaintenanceInfo(selectedTelemetry.engineHours)
    : null;

  const locationSessions = useMemo(
    () =>
      (sheetPanel === "history" || sheetPanel === "info") && !trackLoading
        ? buildLocationSessions(trackGeoJSON, geofences)
        : [],
    [geofences, sheetPanel, trackGeoJSON, trackLoading]
  );

  const sessionTimeHours = useMemo(
    () => hoursFromSessionSpans(locationSessions),
    [locationSessions]
  );

  const buildExportPayload = () => {
    if (!selectedUnit) return null;
    return {
      unitName: selectedUnit.nm,
      dateLabel: format(trackDate, "d MMMM yyyy", { locale: uk }),
      fileDate: format(trackDate, "yyyy-MM-dd"),
      sessions: locationSessions.map((s) => ({
        startUnix: s.startUnix,
        endUnix: s.endUnix,
        name: s.name,
        kind: s.kind,
      })),
      summary: dayAnalytics.summary,
      hoursOnField: sessionTimeHours.hoursOnField,
      hoursOnRoad: sessionTimeHours.hoursOnRoad,
      hoursAtBase: sessionTimeHours.hoursAtBase,
      fuelEvents: dayAnalytics.fuelEvents,
    };
  };

  const headerStats = loading ? (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Синхронізація…
    </span>
  ) : error ? (
    <span className="text-sm font-medium text-[#C05621]">{error}</span>
  ) : (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <FleetStatChip value={fleetStats.total} label="одиниць" tone="neutral" />
        <span className="hidden text-zinc-300 sm:inline" aria-hidden>
          ·
        </span>
        <FleetStatChip value={fleetStats.onBase} label="на базі" tone="neutral" />
        <span className="hidden text-zinc-300 sm:inline" aria-hidden>
          ·
        </span>
        <FleetStatChip value={fleetStats.moving} label="в русі" tone="live" />
        <span className="hidden text-zinc-300 sm:inline" aria-hidden>
          ·
        </span>
        <FleetStatChip value={fleetStats.onField} label="на полях" tone="field" />
      </div>
      <FleetAlertStrip
        alerts={fleetAlerts}
        activeKind={alertFilter}
        onSelect={(kind) => {
          setSummaryMetric(null);
          setAlertFilter(kind);
          if (kind) {
            const first = units.find((u) =>
              unitAlertKinds.get(u.id)?.has(kind)
            );
            if (first) {
              requestAnimationFrame(() => {
                document
                  .querySelector(`[data-unit-id="${first.id}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              });
            }
          }
        }}
      />
    </div>
  );

  const summaryHighlightIds = useMemo(() => {
    if (!summaryMetric || !fleetSummary) return null;
    return new Set(fleetSummary.byMetric[summaryMetric] ?? []);
  }, [summaryMetric, fleetSummary]);

  const scrollToUnitId = (unitId: number) => {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-unit-id="${unitId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Radar}
        title="Моніторинг Техніки"
        description="Радар автопарку та статуси"
        actions={headerStats}
      />

      {!loading && !error && units.length > 0 ? (
        <FleetDaySummaryBar
          date={fleetSummaryDate}
          onDateChange={(next) => {
            setFleetSummaryDate(next);
            setTrackDate(next);
          }}
          summary={fleetSummary}
          loading={fleetSummaryLoading}
          activeMetric={summaryMetric}
          onMetricSelect={(metric) => {
            setAlertFilter(null);
            setSummaryMetric(metric);
            if (metric && fleetSummary) {
              const firstId = fleetSummary.byMetric[metric]?.[0];
              if (firstId != null) scrollToUnitId(firstId);
            }
          }}
        />
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-44 animate-pulse rounded-2xl border border-zinc-200/60 bg-white shadow-sm"
            />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedUnits.map((unit) => {
            const kinds = unitAlertKinds.get(unit.id);
            const inSummary = summaryHighlightIds?.has(unit.id) ?? false;
            const highlight =
              !summaryHighlightIds && alertFilter && kinds?.has(alertFilter)
                ? alertFilter
                : null;
            const dimmed = summaryHighlightIds
              ? !inSummary
              : Boolean(alertFilter && !highlight);
            return (
              <UnitCard
                key={unit.id}
                unit={unit}
                field={fieldByUnitId.get(unit.id) ?? null}
                highlight={highlight}
                summaryHighlight={inSummary}
                dimmed={dimmed}
                onOpen={() => {
                  setSheetPanel("info");
                  setSelectedSessionId(null);
                  setMapFocusTarget(null);
                  setSelectedUnit(unit);
                }}
              />
            );
          })}
        </section>
      )}

      <Sheet
        open={selectedUnit != null}
        onOpenChange={(open) => {
          if (!open) setSelectedUnit(null);
        }}
      >
        <SheetContent
          side="right"
          className={cn(
            "w-full gap-0 border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 sm:max-w-md",
            "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-[#E5DFD3]/40"
          )}
        >
          {selectedUnit && selectedTelemetry ? (
            <>
              <SheetHeader className="relative overflow-hidden border-b border-[#E5DFD3] px-6 py-6 pr-12">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(39,103,73,0.12),transparent_55%)]"
                />
                <div className="relative flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-gradient-to-b from-white to-zinc-50 text-zinc-700 shadow-sm"
                    )}
                  >
                    <VehicleGlyph name={selectedUnit.nm} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-xl font-extrabold tracking-tight text-zinc-900">
                      {selectedUnit.nm}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                      Телеметрія Wialon
                    </SheetDescription>

                    <MechanicPresenceBlock
                      current={selectedDriver}
                      history={driverHistory}
                      compact
                    />

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <UnitStatusBadge unit={selectedUnit} />
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                <div className="flex w-full items-center rounded-xl bg-zinc-100/90 p-1">
                  {(
                    [
                      { id: "info" as const, label: "Інфо", icon: Gauge },
                      { id: "live" as const, label: "Live", icon: Radar },
                      { id: "history" as const, label: "Трек", icon: Route },
                    ] as const
                  ).map((tab) => {
                    const active = sheetPanel === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSheetPanel(tab.id)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-all",
                          "outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                          active
                            ? "bg-white text-emerald-700 shadow-sm"
                            : "text-zinc-500 hover:text-zinc-700"
                        )}
                      >
                        {tab.id === "live" && active ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        ) : (
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                        )}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {sheetPanel === "info" ? (
                  <>
                    <MechanicPresenceBlock
                      current={selectedDriver}
                      history={driverHistory}
                    />

                    <div>
                      <p className="mb-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                        Сенсори та лічильники
                      </p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <TelemetryTile
                          icon={KeyRound}
                          label="Запалювання"
                          value={
                            selectedTelemetry.ignition == null
                              ? NO_DATA
                              : selectedEngineOn
                                ? "Увімкнено"
                                : "Вимкнено"
                          }
                          valueClassName={
                            selectedTelemetry.ignition == null
                              ? "text-zinc-400 font-semibold"
                              : selectedEngineOn
                                ? "text-emerald-600"
                                : "text-red-600"
                          }
                        />
                        <TelemetryTile
                          icon={Fuel}
                          label="Паливо"
                          value={formatLiters(selectedTelemetry.fuelLiters)}
                          valueClassName={
                            selectedTelemetry.fuelLiters == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                        <TelemetryTile
                          icon={Timer}
                          label="Мотогодини"
                          value={formatEngineHours(
                            selectedTelemetry.engineHours
                          )}
                          valueClassName={
                            selectedTelemetry.engineHours == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                        <TelemetryTile
                          icon={Route}
                          label="Пробіг"
                          value={formatMileage(selectedTelemetry.mileageKm)}
                          valueClassName={
                            selectedTelemetry.mileageKm == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                        <TelemetryTile
                          icon={Battery}
                          label="Напруга"
                          value={formatVoltage(selectedTelemetry.voltage)}
                          valueClassName={
                            selectedTelemetry.voltage == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                        <TelemetryTile
                          icon={Satellite}
                          label="Супутники"
                          value={formatSatellites(
                            selectedTelemetry.satellites
                          )}
                          valueClassName={
                            selectedTelemetry.satellites == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                      </div>
                    </div>

                    {(selectedTelemetry.engineHours ?? 0) > 0 &&
                    selectedMaintenance ? (
                      <div
                        className={cn(
                          "rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm",
                          "bg-gradient-to-b from-white to-zinc-50/80"
                        )}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50 text-zinc-600 shadow-sm">
                              <Wrench className="h-4 w-4" strokeWidth={1.4} />
                            </div>
                            <p className="text-sm font-bold text-zinc-900">
                              Технічне обслуговування (ТО)
                            </p>
                          </div>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                              selectedMaintenance.status === "critical" &&
                                "bg-red-50 text-red-600",
                              selectedMaintenance.status === "warning" &&
                                "bg-amber-50 text-amber-700",
                              selectedMaintenance.status === "good" &&
                                "bg-emerald-50 text-emerald-700"
                            )}
                          >
                            {selectedMaintenance.status === "critical"
                              ? "Критично"
                              : selectedMaintenance.status === "warning"
                                ? "Незабаром"
                                : "У нормі"}
                          </span>
                        </div>

                        <p className="text-sm leading-relaxed text-zinc-600">
                          До наступної заміни масла та фільтрів:{" "}
                          <span className="font-bold tabular-nums text-zinc-900">
                            {Math.round(
                              selectedMaintenance.hoursToNextService
                            ).toLocaleString("uk-UA")}{" "}
                            год
                          </span>
                        </p>
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 shadow-inner">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-700 ease-out",
                              selectedMaintenance.status === "critical" &&
                                "bg-red-500",
                              selectedMaintenance.status === "warning" &&
                                "bg-amber-400",
                              selectedMaintenance.status === "good" &&
                                "bg-emerald-500"
                            )}
                            style={{
                              width: `${selectedMaintenance.progressPercent}%`,
                            }}
                          />
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-zinc-400">
                          Інтервал ТО · кожні {SERVICE_INTERVAL} мотогодин
                        </p>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                        Телеметрія
                      </p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <TelemetryTile
                          icon={Clock}
                          label="Останній звʼязок"
                          value={formatLastContact(selectedUnit.pos?.t)}
                        />
                        <TelemetryTile
                          icon={Gauge}
                          label="Напрямок"
                          value={
                            selectedUnit.pos?.c != null &&
                            Number.isFinite(selectedUnit.pos.c)
                              ? `${selectedUnit.pos.c}°`
                              : NO_DATA
                          }
                          valueClassName={
                            selectedUnit.pos?.c == null
                              ? "text-zinc-400 font-semibold"
                              : undefined
                          }
                        />
                        <TelemetryTile
                          icon={MapPin}
                          label="Локація"
                          value={selectedField?.name ?? "Поза полем"}
                          valueClassName={
                            selectedField && !selectedField.isBase
                              ? "text-emerald-700"
                              : undefined
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                {sheetPanel === "live" || sheetPanel === "history" ? (
                  <div>
                    {sheetPanel === "history" ? (
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-zinc-900">
                            Історія маршруту
                          </p>
                          <p className="text-xs text-zinc-500">
                            Відтворення треку за день
                          </p>
                        </div>
                        <TrackDatePicker
                          date={trackDate}
                          unitId={selectedUnit.id}
                          onChange={setTrackDate}
                        />
                      </div>
                    ) : (
                      <div className="mb-3">
                        <p className="text-sm font-bold text-zinc-900">
                          Live Радар
                        </p>
                        <p className="text-xs text-zinc-500">
                          Поточна позиція техніки
                        </p>
                      </div>
                    )}

                    <EquipmentMiniMap
                      unit={selectedUnit}
                      fieldName={selectedField?.name ?? null}
                      geofences={geofences}
                      trackGeoJSON={trackGeoJSON}
                      trackLoading={trackLoading}
                      trackError={trackError}
                      mapMode={mapMode}
                      focusTarget={mapFocusTarget}
                    />

                    {sheetPanel === "history" ? (
                      <div className="mt-5 flex flex-col gap-5">
                        <DayShiftSummary
                          summary={dayAnalytics.summary}
                          hoursOnField={sessionTimeHours.hoursOnField}
                          hoursOnRoad={sessionTimeHours.hoursOnRoad}
                          hoursAtBase={sessionTimeHours.hoursAtBase}
                          fuelEvents={dayAnalytics.fuelEvents}
                          loading={trackLoading}
                          onFuelEventClick={(event: FuelDrainEvent) => {
                            setSelectedSessionId(null);
                            setMapFocusTarget({
                              key: Date.now(),
                              center: [event.lng, event.lat],
                              bounds: expandBounds(
                                [
                                  [event.lng - 0.0015, event.lat - 0.0015],
                                  [event.lng + 0.0015, event.lat + 0.0015],
                                ],
                                0.004
                              ),
                            });
                          }}
                        />
                        <LocationJournalTimeline
                          sessions={locationSessions}
                          loading={trackLoading}
                          selectedId={selectedSessionId}
                          onSelect={(session) => {
                            setSelectedSessionId(session.id);
                            setMapFocusTarget({
                              key: Date.now(),
                              center: session.center,
                              bounds: session.bounds,
                              startIndex: session.startIndex,
                              endIndex: session.endIndex,
                            });
                          }}
                          onExportCsv={() => {
                            const payload = buildExportPayload();
                            if (payload) exportDayJournalCsv(payload);
                          }}
                          onExportXlsx={() => {
                            const payload = buildExportPayload();
                            if (payload) exportDayJournalXlsx(payload);
                          }}
                          onExportPdf={() => {
                            const payload = buildExportPayload();
                            if (payload) printDayJournalReport(payload);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}

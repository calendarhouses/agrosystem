"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FeatureCollection, Polygon } from "geojson";
import { bbox as turfBbox, bearing as turfBearing, point as turfPoint } from "@turf/turf";
import MapboxMap, { Layer, Marker, NavigationControl, Source } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { Radar, Tractor, Truck } from "lucide-react";

import type { FleetTrackedUnit } from "@/lib/equipment-fleet";
import {
  buildPlayedLineFeature,
  interpolateTrackPoint,
  playbackFollowDurationMs,
  playbackFollowZoom,
  type PlaybackSpeed,
} from "@/lib/equipment-track-playback";
import {
  EMPTY_TRACK_LINE,
  hasValidWialonPosition,
  type WialonGeofenceProperties,
  type WialonTrackLineFeature,
} from "@/lib/wialon";
import { DEFAULT_WEATHER_LOCATION } from "@/lib/weather";
import { COMMAND_CENTER_MAP_AREA_CLASS } from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

/** Дефолтний центр карти — база (Іванівка), не Київ */
const FARM_DEFAULT_CENTER: [number, number] = [
  DEFAULT_WEATHER_LOCATION.longitude,
  DEFAULT_WEATHER_LOCATION.latitude,
];

function computeFleetBounds(
  units: FleetTrackedUnit[],
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoints = false;

  for (const unit of units) {
    if (!hasValidWialonPosition(unit) || !unit.pos) continue;
    minX = Math.min(minX, unit.pos.x);
    minY = Math.min(minY, unit.pos.y);
    maxX = Math.max(maxX, unit.pos.x);
    maxY = Math.max(maxY, unit.pos.y);
    hasPoints = true;
  }

  if (geofences.features.length > 0) {
    try {
      const [gMinX, gMinY, gMaxX, gMaxY] = turfBbox(geofences);
      if (Number.isFinite(gMinX) && Number.isFinite(gMinY)) {
        minX = Math.min(minX, gMinX);
        minY = Math.min(minY, gMinY);
        maxX = Math.max(maxX, gMaxX);
        maxY = Math.max(maxY, gMaxY);
        hasPoints = true;
      }
    } catch {
      /* ignore invalid geofence geometry */
    }
  }

  if (!hasPoints || !Number.isFinite(minX)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export type EquipmentCommandMapHandle = {
  flyToUnit: (
    unitId: number,
    options?: { pitch?: number; zoom?: number; duration?: number }
  ) => void;
  /** Плавний превʼю з hover списку — довша анімація, мʼякий easing */
  previewUnitFocus: (unitId: number) => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: {
      padding?:
        | number
        | { top: number; bottom: number; left: number; right: number };
      maxZoom?: number;
      duration?: number;
      pitch?: number;
    }
  ) => void;
  fitAllUnits: () => void;
};

type Props = {
  units: FleetTrackedUnit[];
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>;
  selectedUnitId?: number | null;
  /** Підсвітка з hover списку зліва */
  listHoveredUnitId?: number | null;
  trackGeoJSON?: WialonTrackLineFeature | null;
  trackLoading?: boolean;
  playbackProgress?: number;
  followPlayback?: boolean;
  playbackSpeed?: PlaybackSpeed;
  showPlaybackMarker?: boolean;
  onUnitClick?: (unit: FleetTrackedUnit) => void;
  /** Флот ще завантажується — чекаємо перед fitBounds */
  dataLoading?: boolean;
  fitPadding?: { top: number; bottom: number; left: number; right: number };
  className?: string;
};

/** easeInOutCubic — як на карті полів */
function cameraEasing(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function vehicleIcon(name: string) {
  return name.toLowerCase().includes("бензовоз") ? Truck : Tractor;
}

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

export const EquipmentCommandMap = forwardRef<EquipmentCommandMapHandle, Props>(
  function EquipmentCommandMap(
    {
      units,
      geofences,
      selectedUnitId,
      listHoveredUnitId = null,
      trackGeoJSON,
      trackLoading,
      playbackProgress = 0,
      followPlayback = false,
      playbackSpeed = 1,
      showPlaybackMarker = false,
      onUnitClick,
      dataLoading = false,
      fitPadding,
      className,
    },
    ref
  ) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [viewSettled, setViewSettled] = useState(false);
    const [hoveredUnitId, setHoveredUnitId] = useState<number | null>(null);
    const pendingFlyRef = useRef<number | null>(null);
    const initialFitDoneRef = useRef(false);

    const positionedUnits = useMemo(
      () => units.filter((u) => hasValidWialonPosition(u) && u.pos),
      [units]
    );

    const showTrack = selectedUnitId != null;
    const track = showTrack ? trackGeoJSON ?? EMPTY_TRACK_LINE : EMPTY_TRACK_LINE;
    const coordinates = track.geometry.coordinates;
    const pointCount = coordinates.length;
    const hasTrackLine = showTrack && !trackLoading && pointCount >= 2;

    const playedLineFeature = useMemo(
      () =>
        hasTrackLine && playbackProgress > 0
          ? buildPlayedLineFeature(track, playbackProgress)
          : null,
      [hasTrackLine, playbackProgress, track]
    );

    const playbackPosition = useMemo(() => {
      if (!hasTrackLine) return null;
      if (playbackProgress <= 0) return coordinates[0] ?? null;
      return interpolateTrackPoint(coordinates, playbackProgress);
    }, [coordinates, hasTrackLine, playbackProgress]);

    const playbackOrientation = useMemo(() => {
      if (!playbackPosition || coordinates.length < 2) {
        return { rotation: 0, scaleX: 1 };
      }
      const idx = Math.min(
        Math.max(Math.floor(playbackProgress), 0),
        coordinates.length - 2
      );
      const current = coordinates[idx];
      const next = coordinates[idx + 1];
      if (!current || !next) return { rotation: 0, scaleX: 1 };
      try {
        const bearing = turfBearing(turfPoint(current), turfPoint(next));
        return getMarkerOrientation(bearing);
      } catch {
        return { rotation: 0, scaleX: 1 };
      }
    }, [coordinates, playbackPosition, playbackProgress]);

    useImperativeHandle(ref, () => ({
      flyToUnit(unitId, options) {
        const unit = units.find((u) => u.id === unitId);
        if (!unit?.pos || !hasValidWialonPosition(unit)) {
          pendingFlyRef.current = unitId;
          return;
        }
        pendingFlyRef.current = null;
        const map = mapRef.current;
        if (!map || !mapReady) {
          pendingFlyRef.current = unitId;
          return;
        }
        map.flyTo({
          center: [unit.pos.x, unit.pos.y],
          zoom: options?.zoom ?? 16,
          pitch: options?.pitch ?? 45,
          bearing: 0,
          duration: options?.duration ?? 1800,
          essential: true,
          padding: fitPadding,
          easing: cameraEasing,
        });
      },
      previewUnitFocus(unitId) {
        const unit = units.find((u) => u.id === unitId);
        if (!unit?.pos || !hasValidWialonPosition(unit)) return;
        const map = mapRef.current;
        if (!map || !mapReady) return;
        map.flyTo({
          center: [unit.pos.x, unit.pos.y],
          zoom: 15.2,
          pitch: 42,
          bearing: 0,
          duration: 1400,
          essential: true,
          padding: fitPadding,
          easing: cameraEasing,
        });
      },
      fitBounds(bounds, options) {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        map.fitBounds(bounds, {
          padding: options?.padding ?? fitPadding ?? 100,
          maxZoom: options?.maxZoom ?? 17,
          duration: options?.duration ?? 1200,
          pitch: options?.pitch ?? 40,
          easing: cameraEasing,
        });
      },
      fitAllUnits() {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        const bounds = computeFleetBounds(units, geofences);
        if (!bounds) return;
        map.fitBounds(bounds, {
          padding: fitPadding ?? {
            top: 50,
            bottom: 110,
            left: 436,
            right: 48,
          },
          duration: 1200,
          maxZoom: 14,
          pitch: 0,
          bearing: 0,
          easing: cameraEasing,
        });
      },
    }));

    useEffect(() => {
      if (!mapReady || viewSettled || dataLoading) return;

      const hasData =
        positionedUnits.length > 0 || geofences.features.length > 0;
      if (!hasData) {
        initialFitDoneRef.current = true;
        setViewSettled(true);
        return;
      }

      if (initialFitDoneRef.current || selectedUnitId != null) return;

      const bounds = computeFleetBounds(units, geofences);
      if (!bounds) {
        initialFitDoneRef.current = true;
        setViewSettled(true);
        return;
      }

      initialFitDoneRef.current = true;
      mapRef.current?.fitBounds(bounds, {
        padding: fitPadding ?? { top: 50, bottom: 110, left: 436, right: 48 },
        duration: 1000,
        maxZoom: 14,
        pitch: 0,
        bearing: 0,
      });
    }, [
      mapReady,
      viewSettled,
      dataLoading,
      units,
      geofences,
      positionedUnits.length,
      selectedUnitId,
      fitPadding,
    ]);

    useEffect(() => {
      if (!mapReady || viewSettled) return;
      const map = mapRef.current?.getMap();
      if (!map) return;

      const onMoveEnd = () => {
        if (initialFitDoneRef.current) {
          setViewSettled(true);
        }
      };
      map.on("moveend", onMoveEnd);
      return () => {
        map.off("moveend", onMoveEnd);
      };
    }, [mapReady, viewSettled]);

    useEffect(() => {
      if (viewSettled || !mapReady) return;
      const fallback = window.setTimeout(() => setViewSettled(true), 3500);
      return () => window.clearTimeout(fallback);
    }, [viewSettled, mapReady]);

    useEffect(() => {
      if (selectedUnitId == null) return;
      initialFitDoneRef.current = true;
    }, [selectedUnitId]);

    useEffect(() => {
      if (!mapReady || pendingFlyRef.current == null) return;
      const id = pendingFlyRef.current;
      pendingFlyRef.current = null;
      const unit = units.find((u) => u.id === id);
      if (!unit?.pos) return;
      mapRef.current?.flyTo({
        center: [unit.pos.x, unit.pos.y],
        zoom: 16,
        pitch: 45,
        duration: 1800,
        padding: fitPadding,
      });
    }, [mapReady, units, fitPadding]);

    useEffect(() => {
      if (!mapReady || selectedUnitId == null) return;
      const unit = units.find((u) => u.id === selectedUnitId);
      if (!unit?.pos || !hasValidWialonPosition(unit)) return;
      mapRef.current?.flyTo({
        center: [unit.pos.x, unit.pos.y],
        zoom: 16,
        pitch: 45,
        duration: 1400,
        essential: true,
        padding: fitPadding,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- units навмисно виключено
    }, [mapReady, selectedUnitId, fitPadding]);

    useEffect(() => {
      if (!mapReady || !followPlayback) return;
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        zoom: playbackFollowZoom(playbackSpeed),
        duration: 450,
        essential: true,
        padding: fitPadding,
        easing: cameraEasing,
      });
    }, [followPlayback, playbackSpeed, mapReady, fitPadding]);

    useEffect(() => {
      if (!mapReady || !followPlayback || !playbackPosition) return;
      const map = mapRef.current;
      if (!map) return;
      const duration = playbackFollowDurationMs(playbackSpeed);
      const center = playbackPosition as [number, number];
      if (duration <= 0) {
        map.jumpTo({
          center,
          padding: fitPadding,
        });
        return;
      }
      map.easeTo({
        center,
        duration,
        essential: true,
        padding: fitPadding,
        // Лінійно — без «мʼякої» інерції, інакше трек відстає від іконки
        easing: (t) => t,
      });
    }, [
      followPlayback,
      mapReady,
      playbackPosition,
      fitPadding,
      playbackSpeed,
    ]);

    if (!token) {
      return (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center bg-zinc-900 text-sm text-zinc-300",
            className
          )}
        >
          Додайте NEXT_PUBLIC_MAPBOX_TOKEN у .env.local
        </div>
      );
    }

    const selectedUnit = selectedUnitId
      ? units.find((u) => u.id === selectedUnitId)
      : null;

    return (
      <div className={cn("absolute inset-0", className)}>
        {!viewSettled ? (
          <div className={cn(COMMAND_CENTER_MAP_AREA_CLASS, "z-20 flex flex-col items-center justify-center overflow-hidden bg-zinc-950")}>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(39,103,73,0.22),transparent_65%)]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }}
            />
            <div className="relative flex flex-col items-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-lg backdrop-blur-sm">
                <Radar className="h-7 w-7 animate-pulse text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Підготовка карти
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Центруємо на вашому господарстві…
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-700 ease-out",
            viewSettled ? "opacity-100" : "opacity-0"
          )}
        >
          <MapboxMap
          ref={mapRef}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
          initialViewState={{
            longitude: FARM_DEFAULT_CENTER[0],
            latitude: FARM_DEFAULT_CENTER[1],
            zoom: 11,
            pitch: 0,
          }}
          attributionControl={false}
          onLoad={() => setMapReady(true)}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="bottom-right" showCompass showZoom />

          <Source id="fleet-geofences" type="geojson" data={geofences}>
            <Layer
              id="fleet-geofences-fill"
              type="fill"
              paint={{
                "fill-color": ["coalesce", ["get", "color"], "#276749"],
                "fill-opacity": showTrack ? 0.12 : 0.22,
              }}
            />
            <Layer
              id="fleet-geofences-outline"
              type="line"
              paint={{
                "line-color": ["coalesce", ["get", "color"], "#276749"],
                "line-width": 2,
                "line-opacity": showTrack ? 0.55 : 0.85,
              }}
            />
          </Source>

          {hasTrackLine ? (
            <Source id="equipment-selected-track" type="geojson" data={track}>
              <Layer
                id="equipment-selected-track-glow"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#f59e0b",
                  "line-width": 8,
                  "line-opacity": 0.28,
                  "line-blur": 4,
                }}
              />
              <Layer
                id="equipment-selected-track-line"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#fbbf24",
                  "line-width": 3.5,
                  "line-opacity": 0.92,
                }}
              />
            </Source>
          ) : null}

          {playedLineFeature ? (
            <Source id="equipment-selected-track-played" type="geojson" data={playedLineFeature}>
              <Layer
                id="equipment-selected-track-played-glow"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#10b981",
                  "line-width": 10,
                  "line-opacity": 0.35,
                  "line-blur": 3,
                }}
              />
              <Layer
                id="equipment-selected-track-played-line"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#34d399",
                  "line-width": 4,
                  "line-opacity": 1,
                }}
              />
            </Source>
          ) : null}

          {positionedUnits.map((unit) => {
            if (!unit.pos) return null;
            const selected = unit.id === selectedUnitId;
            const listHovered = unit.id === listHoveredUnitId;
            const hasOp = Boolean(unit.activeOp);
            const Icon = vehicleIcon(unit.nm);
            const speed = Number(unit.pos.s ?? 0);
            const moving = Number.isFinite(speed) && speed > 0;
            const hideLiveMarker =
              selected && showPlaybackMarker;
            const dimOthers =
              listHoveredUnitId != null && !listHovered && !selected;

            if (hideLiveMarker) return null;

            return (
              <Marker
                key={unit.id}
                longitude={unit.pos.x}
                latitude={unit.pos.y}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  onUnitClick?.(unit);
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "group/marker relative flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-lg transition-all duration-300 hover:scale-110",
                    selected
                      ? "border-white bg-emerald-600 text-white ring-4 ring-emerald-400/40"
                      : listHovered
                        ? "scale-125 border-white bg-emerald-600 text-white ring-4 ring-emerald-400/50"
                        : hasOp
                          ? "border-emerald-300 bg-emerald-700/95 text-white"
                          : moving
                            ? "border-white/90 bg-green-600/95 text-white"
                            : "border-white/80 bg-zinc-800/90 text-white",
                    dimOthers && "opacity-35 scale-90"
                  )}
                  aria-label={unit.nm}
                  onMouseEnter={() => setHoveredUnitId(unit.id)}
                  onMouseLeave={() => setHoveredUnitId(null)}
                >
                  {hoveredUnitId === unit.id || listHovered ? (
                    <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 max-w-[220px] -translate-x-1/2 truncate rounded-md bg-black/80 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm shadow-lg">
                      {unit.nm}
                    </span>
                  ) : null}
                  {hasOp ? (
                    <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-300 ring-2 ring-white animate-pulse" />
                  ) : null}
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </Marker>
            );
          })}

          {showPlaybackMarker && playbackPosition && selectedUnit ? (
            <Marker
              longitude={playbackPosition[0]!}
              latitude={playbackPosition[1]!}
              anchor="center"
            >
              {(() => {
                const PlaybackIcon = vehicleIcon(selectedUnit.nm);
                return (
                  <div
                    className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white shadow-xl ring-4 ring-emerald-400/35"
                    style={{
                      transform: `rotate(${playbackOrientation.rotation}deg) scaleX(${playbackOrientation.scaleX})`,
                    }}
                  >
                    <PlaybackIcon className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                );
              })()}
            </Marker>
          ) : null}
        </MapboxMap>
        </div>
      </div>
    );
  }
);

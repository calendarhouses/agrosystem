"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  Polygon,
} from "geojson";
import { Focus, Landmark, Map as MapIcon, Pentagon, Save, Search, Tractor, X } from "lucide-react";
import Map, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type {
  MapMouseEvent,
  MapRef,
  ViewStateChangeEvent,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { VehicleMapPopup } from "@/components/dashboard/vehicle-map-popup";
import { Input } from "@/components/ui/input";
import {
  FIELDS_GEOJSON,
  UKRAINE_MAX_BOUNDS,
} from "@/lib/fields-geojson";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import {
  boundsFromGeometry,
  centerFromBounds,
  mergeBounds,
  type LngLatBoundsTuple,
} from "@/lib/geo-area";
import type {
  WialonGeofenceProperties,
  WialonUnit,
} from "@/lib/wialon";
import { DEFAULT_WEATHER_LOCATION } from "@/lib/weather";
import { useSeasonStore } from "@/lib/season-store";
import {
  CommandCenterMapBootOverlay,
  COMMAND_CENTER_MAP_CANVAS_BG,
} from "@/components/dashboard/command-center-map-boot";
import {
  COMMAND_CENTER_DETAIL_FLOAT_INSET_CLASS,
  commandCenterFitPadding,
} from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

export type MapViewMode = "standard" | "economics";

const ECONOMICS_LAYER = {
  id: "economics" as const,
  label: "Бюджет",
  icon: Landmark,
};

const FLOAT_BAR_CLASS =
  "flex items-center gap-1 rounded-2xl border border-border bg-background/70 p-1.5 shadow-lg backdrop-blur-xl";

function MapToolButton({
  active,
  disabled,
  title,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-foreground/80 transition-all md:h-10 md:min-w-10",
        "hover:bg-foreground/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        className
      )}
    >
      {children}
    </button>
  );
}

function MapBarDivider() {
  return <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />;
}

const BUDGET_COLOR_GREEN = "#22c55e";
const BUDGET_COLOR_YELLOW = "#eab308";
const BUDGET_COLOR_RED = "#ef4444";
const BUDGET_COLOR_NEUTRAL = "#94a3b8";

const FIELD_FILL_LAYER_IDS = [
  "fields-fill",
  "saved-fields-fill",
  "wialon-geofences-fill",
] as const;

const FIELD_LINE_LAYER_IDS = [
  "fields-outline",
  "saved-fields-outline",
  "wialon-geofences-outline",
] as const;

/** Колір burn rate — однакова логіка для fill і outline в режимі «Бюджет». */
function budgetBurnColorExpression(): mapboxgl.Expression {
  const pct = ["to-number", ["get", "budgetPct"]] as mapboxgl.Expression;
  return [
    "case",
    [
      "any",
      ["!", ["has", "budgetPct"]],
      ["==", ["get", "budgetPct"], null],
    ],
    BUDGET_COLOR_NEUTRAL,
    [">", pct, 100],
    BUDGET_COLOR_RED,
    [">=", pct, 70],
    BUDGET_COLOR_YELLOW,
    BUDGET_COLOR_GREEN,
  ] as mapboxgl.Expression;
}

function passportColorExpression(): mapboxgl.Expression {
  return ["coalesce", ["get", "color"], "#276749"] as mapboxgl.Expression;
}

type DrawTool = "draw" | "edit";

const EMPTY_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_GEOFENCES: FeatureCollection<Polygon, WialonGeofenceProperties> = {
  type: "FeatureCollection",
  features: [],
};

/** Відсіює відсутні / нульові / відʼємні координати */
function hasValidWialonPosition(
  unit: WialonUnit
): unit is WialonUnit & { pos: NonNullable<WialonUnit["pos"]> } {
  const pos = unit.pos;
  if (!pos) return false;
  return (
    Number.isFinite(pos.x) &&
    Number.isFinite(pos.y) &&
    pos.x > 0 &&
    pos.y > 0
  );
}

const MARKER_LERP_MS = 1400;

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Окремий маркер з плавною інтерполяцією координат між поллінгами */
const LiveTractorMarker = memo(function LiveTractorMarker({
  unit,
  selected,
  tractorScale,
  zoom,
  onSelect,
}: {
  unit: WialonUnit & { pos: NonNullable<WialonUnit["pos"]> };
  selected: boolean;
  tractorScale: number;
  zoom: number;
  onSelect: (unit: WialonUnit) => void;
}) {
  const targetLng = unit.pos.x;
  const targetLat = unit.pos.y;
  const [lng, setLng] = useState(targetLng);
  const [lat, setLat] = useState(targetLat);
  const displayRef = useRef({ lng: targetLng, lat: targetLat });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = { ...displayRef.current };
    const to = { lng: targetLng, lat: targetLat };
    const dist =
      Math.hypot(to.lng - from.lng, to.lat - from.lat) * 111_000; // ~м
    // Стрибок далеко (телепорт / перший показ) — без анімації
    if (dist > 800) {
      displayRef.current = to;
      setLng(to.lng);
      setLat(to.lat);
      return;
    }
    if (dist < 0.3) {
      displayRef.current = to;
      setLng(to.lng);
      setLat(to.lat);
      return;
    }

    const start = performance.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MARKER_LERP_MS);
      const e = easeInOutQuad(t);
      const nextLng = from.lng + (to.lng - from.lng) * e;
      const nextLat = from.lat + (to.lat - from.lat) * e;
      displayRef.current = { lng: nextLng, lat: nextLat };
      setLng(nextLng);
      setLat(nextLat);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [targetLng, targetLat]);

  const moving = (unit.pos.s ?? 0) > 0;

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      anchor="center"
      style={{ cursor: "pointer", zIndex: selected ? 3 : 2 }}
      onClick={(event) => {
        event.originalEvent.stopPropagation();
        onSelect(unit);
      }}
    >
      <div
        className="relative h-12 w-12 origin-center transition-transform duration-150"
        style={{
          transform: `scale(${tractorScale * (selected ? 1.12 : 1)})`,
          opacity: zoom < 8 ? Math.max(0.35, zoom - 7) : 1,
        }}
        title={`GPS · ${unit.nm}`}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(unit);
          }
        }}
      >
        <span
          className={cn(
            "absolute inset-0 animate-ping rounded-full",
            moving ? "bg-emerald-500/50" : "bg-zinc-400/40"
          )}
        />
        <div
          className={cn(
            "relative z-10 flex h-full w-full items-center justify-center rounded-full border bg-white shadow-md",
            selected
              ? "border-[#276749] ring-2 ring-[#276749]/30"
              : "border-[#E5DFD3]"
          )}
        >
          <Tractor
            className="h-5 w-5 text-[#276749]"
            strokeWidth={2.25}
          />
        </div>
        <span
          className={cn(
            "absolute top-0.5 right-0.5 z-20 h-2.5 w-2.5 rounded-full border-2 border-white",
            moving ? "bg-[#276749]" : "bg-zinc-400"
          )}
        />
      </div>
    </Marker>
  );
});

export type FieldHoverInfo = {
  id: string;
  name: string;
  crop: string;
  areaHa: number | null;
  budgetPct: number | null;
  color: string;
  x: number;
  y: number;
};

type FitPadding =
  | number
  | { top: number; bottom: number; left: number; right: number };

export type FieldsMapHandle = {
  getDrawnFeatures: () => FeatureCollection;
  getFeatureForSave: () => Feature<Geometry> | null;
  removeDrawFeature: (featureId: string | number) => void;
  clearDraw: () => void;
  focusBounds: (
    bounds: LngLatBoundsTuple,
    options?: { padding?: FitPadding; maxZoom?: number; duration?: number }
  ) => void;
  focusGeometry: (geometry: Geometry) => void;
  /** Фокус для інспектора. chromeOverride — коли панель ще не встигла перерендеритись */
  focusFieldForInspector: (
    geometry: Geometry,
    chromeOverride?: "list" | "detail"
  ) => void;
  /** Плавний превʼю з hover списку — ближче, довша анімація */
  previewFieldFocus: (geometry: Geometry) => void;
  fitAllFields: () => void;
  flyTo: (longitude: number, latitude: number, zoom?: number) => void;
  loadPolygonIntoDraw: (feature: Feature<Geometry>) => string | null;
  startDrawMode: () => void;
  startEditMode: () => void;
};

type MapBootView = {
  longitude: number;
  latitude: number;
  zoom: number;
};

type FieldsMapProps = {
  className?: string;
  onFieldClick?: (fieldId: string) => void;
  onDrawnFeaturesChange?: (features: FeatureCollection) => void;
  savedFieldsGeoJson?: FeatureCollection;
  wialonUnits?: WialonUnit[];
  wialonGeofences?: FeatureCollection<Polygon, WialonGeofenceProperties>;
  /** Поки true — карта не монтується (чекаємо Wialon) */
  wialonLoading?: boolean;
  /** id поля, яке зараз редагується в Draw — ховаємо зі saved шару */
  editingFieldId?: string | null;
  selectedFieldId?: string | null;
  /** Підсвітка з списку полів (hover) — затемнює решту карти */
  hoveredFieldId?: string | null;
  /** Режим редагування контуру — без Малювати/Редагувати */
  geometryEditMode?: boolean;
  /** Кнопки «Зберегти» / «Скасувати» під час малювання або редагування */
  drawSave?: {
    visible: boolean;
    label: string;
    disabled?: boolean;
    cancelVisible?: boolean;
    onSave: () => void;
    onCancel?: () => void;
  };
  /** Чи відкрита бокова панель поля (ховає попап трактора тощо) */
  overlayActive?: boolean;
  /** Зсув floating chrome під ліву / праву glass-панель */
  chrome?: "list" | "detail";
  onSearchOpenChange?: (open: boolean) => void;
  onRequestDeleteSelection?: () => void;
  onEscape?: () => void;
};

/** Стартовий кадр над усіма джерелами полів (Wialon + збережені + демо) */
function bootViewFromFieldSources(
  wialonGeofences: FeatureCollection<Polygon, WialonGeofenceProperties>,
  savedFieldsGeoJson: FeatureCollection | undefined,
  includeDemo: boolean
): MapBootView {
  const wialonBounds = wialonGeofences.features.map((feature) =>
    boundsFromGeometry(feature.geometry)
  );
  const demoBounds = includeDemo
    ? FIELDS_GEOJSON.features.map((feature) =>
        boundsFromGeometry(feature.geometry)
      )
    : [];
  const savedBounds = (savedFieldsGeoJson?.features ?? []).map((feature) =>
    boundsFromGeometry(feature.geometry)
  );
  const merged = mergeBounds([
    ...wialonBounds,
    ...demoBounds,
    ...savedBounds,
  ]);

  if (!merged) {
    return {
      longitude: DEFAULT_WEATHER_LOCATION.longitude,
      latitude: DEFAULT_WEATHER_LOCATION.latitude,
      zoom: 11,
    };
  }

  const { longitude, latitude } = centerFromBounds(merged);
  const span = Math.max(merged[2] - merged[0], merged[3] - merged[1]);
  let zoom = 12;
  if (span > 0.8) zoom = 8.5;
  else if (span > 0.4) zoom = 9.5;
  else if (span > 0.2) zoom = 10.5;
  else if (span > 0.08) zoom = 11.5;
  else if (span > 0.03) zoom = 12.5;
  else zoom = 13.5;

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return {
      longitude: DEFAULT_WEATHER_LOCATION.longitude,
      latitude: DEFAULT_WEATHER_LOCATION.latitude,
      zoom: 11,
    };
  }

  return { longitude, latitude, zoom };
}

function collectFieldBounds(
  wialonGeofences: FeatureCollection<Polygon, WialonGeofenceProperties>,
  savedFieldsGeoJson: FeatureCollection | undefined,
  includeDemo: boolean
): LngLatBoundsTuple | null {
  const wialonBounds = wialonGeofences.features.map((feature) =>
    boundsFromGeometry(feature.geometry)
  );
  const demoBounds = includeDemo
    ? FIELDS_GEOJSON.features.map((feature) =>
        boundsFromGeometry(feature.geometry)
      )
    : [];
  const savedBounds = (savedFieldsGeoJson?.features ?? []).map((feature) =>
    boundsFromGeometry(feature.geometry)
  );
  return mergeBounds([...wialonBounds, ...demoBounds, ...savedBounds]);
}

function tractorScaleFromZoom(zoom: number) {
  return Math.max(0.2, zoom / 14);
}

function isDrawAlive(draw: MapboxDraw | null): draw is MapboxDraw {
  if (!draw) return false;
  try {
    draw.getMode();
    return true;
  } catch {
    return false;
  }
}

function paintFillOpacity(focusId: string | null) {
  if (!focusId) return 0.4;
  return [
    "case",
    ["==", ["get", "id"], focusId],
    0.72,
    0.05,
  ] as unknown as number;
}

function paintLineWidth(focusId: string | null) {
  if (!focusId) return 2.5;
  return [
    "case",
    ["==", ["get", "id"], focusId],
    4.5,
    0.8,
  ] as unknown as number;
}

function paintLineOpacity(focusId: string | null) {
  if (!focusId) return 0.95;
  return [
    "case",
    ["==", ["get", "id"], focusId],
    1,
    0.15,
  ] as unknown as number;
}

function paintFillColor(mapViewMode: MapViewMode): mapboxgl.Expression {
  if (mapViewMode === "economics") {
    return budgetBurnColorExpression();
  }
  return passportColorExpression();
}

function paintFillOpacityValue(
  mapViewMode: MapViewMode,
  focusId: string | null
): mapboxgl.Expression | number {
  if (mapViewMode === "economics") {
    if (!focusId) return 0.6;
    return [
      "case",
      ["==", ["get", "id"], focusId],
      0.85,
      0.12,
    ] as unknown as number;
  }
  return paintFillOpacity(focusId);
}

function paintLineColor(mapViewMode: MapViewMode): mapboxgl.Expression {
  if (mapViewMode === "economics") {
    return budgetBurnColorExpression();
  }
  return passportColorExpression();
}

/** Супутникова карта: Draw + преміальний UX */
export const FieldsMap = forwardRef<FieldsMapHandle, FieldsMapProps>(
  function FieldsMap(
    {
      className,
      onFieldClick,
      onDrawnFeaturesChange,
      savedFieldsGeoJson,
      wialonUnits = [],
      wialonGeofences = EMPTY_GEOFENCES,
      wialonLoading = true,
      editingFieldId = null,
      selectedFieldId = null,
      hoveredFieldId = null,
      geometryEditMode = false,
      drawSave,
      overlayActive = false,
      chrome = "list",
      onSearchOpenChange,
      onRequestDeleteSelection,
      onEscape,
    },
    ref
  ) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const drawRef = useRef<MapboxDraw | null>(null);

    const [mapReady, setMapReady] = useState(false);
    const [viewSettled, setViewSettled] = useState(false);
    const [drawReady, setDrawReady] = useState(false);
    const [selectedTractor, setSelectedTractor] = useState<WialonUnit | null>(
      null
    );

    useEffect(() => {
      setSelectedTractor((prev) => {
        if (!prev) return prev;
        const fresh = wialonUnits.find((unit) => unit.id === prev.id);
        return fresh ?? prev;
      });
    }, [wialonUnits]);
    const hasWialonGeofences = wialonGeofences.features.length > 0;

    /** Синхронно з даними — без race зі stale FIELDS_MAP_INITIAL_VIEW (Київ) */
    const mountBootView = useMemo(
      () =>
        bootViewFromFieldSources(
          wialonGeofences,
          savedFieldsGeoJson,
          !hasWialonGeofences
        ),
      [wialonGeofences, savedFieldsGeoJson, hasWialonGeofences]
    );

    const [activeTool, setActiveTool] = useState<DrawTool>("edit");
    const [hasSelection, setHasSelection] = useState(false);
    const [zoom, setZoom] = useState<number>(mountBootView.zoom);
    const [hover, setHover] = useState<FieldHoverInfo | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<GeoSearchResult[]>([]);
    const activeSeason = useSeasonStore((s) => s.activeSeason);
    const [mapViewMode, setMapViewMode] = useState<MapViewMode>("standard");

    useEffect(() => {
      onSearchOpenChange?.(searchOpen);
      return () => onSearchOpenChange?.(false);
    }, [searchOpen, onSearchOpenChange]);

    useEffect(() => {
      if (overlayActive && chrome === "list") setSearchOpen(false);
    }, [overlayActive, chrome]);
    const mapCenterRef = useRef<{ lng: number; lat: number }>({
      lng: mountBootView.longitude,
      lat: mountBootView.latitude,
    });
    const zoomRef = useRef<number>(mountBootView.zoom);

    const onDrawnFeaturesChangeRef = useRef(onDrawnFeaturesChange);
    onDrawnFeaturesChangeRef.current = onDrawnFeaturesChange;
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;
    const onRequestDeleteSelectionRef = useRef(onRequestDeleteSelection);
    onRequestDeleteSelectionRef.current = onRequestDeleteSelection;
    const selectedFieldIdRef = useRef(selectedFieldId);
    selectedFieldIdRef.current = selectedFieldId;

    /** Hover зі списку має пріоритет над кліком — превʼю поля без відкриття sheet */
    const focusFieldId = hoveredFieldId || selectedFieldId;

    const isDrawing = activeTool === "draw";
    const focusMode = isDrawing || geometryEditMode;
    const blockingOverlay = overlayActive;

    const visibleSavedGeoJson: FeatureCollection = {
      type: "FeatureCollection",
      features: (savedFieldsGeoJson?.features ?? []).filter(
        (feature) => feature.properties?.id !== editingFieldId
      ),
    };

    const syncDrawnFeatures = useCallback(() => {
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      onDrawnFeaturesChangeRef.current?.(draw.getAll() as FeatureCollection);
    }, []);

    const focusBounds = useCallback(
      (
        bounds: LngLatBoundsTuple,
        options?: { padding?: FitPadding; maxZoom?: number; duration?: number }
      ) => {
        const mapRefCurrent = mapRef.current;
        if (!mapRefCurrent) return;

        let [west, south, east, north] = bounds;
        if (![west, south, east, north].every(Number.isFinite)) return;

        // Якщо полігон «точки» — розширити мінімально
        if (west === east) {
          west -= 0.002;
          east += 0.002;
        }
        if (south === north) {
          south -= 0.002;
          north += 0.002;
        }

        const duration = options?.duration ?? 850;
        /** easeInOutCubic — м’який розгін/гальмування камери */
        const easing = (t: number) =>
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const camera = {
          padding: options?.padding ?? 80,
          duration,
          maxZoom: options?.maxZoom ?? 16,
          essential: true as const,
          easing,
        };

        try {
          mapRefCurrent.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            camera
          );
        } catch {
          const map = mapRefCurrent.getMap();
          map.easeTo({
            center: [(west + east) / 2, (south + north) / 2],
            zoom: Math.min(options?.maxZoom ?? 14, map.getZoom()),
            duration,
            essential: true,
            easing,
          });
        }
      },
      []
    );

    const focusGeometry = useCallback(
      (geometry: Geometry) => {
        const bounds = boundsFromGeometry(geometry);
        if (bounds) focusBounds(bounds);
      },
      [focusBounds]
    );

    const chromePadding = useCallback((mode: "list" | "detail") => {
      const isDesktop =
        typeof window !== "undefined" ? window.innerWidth >= 768 : true;
      return commandCenterFitPadding(
        isDesktop,
        mode === "detail" ? "right" : "left"
      );
    }, []);

    const focusFieldForInspector = useCallback(
      (geometry: Geometry, chromeOverride?: "list" | "detail") => {
        const bounds = boundsFromGeometry(geometry);
        if (!bounds) return;
        const mode = chromeOverride ?? chrome;
        focusBounds(bounds, {
          padding: chromePadding(mode),
          maxZoom: 14.2,
          duration: 1100,
        });
      },
      [chrome, chromePadding, focusBounds]
    );

    const previewFieldFocus = useCallback(
      (geometry: Geometry) => {
        const bounds = boundsFromGeometry(geometry);
        if (!bounds) return;
        focusBounds(bounds, {
          padding: chromePadding(chrome),
          maxZoom: 15.1,
          duration: 1400,
        });
      },
      [chrome, chromePadding, focusBounds]
    );

    const startDraw = useCallback(() => {
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      setSelectedTractor(null);
      setHover(null);
      setSearchOpen(false);
      setMapViewMode("standard");
      draw.changeMode("draw_polygon");
      setActiveTool("draw");
    }, []);

    const startEdit = useCallback(() => {
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      draw.changeMode("simple_select");
      setActiveTool("edit");
    }, []);

    const deleteSelected = useCallback(() => {
      const draw = drawRef.current;
      if (isDrawAlive(draw) && draw.getSelectedIds().length > 0) {
        draw.trash();
        setHasSelection(false);
        setActiveTool("edit");
        syncDrawnFeatures();
        return;
      }
      if (selectedFieldIdRef.current) {
        onRequestDeleteSelectionRef.current?.();
      }
    }, [syncDrawnFeatures]);

    const fitAllFields = useCallback(() => {
      const wialonBounds = wialonGeofences.features.map((feature) =>
        boundsFromGeometry(feature.geometry)
      );
      const demoBounds = hasWialonGeofences
        ? []
        : FIELDS_GEOJSON.features.map((feature) =>
            boundsFromGeometry(feature.geometry)
          );
      const savedBounds = (savedFieldsGeoJson?.features ?? []).map((feature) =>
        boundsFromGeometry(feature.geometry)
      );
      const merged = mergeBounds([
        ...wialonBounds,
        ...demoBounds,
        ...savedBounds,
      ]);
      if (merged) {
        focusBounds(merged, {
          padding: chromePadding(chrome),
        });
      }
    }, [
      chrome,
      chromePadding,
      focusBounds,
      hasWialonGeofences,
      savedFieldsGeoJson?.features,
      wialonGeofences.features,
    ]);

    const flyTo = useCallback(
      (longitude: number, latitude: number, nextZoom = 14) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [longitude, latitude],
          zoom: nextZoom,
          duration: 1500,
          essential: true,
        });
      },
      []
    );

    // Не монтуємо Map, поки Wialon не відповів; стартуємо вже над полями
    useEffect(() => {
      if (wialonLoading) {
        setViewSettled(false);
        setMapReady(false);
        return;
      }
      setZoom(mountBootView.zoom);
      mapCenterRef.current = {
        lng: mountBootView.longitude,
        lat: mountBootView.latitude,
      };
      zoomRef.current = mountBootView.zoom;
    }, [wialonLoading, mountBootView]);

    useEffect(() => {
      if (wialonLoading || viewSettled || !mapReady) return;
      const fallback = window.setTimeout(() => setViewSettled(true), 3500);
      return () => window.clearTimeout(fallback);
    }, [wialonLoading, viewSettled, mapReady]);

    useEffect(() => {
      if (!searchOpen) return;
      const q = searchQuery.trim();
      if (q.length < 2) {
        setSearchResults([]);
        setSearchError(null);
        setSearchLoading(false);
        return;
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => {
        setSearchLoading(true);
        setSearchError(null);
        searchPlaces(q, controller.signal)
          .then((results) => {
            setSearchResults(results);
            setSearchLoading(false);
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setSearchResults([]);
            setSearchLoading(false);
            setSearchError(
              error instanceof Error ? error.message : "Помилка пошуку"
            );
          });
      }, 320);

      return () => {
        controller.abort();
        window.clearTimeout(timer);
      };
    }, [searchQuery, searchOpen]);

    useImperativeHandle(
      ref,
      () => ({
        getDrawnFeatures() {
          const draw = drawRef.current;
          if (!isDrawAlive(draw)) return EMPTY_COLLECTION;
          return draw.getAll() as FeatureCollection;
        },
        getFeatureForSave() {
          const draw = drawRef.current;
          if (!isDrawAlive(draw)) return null;

          const selected = draw.getSelected();
          if (selected.features.length > 0) {
            return selected.features[0] as Feature<Geometry>;
          }

          const all = draw.getAll() as FeatureCollection;
          const last = all.features[all.features.length - 1];
          return (last as Feature<Geometry> | undefined) ?? null;
        },
        removeDrawFeature(featureId: string | number) {
          const draw = drawRef.current;
          if (!isDrawAlive(draw)) return;
          try {
            draw.delete(String(featureId));
            syncDrawnFeatures();
          } catch {
            // feature уже видалено
          }
        },
        clearDraw() {
          const draw = drawRef.current;
          if (!isDrawAlive(draw)) return;
          try {
            const ids = draw.getAll().features.map((f) => String(f.id));
            if (ids.length) draw.delete(ids);
            syncDrawnFeatures();
          } catch {
            // ignore
          }
        },
        focusBounds,
        focusGeometry,
        focusFieldForInspector,
        previewFieldFocus,
        fitAllFields,
        flyTo,
        loadPolygonIntoDraw(feature: Feature<Geometry>) {
          const draw = drawRef.current;
          if (!isDrawAlive(draw)) return null;
          try {
            draw.deleteAll();
            const ids = draw.add(feature);
            const id = ids[0] ?? null;
            if (id != null) {
              draw.changeMode("direct_select", { featureId: id });
              setActiveTool("edit");
              setHasSelection(true);
            }
            syncDrawnFeatures();
            return id != null ? String(id) : null;
          } catch {
            return null;
          }
        },
        startDrawMode: startDraw,
        startEditMode: startEdit,
      }),
      [
        fitAllFields,
        flyTo,
        focusBounds,
        focusFieldForInspector,
        focusGeometry,
        previewFieldFocus,
        startDraw,
        startEdit,
        syncDrawnFeatures,
      ]
    );

    useEffect(() => {
      if (overlayActive) setSelectedTractor(null);
    }, [overlayActive]);

    // Підлаштувати Mapbox під зміну ширини (згортання сайдбару тощо)
    useEffect(() => {
      if (!mapReady) return;
      const el = mapContainerRef.current;
      const map = mapRef.current?.getMap();
      if (!el || !map) return;

      const resizeMap = () => {
        map.resize();
      };

      const ro = new ResizeObserver(() => {
        resizeMap();
      });
      ro.observe(el);
      window.addEventListener("resize", resizeMap);
      resizeMap();

      return () => {
        ro.disconnect();
        window.removeEventListener("resize", resizeMap);
      };
    }, [mapReady]);

    useEffect(() => {
      if (!mapReady) return;

      const map = mapRef.current?.getMap();
      if (!map) return;

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          point: false,
          line_string: false,
          polygon: false,
          trash: false,
          combine_features: false,
          uncombine_features: false,
        },
        defaultMode: "simple_select",
      });

      map.addControl(draw);
      drawRef.current = draw;
      setDrawReady(true);

      const onCreate = () => {
        setActiveTool("edit");
        setHasSelection(false);
        syncDrawnFeatures();
      };
      const onUpdate = () => {
        syncDrawnFeatures();
      };
      const onDelete = () => {
        setHasSelection(false);
        setActiveTool("edit");
        syncDrawnFeatures();
      };
      const onModeChange = (event: { mode: string }) => {
        setActiveTool(event.mode === "draw_polygon" ? "draw" : "edit");
      };
      const onSelectionChange = (event: { features: object[] }) => {
        setHasSelection(event.features.length > 0);
      };

      map.on("draw.create", onCreate);
      map.on("draw.update", onUpdate);
      map.on("draw.delete", onDelete);
      map.on("draw.modechange", onModeChange);
      map.on("draw.selectionchange", onSelectionChange);

      return () => {
        map.off("draw.create", onCreate);
        map.off("draw.update", onUpdate);
        map.off("draw.delete", onDelete);
        map.off("draw.modechange", onModeChange);
        map.off("draw.selectionchange", onSelectionChange);

        setDrawReady(false);
        drawRef.current = null;

        try {
          if (map.hasControl(draw)) {
            map.removeControl(draw);
          }
        } catch {
          // карта могла вже бути знищена
        }
      };
    }, [mapReady, syncDrawnFeatures]);

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
          return;
        }

        if (event.key === "Escape") {
          if (searchOpen) {
            setSearchOpen(false);
            event.preventDefault();
            return;
          }
          const draw = drawRef.current;
          if (isDrawAlive(draw) && draw.getMode() === "draw_polygon") {
            draw.changeMode("simple_select");
            setActiveTool("edit");
            event.preventDefault();
            return;
          }
          setSelectedTractor(null);
          setHover(null);
          onEscapeRef.current?.();
          return;
        }

        if (
          !geometryEditMode &&
          (event.key === "d" || event.key === "D")
        ) {
          startDraw();
          return;
        }

        if (event.key === "Enter") {
          const draw = drawRef.current;
          if (isDrawAlive(draw) && draw.getMode() === "draw_polygon") {
            draw.changeMode("simple_select");
            setActiveTool("edit");
            syncDrawnFeatures();
            event.preventDefault();
          }
          return;
        }

        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          (hasSelection || selectedFieldIdRef.current)
        ) {
          event.preventDefault();
          deleteSelected();
        }
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [deleteSelected, geometryEditMode, hasSelection, searchOpen, startDraw, syncDrawnFeatures]);

    const handleMapClick = useCallback(
      (event: MapMouseEvent) => {
        if (searchOpen) setSearchOpen(false);
        const draw = drawRef.current;
        const mode = isDrawAlive(draw) ? draw.getMode() : null;

        if (
          mode === "draw_polygon" ||
          mode === "direct_select" ||
          isDrawing
        ) {
          return;
        }

        const feature = event.features?.[0];
        const rawId = feature?.properties?.id ?? feature?.id;
        if (rawId != null && onFieldClick) {
          setSelectedTractor(null);
          onFieldClick(String(rawId));
          return;
        }

        if (selectedTractor) setSelectedTractor(null);
      },
      [isDrawing, onFieldClick, searchOpen, selectedTractor]
    );

    const handleMouseMove = useCallback(
      (event: MapMouseEvent) => {
        if (isDrawing || blockingOverlay || selectedTractor) {
          setHover(null);
          return;
        }

        const feature = event.features?.[0];
        if (!feature?.properties?.id) {
          setHover(null);
          return;
        }

        const areaRaw = feature.properties.areaHa;
        const budgetRaw = feature.properties.budgetPct;
        const budgetPct =
          budgetRaw != null && budgetRaw !== "" && Number.isFinite(Number(budgetRaw))
            ? Number(budgetRaw)
            : null;
        setHover({
          id: String(feature.properties.id),
          name: String(feature.properties.name ?? "Поле"),
          crop: String(feature.properties.crop ?? ""),
          areaHa:
            typeof areaRaw === "number"
              ? areaRaw
              : areaRaw != null
                ? Number(areaRaw)
                : null,
          budgetPct,
          color: String(feature.properties.color ?? "#276749"),
          x: event.point.x,
          y: event.point.y,
        });
      },
      [blockingOverlay, isDrawing, selectedTractor]
    );

    const handleMouseLeave = useCallback(() => {
      setHover(null);
    }, []);

    const handleMove = useCallback((event: ViewStateChangeEvent) => {
      setZoom(event.viewState.zoom);
      zoomRef.current = event.viewState.zoom;
      mapCenterRef.current = {
        lng: event.viewState.longitude,
        lat: event.viewState.latitude,
      };
    }, []);

    const toggleEconomicsLayer = useCallback(() => {
      if (focusMode) return;
      setMapViewMode((prev) => (prev === "economics" ? "standard" : "economics"));
    }, [focusMode]);

    /** Mapbox інколи не перемальовує fill-color при зміні mode — синхронізуємо вручну. */
    useEffect(() => {
      const map = mapRef.current?.getMap();
      if (!map || !mapReady) return;

      const fillColor = paintFillColor(mapViewMode);
      const fillOpacity = paintFillOpacityValue(mapViewMode, focusFieldId);
      const lineColor = paintLineColor(mapViewMode);
      const lineWidth = paintLineWidth(focusFieldId);

      for (const layerId of FIELD_FILL_LAYER_IDS) {
        if (!map.getLayer(layerId)) continue;
        map.setPaintProperty(layerId, "fill-color", fillColor);
        map.setPaintProperty(layerId, "fill-opacity", fillOpacity);
      }

      for (const layerId of FIELD_LINE_LAYER_IDS) {
        if (!map.getLayer(layerId)) continue;
        map.setPaintProperty(layerId, "line-color", lineColor);
        map.setPaintProperty(layerId, "line-width", lineWidth);
        if (layerId === "wialon-geofences-outline") {
          map.setPaintProperty(
            layerId,
            "line-opacity",
            paintLineOpacity(focusFieldId)
          );
        }
      }
    }, [
      mapViewMode,
      mapReady,
      focusFieldId,
      visibleSavedGeoJson,
      wialonGeofences,
    ]);

    if (!token) {
      return (
        <div
          className={cn(
            "flex h-full min-h-[320px] items-center justify-center bg-zinc-900 text-sm text-zinc-400",
            className
          )}
        >
          Додайте NEXT_PUBLIC_MAPBOX_TOKEN у .env.local
        </div>
      );
    }

    const showBootOverlay = wialonLoading || !viewSettled;
    const showTractor = zoom >= 7 && !focusMode;
    const tractorScale = tractorScaleFromZoom(zoom);

    return (
      <div
        ref={mapContainerRef}
        className={cn("relative h-full min-h-0 w-full bg-zinc-950", className)}
      >
        {!wialonLoading ? (
        <>
        <div className="absolute inset-0 overflow-hidden bg-zinc-950">
          <Map
            ref={mapRef}
            mapboxAccessToken={token}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            initialViewState={mountBootView}
            maxBounds={UKRAINE_MAX_BOUNDS}
            dragRotate={false}
            pitchWithRotate={false}
            touchPitch={false}
            attributionControl={false}
            interactiveLayerIds={
              isDrawing
                ? undefined
                : [
                    "wialon-geofences-fill",
                    "fields-fill",
                    "saved-fields-fill",
                  ]
            }
            onClick={handleMapClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMove={handleMove}
            onLoad={() => {
              setMapReady(true);
              const map = mapRef.current?.getMap();
              if (!map) {
                setViewSettled(true);
                return;
              }
              map.getCanvas().style.backgroundColor =
                COMMAND_CENTER_MAP_CANVAS_BG;
              map.getCanvasContainer().style.backgroundColor =
                COMMAND_CENTER_MAP_CANVAS_BG;

              const merged = collectFieldBounds(
                wialonGeofences,
                savedFieldsGeoJson,
                !hasWialonGeofences
              );
              if (merged) {
                const [west, south, east, north] = merged;
                const isDesktop =
                  typeof window !== "undefined"
                    ? window.innerWidth >= 768
                    : true;
                try {
                  map.fitBounds(
                    [
                      [west, south],
                      [east, north],
                    ],
                    {
                      padding: commandCenterFitPadding(isDesktop, "left"),
                      duration: 0,
                      maxZoom: 14,
                      essential: true,
                    }
                  );
                } catch {
                  // ignore invalid bounds
                }
              }

              map.once("idle", () => setViewSettled(true));
            }}
            style={{
              width: "100%",
              height: "100%",
              background: COMMAND_CENTER_MAP_CANVAS_BG,
            }}
            cursor={
              isDrawing
                ? "crosshair"
                : hover
                  ? "pointer"
                  : onFieldClick
                    ? "pointer"
                    : undefined
            }
          >
            <Source
              id="fields"
              type="geojson"
              data={hasWialonGeofences ? EMPTY_COLLECTION : FIELDS_GEOJSON}
            >
              <Layer
                id="fields-fill"
                type="fill"
                paint={{
                  "fill-color": paintFillColor(mapViewMode),
                  "fill-opacity": paintFillOpacityValue(
                    mapViewMode,
                    focusFieldId
                  ),
                  "fill-opacity-transition": { duration: 380, delay: 0 },
                }}
              />
              <Layer
                id="fields-outline"
                type="line"
                paint={{
                  "line-color": paintLineColor(mapViewMode),
                  "line-width": paintLineWidth(focusFieldId),
                  "line-width-transition": { duration: 380, delay: 0 },
                }}
              />
            </Source>

            <Source id="saved-fields" type="geojson" data={visibleSavedGeoJson}>
              <Layer
                id="saved-fields-fill"
                type="fill"
                paint={{
                  "fill-color": paintFillColor(mapViewMode),
                  "fill-opacity": paintFillOpacityValue(
                    mapViewMode,
                    focusFieldId
                  ),
                  "fill-opacity-transition": { duration: 380, delay: 0 },
                }}
              />
              <Layer
                id="saved-fields-outline"
                type="line"
                paint={{
                  "line-color": paintLineColor(mapViewMode),
                  "line-width": paintLineWidth(focusFieldId),
                  "line-width-transition": { duration: 380, delay: 0 },
                }}
              />
            </Source>

            {/* Затемнення карти при фокусі поля (клік або hover зі списку) */}
            {focusFieldId ? (
              <Source
                id="field-focus-dim"
                type="geojson"
                data={{
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "Polygon",
                    coordinates: [
                      [
                        [-180, -85],
                        [180, -85],
                        [180, 85],
                        [-180, 85],
                        [-180, -85],
                      ],
                    ],
                  },
                }}
              >
                <Layer
                  id="field-focus-dim-fill"
                  type="fill"
                  beforeId="fields-fill"
                  paint={{
                    "fill-color": "#0a0f14",
                    "fill-opacity": hoveredFieldId ? 0.38 : 0.42,
                    "fill-opacity-transition": { duration: 420, delay: 0 },
                  }}
                />
              </Source>
            ) : null}

            {/* Wialon geofences — під погодою і під маркерами техніки */}
            <Source
              id="wialon-geofences"
              type="geojson"
              data={wialonGeofences}
            >
              <Layer
                id="wialon-geofences-fill"
                type="fill"
                beforeId="fields-fill"
                paint={{
                  "fill-color": paintFillColor(mapViewMode),
                  "fill-opacity": paintFillOpacityValue(
                    mapViewMode,
                    focusFieldId
                  ),
                  "fill-opacity-transition": { duration: 380, delay: 0 },
                }}
              />
              <Layer
                id="wialon-geofences-outline"
                type="line"
                beforeId="fields-fill"
                paint={{
                  "line-color": paintLineColor(mapViewMode),
                  "line-width": paintLineWidth(focusFieldId),
                  "line-opacity": paintLineOpacity(focusFieldId),
                  "line-width-transition": { duration: 380, delay: 0 },
                  "line-opacity-transition": { duration: 380, delay: 0 },
                }}
              />
            </Source>

            {showTractor
              ? wialonUnits.filter(hasValidWialonPosition).map((unit) => (
                  <LiveTractorMarker
                    key={unit.id}
                    unit={unit}
                    selected={selectedTractor?.id === unit.id}
                    tractorScale={tractorScale}
                    zoom={zoom}
                    onSelect={(next) => {
                      setSelectedTractor(next);
                      setHover(null);
                    }}
                  />
                ))
              : null}
          </Map>
        </div>

        {searchOpen ? (
          <div
            className="absolute inset-x-3 z-50 md:left-auto md:right-3 md:w-[min(calc(100vw-2rem),340px)]"
            style={{ top: "calc(var(--safe-top) + 0.5rem)" }}
          >
            <div className="rounded-2xl border border-border bg-background/92 p-3 shadow-lg backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  enterKeyHint="search"
                  inputMode="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Адреса або 50.45, 30.52"
                  className="h-11 rounded-xl border-border bg-background/60 text-base md:h-10 md:text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground/8 text-foreground md:h-10 md:w-10"
                  aria-label="Закрити пошук"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Населений пункт або координати lat, lng
              </p>
              {searchLoading ? (
                <p className="mt-3 text-xs text-muted-foreground">Шукаємо…</p>
              ) : null}
              {searchError ? (
                <p className="mt-3 text-xs text-destructive">{searchError}</p>
              ) : null}
              {searchResults.length > 0 ? (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-none">
                  {searchResults.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => {
                          flyTo(result.longitude, result.latitude, 13.8);
                          setSearchOpen(false);
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-foreground/5"
                      >
                        {result.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {!(overlayActive && chrome === "list") ? (
        <div
          className={cn(
            "absolute z-40 flex flex-col items-end gap-2",
            chrome === "detail"
              ? cn(
                  "top-[calc(var(--safe-top)+4.75rem)] right-3 md:top-auto md:bottom-3",
                  COMMAND_CENTER_DETAIL_FLOAT_INSET_CLASS
                )
              : "right-3 bottom-[3.85rem] md:bottom-3"
          )}
        >
          <div
            className={FLOAT_BAR_CLASS}
            role="toolbar"
            aria-label="Інструменти карти"
          >
            <MapToolButton
              active={searchOpen}
              title="Пошук"
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Search className="h-[18px] w-[18px]" />
            </MapToolButton>
            {!geometryEditMode ? (
              <MapToolButton
                active={isDrawing}
                disabled={!drawReady}
                title="Малювати (D)"
                onClick={startDraw}
              >
                <Pentagon className="h-[18px] w-[18px]" />
              </MapToolButton>
            ) : null}
            {drawSave?.visible ? (
              <>
                <MapBarDivider />
                {drawSave.cancelVisible ? (
                  <MapToolButton
                    title="Скасувати"
                    onClick={drawSave.onCancel}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-[18px] w-[18px]" />
                  </MapToolButton>
                ) : null}
                <button
                  type="button"
                  disabled={drawSave.disabled}
                  title={drawSave.label}
                  onClick={drawSave.onSave}
                  className={cn(
                    "inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all md:h-10",
                    "hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                >
                  <Save className="h-4 w-4 shrink-0" />
                  <span className="max-sm:sr-only sm:inline">{drawSave.label}</span>
                </button>
              </>
            ) : null}
            {!focusMode ? (
              <>
                <MapBarDivider />
                <MapToolButton title="Усі поля" onClick={fitAllFields}>
                  <Focus className="h-[18px] w-[18px]" />
                </MapToolButton>
                <MapToolButton
                  active={mapViewMode === ECONOMICS_LAYER.id}
                  title={ECONOMICS_LAYER.label}
                  onClick={toggleEconomicsLayer}
                >
                  <ECONOMICS_LAYER.icon className="h-[18px] w-[18px]" />
                </MapToolButton>
              </>
            ) : null}
          </div>
        </div>
        ) : null}

        {isDrawing ? (
          <div
            className={cn(
              "pointer-events-none absolute z-50 flex justify-center px-4",
              "top-[max(1rem,var(--safe-top))]",
              chrome === "detail"
                ? "inset-x-0 md:right-[calc(0.75rem+min(580px,calc(100%-1.5rem)))]"
                : "inset-x-0 md:left-[calc(0.75rem+min(400px,calc(100%-1.5rem)))]"
            )}
          >
            <div className="max-w-lg rounded-2xl border border-border bg-background/80 px-4 py-2.5 text-center text-sm font-medium text-foreground shadow-lg backdrop-blur-xl">
              Клікайте по карті для створення контуру. Натисніть Enter для
              завершення
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                <span className="md:hidden">
                  Замкніть полігон тапом на першу точку
                </span>
                <span className="hidden md:inline">
                  Esc — скасувати · замкніть полігон кліком на першу точку
                </span>
              </span>
            </div>
          </div>
        ) : null}

        {mapViewMode === "economics" &&
        !focusMode &&
        !searchOpen &&
        !(overlayActive && chrome === "list") ? (
          <div
            className={cn(
              "pointer-events-auto absolute z-30",
              "top-[calc(var(--safe-top)+0.55rem)] left-3",
              "md:top-auto md:bottom-[5.25rem]",
              chrome === "detail"
                ? COMMAND_CENTER_DETAIL_FLOAT_INSET_CLASS
                : "md:left-[calc(0.75rem+min(400px,calc(100%-1.5rem))+12px)]"
            )}
          >
            <div className="flex max-w-[min(100%,calc(100vw-9.5rem))] items-center gap-2 overflow-x-auto rounded-full border border-[#E5DFD3]/90 bg-[#F4F1EA]/92 px-2.5 py-1.5 shadow-lg backdrop-blur-xl md:max-w-md md:flex-col md:items-stretch md:gap-2 md:rounded-2xl md:px-3 md:py-2.5">
              <p className="hidden text-[11px] font-bold text-zinc-800 md:block">
                Витрати від бюджету · {activeSeason}
              </p>
              <ul className="flex items-center gap-2.5 md:grid md:grid-cols-2 md:gap-1.5">
                {(
                  [
                    {
                      color: BUDGET_COLOR_GREEN,
                      short: "<70%",
                      label: "У нормі",
                    },
                    {
                      color: BUDGET_COLOR_YELLOW,
                      short: "70–100%",
                      label: "Близько",
                    },
                    {
                      color: BUDGET_COLOR_RED,
                      short: ">100%",
                      label: "Понад",
                    },
                    {
                      color: BUDGET_COLOR_NEUTRAL,
                      short: "—",
                      label: "Немає",
                    },
                  ] as const
                ).map((item) => (
                  <li
                    key={item.short}
                    className="flex shrink-0 items-center gap-1.5 md:rounded-xl md:bg-white/80 md:px-2 md:py-1.5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/10"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[10px] font-semibold tabular-nums text-zinc-700 md:hidden">
                      {item.short}
                    </span>
                    <span className="hidden text-[11px] font-semibold text-zinc-800 md:inline">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {hover && !blockingOverlay && !selectedTractor ? (
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[120%] rounded-lg border border-[#E5DFD3] bg-[#F4F1EA]/95 px-3 py-2 shadow-lg backdrop-blur-sm"
            style={{ left: hover.x, top: hover.y }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: hover.color }}
              />
              <p className="text-xs font-bold text-zinc-900">
                {hover.name}
                {hover.crop ? `: ${hover.crop}` : ""}
              </p>
            </div>
            {hover.areaHa != null && Number.isFinite(hover.areaHa) ? (
              <p className="mt-0.5 pl-4 text-[11px] tabular-nums text-zinc-500">
                {hover.areaHa} га
              </p>
            ) : null}
            {mapViewMode === "economics" ? (
              <p className="mt-0.5 pl-4 text-[11px] font-medium text-zinc-700">
                {hover.budgetPct != null
                  ? `Витрачено ${Math.round(hover.budgetPct)}% бюджету`
                  : "Бюджет не задано"}
              </p>
            ) : null}
          </div>
        ) : null}

        {selectedTractor && !blockingOverlay ? (
          <VehicleMapPopup
            unit={selectedTractor}
            onClose={() => setSelectedTractor(null)}
          />
        ) : null}
        </>
        ) : null}
        <CommandCenterMapBootOverlay
          visible={showBootOverlay}
          icon={MapIcon}
          subtitle="Синхронізуємо геозони господарства…"
        />
      </div>
    );
  }
);

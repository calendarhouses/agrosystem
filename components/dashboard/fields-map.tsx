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
import { createPortal } from "react-dom";
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
import {
  FIELDS_GEOJSON,
  UKRAINE_MAX_BOUNDS,
} from "@/lib/fields-geojson";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import {
  boundsFromGeometry,
  mergeBounds,
  type LngLatBoundsTuple,
} from "@/lib/geo-area";
import type {
  WialonGeofenceProperties,
  WialonUnit,
} from "@/lib/wialon";
import { FARM_BASE_LOCATION } from "@/lib/farm-base-location";
import { focusMapAroundFarmAnchor } from "@/lib/map-farm-camera";
import { useSeasonStore } from "@/lib/season-store";
import {
  CommandCenterMapBootOverlay,
  COMMAND_CENTER_MAP_CANVAS_BG,
} from "@/components/dashboard/command-center-map-boot";
import {
  mapCameraPadding,
} from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";
import { useAppBoot } from "@/lib/app-boot";
import { useIsMobile } from "@/lib/use-mobile";

export type MapViewMode = "standard" | "economics";

const FIELD_HIT_LAYERS = [
  "wialon-geofences-fill",
  "fields-fill",
  "saved-fields-fill",
] as const;

const MOBILE_LONG_PRESS_MS = 420;
const MOBILE_TAP_MOVE_THRESHOLD_PX = 22;

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

function fieldFeatureAtPoint(
  map: NonNullable<ReturnType<MapRef["getMap"]>>,
  point: { x: number; y: number }
) {
  try {
    const layers = FIELD_HIT_LAYERS.filter((layerId) => map.getLayer(layerId));
    if (layers.length === 0) return null;
    const features = map.queryRenderedFeatures([point.x, point.y], { layers });
    const feature = features.find((item) => item.properties?.id != null);
    if (!feature?.properties?.id) return null;
    return feature;
  } catch {
    return null;
  }
}

function hoverInfoFromFeature(
  feature: GeoJSON.Feature,
  x: number,
  y: number
): FieldHoverInfo {
  const areaRaw = feature.properties?.areaHa;
  const budgetRaw = feature.properties?.budgetPct;
  const budgetPct =
    budgetRaw != null && budgetRaw !== "" && Number.isFinite(Number(budgetRaw))
      ? Number(budgetRaw)
      : null;

  return {
    id: String(feature.properties?.id),
    name: String(feature.properties?.name ?? "Поле"),
    crop: String(feature.properties?.crop ?? ""),
    areaHa:
      typeof areaRaw === "number"
        ? areaRaw
        : areaRaw != null
          ? Number(areaRaw)
          : null,
    budgetPct,
    color: String(feature.properties?.color ?? "#276749"),
    x,
    y,
  };
}

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
  onMapChromeChange?: (state: {
    searchOpen: boolean;
    drawing: boolean;
    economics: boolean;
  }) => void;
  onRequestDeleteSelection?: () => void;
  onEscape?: () => void;
};

/** Стартовий кадр — Іванівка біля Ставища; zoom підбирає fitBounds */
const IVANIVKA_BOOT_VIEW: MapBootView = {
  longitude: FARM_BASE_LOCATION.longitude,
  latitude: FARM_BASE_LOCATION.latitude,
  zoom: 12.2,
};

function expandBounds(bounds: LngLatBoundsTuple): LngLatBoundsTuple {
  let [west, south, east, north] = bounds;
  if (west === east) {
    west -= 0.002;
    east += 0.002;
  }
  if (south === north) {
    south -= 0.002;
    north += 0.002;
  }
  return [west, south, east, north];
}

/**
 * Мобільна камера: масштаб під поля, центр — база (Іванівка), якщо вона
 * всередині bounds; інакше — геометричний центр полів (захист від «чужої» бази).
 */
function focusFieldsAroundAnchor(
  map: NonNullable<ReturnType<MapRef["getMap"]>>,
  bounds: LngLatBoundsTuple,
  options?: { padding?: FitPadding; maxZoom?: number; duration?: number }
) {
  focusMapAroundFarmAnchor(map, bounds, options);
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
      onMapChromeChange,
      onRequestDeleteSelection,
      onEscape,
    },
    ref
  ) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const { isAppLoading, reportFieldsMapReady } = useAppBoot();
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
    const savedFieldCount = savedFieldsGeoJson?.features?.length ?? 0;
    const showDemoFields =
      !wialonLoading && !hasWialonGeofences && savedFieldCount === 0;

    const mountBootView = IVANIVKA_BOOT_VIEW;

    const [activeTool, setActiveTool] = useState<DrawTool>("edit");
    const [hasSelection, setHasSelection] = useState(false);
    const [zoom, setZoom] = useState<number>(mountBootView.zoom);
    const isMobile = useIsMobile();
    const [hover, setHover] = useState<FieldHoverInfo | null>(null);
    const [touchPreviewFieldId, setTouchPreviewFieldId] = useState<
      string | null
    >(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<GeoSearchResult[]>([]);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const activeSeason = useSeasonStore((s) => s.activeSeason);
    const [mapViewMode, setMapViewMode] = useState<MapViewMode>("standard");

    useEffect(() => {
      onSearchOpenChange?.(searchOpen);
    }, [searchOpen, onSearchOpenChange]);

    useEffect(() => {
      return () => onSearchOpenChange?.(false);
      // лише при unmount карти
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      // Peek-шторка не overlayActive — пошу закриваємо пошук лише для деталей/повного списку
      if (overlayActive) setSearchOpen(false);
    }, [overlayActive]);

    useEffect(() => {
      if (!searchOpen) return;
      const id = window.setTimeout(() => {
        const el = searchInputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
      }, 100);
      return () => window.clearTimeout(id);
    }, [searchOpen]);

    const isDrawing = activeTool === "draw";
    const focusMode = isDrawing || geometryEditMode;

    useEffect(() => {
      onMapChromeChange?.({
        searchOpen,
        drawing: isDrawing,
        economics: mapViewMode === "economics",
      });
      return () =>
        onMapChromeChange?.({
          searchOpen: false,
          drawing: false,
          economics: false,
        });
    }, [searchOpen, isDrawing, mapViewMode, onMapChromeChange]);
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
    const onFieldClickRef = useRef(onFieldClick);
    onFieldClickRef.current = onFieldClick;
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const suppressNextClickRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(
      null
    );

    /** Hover зі списку має пріоритет над кліком — превʼю поля без відкриття sheet */
    const focusFieldId =
      hoveredFieldId || selectedFieldId || touchPreviewFieldId;

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

    const chromePadding = useCallback(
      (mode: "list" | "detail") => {
        const isDesktop =
          typeof window !== "undefined" ? window.innerWidth >= 768 : true;
        return mapCameraPadding(isDesktop, mode === "detail" ? "right" : "left", {
          economicsLegend: mapViewMode === "economics",
        });
      },
      [mapViewMode]
    );

    const focusFieldForInspector = useCallback(
      (geometry: Geometry, chromeOverride?: "list" | "detail") => {
        const bounds = boundsFromGeometry(geometry);
        if (!bounds) return;
        userMapNavigationRef.current = true;
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
        userMapNavigationRef.current = true;
        focusBounds(bounds, {
          padding: chromePadding(chrome),
          maxZoom: 15.1,
          duration: 1400,
        });
      },
      [chrome, chromePadding, focusBounds]
    );

    const cancelDraw = useCallback(() => {
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      try {
        if (draw.getMode() === "draw_polygon") {
          draw.trash();
        }
        draw.changeMode("simple_select");
      } catch {
        // draw уже скинуто
      }
      setActiveTool("edit");
      syncDrawnFeatures();
    }, [syncDrawnFeatures]);

    const toggleDraw = useCallback(() => {
      if (activeTool === "draw") {
        cancelDraw();
        return;
      }
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      setSelectedTractor(null);
      setHover(null);
      setSearchOpen(false);
      setMapViewMode("standard");
      draw.changeMode("draw_polygon");
      setActiveTool("draw");
    }, [activeTool, cancelDraw]);

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

    const userMapNavigationRef = useRef(false);
    const settleAfterCameraRef = useRef<(() => void) | null>(null);

    const markViewSettled = useCallback(() => {
      setViewSettled(true);
    }, []);

    /** Чекаємо кінець камери (moveend) + idle тайлів — інакше прелоадер гасне посеред анімації. */
    const waitForCameraSettle = useCallback(
      (map: NonNullable<ReturnType<MapRef["getMap"]>>, minDelayMs = 280) => {
        settleAfterCameraRef.current?.();
        let done = false;
        let idleHandler: (() => void) | null = null;
        let moveEndHandler: (() => void) | null = null;
        let fallbackTimer = 0;
        let minTimer = 0;

        const finish = () => {
          if (done) return;
          done = true;
          if (idleHandler) map.off("idle", idleHandler);
          if (moveEndHandler) map.off("moveend", moveEndHandler);
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          if (minTimer) window.clearTimeout(minTimer);
          settleAfterCameraRef.current = null;
          markViewSettled();
        };

        settleAfterCameraRef.current = () => {
          done = true;
          if (idleHandler) map.off("idle", idleHandler);
          if (moveEndHandler) map.off("moveend", moveEndHandler);
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          if (minTimer) window.clearTimeout(minTimer);
          settleAfterCameraRef.current = null;
        };

        minTimer = window.setTimeout(() => {
          const armIdle = () => {
            idleHandler = () => finish();
            map.once("idle", idleHandler);
            // Якщо вже idle — все одно дочекаємось наступного кадру
            requestAnimationFrame(() => {
              if (!done && !map.isMoving() && !map.isZooming()) {
                finish();
              }
            });
          };

          if (map.isMoving() || map.isZooming()) {
            moveEndHandler = () => armIdle();
            map.once("moveend", moveEndHandler);
          } else {
            armIdle();
          }
        }, minDelayMs);

        fallbackTimer = window.setTimeout(finish, 4500);
      },
      [markViewSettled]
    );

    const fitAllFields = useCallback(() => {
      userMapNavigationRef.current = false;
      const merged = collectFieldBounds(
        wialonGeofences,
        savedFieldsGeoJson,
        showDemoFields
      );
      if (!merged) return;

      const isDesktop =
        typeof window !== "undefined" ? window.innerWidth >= 768 : true;
      const padding = mapCameraPadding(
        isDesktop,
        chrome === "detail" ? "right" : "left"
      );
      const map = mapRef.current?.getMap();

      if (map) {
        focusFieldsAroundAnchor(map, merged, {
          padding,
          maxZoom: 14,
        });
        waitForCameraSettle(map, 320);
        return;
      }

      focusBounds(merged, { padding });
    }, [
      chrome,
      focusBounds,
      showDemoFields,
      savedFieldsGeoJson,
      wialonGeofences,
      waitForCameraSettle,
    ]);

    const didAutoFitRef = useRef(false);
    useEffect(() => {
      if (!mapReady || wialonLoading || didAutoFitRef.current) return;
      const hasFields =
        wialonGeofences.features.length > 0 ||
        (savedFieldsGeoJson?.features?.length ?? 0) > 0;
      if (!hasFields) return;
      didAutoFitRef.current = true;
      setViewSettled(false);
      const timer = window.setTimeout(() => fitAllFields(), 200);
      return () => window.clearTimeout(timer);
    }, [
      fitAllFields,
      mapReady,
      savedFieldsGeoJson?.features?.length,
      wialonGeofences.features.length,
      wialonLoading,
    ]);

    const fitAllFieldsRef = useRef(fitAllFields);
    fitAllFieldsRef.current = fitAllFields;

    useEffect(() => {
      if (!mapReady || wialonLoading || userMapNavigationRef.current) return;
      const isDesktop =
        typeof window !== "undefined" ? window.innerWidth >= 768 : false;
      // На ПК перемикання шару бюджету не має рухати камеру — лише мобільна легенда зверху.
      if (isDesktop) return;
      const timer = window.setTimeout(() => fitAllFieldsRef.current(), 80);
      return () => window.clearTimeout(timer);
      // лише зміна шару економіки — НЕ chrome/padding (інакше бійка з фокусом поля)
    }, [mapViewMode, mapReady, wialonLoading]);

    useEffect(() => {
      if (!mapReady || wialonLoading) return;
      let timer: number | undefined;
      const refit = () => {
        if (window.innerWidth >= 768) return;
        if (userMapNavigationRef.current) return;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => fitAllFieldsRef.current(), 180);
      };
      window.addEventListener("orientationchange", refit);
      return () => {
        window.removeEventListener("orientationchange", refit);
        window.clearTimeout(timer);
      };
    }, [mapReady, wialonLoading]);

    const flyTo = useCallback(
      (longitude: number, latitude: number, nextZoom = 14) => {
        const map = mapRef.current;
        if (!map) return;
        userMapNavigationRef.current = true;
        map.flyTo({
          center: [longitude, latitude],
          zoom: nextZoom,
          duration: 1500,
          essential: true,
        });
      },
      []
    );

    // Не скидаємо mapReady при повторному завантаженні Wialon — карта лишається інтерактивною.
    useEffect(() => {
      if (wialonLoading) {
        setViewSettled(false);
        settleAfterCameraRef.current?.();
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
      const fallback = window.setTimeout(() => setViewSettled(true), 5000);
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
        startDrawMode: toggleDraw,
        startEditMode: startEdit,
      }),
      [
        fitAllFields,
        flyTo,
        focusBounds,
        focusFieldForInspector,
        focusGeometry,
        previewFieldFocus,
        toggleDraw,
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
            cancelDraw();
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
          toggleDraw();
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
    }, [cancelDraw, deleteSelected, geometryEditMode, hasSelection, searchOpen, toggleDraw, syncDrawnFeatures]);

    const handleMapClick = useCallback(
      (event: MapMouseEvent) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
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
          setHover(null);
          setTouchPreviewFieldId(null);
          onFieldClick(String(rawId));
          return;
        }

        setHover(null);
        setTouchPreviewFieldId(null);
        if (selectedTractor) setSelectedTractor(null);
      },
      [isDrawing, onFieldClick, searchOpen, selectedTractor]
    );

    const handleMouseMove = useCallback(
      (event: MapMouseEvent) => {
        if (isMobile) return;
        if (isDrawing || blockingOverlay || selectedTractor) {
          setHover(null);
          return;
        }

        const feature = event.features?.[0];
        if (!feature?.properties?.id) {
          setHover(null);
          return;
        }

        setHover(
          hoverInfoFromFeature(feature as GeoJSON.Feature, event.point.x, event.point.y)
        );
      },
      [blockingOverlay, isDrawing, isMobile, selectedTractor]
    );

    const handleMouseLeave = useCallback(() => {
      if (isMobile) return;
      setHover(null);
    }, [isMobile]);

    const handleMove = useCallback(
      (event: ViewStateChangeEvent) => {
        setZoom(event.viewState.zoom);
        zoomRef.current = event.viewState.zoom;
        mapCenterRef.current = {
          lng: event.viewState.longitude,
          lat: event.viewState.latitude,
        };
        // Під час жесту карти скидаємо лише превʼю long-press,
        // не чіпаємо longPressTriggered — інакше тап після підсвітки «губиться».
        if (isMobile && !touchStartRef.current) {
          setHover(null);
          setTouchPreviewFieldId(null);
        }
      },
      [isMobile]
    );

    const toggleEconomicsLayer = useCallback(() => {
      if (focusMode) return;
      setMapViewMode((prev) => (prev === "economics" ? "standard" : "economics"));
    }, [focusMode]);

    const isDrawingRef = useRef(isDrawing);
    isDrawingRef.current = isDrawing;
    const blockingOverlayRef = useRef(blockingOverlay);
    blockingOverlayRef.current = blockingOverlay;
    const searchOpenRef = useRef(searchOpen);
    searchOpenRef.current = searchOpen;
    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;

    useEffect(() => {
      if (blockingOverlay) {
        setHover(null);
        setTouchPreviewFieldId(null);
      }
    }, [blockingOverlay]);

    useEffect(() => {
      if (selectedFieldId) {
        setHover(null);
        setTouchPreviewFieldId(null);
      }
    }, [selectedFieldId]);

    const touchPreviewFieldIdRef = useRef<string | null>(null);
    touchPreviewFieldIdRef.current = touchPreviewFieldId;

    useEffect(() => {
      if (!mapReady || !isMobile) return;
      const map = mapRef.current?.getMap();
      if (!map) return;

      const container = map.getContainer();
      let previewClearTimer: number | null = null;

      const clearLongPress = () => {
        if (longPressTimerRef.current) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };

      const clearPreviewDismiss = () => {
        if (previewClearTimer) {
          window.clearTimeout(previewClearTimer);
          previewClearTimer = null;
        }
      };

      const clearFieldPreview = () => {
        clearPreviewDismiss();
        setHover(null);
        setTouchPreviewFieldId(null);
        longPressTriggeredRef.current = false;
      };

      const resetTouchTracking = () => {
        clearLongPress();
        touchStartRef.current = null;
      };

      const touchPoint = (touch: Touch) => {
        const rect = container.getBoundingClientRect();
        return {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      };

      const openFieldAt = (x: number, y: number) => {
        const feature = fieldFeatureAtPoint(map, { x, y });
        const rawId = feature?.properties?.id ?? feature?.id;
        if (rawId == null || !onFieldClickRef.current) return false;
        clearFieldPreview();
        setSelectedTractor(null);
        suppressNextClickRef.current = true;
        onFieldClickRef.current(String(rawId));
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 450);
        return true;
      };

      const onTouchStart = (event: TouchEvent) => {
        if (
          isDrawingRef.current ||
          blockingOverlayRef.current ||
          searchOpenRef.current ||
          event.touches.length !== 1
        ) {
          return;
        }

        const { x, y } = touchPoint(event.touches[0]!);
        touchStartRef.current = { x, y, time: Date.now() };
        longPressTriggeredRef.current = false;
        clearLongPress();
        // Не скидаємо активний тултип на touchstart — лише на tap поза полем / pan

        longPressTimerRef.current = window.setTimeout(() => {
          const feature = fieldFeatureAtPoint(map, { x, y });
          if (!feature) return;
          longPressTriggeredRef.current = true;
          suppressNextClickRef.current = true;
          setTouchPreviewFieldId(String(feature.properties?.id));
          setHover(hoverInfoFromFeature(feature as GeoJSON.Feature, x, y));
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate(12);
          }
          clearPreviewDismiss();
          // Тултип лише поки палець затиснутий — на touchend знімаємо
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 450);
        }, MOBILE_LONG_PRESS_MS);
      };

      const onTouchMove = (event: TouchEvent) => {
        const start = touchStartRef.current;
        if (!start || event.touches.length !== 1) return;
        const { x, y } = touchPoint(event.touches[0]!);
        if (
          Math.hypot(x - start.x, y - start.y) > MOBILE_TAP_MOVE_THRESHOLD_PX
        ) {
          resetTouchTracking();
          // Пан карти — знімаємо long-press підсвітку, знову всі поля
          if (touchPreviewFieldIdRef.current) {
            clearFieldPreview();
          }
        }
      };

      const onTouchEnd = (event: TouchEvent) => {
        const start = touchStartRef.current;
        const wasLongPress = longPressTriggeredRef.current;
        clearLongPress();
        touchStartRef.current = null;

        // Підняли палець після long-press — зняти тултип, знову всі поля.
        // Деталі відкриваються лише наступним окремим тапом.
        if (wasLongPress) {
          clearFieldPreview();
          suppressNextClickRef.current = true;
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 450);
          return;
        }

        if (
          !start ||
          isDrawingRef.current ||
          blockingOverlayRef.current ||
          searchOpenRef.current
        ) {
          return;
        }

        const touch = event.changedTouches[0];
        if (!touch) return;
        const { x, y } = touchPoint(touch);
        const duration = Date.now() - start.time;
        const moved = Math.hypot(x - start.x, y - start.y);
        if (
          duration >= MOBILE_LONG_PRESS_MS ||
          moved > MOBILE_TAP_MOVE_THRESHOLD_PX
        ) {
          return;
        }

        const previewId = touchPreviewFieldIdRef.current;
        const feature = fieldFeatureAtPoint(map, { x, y });
        const rawId =
          feature?.properties?.id != null
            ? String(feature.properties.id)
            : feature?.id != null
              ? String(feature.id)
              : null;

        if (previewId) {
          // Тап по тому ж підсвіченому полі → відкрити деталі
          // (превʼю вже зняте на touchend long-press; цей шлях — якщо лишилось)
          if (rawId === previewId) {
            openFieldAt(x, y);
            return;
          }
          // Тап будь-де інде — зняти тултип і показати всі поля
          clearFieldPreview();
          suppressNextClickRef.current = true;
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 450);
          return;
        }

        if (rawId != null) {
          openFieldAt(x, y);
        }
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: true });
      container.addEventListener("touchend", onTouchEnd, { passive: true });
      container.addEventListener("touchcancel", onTouchEnd, { passive: true });

      return () => {
        resetTouchTracking();
        clearPreviewDismiss();
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        container.removeEventListener("touchcancel", onTouchEnd);
      };
    }, [isMobile, mapReady]);

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

    const showBootOverlay = !mapReady || !viewSettled || wialonLoading;
    // Поки LEVADA на екрані — не показуємо другий (маповий) прелоадер
    const showLocalBootOverlay = Boolean(token) && showBootOverlay && !isAppLoading;

    // ВАЖЛИВО: до будь-якого early return — інакше React «Rendered fewer hooks» і вкладка вмирає
    useEffect(() => {
      if (!token) {
        reportFieldsMapReady();
        return;
      }
      if (!showBootOverlay) {
        reportFieldsMapReady();
      }
    }, [token, showBootOverlay, reportFieldsMapReady]);

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

    const showTractor = zoom >= 7 && !focusMode;
    const tractorScale = tractorScaleFromZoom(zoom);

    return (
      <div
        ref={mapContainerRef}
        className={cn("relative h-full min-h-0 w-full bg-zinc-950", className)}
      >
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

              if (!wialonLoading) {
                const merged = collectFieldBounds(
                  wialonGeofences,
                  savedFieldsGeoJson,
                  showDemoFields
                );
                if (merged) {
                  const isDesktop =
                    typeof window !== "undefined"
                      ? window.innerWidth >= 768
                      : true;
                  const padding = mapCameraPadding(
                    isDesktop,
                    chrome === "detail" ? "right" : "left"
                  );
                  try {
                    focusFieldsAroundAnchor(map, merged, {
                      padding,
                      maxZoom: 14,
                      duration: 0,
                    });
                    waitForCameraSettle(map, 200);
                    return;
                  } catch {
                    // ignore invalid bounds
                  }
                }
              }

              // Полів ще немає / Wialon грузиться — не гасимо прелоадер на першому idle
              if (!wialonLoading) {
                waitForCameraSettle(map, 400);
              }
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
              data={showDemoFields ? FIELDS_GEOJSON : EMPTY_COLLECTION}
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

        {searchOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="pointer-events-auto fixed inset-x-3 z-[220] md:left-auto md:right-3 md:w-[min(calc(100vw-2rem),340px)]"
                style={{ top: "calc(var(--safe-top) + 0.5rem)" }}
                data-vaul-no-drag=""
                role="search"
              >
                <div
                  className="rounded-2xl border border-[#E5DFD3]/90 bg-[#F4F1EA] p-3 shadow-xl"
                >
                  <div className="flex items-center gap-2">
                    <input
                      ref={searchInputRef}
                      type="text"
                      enterKeyHint="search"
                      inputMode="search"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onTouchEnd={(event) => {
                        // iOS: гарантований фокус по тапу в поле
                        event.currentTarget.focus();
                      }}
                      placeholder="Адреса або 50.45, 30.52"
                      className="h-11 min-w-0 flex-1 touch-manipulation rounded-xl border border-[#E5DFD3] bg-white px-3 text-base text-zinc-900 outline-none ring-emerald-700/30 placeholder:text-zinc-400 focus:ring-2 md:h-10 md:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900/8 text-zinc-800 md:h-10 md:w-10"
                      aria-label="Закрити пошук"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Населений пункт або координати lat, lng
                  </p>
                  {searchLoading ? (
                    <p className="mt-3 text-xs text-zinc-500">Шукаємо…</p>
                  ) : null}
                  {searchError ? (
                    <p className="mt-3 text-xs text-amber-800">{searchError}</p>
                  ) : null}
                  {searchResults.length > 0 ? (
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain">
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
                            className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm text-zinc-800 transition-colors hover:bg-white active:bg-white"
                          >
                            {result.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}

        {!overlayActive ? (
        <div
          className={cn(
            "absolute z-40 flex flex-col items-end gap-2",
            "right-3 bottom-[var(--map-float-bottom)] md:bottom-3"
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
                title={isDrawing ? "Скасувати малювання" : "Малювати (D)"}
                onClick={toggleDraw}
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
              "top-[calc(var(--safe-top)+0.75rem)]",
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
        !overlayActive ? (
          <div
            className={cn(
              "pointer-events-auto absolute z-40",
              "top-[env(safe-area-inset-top,0px)] mt-4 left-4 right-4",
              "md:top-auto md:right-3 md:left-auto md:max-w-sm",
              "md:bottom-[calc(0.75rem+3.25rem+0.5rem)]",
              chrome === "detail" && "md:right-[calc(0.75rem+min(580px,calc(100%-1.5rem))+12px)]"
            )}
          >
            <div
              className={cn(
                "rounded-2xl border border-white/50 bg-white/80 p-3 shadow-lg backdrop-blur-md",
                "md:border-[#E5DFD3]/90 md:bg-[#F4F1EA]/95 md:backdrop-blur-xl"
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs font-bold text-zinc-900">
                  Бюджет полів · {activeSeason}
                </p>
                <p className="hidden text-[10px] leading-snug text-zinc-600 md:block">
                  Колір контуру = % витрат від планового бюджету
                </p>
              </div>
              <ul className="mt-2 flex flex-wrap items-center gap-3 text-xs md:mt-2 md:gap-x-3 md:gap-y-1.5">
                {(
                  [
                    {
                      color: BUDGET_COLOR_GREEN,
                      label: "<70% норма",
                    },
                    {
                      color: BUDGET_COLOR_YELLOW,
                      label: "70–100%",
                    },
                    {
                      color: BUDGET_COLOR_RED,
                      label: ">100%",
                    },
                    {
                      color: BUDGET_COLOR_NEUTRAL,
                      label: "немає плану",
                    },
                  ] as const
                ).map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium text-zinc-700">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {hover && !blockingOverlay && !selectedTractor ? (
          <div
            className={cn(
              "pointer-events-none absolute z-30 -translate-x-1/2",
              isMobile
                ? "-translate-y-[calc(100%+16px)]"
                : "-translate-y-[120%]"
            )}
            style={{ left: hover.x, top: hover.y }}
          >
            {isMobile ? (
              <div className="min-w-[9.5rem] max-w-[14rem] rounded-2xl border border-white/15 bg-zinc-950/92 px-3.5 py-2.5 shadow-2xl shadow-black/40 backdrop-blur-md">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/25"
                    style={{ backgroundColor: hover.color }}
                  />
                  <p className="truncate text-[13px] font-semibold leading-tight text-white">
                    {hover.name}
                  </p>
                </div>
                {hover.crop ? (
                  <p className="mt-1 pl-[1.375rem] text-[11px] leading-tight text-zinc-300">
                    {hover.crop}
                  </p>
                ) : null}
                {hover.areaHa != null && Number.isFinite(hover.areaHa) ? (
                  <p className="mt-0.5 pl-[1.375rem] text-[11px] tabular-nums text-zinc-400">
                    {hover.areaHa} га
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-[#E5DFD3] bg-[#F4F1EA]/95 px-3 py-2 shadow-lg backdrop-blur-sm">
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
            )}
          </div>
        ) : null}

        {selectedTractor && !blockingOverlay ? (
          <VehicleMapPopup
            unit={selectedTractor}
            onClose={() => setSelectedTractor(null)}
          />
        ) : null}

        <CommandCenterMapBootOverlay
          visible={showLocalBootOverlay}
          icon={MapIcon}
        />
      </div>
    );
  }
);

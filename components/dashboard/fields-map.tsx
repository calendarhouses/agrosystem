"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import {
  CloudRain,
  Focus,
  Loader2,
  MousePointer2,
  Pause,
  Pentagon,
  Play,
  Search,
  Tractor,
  Wind,
  X,
} from "lucide-react";
import { bbox, center as turfCenter } from "@turf/turf";
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
  FIELDS_MAP_INITIAL_VIEW,
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
import {
  fetchRainViewerFrames,
  fetchRegionalWeatherField,
  formatHourLabel,
  formatUnixLabel,
  hourTimeAtProgress,
  indexClosestRainFrame,
  indexClosestToNow,
  rainTileUrl,
  rainTimeAtProgress,
  timelineFromRegionalWeather,
  windAtLocation,
  type RainViewerFrame,
  type RegionalWeatherField,
  type WeatherHourPoint,
} from "@/lib/weather-layers";
import { cn } from "@/lib/utils";

const RAIN_OPACITY = 0.62;

type DrawTool = "draw" | "edit";
type WeatherMode = "rain" | "wind" | null;

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

export type FieldHoverInfo = {
  id: string;
  name: string;
  crop: string;
  areaHa: number | null;
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
  /** Фокус для інспектора: поле правіше, менше зум, місце під popup зліва */
  focusFieldForInspector: (geometry: Geometry) => void;
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
  /** Режим редагування контуру — без Малювати/Редагувати */
  geometryEditMode?: boolean;
  /** Додаткова кнопка в тулбарі (напр. Зберегти) */
  toolbarAction?: ReactNode;
  /** Чи відкритий інспектор/паспорт (ховає трактор тощо) */
  overlayActive?: boolean;
  inspectorPanel?: ReactNode;
  passportPanel?: ReactNode;
  onRequestDeleteSelection?: () => void;
  onEscape?: () => void;
};

/** Стартовий кадр над усіма геозонами без анімації flyTo */
function bootViewFromGeofences(
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>
): MapBootView {
  if (!geofences.features.length) {
    return { ...FIELDS_MAP_INITIAL_VIEW };
  }

  try {
    const point = turfCenter(geofences);
    const [longitude, latitude] = point.geometry.coordinates;
    const [minX, minY, maxX, maxY] = bbox(geofences);
    const span = Math.max(maxX - minX, maxY - minY);
    let zoom = 12;
    if (span > 0.8) zoom = 8.5;
    else if (span > 0.4) zoom = 9.5;
    else if (span > 0.2) zoom = 10.5;
    else if (span > 0.08) zoom = 11.5;
    else if (span > 0.03) zoom = 12.5;
    else zoom = 13.5;

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(minX)
    ) {
      return { ...FIELDS_MAP_INITIAL_VIEW };
    }

    return { longitude, latitude, zoom };
  } catch {
    return { ...FIELDS_MAP_INITIAL_VIEW };
  }
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

function paintFillOpacity(selectedId: string | null) {
  if (!selectedId) return 0.4;
  return [
    "case",
    ["==", ["get", "id"], selectedId],
    0.62,
    0.07,
  ] as unknown as number;
}

function paintLineWidth(selectedId: string | null) {
  if (!selectedId) return 2.5;
  return [
    "case",
    ["==", ["get", "id"], selectedId],
    4.5,
    1,
  ] as unknown as number;
}

function paintLineOpacity(selectedId: string | null) {
  if (!selectedId) return 0.95;
  return [
    "case",
    ["==", ["get", "id"], selectedId],
    1,
    0.2,
  ] as unknown as number;
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
      geometryEditMode = false,
      toolbarAction,
      overlayActive = false,
      inspectorPanel,
      passportPanel,
      onRequestDeleteSelection,
      onEscape,
    },
    ref
  ) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const drawRef = useRef<MapboxDraw | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [bootView, setBootView] = useState<MapBootView>({
      ...FIELDS_MAP_INITIAL_VIEW,
    });
    const [mapReady, setMapReady] = useState(false);
    const [drawReady, setDrawReady] = useState(false);
    const [selectedTractor, setSelectedTractor] = useState<WialonUnit | null>(
      null
    );
    const hasWialonGeofences = wialonGeofences.features.length > 0;
    const [activeTool, setActiveTool] = useState<DrawTool>("edit");
    const [hasSelection, setHasSelection] = useState(false);
    const [zoom, setZoom] = useState<number>(FIELDS_MAP_INITIAL_VIEW.zoom);
    const [hover, setHover] = useState<FieldHoverInfo | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<GeoSearchResult[]>([]);
    const [weatherMode, setWeatherMode] = useState<WeatherMode>(null);
    const [weatherHours, setWeatherHours] = useState<WeatherHourPoint[]>([]);
    const [playbackT, setPlaybackT] = useState(0);
    const [weatherPlaying, setWeatherPlaying] = useState(true);
    const [weatherLoading, setWeatherLoading] = useState(false);
    const [weatherError, setWeatherError] = useState<string | null>(null);
    const [weatherField, setWeatherField] =
      useState<RegionalWeatherField | null>(null);
    const [rainHost, setRainHost] = useState("https://tilecache.rainviewer.com");
    const [rainFrames, setRainFrames] = useState<RainViewerFrame[]>([]);
    const [rainSlotA, setRainSlotA] = useState<RainViewerFrame | null>(null);
    const [rainSlotB, setRainSlotB] = useState<RainViewerFrame | null>(null);
    const [rainFront, setRainFront] = useState<"a" | "b">("a");
    const weatherCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const weatherParticlesRef = useRef<
      Array<{
        x: number;
        y: number;
        len: number;
        speed: number;
        age: number;
        stationIdx: number;
      }>
    >([]);
    const weatherProgressRef = useRef(0);
    const weatherIndexRef = useRef(0);
    const weatherBlendRef = useRef(0);
    const rainFrontRef = useRef<"a" | "b">("a");
    const rainCommittedRef = useRef(0);
    const rainFramesRef = useRef<RainViewerFrame[]>([]);
    const mapCenterRef = useRef<{ lng: number; lat: number }>({
      lng: FIELDS_MAP_INITIAL_VIEW.longitude,
      lat: FIELDS_MAP_INITIAL_VIEW.latitude,
    });
    const zoomRef = useRef<number>(FIELDS_MAP_INITIAL_VIEW.zoom);

    const onDrawnFeaturesChangeRef = useRef(onDrawnFeaturesChange);
    onDrawnFeaturesChangeRef.current = onDrawnFeaturesChange;
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;
    const onRequestDeleteSelectionRef = useRef(onRequestDeleteSelection);
    onRequestDeleteSelectionRef.current = onRequestDeleteSelection;
    const selectedFieldIdRef = useRef(selectedFieldId);
    selectedFieldIdRef.current = selectedFieldId;

    const isDrawing = activeTool === "draw";
    const blockingOverlay =
      overlayActive || Boolean(passportPanel || inspectorPanel);

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

        const camera = {
          padding: options?.padding ?? 80,
          duration: options?.duration ?? 850,
          maxZoom: options?.maxZoom ?? 16,
          essential: true as const,
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
            duration: options?.duration ?? 700,
            essential: true,
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

    const focusFieldForInspector = useCallback(
      (geometry: Geometry) => {
        const bounds = boundsFromGeometry(geometry);
        if (!bounds) return;
        // Padding під повновисотний попап зліва
        focusBounds(bounds, {
          padding: { top: 48, bottom: 48, left: 440, right: 56 },
          maxZoom: 13.4,
          duration: 1400,
        });
      },
      [focusBounds]
    );

    const startDraw = useCallback(() => {
      const draw = drawRef.current;
      if (!isDrawAlive(draw)) return;
      setSelectedTractor(null);
      setHover(null);
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
      if (merged) focusBounds(merged, { padding: 64 });
    }, [
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
        setIsLoading(true);
        return;
      }

      const nextView = bootViewFromGeofences(wialonGeofences);
      setBootView(nextView);
      setZoom(nextView.zoom);
      setIsLoading(false);
    }, [wialonLoading, wialonGeofences]);

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
        startDraw,
        startEdit,
        syncDrawnFeatures,
      ]
    );

    useEffect(() => {
      if (passportPanel || inspectorPanel) setSelectedTractor(null);
    }, [passportPanel, inspectorPanel]);

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

        if (
          !geometryEditMode &&
          (event.key === "v" || event.key === "V")
        ) {
          startEdit();
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
    }, [deleteSelected, geometryEditMode, hasSelection, searchOpen, startDraw, startEdit]);

    const handleMapClick = useCallback(
      (event: MapMouseEvent) => {
        if (searchOpen) {
          setSearchOpen(false);
        }

        const draw = drawRef.current;
        const mode = isDrawAlive(draw) ? draw.getMode() : null;

        if (
          selectedTractor ||
          mode === "draw_polygon" ||
          mode === "direct_select" ||
          isDrawing
        ) {
          return;
        }

        const feature = event.features?.[0];
        const fieldId = feature?.properties?.id;
        if (fieldId != null && onFieldClick) {
          onFieldClick(String(fieldId));
        }
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

    const toggleWeatherMode = useCallback((mode: Exclude<WeatherMode, null>) => {
      setWeatherMode((prev) => {
        const next = prev === mode ? null : mode;
        if (next) setWeatherPlaying(true);
        return next;
      });
      setSearchOpen(false);
    }, []);

    const weatherLen =
      weatherMode === "rain"
        ? Math.max(0, rainFrames.length - 1)
        : Math.max(0, weatherHours.length - 1);
    const weatherIndex = Math.min(
      weatherLen,
      Math.max(0, Math.floor(playbackT))
    );
    const weatherBlend = Math.max(0, Math.min(1, playbackT - weatherIndex));

    const rainOpacityFront =
      weatherMode === "rain" ? RAIN_OPACITY * (1 - weatherBlend) : 0;
    const rainOpacityBack =
      weatherMode === "rain" ? RAIN_OPACITY * weatherBlend : 0;

    const applyRainOpacities = useCallback(
      (front: "a" | "b", fade: number) => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const opFront = RAIN_OPACITY * (1 - fade);
        const opBack = RAIN_OPACITY * fade;
        try {
          if (map.getLayer("rainviewer-a-layer")) {
            map.setPaintProperty(
              "rainviewer-a-layer",
              "raster-opacity",
              front === "a" ? opFront : opBack
            );
          }
          if (map.getLayer("rainviewer-b-layer")) {
            map.setPaintProperty(
              "rainviewer-b-layer",
              "raster-opacity",
              front === "b" ? opFront : opBack
            );
          }
        } catch {
          // ignore
        }
      },
      []
    );

    const syncRainBuffers = useCallback(
      (progress: number, frames: RainViewerFrame[]) => {
        if (frames.length < 2) return;
        const max = frames.length - 1;
        const p = Math.max(0, Math.min(max, progress));
        const idx = Math.floor(p);
        const fade = p - idx;

        if (idx !== rainCommittedRef.current) {
          const newFront: "a" | "b" =
            rainFrontRef.current === "a" ? "b" : "a";
          rainFrontRef.current = newFront;
          rainCommittedRef.current = idx;
          setRainFront(newFront);
          const nextFrame = frames[Math.min(max, idx + 1)]!;
          if (newFront === "a") setRainSlotB(nextFrame);
          else setRainSlotA(nextFrame);
        }

        weatherIndexRef.current = idx;
        weatherBlendRef.current = fade;
        applyRainOpacities(rainFrontRef.current, fade);
      },
      [applyRainOpacities]
    );

    const seekPlayback = useCallback(
      (next: number) => {
        const length =
          weatherMode === "rain"
            ? Math.max(0, rainFramesRef.current.length - 1)
            : Math.max(0, weatherHours.length - 1);
        const clamped = Math.max(0, Math.min(length, next));
        weatherProgressRef.current = clamped;
        setPlaybackT(clamped);

        if (weatherMode === "rain") {
          const frames = rainFramesRef.current;
          if (!frames.length) return;
          const idx = Math.floor(clamped);
          const fade = clamped - idx;
          rainFrontRef.current = "a";
          rainCommittedRef.current = idx;
          setRainFront("a");
          setRainSlotA(frames[idx]!);
          setRainSlotB(frames[Math.min(frames.length - 1, idx + 1)]!);
          weatherIndexRef.current = idx;
          weatherBlendRef.current = fade;
          requestAnimationFrame(() => applyRainOpacities("a", fade));
        } else {
          weatherIndexRef.current = Math.floor(clamped);
          weatherBlendRef.current = clamped - Math.floor(clamped);
        }
      },
      [weatherMode, weatherHours.length, applyRainOpacities]
    );

    // Live-радар (RainViewer past+nowcast) або регіональний вітер
    useEffect(() => {
      if (!weatherMode) {
        setWeatherHours([]);
        setWeatherField(null);
        setRainFrames([]);
        rainFramesRef.current = [];
        setRainSlotA(null);
        setRainSlotB(null);
        setWeatherError(null);
        setPlaybackT(0);
        return;
      }

      const controller = new AbortController();
      setWeatherLoading(true);
      setWeatherError(null);
      const { lat, lng } = mapCenterRef.current;

      const load = async () => {
        if (weatherMode === "rain") {
          setWeatherField(null);
          setWeatherHours([]);
          const { host, frames } = await fetchRainViewerFrames(
            controller.signal
          );
          setRainHost(host);
          setRainFrames(frames);
          rainFramesRef.current = frames;
          const start = indexClosestRainFrame(frames);
          weatherProgressRef.current = start;
          setPlaybackT(start);
          rainFrontRef.current = "a";
          rainCommittedRef.current = start;
          setRainFront("a");
          setRainSlotA(frames[start] ?? null);
          setRainSlotB(
            frames[Math.min(frames.length - 1, start + 1)] ?? null
          );
          weatherIndexRef.current = start;
          weatherBlendRef.current = 0;
          requestAnimationFrame(() => applyRainOpacities("a", 0));
        } else {
          setRainFrames([]);
          rainFramesRef.current = [];
          setRainSlotA(null);
          setRainSlotB(null);
          const field = await fetchRegionalWeatherField(controller.signal);
          setWeatherField(field);
          const hours = timelineFromRegionalWeather(field, lat, lng);
          setWeatherHours(hours);
          const start = indexClosestToNow(hours);
          weatherProgressRef.current = start;
          setPlaybackT(start);
          weatherIndexRef.current = start;
          weatherBlendRef.current = 0;
        }
        setWeatherLoading(false);
      };

      load().catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeatherLoading(false);
        setWeatherError(
          error instanceof Error ? error.message : "Немає даних погоди"
        );
      });

      return () => controller.abort();
    }, [weatherMode, applyRainOpacities]);

    // Плавне програвання
    useEffect(() => {
      if (!weatherMode || !weatherPlaying) return;
      const length =
        weatherMode === "rain"
          ? Math.max(0, rainFrames.length - 1)
          : Math.max(0, weatherHours.length - 1);
      if (length < 0.01) return;

      const fullMs = weatherMode === "rain" ? 16_000 : 26_000;
      const speed = length / fullMs;
      let frameId = 0;
      let last = performance.now();
      let uiAcc = 0;

      const tick = (now: number) => {
        const dt = Math.min(48, now - last);
        last = now;
        let next = weatherProgressRef.current + dt * speed;
        if (next >= length) {
          next = 0;
          if (weatherMode === "rain") {
            const frames = rainFramesRef.current;
            if (frames.length >= 2) {
              rainFrontRef.current = "a";
              rainCommittedRef.current = 0;
              setRainFront("a");
              setRainSlotA(frames[0]!);
              setRainSlotB(frames[1]!);
              applyRainOpacities("a", 0);
            }
          }
        }
        weatherProgressRef.current = next;

        if (weatherMode === "rain") {
          syncRainBuffers(next, rainFramesRef.current);
        } else {
          weatherIndexRef.current = Math.floor(next);
          weatherBlendRef.current = next - Math.floor(next);
        }

        uiAcc += dt;
        if (uiAcc >= 32) {
          uiAcc = 0;
          setPlaybackT(next);
        }
        frameId = window.requestAnimationFrame(tick);
      };

      frameId = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(frameId);
    }, [
      weatherMode,
      weatherPlaying,
      rainFrames.length,
      weatherHours.length,
      syncRainBuffers,
      applyRainOpacities,
    ]);

    useEffect(() => {
      if (weatherMode !== "rain") return;
      applyRainOpacities(rainFront, weatherBlendRef.current);
    }, [weatherMode, rainSlotA, rainSlotB, rainFront, applyRainOpacities]);

    // Canvas тільки для вітру
    useEffect(() => {
      if (weatherMode !== "wind" || !weatherField) return;
      const canvas = weatherCanvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(parent.clientWidth * dpr);
        canvas.height = Math.floor(parent.clientHeight * dpr);
        canvas.style.width = `${parent.clientWidth}px`;
        canvas.style.height = `${parent.clientHeight}px`;
        const ctx = canvas.getContext("2d");
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();

      const pickStation = (x: number, y: number) => {
        const map = mapRef.current?.getMap();
        if (!map || !weatherField.stations.length) return 0;
        try {
          const ll = map.unproject([x, y]);
          let best = 0;
          let bestDist = Infinity;
          weatherField.stations.forEach((station, index) => {
            const d =
              (station.lat - ll.lat) ** 2 + (station.lng - ll.lng) ** 2;
            if (d < bestDist) {
              bestDist = d;
              best = index;
            }
          });
          return best;
        } catch {
          return 0;
        }
      };

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      weatherParticlesRef.current = Array.from({ length: 340 }, () => {
        const x = Math.random() * w;
        const y = Math.random() * h;
        return {
          x,
          y,
          len: 12 + Math.random() * 18,
          speed: 0.65 + Math.random() * 0.9,
          age: Math.random() * 100,
          stationIdx: pickStation(x, y),
        };
      });

      let frameId = 0;
      const draw = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          frameId = window.requestAnimationFrame(draw);
          return;
        }
        ctx.clearRect(0, 0, w, h);
        const idx = weatherIndexRef.current;
        const blend = weatherBlendRef.current;
        const i0 = Math.max(0, Math.min(weatherField.times.length - 1, idx));
        const i1 = Math.min(weatherField.times.length - 1, i0 + 1);

        for (const p of weatherParticlesRef.current) {
          const station =
            weatherField.stations[p.stationIdx] ?? weatherField.stations[0]!;
          const speed0 = station.speed[i0] ?? 0;
          const speed1 = station.speed[i1] ?? speed0;
          const dir0 = station.dir[i0] ?? 0;
          const dir1 = station.dir[i1] ?? dir0;
          const speed = speed0 + (speed1 - speed0) * blend;
          const diff = ((dir1 - dir0 + 540) % 360) - 180;
          const dir = (dir0 + diff * blend + 360) % 360;
          const rad = ((dir + 180) * Math.PI) / 180;
          const vx = Math.cos(rad) * (1.0 + speed * 0.5) * p.speed;
          const vy = Math.sin(rad) * (1.0 + speed * 0.5) * p.speed;
          p.x += vx;
          p.y += vy;
          p.age += 1;
          if (
            p.x < -40 ||
            p.y < -40 ||
            p.x > w + 40 ||
            p.y > h + 40 ||
            p.age > 130
          ) {
            p.x = Math.random() * w;
            p.y = Math.random() * h;
            p.age = 0;
            p.stationIdx = pickStation(p.x, p.y);
          }
          const alpha = 0.3 + (1 - p.age / 130) * 0.5;
          ctx.strokeStyle = `rgba(244, 241, 234, ${alpha})`;
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - vx * (p.len / 4), p.y - vy * (p.len / 4));
          ctx.stroke();
        }
        frameId = window.requestAnimationFrame(draw);
      };

      frameId = window.requestAnimationFrame(draw);
      window.addEventListener("resize", resize);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.removeEventListener("resize", resize);
        weatherParticlesRef.current = [];
      };
    }, [weatherMode, weatherField]);

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

    if (isLoading) {
      return (
        <div
          className={cn(
            "flex h-full min-h-[320px] w-full animate-pulse items-center justify-center rounded-xl bg-[#EBE5D9]",
            className
          )}
        >
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-[#C05621]" />
            <p className="text-sm font-medium text-zinc-600">
              Синхронізація з геозонами…
            </p>
          </div>
        </div>
      );
    }

    const showTractor = zoom >= 7;
    const tractorScale = tractorScaleFromZoom(zoom);

    return (
      <div
        ref={mapContainerRef}
        className={cn(
          "relative h-full min-h-[320px] w-full rounded-xl",
          className
        )}
      >
        <div className="absolute inset-0 overflow-hidden rounded-xl">
          <Map
            ref={mapRef}
            mapboxAccessToken={token}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            initialViewState={bootView}
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
            }}
            style={{ width: "100%", height: "100%" }}
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
                  "fill-color": ["get", "color"],
                  "fill-opacity": paintFillOpacity(selectedFieldId),
                }}
              />
              <Layer
                id="fields-outline"
                type="line"
                paint={{
                  "line-color": ["get", "color"],
                  "line-width": paintLineWidth(selectedFieldId),
                }}
              />
            </Source>

            <Source id="saved-fields" type="geojson" data={visibleSavedGeoJson}>
              <Layer
                id="saved-fields-fill"
                type="fill"
                paint={{
                  "fill-color": ["get", "color"],
                  "fill-opacity": paintFillOpacity(selectedFieldId),
                }}
              />
              <Layer
                id="saved-fields-outline"
                type="line"
                paint={{
                  "line-color": ["get", "color"],
                  "line-width": paintLineWidth(selectedFieldId),
                }}
              />
            </Source>

            {/* Затемнення карти при вибраному полі — поле залишається зверху */}
            {selectedFieldId ? (
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
                    "fill-opacity": 0.42,
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
                  "fill-color": [
                    "coalesce",
                    ["get", "color"],
                    "#276749",
                  ],
                  "fill-opacity": paintFillOpacity(selectedFieldId),
                }}
              />
              <Layer
                id="wialon-geofences-outline"
                type="line"
                beforeId="fields-fill"
                paint={{
                  "line-color": [
                    "coalesce",
                    ["get", "color"],
                    "#276749",
                  ],
                  "line-width": paintLineWidth(selectedFieldId),
                  "line-opacity": paintLineOpacity(selectedFieldId),
                }}
              />
            </Source>

            {weatherMode === "rain" || weatherMode === "wind" ? (
              <Source
                id="weather-dim"
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
                  id="weather-dim-fill"
                  type="fill"
                  beforeId="fields-fill"
                  paint={{
                    "fill-color": "#0a0f14",
                    "fill-opacity": weatherMode === "rain" ? 0.3 : 0.26,
                  }}
                />
              </Source>
            ) : null}

            {weatherMode === "rain" && rainSlotA ? (
              <Source
                id="rainviewer-a"
                type="raster"
                tiles={[rainTileUrl(rainHost, rainSlotA.path)]}
                tileSize={256}
                maxzoom={7}
              >
                <Layer
                  id="rainviewer-a-layer"
                  type="raster"
                  beforeId="fields-fill"
                  paint={{
                    "raster-opacity":
                      rainFront === "a" ? rainOpacityFront : rainOpacityBack,
                    "raster-resampling": "linear",
                    "raster-fade-duration": 0,
                  }}
                />
              </Source>
            ) : null}

            {weatherMode === "rain" && rainSlotB ? (
              <Source
                id="rainviewer-b"
                type="raster"
                tiles={[rainTileUrl(rainHost, rainSlotB.path)]}
                tileSize={256}
                maxzoom={7}
              >
                <Layer
                  id="rainviewer-b-layer"
                  type="raster"
                  beforeId="fields-fill"
                  paint={{
                    "raster-opacity":
                      rainFront === "b" ? rainOpacityFront : rainOpacityBack,
                    "raster-resampling": "linear",
                    "raster-fade-duration": 0,
                  }}
                />
              </Source>
            ) : null}

            {showTractor
              ? wialonUnits.filter(hasValidWialonPosition).map((unit) => {
                  const moving = (unit.pos.s ?? 0) > 0;
                  const selected = selectedTractor?.id === unit.id;
                  return (
                    <Marker
                      key={unit.id}
                      longitude={unit.pos.x}
                      latitude={unit.pos.y}
                      anchor="center"
                      style={{ cursor: "pointer", zIndex: selected ? 3 : 2 }}
                      onClick={(event) => {
                        event.originalEvent.stopPropagation();
                        setSelectedTractor(unit);
                        setHover(null);
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
                            setSelectedTractor(unit);
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
                })
              : null}
          </Map>
        </div>

        {weatherMode === "wind" ? (
          <canvas
            ref={weatherCanvasRef}
            className="pointer-events-none absolute inset-0 z-20 rounded-xl"
          />
        ) : null}

        <div className="absolute top-3 right-3 z-40 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => toggleWeatherMode("rain")}
            title="Live-радар опадів"
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold shadow-md backdrop-blur-sm transition-all",
              weatherMode === "rain"
                ? "border-[#2B6CB0]/40 bg-[#2B6CB0] text-white"
                : "border-[#E5DFD3] bg-[#F4F1EA]/95 text-zinc-700 hover:bg-[#E5DFD3]/70"
            )}
          >
            <CloudRain className="h-4 w-4" />
            Live-Радар
          </button>
          <button
            type="button"
            onClick={() => toggleWeatherMode("wind")}
            title="Карта вітрів"
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold shadow-md backdrop-blur-sm transition-all",
              weatherMode === "wind"
                ? "border-[#0F766E]/40 bg-[#0F766E] text-white"
                : "border-[#E5DFD3] bg-[#F4F1EA]/95 text-zinc-700 hover:bg-[#E5DFD3]/70"
            )}
          >
            <Wind className="h-4 w-4" />
            Вітер
          </button>
        </div>

        {weatherMode ? (
          <div className="absolute right-3 bottom-3 left-3 z-40 mx-auto max-w-xl sm:left-1/2 sm:right-auto sm:w-[min(100%-1.5rem,36rem)] sm:-translate-x-1/2">
            <div className="rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA]/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
              {weatherLoading ? (
                <p className="inline-flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Завантаження шкали…
                </p>
              ) : weatherError ? (
                <p className="text-xs text-[#C05621]">{weatherError}</p>
              ) : weatherMode === "rain" && rainSlotA ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900">
                        Live-Радар ·{" "}
                        {formatUnixLabel(
                          rainTimeAtProgress(rainFrames, playbackT)
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                        Фактичний рух фронту · past + nowcast
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWeatherPlaying((p) => !p)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD3] bg-zinc-100 text-zinc-700 transition-colors hover:bg-[#E5DFD3]/80"
                      title={weatherPlaying ? "Пауза" : "Відтворити"}
                    >
                      {weatherPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={weatherLen}
                    step={0.01}
                    value={Math.min(playbackT, weatherLen)}
                    onChange={(event) => {
                      setWeatherPlaying(false);
                      seekPlayback(Number(event.target.value));
                    }}
                    className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#E5DFD3] accent-[#276749]"
                    aria-label="Шкала Live-радару"
                  />
                  <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
                    <span>
                      {rainFrames[0]
                        ? formatUnixLabel(rainFrames[0].time)
                        : "—"}
                    </span>
                    <span className="text-zinc-400">RainViewer · live</span>
                    <span>
                      {rainFrames[rainFrames.length - 1]
                        ? formatUnixLabel(
                            rainFrames[rainFrames.length - 1]!.time
                          )
                        : "—"}
                    </span>
                  </div>
                </>
              ) : weatherMode === "wind" &&
                weatherField &&
                weatherHours.length ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900">
                        Вітер ·{" "}
                        {formatHourLabel(
                          hourTimeAtProgress(
                            weatherHours.map((h) => h.time),
                            playbackT
                          )
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                        {(() => {
                          const local = windAtLocation(
                            weatherField,
                            mapCenterRef.current.lat,
                            mapCenterRef.current.lng,
                            weatherIndex,
                            weatherBlend
                          );
                          return `${Math.round(local.speed)} м/с · ${Math.round(local.dir)}° · по областях`;
                        })()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWeatherPlaying((p) => !p)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD3] bg-zinc-100 text-zinc-700 transition-colors hover:bg-[#E5DFD3]/80"
                      title={weatherPlaying ? "Пауза" : "Відтворити"}
                    >
                      {weatherPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={weatherLen}
                    step={0.01}
                    value={Math.min(playbackT, weatherLen)}
                    onChange={(event) => {
                      setWeatherPlaying(false);
                      seekPlayback(Number(event.target.value));
                    }}
                    className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#E5DFD3] accent-[#276749]"
                    aria-label="Шкала вітру"
                  />
                  <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
                    <span>
                      {weatherHours[0]
                        ? formatHourLabel(weatherHours[0].time)
                        : "−2 год"}
                    </span>
                    <span className="text-zinc-400">
                      Регіони UA · −2…+10 год
                    </span>
                    <span>
                      {weatherHours[weatherHours.length - 1]
                        ? formatHourLabel(
                            weatherHours[weatherHours.length - 1]!.time
                          )
                        : "+10 год"}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="absolute top-3 left-3 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-[#E5DFD3] bg-[#F4F1EA]/95 p-1.5 shadow-md backdrop-blur-sm">
          {!geometryEditMode ? (
            <>
              <button
                type="button"
                disabled={!drawReady}
                onClick={startDraw}
                title="Малювати (D)"
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                  activeTool === "draw"
                    ? "bg-[#276749] text-white shadow-sm"
                    : "text-zinc-700 hover:bg-[#E5DFD3]/70 hover:text-zinc-900"
                )}
              >
                <Pentagon className="h-4 w-4" />
                Малювати
              </button>

              <button
                type="button"
                disabled={!drawReady}
                onClick={startEdit}
                title="Редагувати (V)"
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                  activeTool === "edit"
                    ? "bg-[#276749] text-white shadow-sm"
                    : "text-zinc-700 hover:bg-[#E5DFD3]/70 hover:text-zinc-900"
                )}
              >
                <MousePointer2 className="h-4 w-4" />
                Редагувати
              </button>
            </>
          ) : null}

          {toolbarAction}

          <span className="mx-0.5 hidden h-6 w-px bg-[#E5DFD3] sm:block" />

          <button
            type="button"
            onClick={fitAllFields}
            title="Показати всі поля"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition-all hover:bg-[#E5DFD3]/70 hover:text-zinc-900"
          >
            <Focus className="h-4 w-4" />
            Усі поля
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            title="Пошук адреси або координат"
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
              searchOpen
                ? "bg-[#276749] text-white shadow-sm"
                : "text-zinc-700 hover:bg-[#E5DFD3]/70 hover:text-zinc-900"
            )}
          >
            <Search className="h-4 w-4" />
            Пошук
          </button>
        </div>

        {searchOpen ? (
          <div className="absolute top-14 left-3 z-40 w-[min(100%-1.5rem,340px)] rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-3 shadow-lg">
            <Input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Адреса або 50.45, 30.52"
              className="h-10 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm text-zinc-900"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Введіть населений пункт або координати lat, lng
            </p>

            {searchLoading ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Шукаємо…
              </p>
            ) : null}

            {searchError ? (
              <p className="mt-3 text-xs text-[#C05621]">{searchError}</p>
            ) : null}

            {searchResults.length > 0 ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
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
                      className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                    >
                      {result.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {isDrawing ? (
          <div className="pointer-events-none absolute top-28 right-3 z-40 max-w-[220px] rounded-xl border border-[#276749]/30 bg-[#276749]/95 px-3 py-2 text-xs font-medium text-white shadow-md">
            Ставте точки кліком. Замкніть полігон — клік на першу точку.
            <span className="mt-1 block text-white/70">Esc — скасувати</span>
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
          </div>
        ) : null}

        {selectedTractor && !blockingOverlay ? (
          <VehicleMapPopup
            unit={selectedTractor}
            onClose={() => setSelectedTractor(null)}
          />
        ) : null}

        {/* Панелі поверх карти — без обрізання */}
        {inspectorPanel}
        {passportPanel}
      </div>
    );
  }
);

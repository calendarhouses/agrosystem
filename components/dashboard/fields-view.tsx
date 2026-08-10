"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import {
  CloudSun,
  Droplets,
  Focus,
  History,
  Info,
  Loader2,
  Map as MapIcon,
  MapPin,
  Pencil,
  Pentagon,
  Save,
  Settings2,
  Trash2,
  Wind,
  X,
} from "lucide-react";

import { FieldDetailSheet } from "@/components/dashboard/field-detail-sheet";
import { FieldMicroclimate } from "@/components/dashboard/field-microclimate";
import { FieldTechHistorySheet } from "@/components/dashboard/field-tech-history-sheet";
import {
  FieldsMap,
  type FieldsMapHandle,
} from "@/components/dashboard/fields-map";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fieldCentroid } from "@/lib/field-centroid";
import {
  createFarmField,
  deleteFarmField,
  farmFieldsToGeoJson,
  FIELD_COLOR_OPTIONS,
  isPolygonGeometry,
  listFarmFields,
  updateFarmField,
  type FarmField,
} from "@/lib/farm-fields";
import { hectaresFromFeature } from "@/lib/geo-area";
import {
  analyticsForMapField,
  buildMapFieldList,
  mapItemToSheetField,
  nextFieldNumber,
  type MapFieldItem,
} from "@/lib/map-fields";
import {
  fieldOperationsKey,
  fieldOperationsLegacyKeys,
} from "@/lib/field-operations";
import { syncPlannedOpsFromTrackerPresence } from "@/lib/field-operation-tracker";
import type {
  WialonGeofenceProperties,
  WialonUnit,
} from "@/lib/wialon";
import {
  DEFAULT_WEATHER_LOCATION,
  fetchWeather,
  fetchWeatherWithHourly,
  readStoredWeatherLocation,
  shortWeatherPlaceLabel,
  writeStoredWeatherLocation,
  type HourlyForecastHour,
  type WeatherLocation,
  type WeatherSnapshot,
} from "@/lib/weather";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import { cn } from "@/lib/utils";

const EMPTY_DRAWN: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_GEOFENCES: FeatureCollection<Polygon, WialonGeofenceProperties> = {
  type: "FeatureCollection",
  features: [],
};

const CROP_OPTIONS = [
  "Кукурудза",
  "Ріпак",
  "Соняшник",
  "Пшениця",
] as const;

function normalizeCrop(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  const match = CROP_OPTIONS.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase()
  );
  return match ?? CROP_OPTIONS[0];
}

type PassportMode = "create" | "edit";
type ActivePanel = "inspector" | "passport";

/** Компактна шапка: заголовок + жива погода Open-Meteo */
function FieldsTopBar({
  plotCount,
  totalHa,
  fieldsLoading,
}: {
  plotCount: number;
  totalHa: number;
  fieldsLoading?: boolean;
}) {
  const [location, setLocation] = useState<WeatherLocation>(
    DEFAULT_WEATHER_LOCATION
  );
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeResults, setPlaceResults] = useState<GeoSearchResult[]>([]);
  const [latDraft, setLatDraft] = useState(String(DEFAULT_WEATHER_LOCATION.latitude));
  const [lngDraft, setLngDraft] = useState(
    String(DEFAULT_WEATHER_LOCATION.longitude)
  );

  useEffect(() => {
    const stored = readStoredWeatherLocation();
    setLocation(stored);
    setLatDraft(String(stored.latitude));
    setLngDraft(String(stored.longitude));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchWeather(location.latitude, location.longitude, controller.signal)
      .then((data) => {
        setWeather(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setWeather(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Помилка погоди");
      });

    return () => controller.abort();
  }, [location.latitude, location.longitude]);

  useEffect(() => {
    if (!settingsOpen) return;
    const q = placeQuery.trim();
    if (q.length < 2) {
      setPlaceResults([]);
      setPlaceError(null);
      setPlaceLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPlaceLoading(true);
      setPlaceError(null);
      searchPlaces(q, controller.signal)
        .then((results) => {
          setPlaceResults(results);
          setPlaceLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setPlaceResults([]);
          setPlaceLoading(false);
          setPlaceError(err instanceof Error ? err.message : "Помилка пошуку");
        });
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [placeQuery, settingsOpen]);

  function applyLocation(next: WeatherLocation) {
    setLocation(next);
    writeStoredWeatherLocation(next);
    setLatDraft(String(next.latitude));
    setLngDraft(String(next.longitude));
    setPlaceQuery("");
    setPlaceResults([]);
    setSettingsOpen(false);
  }

  function applyCustomCoords() {
    const latitude = Number(latDraft.replace(",", "."));
    const longitude = Number(lngDraft.replace(",", "."));
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      setError("Некоректні координати");
      return;
    }
    applyLocation({
      id: "custom",
      label: "Власна локація",
      latitude,
      longitude,
    });
  }

  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5DFD3] border-l-4 border-l-[#C05621] bg-[#F4F1EA] px-3 py-2 shadow-sm sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#C05621]/25 bg-[#C05621]/10 text-[#C05621]">
          <MapIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-extrabold tracking-tight text-zinc-900 sm:text-lg">
            Карта Полів
          </h1>
          <p className="truncate text-[11px] text-zinc-500 sm:text-xs">
            {fieldsLoading
              ? "Завантаження ділянок…"
              : `${plotCount} ділянок · ${totalHa} га`}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 max-w-[min(46vw,200px)] shrink items-center gap-2 sm:max-w-[220px] sm:gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#D69E2E]/30 bg-[#D69E2E]/15">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#D69E2E]" />
          ) : (
            <CloudSun className="h-4 w-4 text-[#D69E2E]" />
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-extrabold tabular-nums leading-none text-zinc-900">
              {weather ? `${weather.tempC}°` : "—"}
            </span>
            <span className="hidden truncate text-[11px] text-zinc-500 sm:inline">
              {error ? "Немає даних" : weather?.condition ?? "Завантаження…"}
            </span>
          </div>
          <p
            className="truncate text-[10px] text-zinc-500 sm:text-[11px]"
            title={location.label}
          >
            {shortWeatherPlaceLabel(location.label)}
          </p>
        </div>
        <div className="hidden items-center gap-1.5 border-l border-[#E5DFD3] pl-3 md:flex">
          <span className="inline-flex items-center gap-1 rounded-md border border-[#E5DFD3] bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
            <Wind className="h-3 w-3" />
            {weather ? `${weather.windMs} м/с` : "—"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-[#E5DFD3] bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
            <Droplets className="h-3 w-3 text-[#C05621]" />
            {weather ? `${weather.humidityPercent}%` : "—"}
          </span>
        </div>

        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger
            type="button"
            aria-label="Налаштування погоди"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5DFD3] bg-zinc-100 text-zinc-500 transition-colors hover:bg-[#E5DFD3]/70 hover:text-zinc-800"
          >
            <Settings2 className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 border border-[#E5DFD3] bg-[#F4F1EA] p-3 text-zinc-900 shadow-lg"
          >
            <PopoverHeader>
              <PopoverTitle className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                <MapPin className="h-4 w-4 text-[#276749]" />
                Локація погоди
              </PopoverTitle>
            </PopoverHeader>

            <Input
              value={placeQuery}
              onChange={(event) => setPlaceQuery(event.target.value)}
              placeholder="Село, місто або вулиця…"
              className="mt-2 h-9 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Пошук по всій Україні · або координати нижче
            </p>

            {placeLoading ? (
              <p className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Шукаємо…
              </p>
            ) : null}
            {placeError ? (
              <p className="mt-2 text-xs text-[#C05621]">{placeError}</p>
            ) : null}

            {placeResults.length > 0 ? (
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {placeResults.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() =>
                        applyLocation({
                          id: result.id,
                          label: result.label,
                          latitude: result.latitude,
                          longitude: result.longitude,
                        })
                      }
                      className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                    >
                      {result.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#E5DFD3] pt-3">
              <div className="space-y-1">
                <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
                  Lat
                </Label>
                <Input
                  value={latDraft}
                  onChange={(event) => setLatDraft(event.target.value)}
                  className="h-9 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
                  Lng
                </Label>
                <Input
                  value={lngDraft}
                  onChange={(event) => setLngDraft(event.target.value)}
                  className="h-9 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={applyCustomCoords}
              className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#276749] text-xs font-bold text-white transition-colors hover:bg-[#22543d]"
            >
              Застосувати координати
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** Головний розділ: жива карта полів з повним CRUD */
export function FieldsView() {
  const fieldsMapRef = useRef<FieldsMapHandle>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [overlayPos, setOverlayPos] = useState<{
    left: number;
    top: number;
    bottom: number;
  }>({
    left: 24,
    top: 96,
    bottom: 24,
  });

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const syncOverlayPos = useCallback(() => {
    const host = mapHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setOverlayPos({
      left: Math.max(12, rect.left + 12),
      top: Math.max(12, rect.top + 12),
      bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
    });
  }, []);

  const [drawnContours, setDrawnContours] =
    useState<FeatureCollection>(EMPTY_DRAWN);
  const [savedFields, setSavedFields] = useState<FarmField[]>([]);
  const [wialonUnits, setWialonUnits] = useState<WialonUnit[]>([]);
  const [wialonGeofences, setWialonGeofences] =
    useState<FeatureCollection<Polygon, WialonGeofenceProperties>>(
      EMPTY_GEOFENCES
    );
  const [wialonLoading, setWialonLoading] = useState(true);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [isFieldHistoryOpen, setIsFieldHistoryOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const [passportMode, setPassportMode] = useState<PassportMode>("create");
  const [pendingFeature, setPendingFeature] =
    useState<Feature<Geometry> | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState("");
  const [crop, setCrop] = useState<string>(CROP_OPTIONS[0]);
  const [areaHa, setAreaHa] = useState(0);
  const [color, setColor] = useState<string>(FIELD_COLOR_OPTIONS[0].value);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const passportOpen = activePanel === "passport";

  useLayoutEffect(() => {
    syncOverlayPos();
    window.addEventListener("resize", syncOverlayPos);
    return () => window.removeEventListener("resize", syncOverlayPos);
  }, [syncOverlayPos, activePanel, selectedId]);

  const mapFields = useMemo(
    () =>
      buildMapFieldList(savedFields, wialonGeofences, {
        // Поки Wialon грузиться — без демо «Поле 1/2/3»
        allowDemoFallback: !wialonLoading,
      }),
    [savedFields, wialonGeofences, wialonLoading]
  );

  const selectedItem = useMemo(
    () => mapFields.find((item) => item.id === selectedId) ?? null,
    [mapFields, selectedId]
  );

  const [fieldWeather, setFieldWeather] = useState<WeatherSnapshot | null>(null);
  const [fieldHourly, setFieldHourly] = useState<HourlyForecastHour[] | null>(
    null
  );
  const [fieldWeatherLoading, setFieldWeatherLoading] = useState(false);
  const [fieldWeatherError, setFieldWeatherError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedItem?.geometry) {
      setFieldWeather(null);
      setFieldHourly(null);
      setFieldWeatherError(null);
      setFieldWeatherLoading(false);
      return;
    }

    const centroid = fieldCentroid(selectedItem.geometry);
    if (!centroid) {
      setFieldWeather(null);
      setFieldHourly(null);
      setFieldWeatherError("Немає центру поля");
      return;
    }

    const controller = new AbortController();
    setFieldWeatherLoading(true);
    setFieldWeatherError(null);

    fetchWeatherWithHourly(
      centroid.latitude,
      centroid.longitude,
      controller.signal
    )
      .then(({ current, hourly }) => {
        setFieldWeather(current);
        setFieldHourly(hourly);
        setFieldWeatherLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFieldWeather(null);
        setFieldHourly(null);
        setFieldWeatherLoading(false);
        setFieldWeatherError(
          error instanceof Error ? error.message : "Помилка погоди"
        );
      });

    return () => controller.abort();
  }, [selectedItem]);

  const sheetField = useMemo(
    () => (selectedItem ? mapItemToSheetField(selectedItem) : null),
    [selectedItem]
  );

  const sheetFieldKey = useMemo(
    () => (selectedItem ? fieldOperationsKey(selectedItem) : null),
    [selectedItem]
  );

  const sheetLegacyFieldKeys = useMemo(
    () => (selectedItem ? fieldOperationsLegacyKeys(selectedItem) : []),
    [selectedItem]
  );

  const sheetAnalytics = useMemo(
    () => (selectedItem ? analyticsForMapField(selectedItem) : null),
    [selectedItem]
  );

  const savedGeoJson = useMemo(
    () =>
      // Геозони Wialon уже на карті — не дублюємо контур паспорта (крива «подвійна» обводка)
      farmFieldsToGeoJson(
        savedFields.filter((field) => !field.wialonZoneId?.trim())
      ),
    [savedFields]
  );

  /** Колір / назва / культура з паспорта накладаються на шар Wialon */
  const mapWialonGeofences = useMemo(() => {
    const passportByZone = new Map(
      savedFields
        .filter((field) => field.wialonZoneId?.trim())
        .map((field) => [field.wialonZoneId!.trim(), field] as const)
    );
    if (passportByZone.size === 0) return wialonGeofences;

    return {
      type: "FeatureCollection" as const,
      features: wialonGeofences.features.map((feature) => {
        const zoneId = String(feature.properties?.id ?? feature.id ?? "");
        const passport = passportByZone.get(zoneId);
        if (!passport) return feature;
        return {
          ...feature,
          geometry:
            passport.geometry?.type === "Polygon" ||
            passport.geometry?.type === "MultiPolygon"
              ? (passport.geometry as typeof feature.geometry)
              : feature.geometry,
          properties: {
            ...feature.properties,
            name: passport.name,
            crop: passport.crop,
            color: passport.color,
            areaHa: passport.areaHa,
          },
        };
      }),
    };
  }, [wialonGeofences, savedFields]);

  const totalHa = useMemo(() => {
    return Math.round(
      mapFields.reduce((sum, field) => sum + field.areaHa, 0) * 10
    ) / 10;
  }, [mapFields]);

  useEffect(() => {
    let cancelled = false;
    listFarmFields().then((fields) => {
      if (!cancelled) setSavedFields(fields);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Лікує старі паспорти без wialon_zone_id (подвійна обводка / битий клік) */
  useEffect(() => {
    if (wialonLoading || wialonGeofences.features.length === 0) return;
    setSavedFields((prev) => {
      let changed = false;
      const next = prev.map((field) => {
        if (field.wialonZoneId?.trim()) return field;
        const match = wialonGeofences.features.find(
          (feature) =>
            feature.properties?.name?.trim() === field.name.trim()
        );
        const zoneId = match?.properties?.id;
        if (!zoneId) return field;
        changed = true;
        return { ...field, wialonZoneId: String(zoneId) };
      });
      return changed ? next : prev;
    });
  }, [wialonLoading, wialonGeofences]);

  useEffect(() => {
    const controller = new AbortController();
    setWialonLoading(true);

    fetch("/api/wialon", { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          units?: WialonUnit[];
          geofences?: FeatureCollection<Polygon, WialonGeofenceProperties>;
        };
        if (!response.ok || !Array.isArray(data.units)) {
          throw new Error("Не вдалося завантажити Wialon");
        }
        setWialonUnits(data.units);
        setWialonGeofences(
          data.geofences?.type === "FeatureCollection"
            ? data.geofences
            : EMPTY_GEOFENCES
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setWialonUnits([]);
        setWialonGeofences(EMPTY_GEOFENCES);
      })
      .finally(() => {
        if (!controller.signal.aborted) setWialonLoading(false);
      });

    return () => controller.abort();
  }, []);

  /** Автостатус: запланована техніка заїхала на поле → in_progress */
  useEffect(() => {
    if (wialonLoading || wialonUnits.length === 0 || mapFields.length === 0) {
      return;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const fields = mapFields
        .filter((item) => item.geometry)
        .map((item) => ({
          fieldKey: fieldOperationsKey(item),
          geometry: item.geometry,
          farmFieldId: item.farmField?.id ?? null,
        }));
      if (fields.length === 0) return;
      try {
        await syncPlannedOpsFromTrackerPresence({
          fields,
          units: wialonUnits,
        });
      } catch {
        /* silent */
      }
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wialonLoading, wialonUnits, mapFields]);

  const flashStatus = useCallback((message: string) => {
    setStatusHint(message);
    window.setTimeout(() => setStatusHint(null), 3200);
  }, []);

  const restoreMapOverview = useCallback(() => {
    setSelectedId(null);
    setActivePanel(null);
    setConfirmDelete(false);
    setIsFieldHistoryOpen(false);
    setSheetOpen(false);
    setPendingFeature(null);
    setSavedFlash(false);
    window.setTimeout(() => fieldsMapRef.current?.fitAllFields(), 40);
  }, []);

  const closePanels = useCallback(() => {
    restoreMapOverview();
  }, [restoreMapOverview]);

  const closePassport = useCallback(() => {
    setPendingFeature(null);
    setSavedFlash(false);
    if (editingFieldId) {
      fieldsMapRef.current?.clearDraw();
      setEditingFieldId(null);
    }
    // Повертаємо огляд усіх полів (не лишаємо фокус на одному)
    restoreMapOverview();
  }, [editingFieldId, restoreMapOverview]);

  const selectField = useCallback(
    (item: MapFieldItem, options?: { fly?: boolean }) => {
      setConfirmDelete(false);
      setSelectedId(item.id);
      setActivePanel("inspector");
      setPendingFeature(null);
      setSavedFlash(false);

      if (options?.fly === false || !item.geometry) return;
      fieldsMapRef.current?.focusFieldForInspector(item.geometry);
    },
    []
  );

  const openFieldById = useCallback(
    (fieldId: string) => {
      const item =
        mapFields.find((field) => field.id === fieldId) ??
        mapFields.find((field) => field.farmField?.id === fieldId);
      if (!item) return;
      selectField(item, { fly: true });
    },
    [mapFields, selectField]
  );

  const handleDrawnFeaturesChange = useCallback(
    (features: FeatureCollection) => {
      setDrawnContours(features);
      setSaveHint(null);
    },
    []
  );

  const handleEscape = useCallback(() => {
    if (activePanel === "passport") {
      closePassport();
      return;
    }
    if (confirmDelete) {
      setConfirmDelete(false);
      return;
    }
    if (isFieldHistoryOpen || sheetOpen) {
      restoreMapOverview();
      return;
    }
    if (activePanel === "inspector") {
      closePanels();
      return;
    }
    if (activePanel) {
      setActivePanel(null);
      return;
    }
    if (selectedId) {
      restoreMapOverview();
    }
  }, [
    activePanel,
    closePanels,
    closePassport,
    confirmDelete,
    isFieldHistoryOpen,
    restoreMapOverview,
    selectedId,
    sheetOpen,
  ]);

  function handleOpenCreatePassport() {
    if (editingFieldId) {
      const feature = fieldsMapRef.current?.getFeatureForSave() ?? null;
      if (!feature || !isPolygonGeometry(feature.geometry)) {
        setSaveHint("Відредагуйте контур на карті");
        return;
      }
      void persistGeometryEdit(feature);
      return;
    }

    const feature = fieldsMapRef.current?.getFeatureForSave() ?? null;
    const all = fieldsMapRef.current?.getDrawnFeatures() ?? drawnContours;

    if (!feature || all.features.length === 0) {
      setSaveHint("Спочатку намалюйте або виділіть контур на карті");
      return;
    }

    if (!isPolygonGeometry(feature.geometry)) {
      setSaveHint("Можна зберігати лише полігони");
      return;
    }

    const nextIndex = nextFieldNumber(mapFields);
    const hectares = hectaresFromFeature(feature);
    const colorIndex =
      (savedFields.length + drawnContours.features.length) %
      FIELD_COLOR_OPTIONS.length;

    setPassportMode("create");
    setEditingFieldId(null);
    setPendingFeature(feature);
    setFieldName(`Поле ${nextIndex}`);
    setCrop(normalizeCrop(CROP_OPTIONS[0]));
    setAreaHa(hectares);
    setColor(FIELD_COLOR_OPTIONS[colorIndex].value);
    setSaveHint(null);
    setSavedFlash(false);
    setSelectedId(null);
    setActivePanel("passport");
  }

  function openPassport(item: MapFieldItem) {
    const hasPassport = Boolean(item.farmField);
    setPassportMode(hasPassport ? "edit" : "create");
    setPendingFeature(
      hasPassport || !item.geometry
        ? null
        : {
            type: "Feature",
            properties: {
              id: item.id,
              name: item.name,
              crop: item.crop,
              color: item.color,
            },
            geometry: item.geometry,
          }
    );
    setFieldName(item.name);
    setCrop(normalizeCrop(item.crop));
    setAreaHa(item.areaHa);
    setColor(item.color || FIELD_COLOR_OPTIONS[0].value);
    setEditingFieldId(null);
    setSaveHint(null);
    setSavedFlash(false);
    setConfirmDelete(false);
    setSelectedId(item.id);
    setActivePanel("passport");
  }

  function startGeometryEdit(item: MapFieldItem) {
    if (!item.geometry) {
      flashStatus("Немає контуру для редагування");
      return;
    }

    setActivePanel(null);
    setConfirmDelete(false);
    // id паспорта в БД (якщо є) або id зони / поля на карті
    setEditingFieldId(item.farmField?.id ?? item.id);
    setSelectedId(item.id);

    const feature: Feature<Geometry> = {
      type: "Feature",
      properties: {
        id: item.id,
        name: item.name,
        crop: item.crop,
        color: item.color,
      },
      geometry: item.geometry,
    };

    fieldsMapRef.current?.loadPolygonIntoDraw(feature);
    fieldsMapRef.current?.focusGeometry(item.geometry);
    flashStatus("Редагуйте вершини · потім «Зберегти контур»");
  }

  function openFleetPanel(item: MapFieldItem) {
    setSelectedId(item.id);
    setConfirmDelete(false);
    setActivePanel(null);
    setIsFieldHistoryOpen(true);
  }

  async function persistGeometryEdit(feature: Feature<Geometry>) {
    if (!editingFieldId || !isPolygonGeometry(feature.geometry)) return;

    const item =
      mapFields.find(
        (field) =>
          field.farmField?.id === editingFieldId || field.id === editingFieldId
      ) ?? selectedItem;

    if (!item) {
      setSaveHint("Поле не знайдено");
      return;
    }

    setBusy(true);
    try {
      const hectares = hectaresFromFeature(feature);
      const geometry = feature.geometry;

      if (item.farmField) {
        const updated = await updateFarmField(item.farmField.id, {
          geometry,
          areaHa: hectares,
        });
        setSavedFields((prev) =>
          prev.map((field) => (field.id === updated.id ? updated : field))
        );
      } else {
        const wialonZoneId =
          item.source === "wialon" ? item.id : null;
        const created = await createFarmField({
          name: item.name,
          crop: normalizeCrop(item.crop),
          areaHa: hectares,
          color: item.color || FIELD_COLOR_OPTIONS[0].value,
          geometry,
          wialonZoneId,
        });
        const linked: FarmField = {
          ...created,
          wialonZoneId: created.wialonZoneId ?? wialonZoneId,
        };
        setSavedFields((prev) => [
          linked,
          ...prev.filter((field) => field.id !== linked.id),
        ]);
      }

      if (feature.id != null) {
        fieldsMapRef.current?.removeDrawFeature(feature.id);
      } else {
        fieldsMapRef.current?.clearDraw();
      }

      setEditingFieldId(null);
      flashStatus("Контур збережено");
    } catch (error) {
      console.error(error);
      setSaveHint("Не вдалося оновити контур");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPassport() {
    if (!fieldName.trim()) return;

    setBusy(true);
    try {
      if (passportMode === "edit" && selectedItem?.farmField) {
        const updated = await updateFarmField(selectedItem.farmField.id, {
          name: fieldName.trim(),
          crop,
          areaHa,
          color,
        });
        setSavedFields((prev) =>
          prev.map((field) => (field.id === updated.id ? updated : field))
        );
        setSavedFlash(true);
        window.setTimeout(() => {
          setActivePanel("inspector");
          setSavedFlash(false);
          setBusy(false);
        }, 550);
        return;
      }

      const geometryFromPending =
        pendingFeature && isPolygonGeometry(pendingFeature.geometry)
          ? pendingFeature.geometry
          : null;
      const geometryFromSelected =
        selectedItem?.geometry && isPolygonGeometry(selectedItem.geometry)
          ? selectedItem.geometry
          : null;
      const geometry = geometryFromPending ?? geometryFromSelected;

      if (!geometry) {
        setSaveHint("Немає контуру поля для збереження паспорта");
        setBusy(false);
        return;
      }

      const wialonZoneId =
        selectedItem?.source === "wialon"
          ? selectedItem.id
          : selectedItem?.farmField?.wialonZoneId ?? null;

      const existingLinked = wialonZoneId
        ? savedFields.find((field) => field.wialonZoneId === wialonZoneId)
        : null;

      if (existingLinked) {
        const updated = await updateFarmField(existingLinked.id, {
          name: fieldName.trim(),
          crop,
          areaHa,
          color,
          wialonZoneId,
        });
        setSavedFields((prev) =>
          prev.map((field) => (field.id === updated.id ? updated : field))
        );
        setSavedFlash(true);
        setSelectedId(wialonZoneId || updated.id);
        window.setTimeout(() => {
          setActivePanel("inspector");
          setSavedFlash(false);
          setPendingFeature(null);
          setBusy(false);
        }, 550);
        return;
      }

      const saved = await createFarmField({
        name: fieldName.trim(),
        crop,
        areaHa,
        color,
        geometry,
        wialonZoneId,
      });

      // Якщо колонка wialon_zone_id ще не в БД — тримаємо звʼязок локально
      const linked: FarmField = {
        ...saved,
        wialonZoneId: saved.wialonZoneId ?? wialonZoneId,
      };

      setSavedFields((prev) => [
        linked,
        ...prev.filter((field) => field.id !== linked.id),
      ]);

      if (pendingFeature?.id != null) {
        fieldsMapRef.current?.removeDrawFeature(pendingFeature.id);
      }

      setSavedFlash(true);
      // для Wialon лишаємо id зони в селекції (мердж підхопить паспорт)
      setSelectedId(wialonZoneId || linked.id);
      window.setTimeout(() => {
        setActivePanel("inspector");
        setSavedFlash(false);
        setPendingFeature(null);
        setBusy(false);
      }, 650);
    } catch (error) {
      console.error(error);
      setSaveHint("Не вдалося зберегти поле");
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (!selectedItem) return;

    if (selectedItem.source !== "saved" || !selectedItem.farmField) {
      setConfirmDelete(false);
      flashStatus(
        selectedItem.source === "wialon"
          ? "Геозону Wialon не можна видалити з AgroSystem"
          : "Демо-поле лише для огляду"
      );
      return;
    }

    setBusy(true);
    try {
      await deleteFarmField(selectedItem.farmField.id);
      setSavedFields((prev) =>
        prev.filter((field) => field.id !== selectedItem.id)
      );
      setSelectedId(null);
      setConfirmDelete(false);
      setActivePanel(null);
      flashStatus("Поле видалено");
    } catch (error) {
      console.error(error);
      flashStatus("Не вдалося видалити");
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteFromToolbar() {
    if (!selectedItem) return;
    if (selectedItem.source !== "saved") {
      flashStatus("Демо-поля лише для огляду — видаляйте збережені");
      return;
    }
    setActivePanel("inspector");
    setConfirmDelete(true);
  }

  const overlayStyle = {
    position: "fixed" as const,
    left: overlayPos.left,
    top: overlayPos.top,
    bottom: overlayPos.bottom,
    zIndex: 80,
  };

  const inspectorPanel =
    selectedItem && activePanel === "inspector" ? (
      <div
        className="flex w-[min(92vw,400px)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white text-zinc-900 shadow-xl"
        style={{ ...overlayStyle, maxWidth: 400 }}
      >
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-5">
          <div className="sticky top-0 z-20 -mx-1 mb-5 flex items-start justify-between gap-3 bg-white px-1 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: selectedItem.color }}
                  aria-hidden
                />
                <p className="truncate text-lg font-extrabold tracking-tight text-zinc-900">
                  {selectedItem.crop
                    ? `${selectedItem.name}: ${selectedItem.crop}`
                    : selectedItem.name}
                </p>
              </div>
              <p className="mt-1 pl-[22px] text-sm text-zinc-500 tabular-nums">
                {selectedItem.areaHa.toFixed(2)} га
              </p>
            </div>
            <button
              type="button"
              aria-label="Закрити"
              onClick={closePanels}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {confirmDelete ? (
            <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-700">
                {selectedItem.source === "saved"
                  ? `Видалити «${selectedItem.name}» назавжди?`
                  : selectedItem.source === "wialon"
                    ? `«${selectedItem.name}» — геозона Wialon. Видалити з AgroSystem неможливо.`
                    : `«${selectedItem.name}» — демо-поле, лише для огляду.`}
              </p>
              <div className="flex gap-2">
                {selectedItem.source === "saved" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDeleteSelected()}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-rose-500 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-60"
                  >
                    Так, видалити
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className={cn(
                    "inline-flex h-11 items-center justify-center rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50",
                    selectedItem.source === "saved" ? "flex-1" : "w-full"
                  )}
                >
                  {selectedItem.source === "saved" ? "Скасувати" : "Зрозуміло"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-5">
              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setActivePanel(null);
                    setSheetOpen(true);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#276749] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f5239]"
                >
                  <Info className="size-4 shrink-0" />
                  Деталі поля
                </button>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => openFleetPanel(selectedItem)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5DFD3] bg-zinc-50 px-3 py-3 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100"
                  >
                    <History className="size-4 shrink-0" />
                    Історія техніки
                  </button>
                  <button
                    type="button"
                    onClick={() => openPassport(selectedItem)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5DFD3] bg-zinc-50 px-3 py-3 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100"
                  >
                    <Pencil className="size-4 shrink-0" />
                    Паспорт
                  </button>
                </div>
                {selectedItem.geometry ? (
                  <button
                    type="button"
                    onClick={() => startGeometryEdit(selectedItem)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <Pentagon className="size-4 shrink-0" />
                    Редагувати контур
                  </button>
                ) : null}
              </div>

              <FieldMicroclimate
                className="space-y-4"
                weather={fieldWeather}
                hourly={fieldHourly}
                loading={fieldWeatherLoading}
                error={fieldWeatherError}
              />

              <button
                type="button"
                className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-rose-50 py-3 font-medium text-rose-600 transition-colors hover:bg-rose-100"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={18} />
                Видалити поле
              </button>
            </div>
          )}
        </div>
      </div>
    ) : null;

  const passportPanel = passportOpen ? (
      <div
        className="flex w-[min(92vw,400px)] max-w-[400px] flex-col overflow-y-auto rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-5 text-zinc-900 shadow-xl"
        style={overlayStyle}
      >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-extrabold tracking-tight text-zinc-900">
            {passportMode === "edit" ? "Редагувати паспорт" : "Паспорт поля"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Назва · культура · площа · колір
          </p>
        </div>
        <button
          type="button"
          aria-label="Закрити"
          onClick={closePassport}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
            Назва
          </Label>
          <Input
            value={fieldName}
            onChange={(event) => setFieldName(event.target.value)}
            className="h-10 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm text-zinc-900"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
            Культура
          </Label>
          <Select
            items={[...CROP_OPTIONS]}
            value={crop}
            onValueChange={(value) => {
              if (typeof value === "string" && value) {
                setCrop(normalizeCrop(value));
              }
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm text-zinc-900">
              <SelectValue placeholder="Оберіть культуру" />
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              className="z-[220] border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900"
            >
              {CROP_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
            Площа, га
          </Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            value={areaHa}
            onChange={(event) => setAreaHa(Number(event.target.value) || 0)}
            className="h-10 rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm tabular-nums text-zinc-900"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
            Колір обведення
          </Label>
          <div className="flex flex-wrap gap-2.5">
            {FIELD_COLOR_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.label}
                onClick={() => setColor(option.value)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-transform",
                  color === option.value
                    ? "scale-110 border-zinc-900"
                    : "border-white/80 hover:scale-105"
                )}
                style={{ backgroundColor: option.value }}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={busy || savedFlash || !fieldName.trim()}
          onClick={() => void handleConfirmPassport()}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#276749] text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#22543d] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {savedFlash
            ? "Збережено ✓"
            : busy
              ? "Збереження…"
              : passportMode === "edit"
                ? "Оновити паспорт"
                : "Зберегти паспорт"}
        </button>

        {saveHint ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {saveHint}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-500">
            Дані зберігаються в базі й підтягуються в «Деталі поля» після
            оновлення сторінки.
          </p>
        )}
      </div>
    </div>
  ) : null;

  const canSaveContour =
    Boolean(editingFieldId) || drawnContours.features.length > 0;

  const toolbarAction = canSaveContour ? (
    <>
      {editingFieldId ? null : (
        <span className="mx-0.5 hidden h-6 w-px bg-[#E5DFD3] sm:block" />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={handleOpenCreatePassport}
        className="inline-flex items-center gap-2 rounded-lg bg-[#276749] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#22543d] disabled:opacity-60"
      >
        <Save className="h-4 w-4" />
        {editingFieldId ? "Зберегти контур" : "Зберегти поле"}
      </button>
      {editingFieldId ? (
        <button
          type="button"
          onClick={() => {
            fieldsMapRef.current?.clearDraw();
            setEditingFieldId(null);
            setActivePanel(null);
            flashStatus("Редагування скасовано");
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-[#C05621]/35 bg-[#C05621]/10 px-3 py-2 text-sm font-bold text-[#C05621] transition-colors hover:bg-[#C05621]/15"
        >
          <X className="h-4 w-4" />
          Скасувати
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <main className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-4 pt-2 pb-3 sm:px-6 lg:px-8">
      <FieldsTopBar
        plotCount={mapFields.length}
        totalHa={totalHa}
        fieldsLoading={wialonLoading}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-5 lg:gap-4">
        <GlassCard className="flex min-h-0 flex-col overflow-hidden p-4 hover:scale-100 lg:col-span-1">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-500">Список ділянок</p>
            <button
              type="button"
              title="Показати всі на карті"
              onClick={() => fieldsMapRef.current?.fitAllFields()}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-700"
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
          </div>

          <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
            {wialonLoading ? (
              <>
                <li className="flex items-center gap-2 px-1 py-1.5 text-xs font-medium text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Завантаження ділянок…
                </li>
                {Array.from({ length: 6 }).map((_, index) => (
                  <li
                    key={`field-skeleton-${index}`}
                    className="flex items-center gap-3 rounded-xl border border-[#E5DFD3] bg-zinc-100/80 px-3 py-2.5"
                    aria-hidden
                  >
                    <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-zinc-300" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="h-3.5 w-[70%] animate-pulse rounded bg-zinc-200/90" />
                      <div className="h-2.5 w-16 animate-pulse rounded bg-zinc-200/70" />
                    </div>
                  </li>
                ))}
              </>
            ) : (
              mapFields.map((field) => {
                const active =
                  selectedId === field.id || editingFieldId === field.id;
                return (
                  <li key={field.id}>
                    <button
                      type="button"
                      onClick={() => selectField(field)}
                      onDoubleClick={() => {
                        setSelectedId(field.id);
                        setActivePanel(null);
                        setSheetOpen(true);
                        if (field.geometry) {
                          fieldsMapRef.current?.focusGeometry(field.geometry);
                        }
                      }}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                        active
                          ? "border-[#276749] bg-emerald-50/50 shadow-sm"
                          : "border-[#E5DFD3] bg-zinc-100 hover:border-[#E5DFD3] hover:bg-[#E5DFD3]/40"
                      )}
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full transition-transform",
                          active && "scale-125 ring-2 ring-white"
                        )}
                        style={{ backgroundColor: field.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {field.crop
                            ? `${field.name}: ${field.crop}`
                            : field.name}
                        </p>
                        <p className="text-xs tabular-nums text-zinc-500">
                          {field.areaHa.toFixed(2)} га
                          {editingFieldId === field.id
                            ? " · редагування"
                            : field.source === "saved"
                              ? " · ваше"
                              : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {(saveHint || statusHint) && (
            <div className="mt-3 shrink-0 border-t border-[#E5DFD3] pt-2.5">
              {saveHint ? (
                <p className="text-[11px] leading-snug text-[#C05621]">
                  {saveHint}
                </p>
              ) : statusHint ? (
                <p className="text-[11px] leading-snug text-[#276749]">
                  {statusHint}
                </p>
              ) : null}
            </div>
          )}
        </GlassCard>

        <GlassCard className="relative min-h-[420px] overflow-visible p-0 hover:translate-y-0 hover:shadow-sm lg:col-span-4 lg:min-h-0">
          <div ref={mapHostRef} className="absolute inset-0">
            <FieldsMap
              ref={fieldsMapRef}
              className="h-full w-full rounded-xl"
              onFieldClick={openFieldById}
              onDrawnFeaturesChange={handleDrawnFeaturesChange}
              savedFieldsGeoJson={savedGeoJson}
              wialonUnits={wialonUnits}
              wialonGeofences={mapWialonGeofences}
              wialonLoading={wialonLoading}
              editingFieldId={editingFieldId}
              selectedFieldId={selectedId}
              geometryEditMode={Boolean(editingFieldId)}
              toolbarAction={toolbarAction}
              overlayActive={activePanel != null}
              onRequestDeleteSelection={requestDeleteFromToolbar}
              onEscape={handleEscape}
            />
          </div>
        </GlassCard>
      </div>

      {portalReady
        ? createPortal(
            <>
              {inspectorPanel}
              {passportPanel}
            </>,
            document.body
          )
        : null}

      <FieldTechHistorySheet
        open={isFieldHistoryOpen}
        onOpenChange={(open) => {
          setIsFieldHistoryOpen(open);
          if (!open) restoreMapOverview();
        }}
        fieldName={selectedItem?.name ?? null}
        areaHa={selectedItem?.areaHa ?? null}
        fieldGeometry={selectedItem?.geometry ?? null}
        units={wialonUnits}
      />

      <FieldDetailSheet
        field={sheetField}
        fieldKey={sheetFieldKey}
        legacyFieldKeys={sheetLegacyFieldKeys}
        farmFieldId={selectedItem?.farmField?.id ?? null}
        fieldGeometry={selectedItem?.geometry ?? null}
        analytics={sheetAnalytics}
        units={wialonUnits}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) restoreMapOverview();
        }}
        onPlanWork={() => {
          flashStatus("Роботу заплановано · див. історію операцій");
        }}
      />
    </main>
  );
}

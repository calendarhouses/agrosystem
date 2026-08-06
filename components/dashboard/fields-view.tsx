"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  CloudSun,
  Droplets,
  Focus,
  Loader2,
  Map as MapIcon,
  MapPin,
  Pencil,
  Pentagon,
  Save,
  Settings2,
  Tractor,
  Trash2,
  Wind,
  X,
} from "lucide-react";

import { FieldDetailSheet } from "@/components/dashboard/field-detail-sheet";
import { FieldMicroclimate } from "@/components/dashboard/field-microclimate";
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
  DEFAULT_WEATHER_LOCATION,
  fetchWeather,
  readStoredWeatherLocation,
  writeStoredWeatherLocation,
  type WeatherLocation,
  type WeatherSnapshot,
} from "@/lib/weather";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import { cn } from "@/lib/utils";

const EMPTY_DRAWN: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const CROP_OPTIONS = [
  "Соя",
  "Кукурудза",
  "Пшениця",
  "Соняшник",
  "Ріпак",
  "Ячмінь",
] as const;

type PassportMode = "create" | "edit";
type ActivePanel = "inspector" | "passport" | "fleet";
type FleetPeriod = "today" | "week" | "season";

const FLEET_PERIODS: { id: FleetPeriod; label: string }[] = [
  { id: "today", label: "Сьогодні" },
  { id: "week", label: "7 днів" },
  { id: "season", label: "Сезон" },
];

const FLEET_HISTORY: Record<
  FleetPeriod,
  Array<{ id: string; when: string; machine: string; task: string; hours: string }>
> = {
  today: [
    {
      id: "t1",
      when: "09:20–13:40",
      machine: "John Deere 8R",
      task: "Дискування",
      hours: "4 год 20 хв",
    },
  ],
  week: [
    {
      id: "w1",
      when: "5 сер",
      machine: "John Deere 8R",
      task: "Дискування",
      hours: "4 год 20 хв",
    },
    {
      id: "w2",
      when: "3 сер",
      machine: "Case IH Magnum",
      task: "Обприскування",
      hours: "2 год 10 хв",
    },
    {
      id: "w3",
      when: "1 сер",
      machine: "Claas Lexion",
      task: "Огляд",
      hours: "0 год 45 хв",
    },
  ],
  season: [
    {
      id: "s1",
      when: "Серпень",
      machine: "John Deere 8R",
      task: "Обробіток ґрунту",
      hours: "28 год",
    },
    {
      id: "s2",
      when: "Липень",
      machine: "Case IH Magnum",
      task: "ЗЗР",
      hours: "11 год",
    },
    {
      id: "s3",
      when: "Травень",
      machine: "John Deere 8R",
      task: "Посів",
      hours: "16 год",
    },
  ],
};

/** Компактна шапка: заголовок + жива погода Open-Meteo */
function FieldsTopBar({
  plotCount,
  totalHa,
}: {
  plotCount: number;
  totalHa: number;
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
            {plotCount} ділянок · {totalHa} га
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#D69E2E]/30 bg-[#D69E2E]/15">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#D69E2E]" />
          ) : (
            <CloudSun className="h-4 w-4 text-[#D69E2E]" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-extrabold tabular-nums leading-none text-zinc-900">
              {weather ? `${weather.tempC}°` : "—"}
            </span>
            <span className="hidden text-[11px] text-zinc-500 sm:inline">
              {error ? "Немає даних" : weather?.condition ?? "Завантаження…"}
            </span>
          </div>
          <p className="truncate text-[10px] text-zinc-500 sm:text-[11px]">
            {location.label}
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
  const [overlayPos, setOverlayPos] = useState<{ left: number; bottom: number }>({
    left: 24,
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
      bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
    });
  }, []);

  const [drawnContours, setDrawnContours] =
    useState<FeatureCollection>(EMPTY_DRAWN);
  const [savedFields, setSavedFields] = useState<FarmField[]>([]);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [fleetPeriod, setFleetPeriod] = useState<FleetPeriod>("today");
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
    () => buildMapFieldList(savedFields),
    [savedFields]
  );

  const selectedItem = useMemo(
    () => mapFields.find((item) => item.id === selectedId) ?? null,
    [mapFields, selectedId]
  );

  const [fieldWeather, setFieldWeather] = useState<WeatherSnapshot | null>(null);
  const [fieldWeatherLoading, setFieldWeatherLoading] = useState(false);
  const [fieldWeatherError, setFieldWeatherError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedItem?.geometry) {
      setFieldWeather(null);
      setFieldWeatherError(null);
      setFieldWeatherLoading(false);
      return;
    }

    const centroid = fieldCentroid(selectedItem.geometry);
    if (!centroid) {
      setFieldWeather(null);
      setFieldWeatherError("Немає центру поля");
      return;
    }

    const controller = new AbortController();
    setFieldWeatherLoading(true);
    setFieldWeatherError(null);

    fetchWeather(centroid.latitude, centroid.longitude, controller.signal)
      .then((data) => {
        setFieldWeather(data);
        setFieldWeatherLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFieldWeather(null);
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

  const sheetAnalytics = useMemo(
    () => (selectedItem ? analyticsForMapField(selectedItem) : null),
    [selectedItem]
  );

  const savedGeoJson = useMemo(
    () => farmFieldsToGeoJson(savedFields),
    [savedFields]
  );

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

  const flashStatus = useCallback((message: string) => {
    setStatusHint(message);
    window.setTimeout(() => setStatusHint(null), 3200);
  }, []);

  const closePanels = useCallback(() => {
    setActivePanel(null);
    setConfirmDelete(false);
    setPendingFeature(null);
    setSavedFlash(false);
  }, []);

  const closePassport = useCallback(() => {
    setActivePanel(null);
    setPendingFeature(null);
    setSavedFlash(false);
    if (editingFieldId) {
      fieldsMapRef.current?.clearDraw();
      setEditingFieldId(null);
    }
  }, [editingFieldId]);

  const selectField = useCallback(
    (item: MapFieldItem, options?: { fly?: boolean }) => {
      setConfirmDelete(false);
      setSelectedId(item.id);
      setActivePanel("inspector");
      setPendingFeature(null);
      setSavedFlash(false);

      if (options?.fly !== false && item.geometry) {
        fieldsMapRef.current?.focusGeometry(item.geometry);
      }
    },
    []
  );

  const openFieldById = useCallback(
    (fieldId: string) => {
      const item = mapFields.find((field) => field.id === fieldId);
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
    if (activePanel) {
      setActivePanel(null);
      return;
    }
    setSelectedId(null);
  }, [activePanel, closePassport, confirmDelete]);

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
    setCrop(CROP_OPTIONS[0]);
    setAreaHa(hectares);
    setColor(FIELD_COLOR_OPTIONS[colorIndex].value);
    setSaveHint(null);
    setSavedFlash(false);
    setSelectedId(null);
    setActivePanel("passport");
  }

  function openEditPassport(item: MapFieldItem) {
    if (item.source !== "saved" || !item.farmField) return;
    setPassportMode("edit");
    setPendingFeature(null);
    setFieldName(item.name);
    setCrop(item.crop);
    setAreaHa(item.areaHa);
    setColor(item.color);
    setEditingFieldId(null);
    setSaveHint(null);
    setSavedFlash(false);
    setSelectedId(item.id);
    setActivePanel("passport");
  }

  function startGeometryEdit(item: MapFieldItem) {
    if (item.source !== "saved" || !item.farmField || !item.geometry) return;

    setActivePanel(null);
    setConfirmDelete(false);
    setEditingFieldId(item.id);
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
    setFleetPeriod("today");
    setActivePanel("fleet");
  }

  async function persistGeometryEdit(feature: Feature<Geometry>) {
    if (!editingFieldId || !isPolygonGeometry(feature.geometry)) return;

    setBusy(true);
    try {
      const hectares = hectaresFromFeature(feature);
      const updated = await updateFarmField(editingFieldId, {
        geometry: feature.geometry,
        areaHa: hectares,
      });

      setSavedFields((prev) =>
        prev.map((field) => (field.id === updated.id ? updated : field))
      );

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
          setActivePanel(null);
          setSavedFlash(false);
          setBusy(false);
        }, 550);
        return;
      }

      if (
        !pendingFeature ||
        !isPolygonGeometry(pendingFeature.geometry)
      ) {
        setBusy(false);
        return;
      }

      const saved = await createFarmField({
        name: fieldName.trim(),
        crop,
        areaHa,
        color,
        geometry: pendingFeature.geometry,
      });

      setSavedFields((prev) => [
        saved,
        ...prev.filter((field) => field.id !== saved.id),
      ]);

      if (pendingFeature.id != null) {
        fieldsMapRef.current?.removeDrawFeature(pendingFeature.id);
      }

      setSavedFlash(true);
      setSelectedId(saved.id);
      window.setTimeout(() => {
        setActivePanel(null);
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
    if (!selectedItem || selectedItem.source !== "saved" || !selectedItem.farmField) {
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
    bottom: overlayPos.bottom,
    zIndex: 80,
  };

  const inspectorPanel =
    selectedItem && activePanel === "inspector" ? (
      <div
        className="w-[min(92vw,380px)] rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-5 text-zinc-900 shadow-xl"
        style={overlayStyle}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full ring-2 ring-white"
                style={{ backgroundColor: selectedItem.color }}
              />
              <span className="rounded-full border border-[#E5DFD3] bg-zinc-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                {selectedItem.source === "saved" ? "Збережено" : "Демо"}
              </span>
            </div>
            <p className="text-lg font-extrabold tracking-tight text-zinc-900">
              {selectedItem.name}: {selectedItem.crop}
            </p>
            <p className="mt-1 text-sm tabular-nums text-zinc-500">
              {selectedItem.areaHa} га
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрити"
            onClick={closePanels}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <FieldMicroclimate
          className="mb-4"
          weather={fieldWeather}
          loading={fieldWeatherLoading}
          error={fieldWeatherError}
        />

        {confirmDelete ? (
          <div className="space-y-3 rounded-xl border border-[#C05621]/25 bg-[#C05621]/5 p-4">
            <p className="text-sm font-semibold text-[#C05621]">
              Видалити «{selectedItem.name}» назавжди?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteSelected()}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-[#C05621] text-sm font-bold text-white transition-colors hover:bg-[#9c4221] disabled:opacity-60"
              >
                Так, видалити
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-700 transition-colors hover:bg-[#E5DFD3]/60"
              >
                Скасувати
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                setSheetOpen(true);
              }}
              className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#276749] text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#22543d]"
            >
              Деталі поля
            </button>

            {selectedItem.source === "saved" ? (
              <>
                <button
                  type="button"
                  onClick={() => openEditPassport(selectedItem)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                >
                  <Pencil className="h-4 w-4" />
                  Паспорт
                </button>
                <button
                  type="button"
                  onClick={() => startGeometryEdit(selectedItem)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                >
                  <Pentagon className="h-4 w-4" />
                  Контур
                </button>
                <button
                  type="button"
                  onClick={() => openFleetPanel(selectedItem)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                >
                  <Tractor className="h-4 w-4" />
                  Техніка
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#C05621]/25 bg-[#C05621]/10 text-sm font-semibold text-[#C05621] transition-colors hover:bg-[#C05621]/15"
                >
                  <Trash2 className="h-4 w-4" />
                  Видалити
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openFleetPanel(selectedItem)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
                >
                  <Tractor className="h-4 w-4" />
                  Техніка
                </button>
                <p className="flex items-center justify-center text-xs leading-snug text-zinc-500">
                  Демо-поле · лише огляд
                </p>
              </>
            )}
          </div>
        )}
      </div>
    ) : null;

  const fleetPanel =
    selectedItem && activePanel === "fleet" ? (
      <div
        className="w-[min(92vw,400px)] rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-5 text-zinc-900 shadow-xl"
        style={overlayStyle}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-extrabold tracking-tight text-zinc-900">
              Техніка на полі
            </p>
            <p className="mt-1 truncate text-sm text-zinc-500">
              {selectedItem.name}: {selectedItem.crop}
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрити"
            onClick={closePanels}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[#E5DFD3]/60 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-[#276749]/25 bg-[#276749]/10 px-3.5 py-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#276749] uppercase">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#276749]" />
            Зараз на полі
          </div>
          <p className="text-sm font-bold text-zinc-900">John Deere 8R</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            Дискування · 12 км/год · паливо 45%
          </p>
        </div>

        <FieldMicroclimate
          className="mb-4"
          weather={fieldWeather}
          loading={fieldWeatherLoading}
          error={fieldWeatherError}
        />

        <div className="mb-3 flex gap-1.5 rounded-xl bg-zinc-100 p-1">
          {FLEET_PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              onClick={() => setFleetPeriod(period.id)}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
                fleetPeriod === period.id
                  ? "bg-[#F4F1EA] text-[#276749] shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {period.label}
            </button>
          ))}
        </div>

        <p className="mb-2 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
          Історія за період
        </p>
        <ul className="max-h-[240px] space-y-2 overflow-y-auto pr-0.5">
          {FLEET_HISTORY[fleetPeriod].map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-[#E5DFD3] bg-zinc-100/80 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">{row.machine}</p>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {row.when}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-600">
                {row.task} · {row.hours}
              </p>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setActivePanel(null);
            flashStatus("Відкрийте розділ Техніка для повного журналу");
          }}
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border border-[#E5DFD3] bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors hover:bg-[#E5DFD3]/70"
        >
          Закрити
        </button>
      </div>
    ) : null;

  const passportPanel = passportOpen ? (
      <div
        className="w-[min(92vw,400px)] rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-5 text-zinc-900 shadow-xl"
        style={overlayStyle}
      >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-extrabold tracking-tight text-zinc-900">
            {passportMode === "edit" ? "Редагувати паспорт" : "Паспорт поля"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Назва · культура · колір обведення
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
          <Select value={crop} onValueChange={(value) => value && setCrop(value)}>
            <SelectTrigger className="h-10 w-full rounded-lg border-[#E5DFD3] bg-zinc-100 text-sm text-zinc-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[90] border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900">
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
                : "Зберегти поле"}
        </button>
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
      <FieldsTopBar plotCount={mapFields.length} totalHa={totalHa} />

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
            {mapFields.map((field) => {
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
                        ? "border-[#276749]/35 bg-[#276749]/10 shadow-sm"
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
                        {field.name}: {field.crop}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {field.areaHa} га
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
            })}
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
              {fleetPanel}
              {passportPanel}
            </>,
            document.body
          )
        : null}

      <FieldDetailSheet
        field={sheetField}
        analytics={sheetAnalytics}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onPlanWork={() => {
          setSheetOpen(false);
          flashStatus("Роботу додано до черги операцій");
        }}
      />
    </main>
  );
}

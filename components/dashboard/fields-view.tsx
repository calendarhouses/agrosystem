"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import { useSearchParams } from "next/navigation";

import {
  FieldDetailSheet,
  type FieldHubTab,
} from "@/components/dashboard/field-detail-sheet";
import {
  normalizeFieldCrop,
  FIELD_CROP_OPTIONS,
} from "@/components/dashboard/field-passport-form";
import {
  FieldsGlassPanel,
  FieldsDetailGlassFrame,
} from "@/components/dashboard/fields-glass-panel";
import { FieldsMapChrome } from "@/components/dashboard/fields-map-chrome";
import {
  FieldsMap,
  type FieldsMapHandle,
} from "@/components/dashboard/fields-map";
import { getCompanyFinancialOverview } from "@/app/finance/actions";
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
  buildMapFieldList,
  mapItemToSheetField,
  nextFieldNumber,
  type MapFieldItem,
} from "@/lib/map-fields";
import {
  fieldOperationsKey,
  fieldOperationsLegacyKeys,
} from "@/lib/field-operations";
import { useSeasonStore } from "@/lib/season-store";
import { syncPlannedOpsFromTrackerPresence } from "@/lib/field-operation-tracker";
import type {
  WialonGeofenceProperties,
  WialonUnit,
} from "@/lib/wialon";
import {
  fetchWeatherWithHourly,
  type HourlyForecastHour,
  type WeatherSnapshot,
} from "@/lib/weather";
import { useFieldRealtime } from "@/lib/use-field-realtime";
import { useLiveWialonUnits } from "@/lib/use-live-wialon-units";
import {
  COMMAND_CENTER_MAP_AREA_CLASS,
  COMMAND_CENTER_MAP_AREA_RIGHT_CLASS,
} from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

const EMPTY_DRAWN: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_GEOFENCES: FeatureCollection<Polygon, WialonGeofenceProperties> = {
  type: "FeatureCollection",
  features: [],
};

const CROP_OPTIONS = FIELD_CROP_OPTIONS;

function normalizeCrop(value: string | null | undefined): string {
  return normalizeFieldCrop(value);
}

type PassportMode = "create" | "edit";

/** Головний розділ: жива карта полів з повним CRUD */
export function FieldsView() {
  const searchParams = useSearchParams();
  const fieldsMapRef = useRef<FieldsMapHandle>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const activeSeason = useSeasonStore((s) => s.activeSeason);

  const [drawnContours, setDrawnContours] =
    useState<FeatureCollection>(EMPTY_DRAWN);
  const [savedFields, setSavedFields] = useState<FarmField[]>([]);
  const [wialonSeedUnits, setWialonSeedUnits] = useState<WialonUnit[] | null>(
    null
  );
  const [wialonGeofences, setWialonGeofences] =
    useState<FeatureCollection<Polygon, WialonGeofenceProperties>>(
      EMPTY_GEOFENCES
    );
  const [wialonBootLoading, setWialonBootLoading] = useState(true);
  const [wialonLoadError, setWialonLoadError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const { units: wialonUnits } = useLiveWialonUnits({
    enabled: true,
    intervalMs: 15_000,
    seedUnits: wialonSeedUnits,
  });

  /** Повний boot (геозони + seed) ще йде — скелетони в списку */
  const wialonLoading = wialonBootLoading && wialonSeedUnits == null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const hoverIntentRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewedIdRef = useRef<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mobileListExpanded, setMobileListExpanded] = useState(false);
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [mapToolActive, setMapToolActive] = useState(false);
  const [hubInitialTab, setHubInitialTab] = useState<FieldHubTab>("overview");
  const [hubConfirmDelete, setHubConfirmDelete] = useState(false);
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
  const [fieldBudgetPct, setFieldBudgetPct] = useState<
    Record<string, number | null>
  >({});
  const [realtimeVersion, setRealtimeVersion] = useState(0);

  const reloadFarmFields = useCallback(() => {
    void listFarmFields().then(setSavedFields);
  }, []);

  const reloadFinanceOverview = useCallback(() => {
    void getCompanyFinancialOverview(activeSeason).then((res) => {
      if (!res.ok) return;
      const next: Record<string, number | null> = {};
      for (const row of res.data.fields) {
        next[row.fieldId.toLowerCase()] = row.burnRate;
      }
      setFieldBudgetPct(next);
    });
  }, [activeSeason]);

  const mapFields = useMemo(
    () =>
      buildMapFieldList(savedFields, wialonGeofences, {
        // Ніколи не підставляємо фейкові «Поле 1/2/3» — лише Wialon + збережені
        allowDemoFallback: false,
      }),
    [savedFields, wialonGeofences]
  );

  const { connected: liveConnected, pulse: livePulse } = useFieldRealtime({
    onFarmFieldsChange: () => {
      reloadFarmFields();
      reloadFinanceOverview();
    },
    onFieldOperationsChange: () => {
      setRealtimeVersion((version) => version + 1);
      reloadFinanceOverview();
    },
    onInventoryMovesChange: () => {
      setRealtimeVersion((version) => version + 1);
      reloadFinanceOverview();
    },
  });

  const selectedItem = useMemo(
    () => mapFields.find((item) => item.id === selectedId) ?? null,
    [mapFields, selectedId]
  );

  const occupiedWialonZones = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of savedFields) {
      const zoneId = field.wialonZoneId?.trim();
      if (zoneId) map[zoneId] = field.name;
    }
    return map;
  }, [savedFields]);

  const sheetWialonZoneId =
    selectedItem?.farmField?.wialonZoneId?.trim() ||
    (selectedItem?.source === "wialon" ? selectedItem.id : null);

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

  const sheetField = useMemo(() => {
    if (selectedItem) return mapItemToSheetField(selectedItem);
    if (sheetOpen && pendingFeature) {
      const hectares = isPolygonGeometry(pendingFeature.geometry)
        ? hectaresFromFeature(pendingFeature)
        : areaHa;
      const draftArea = areaHa > 0 ? areaHa : hectares;
      return {
        id: "draft",
        name: fieldName.trim() || "Нове поле",
        crop: crop || CROP_OPTIONS[0],
        areaHa: draftArea,
        status: "active" as const,
        mapPositionClass: "",
        accent: "lime" as const,
        economics: {
          costPerHaUsd: 0,
          fuelUsedL: 0,
          expectedRevenueUsd: 0,
        },
        timeline: [],
      };
    }
    return null;
  }, [selectedItem, sheetOpen, pendingFeature, fieldName, crop, areaHa]);

  const sheetFieldKey = useMemo(
    () => (selectedItem ? fieldOperationsKey(selectedItem) : null),
    [selectedItem]
  );

  const sheetLegacyFieldKeys = useMemo(
    () => (selectedItem ? fieldOperationsLegacyKeys(selectedItem) : []),
    [selectedItem]
  );

  useEffect(() => {
    let cancelled = false;
    void getCompanyFinancialOverview(activeSeason).then((res) => {
      if (cancelled || !res.ok) return;
      const next: Record<string, number | null> = {};
      for (const row of res.data.fields) {
        next[row.fieldId.toLowerCase()] = row.burnRate;
      }
      setFieldBudgetPct(next);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSeason]);

  const savedGeoJson = useMemo(() => {
    const base = farmFieldsToGeoJson(
      savedFields.filter((field) => !field.wialonZoneId?.trim())
    );
    return {
      ...base,
      features: base.features.map((feature) => {
        const id = String(feature.properties?.id ?? feature.id ?? "");
        return {
          ...feature,
          properties: {
            ...feature.properties,
            budgetPct: fieldBudgetPct[id.toLowerCase()] ?? null,
          },
        };
      }),
    };
  }, [savedFields, fieldBudgetPct]);

  /** Колір / назва / культура з паспорта накладаються на шар Wialon */
  const mapWialonGeofences = useMemo(() => {
    const passportByZone = new Map(
      savedFields
        .filter((field) => field.wialonZoneId?.trim())
        .map((field) => [field.wialonZoneId!.trim(), field] as const)
    );
    if (passportByZone.size === 0) {
      return {
        type: "FeatureCollection" as const,
        features: wialonGeofences.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            budgetPct: null,
          },
        })),
      };
    }

    return {
      type: "FeatureCollection" as const,
      features: wialonGeofences.features.map((feature) => {
        const zoneId = String(feature.properties?.id ?? feature.id ?? "");
        const passport = passportByZone.get(zoneId);
        if (!passport) {
          return {
            ...feature,
            properties: {
              ...feature.properties,
              budgetPct: null,
            },
          };
        }
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
            budgetPct: fieldBudgetPct[passport.id.toLowerCase()] ?? null,
          },
        };
      }),
    };
  }, [wialonGeofences, savedFields, fieldBudgetPct]);

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

  /** Лікує старі паспорти без wialon_zone_id — пише звʼязок у farm_fields (не лише в state) */
  const wialonHealAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (wialonLoading || wialonGeofences.features.length === 0) return;

    const orphans = savedFields.filter((field) => {
      if (field.wialonZoneId?.trim()) return false;
      if (field.id.startsWith("local-")) return false;
      if (wialonHealAttemptedRef.current.has(field.id)) return false;
      return true;
    });
    if (orphans.length === 0) return;

    const occupiedZones = new Set(
      savedFields
        .map((field) => field.wialonZoneId?.trim())
        .filter((id): id is string => Boolean(id))
    );

    let cancelled = false;

    void (async () => {
      const patched: FarmField[] = [];

      for (const field of orphans) {
        wialonHealAttemptedRef.current.add(field.id);
        const match = wialonGeofences.features.find(
          (feature) =>
            feature.properties?.name?.trim() === field.name.trim()
        );
        const zoneId = match?.properties?.id;
        if (zoneId == null) continue;
        const zoneKey = String(zoneId);
        if (occupiedZones.has(zoneKey)) continue;

        try {
          const updated = await updateFarmField(field.id, {
            wialonZoneId: zoneKey,
          });
          // Якщо API не повернув колонку — не вважаємо залікованим
          if (!updated.wialonZoneId?.trim()) {
            wialonHealAttemptedRef.current.delete(field.id);
            continue;
          }
          occupiedZones.add(zoneKey);
          patched.push(updated);
        } catch (err) {
          wialonHealAttemptedRef.current.delete(field.id);
          console.error("[wialon-zone-heal]", field.id, err);
        }
      }

      if (!cancelled && patched.length > 0) {
        setSavedFields((prev) => {
          const byId = new Map(patched.map((field) => [field.id, field]));
          return prev.map((field) => byId.get(field.id) ?? field);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wialonLoading, wialonGeofences, savedFields]);

  useEffect(() => {
    const controller = new AbortController();
    setWialonBootLoading(true);
    setWialonLoadError(null);

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
        setWialonSeedUnits(data.units);
        setWialonGeofences(
          data.geofences?.type === "FeatureCollection"
            ? data.geofences
            : EMPTY_GEOFENCES
        );
        setWialonLoadError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setWialonSeedUnits([]);
        setWialonGeofences(EMPTY_GEOFENCES);
        setWialonLoadError(
          error instanceof Error
            ? error.message
            : "Wialon недоступний — геозони не завантажено"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWialonBootLoading(false);
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
    setSheetOpen(false);
    setPendingFeature(null);
    setSavedFlash(false);
    setSaveHint(null);
    window.setTimeout(() => fieldsMapRef.current?.fitAllFields(), 40);
  }, []);

  const closePassportDraft = useCallback(() => {
    setPendingFeature(null);
    setSavedFlash(false);
    if (editingFieldId) {
      fieldsMapRef.current?.clearDraw();
      setEditingFieldId(null);
    }
    restoreMapOverview();
  }, [editingFieldId, restoreMapOverview]);

  function syncPassportFromItem(item: MapFieldItem) {
    setPassportMode(item.farmField ? "edit" : "create");
    setFieldName(item.name);
    setCrop(normalizeCrop(item.crop));
    setAreaHa(item.areaHa);
    setColor(item.color || FIELD_COLOR_OPTIONS[0].value);
    setSaveHint(null);
    setSavedFlash(false);
  }

  const selectField = useCallback(
    (item: MapFieldItem, options?: { fly?: boolean; tab?: FieldHubTab }) => {
      setSelectedId(item.id);
      syncPassportFromItem(item);
      setHubInitialTab(options?.tab ?? "overview");
      setSheetOpen(true);
      setPendingFeature(null);
      setMobileListExpanded(false);

      if (options?.fly === false || !item.geometry) return;
      fieldsMapRef.current?.focusFieldForInspector(item.geometry, "detail");
    },
    []
  );

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  /** Затримка перед підсвіткою/польотом — без миготіння при швидкому скролі списку */
  const scheduleListHover = useCallback((fieldId: string | null) => {
    hoverIntentRef.current = fieldId;
    clearHoverTimer();
    const delay = fieldId ? 1340 : 180;
    hoverTimerRef.current = setTimeout(() => {
      const next = hoverIntentRef.current;
      setHoveredFieldId(next);
      hoverTimerRef.current = null;
    }, delay);
  }, [clearHoverTimer]);

  useEffect(() => {
    return () => clearHoverTimer();
  }, [clearHoverTimer]);

  useEffect(() => {
    if (!hoveredFieldId) {
      lastPreviewedIdRef.current = null;
      return;
    }
    if (sheetOpen) return;
    if (lastPreviewedIdRef.current === hoveredFieldId) return;

    const item = mapFields.find((field) => field.id === hoveredFieldId);
    if (!item?.geometry) return;

    lastPreviewedIdRef.current = hoveredFieldId;
    fieldsMapRef.current?.previewFieldFocus(item.geometry);
  }, [hoveredFieldId, mapFields, sheetOpen]);

  const openFieldById = useCallback(
    (fieldId: string) => {
      const needle = fieldId.trim();
      if (!needle) return;
      const item =
        mapFields.find((field) => field.id === needle) ??
        mapFields.find((field) => field.farmField?.id === needle) ??
        mapFields.find(
          (field) => field.farmField?.wialonZoneId?.trim() === needle
        );
      if (!item) return;
      selectField(item, { fly: true });
    },
    [mapFields, selectField]
  );

  /** Deep-link з техніки: /?field={farmFieldId|mapFieldId} */
  const openedFieldDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    const raw = searchParams.get("field")?.trim();
    if (!raw || mapFields.length === 0 || wialonLoading) return;
    if (openedFieldDeepLinkRef.current === raw) return;
    const item =
      mapFields.find((field) => field.id === raw) ??
      mapFields.find((field) => field.farmField?.id === raw);
    if (!item) return;
    openedFieldDeepLinkRef.current = raw;
    selectField(item, { fly: true });
  }, [searchParams, mapFields, wialonLoading, selectField]);

  const handleDrawnFeaturesChange = useCallback(
    (features: FeatureCollection) => {
      setDrawnContours(features);
      setSaveHint(null);
    },
    []
  );

  const handleEscape = useCallback(() => {
    if (editingFieldId) {
      fieldsMapRef.current?.clearDraw();
      setEditingFieldId(null);
      flashStatus("Редагування скасовано");
      return;
    }
    if (sheetOpen) {
      setSheetOpen(false);
      if (!selectedId && pendingFeature) {
        setPendingFeature(null);
      }
      return;
    }
    if (selectedId) {
      restoreMapOverview();
    }
  }, [
    editingFieldId,
    flashStatus,
    pendingFeature,
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
    setHubInitialTab("settings");
    setSheetOpen(true);
  }

  function startGeometryEdit(item: MapFieldItem) {
    if (!item.geometry) {
      flashStatus("Немає контуру для редагування");
      return;
    }

    setSheetOpen(false);
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
          setHubInitialTab("overview");
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
        setPassportMode("edit");
        setSelectedId(wialonZoneId || updated.id);
        window.setTimeout(() => {
          setHubInitialTab("overview");
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

      // Якщо БД не зберегла zone id — дописуємо окремим UPDATE
      let linked = saved;
      if (wialonZoneId && !saved.wialonZoneId?.trim()) {
        linked = await updateFarmField(saved.id, { wialonZoneId });
      }

      setSavedFields((prev) => [
        linked,
        ...prev.filter((field) => field.id !== linked.id),
      ]);

      if (pendingFeature?.id != null) {
        fieldsMapRef.current?.removeDrawFeature(pendingFeature.id);
      }

      setSavedFlash(true);
      setPassportMode("edit");
      // для Wialon лишаємо id зони в селекції (мердж підхопить паспорт)
      setSelectedId(wialonZoneId || linked.id);
      window.setTimeout(() => {
        setHubInitialTab("overview");
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
    const farmId = selectedItem?.farmField?.id;

    if (farmId) {
      setBusy(true);
      try {
        await deleteFarmField(farmId);
        setSavedFields((prev) => prev.filter((field) => field.id !== farmId));
        setSelectedId(null);
        setHubConfirmDelete(false);
        setSheetOpen(false);
        setPassportMode("create");
        flashStatus("Поле видалено");
      } catch (error) {
        console.error(error);
        flashStatus("Не вдалося видалити");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (pendingFeature || (sheetOpen && passportMode === "create")) {
      if (pendingFeature?.id != null) {
        fieldsMapRef.current?.removeDrawFeature(pendingFeature.id);
      } else {
        fieldsMapRef.current?.clearDraw();
      }
      setHubConfirmDelete(false);
      closePassportDraft();
      flashStatus("Чернетку поля видалено");
      return;
    }

    if (!selectedItem) return;

    flashStatus(
      selectedItem.source === "wialon"
        ? "Геозону Wialon не можна видалити з AgroSystem"
        : "Видаляти можна лише збережені поля"
    );
  }

  function requestDeleteFromToolbar() {
    if (!selectedItem) return;
    if (selectedItem.source !== "saved") {
      flashStatus("Спочатку збережіть поле з паспортом");
      return;
    }
    setHubInitialTab("settings");
    setHubConfirmDelete(true);
    setSheetOpen(true);
  }

  const canSaveContour =
    Boolean(editingFieldId) || drawnContours.features.length > 0;

  const drawSaveActions = canSaveContour
    ? {
        visible: true as const,
        label: editingFieldId ? "Зберегти контур" : "Зберегти поле",
        disabled: busy,
        cancelVisible: Boolean(editingFieldId),
        onSave: handleOpenCreatePassport,
        onCancel: () => {
          fieldsMapRef.current?.clearDraw();
          setEditingFieldId(null);
          flashStatus("Редагування скасовано");
        },
      }
    : undefined;

  const draftGeometry =
    pendingFeature && isPolygonGeometry(pendingFeature.geometry)
      ? pendingFeature.geometry
      : null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        ref={mapHostRef}
        className="absolute inset-0 z-0 bg-zinc-950"
        data-allow-pan="true"
      >
        <FieldsMap
          ref={fieldsMapRef}
          className="h-full w-full"
          chrome={sheetOpen ? "detail" : "list"}
          onSearchOpenChange={setMapSearchOpen}
          onMapChromeChange={(state) =>
            setMapToolActive(
              state.searchOpen || state.drawing || state.economics
            )
          }
          onFieldClick={openFieldById}
          onDrawnFeaturesChange={handleDrawnFeaturesChange}
          savedFieldsGeoJson={savedGeoJson}
          wialonUnits={wialonUnits}
          wialonGeofences={mapWialonGeofences}
          wialonLoading={wialonLoading}
          editingFieldId={editingFieldId}
          selectedFieldId={selectedId}
          hoveredFieldId={hoveredFieldId}
          geometryEditMode={Boolean(editingFieldId)}
          drawSave={drawSaveActions}
          overlayActive={sheetOpen || mobileListExpanded}
          onRequestDeleteSelection={requestDeleteFromToolbar}
          onEscape={handleEscape}
        />
      </div>

      <div
        className={cn(
          "pointer-events-none z-30 px-3 pb-3",
          "pt-[calc(var(--safe-top)+0.4rem)]",
          sheetOpen
            ? COMMAND_CENTER_MAP_AREA_RIGHT_CLASS
            : COMMAND_CENTER_MAP_AREA_CLASS
        )}
      >
        {!mapSearchOpen && !mobileListExpanded && !mapToolActive ? (
          <div
            className={cn(
              "flex",
              sheetOpen ? "justify-start" : "justify-end"
            )}
          >
            <FieldsMapChrome align={sheetOpen ? "start" : "end"} />
          </div>
        ) : null}
      </div>

      {!sheetOpen ? (
        <FieldsGlassPanel
          fields={mapFields}
          loading={wialonLoading}
          selectedId={selectedId}
          hoveredId={hoveredFieldId}
          editingFieldId={editingFieldId}
          budgetByFieldId={fieldBudgetPct}
          totalHa={totalHa}
          liveConnected={liveConnected}
          livePulse={livePulse}
          statusHint={statusHint}
          saveHint={saveHint}
          wialonLoadError={wialonLoadError}
          mobileExpanded={mobileListExpanded}
          onMobileExpandedChange={setMobileListExpanded}
          onSelect={(field) => selectField(field, { fly: true })}
          onHover={scheduleListHover}
          onFitAll={() => fieldsMapRef.current?.fitAllFields()}
        />
      ) : (
        <>
          <FieldsDetailGlassFrame>
            <FieldDetailSheet
              variant="panel"
              field={sheetField}
              fieldKey={sheetFieldKey}
              legacyFieldKeys={sheetLegacyFieldKeys}
              farmFieldId={selectedItem?.farmField?.id ?? null}
              fieldGeometry={selectedItem?.geometry ?? draftGeometry}
              fieldColor={selectedItem?.color ?? color}
              mapSource={selectedItem?.source ?? "saved"}
              open={sheetOpen}
              onOpenChange={(open) => {
                setSheetOpen(open);
                if (!open) {
                  setHubConfirmDelete(false);
                  if (pendingFeature && !selectedItem) {
                    closePassportDraft();
                  } else {
                    restoreMapOverview();
                  }
                }
              }}
              initialTab={hubInitialTab}
              initialConfirmDelete={hubConfirmDelete}
              units={wialonUnits}
              weather={fieldWeather}
              hourly={fieldHourly}
              weatherLoading={fieldWeatherLoading}
              weatherError={fieldWeatherError}
              passportMode={passportMode}
              passportBusy={busy}
              passportSavedFlash={savedFlash}
              passportSaveHint={saveHint}
              passportName={fieldName}
              passportCrop={crop}
              passportAreaHa={areaHa}
              passportColor={color}
              onPassportNameChange={setFieldName}
              onPassportCropChange={(value) => setCrop(normalizeCrop(value))}
              onPassportAreaHaChange={setAreaHa}
              onPassportColorChange={setColor}
              onPassportSave={() => void handleConfirmPassport()}
              onPassportDelete={() => void handleDeleteSelected()}
              canDeleteField={
                Boolean(selectedItem?.farmField?.id) ||
                Boolean(pendingFeature && sheetOpen)
              }
              onEditGeometry={
                selectedItem ? () => startGeometryEdit(selectedItem) : undefined
              }
              onPlanWork={() => {
                flashStatus("Роботу заплановано · див. історію операцій");
              }}
              realtimeVersion={realtimeVersion}
              wialonZoneId={sheetWialonZoneId}
              wialonGeofences={wialonGeofences}
              wialonLoading={wialonLoading}
              occupiedWialonZones={occupiedWialonZones}
              onIntegrationsFieldUpdated={(updated) => {
                setSavedFields((prev) =>
                  prev.map((field) =>
                    field.id === updated.id ? updated : field
                  )
                );
                setAreaHa(updated.areaHa);
              }}
            />
          </FieldsDetailGlassFrame>
        </>
      )}
    </div>
  );
}

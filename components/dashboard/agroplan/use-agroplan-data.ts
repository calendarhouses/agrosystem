"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getAgroRadarStockContext,
  type AgroRadarStockContext,
} from "@/app/calendar/actions";
import {
  buildSeasonMonths,
  insightsToBlocks,
  mergeAgroplanBlocks,
  type AgroplanBlock,
} from "@/lib/agroplan/blocks";
import {
  applyBlockOverrides,
  blocksOnFields,
  shiftBlocksMs,
  type BlockOverrideState,
} from "@/lib/agroplan/block-overrides";
import {
  DEFAULT_AGROPLAN_FILTERS,
  filterBlocks,
  type AgroplanFilters,
} from "@/lib/agroplan/filters";
import {
  hiddenFromRemote,
  hideBlock,
  loadHiddenBlockIds,
  loadPlacements,
  mergePlacementStores,
  placementsToOverrides,
  queuePlacementSync,
  savePlacementPatch,
} from "@/lib/agroplan/placements";
import {
  createPlacementHistory,
  type PlacementPatch,
} from "@/lib/agroplan/placement-history";
import {
  seasonOperationsToBlocks,
  type AgroplanSeasonOperation,
} from "@/lib/agroplan/season-ops";
import { buildSeasonWindow, clampMsToSeason } from "@/lib/agroplan/timeline";
import { buildDayClimateRisks } from "@/lib/agroplan/weather-risk";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import {
  generateAgroInsights,
  type AgroCurrentWeather,
  type AgroForecastHour,
  type AgroNdviAlert,
  type InsightCardData,
} from "@/lib/agronomy-engine";
import type { AgroFleetUnit } from "@/lib/agronomy-fleet";
import type { AgroInventoryItem } from "@/lib/agronomy-resources";
import type { FleetActiveOperation } from "@/lib/equipment-active-ops";
import { type FarmField } from "@/lib/farm-fields";
import { shiftKyivYmd, todayKyivYmd, toKyivDayKey } from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";
import { useFieldRealtime } from "@/lib/use-field-realtime";
import {
  DEFAULT_WEATHER_LOCATION,
  fetchPlanningWeather,
  fetchWeather,
} from "@/lib/weather";

export type AgroplanData = {
  now: Date;
  seasonId: string;
  fields: FarmField[];
  fieldsLoading: boolean;
  inventory: AgroInventoryItem[];
  fleet: AgroFleetUnit[];
  ndviAlerts: AgroNdviAlert[];
  fuelPriceUah: number;
  liveWeather: AgroCurrentWeather | null;
  weatherLoading: boolean;
  forecastHours: AgroForecastHour[];
  insights: InsightCardData[];
  seasonOperations: AgroplanSeasonOperation[];
  blocks: AgroplanBlock[];
  filteredBlocks: AgroplanBlock[];
  activeOps: FleetActiveOperation[];
  dayRisks: Map<string, import("@/lib/agroplan/weather-risk").DayClimateRisk>;
  season: ReturnType<typeof buildSeasonWindow>;
  filters: AgroplanFilters;
  setFilters: (next: AgroplanFilters) => void;
  setBlockStartMs: (block: AgroplanBlock, startMs: number) => void;
  setBlockDurationHours: (block: AgroplanBlock, durationHours: number) => void;
  shiftBlockByDays: (block: AgroplanBlock, daysDelta: number) => void;
  bulkShiftBlocks: (blockIds: ReadonlySet<string>, daysDelta: number) => void;
  undoLastChange: () => void;
  dismissBlock: (blockId: string) => void;
  refreshStock: () => void;
  refreshSeasonOps: () => void;
  realtimePulse: boolean;
};

export function useAgroplanData(): AgroplanData {
  const now = useMemo(() => new Date(), []);
  const seasonId = useMemo(() => currentAgroSeason(now), [now]);
  const season = useMemo(() => buildSeasonWindow(now), [now]);

  const [fields, setFields] = useState<FarmField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [inventory, setInventory] = useState<AgroInventoryItem[]>([]);
  const [fleet, setFleet] = useState<AgroFleetUnit[]>([]);
  const [ndviAlerts, setNdviAlerts] = useState<AgroNdviAlert[]>([]);
  const [fuelPriceUah, setFuelPriceUah] = useState(50);
  const [forecastHours, setForecastHours] = useState<AgroForecastHour[]>([]);
  const [liveWeather, setLiveWeather] = useState<AgroCurrentWeather | null>(
    null
  );
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [activeOps, setActiveOps] = useState<FleetActiveOperation[]>([]);
  const [seasonOperations, setSeasonOperations] = useState<
    AgroplanSeasonOperation[]
  >([]);
  const initialLocal = loadPlacements();
  const initialOverrides = placementsToOverrides(initialLocal);
  const [blockOverrides, setBlockOverrides] = useState<BlockOverrideState>(
    () => initialOverrides
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(
    () => loadHiddenBlockIds()
  );
  const [filters, setFilters] = useState<AgroplanFilters>(
    DEFAULT_AGROPLAN_FILTERS
  );
  const historyRef = useRef(createPlacementHistory());
  const blocksRef = useRef<AgroplanBlock[]>([]);

  const refreshSeasonOps = useCallback(() => {
    void cachedFetchJson<{
      ok?: boolean;
      operations?: AgroplanSeasonOperation[];
    }>("api:agroplan:season-ops", `/api/agroplan/season-ops?season=${seasonId}`, undefined, {
      force: true,
    })
      .then(({ data }) => setSeasonOperations(data.operations ?? []))
      .catch(() => setSeasonOperations([]));
  }, [seasonId]);

  const refreshStock = useCallback(() => {
    void cachedFetchJson<{
      ok?: boolean;
      stock?: AgroRadarStockContext | null;
    }>("api:agro-radar:stock", "/api/agro-radar/stock", undefined, {
      force: true,
    })
      .then(({ data }) => {
        if (data.stock) return data.stock;
        return getAgroRadarStockContext();
      })
      .catch(() => getAgroRadarStockContext())
      .then((stock) => {
        setInventory(stock.inventory);
        setFleet(stock.fleet);
        setNdviAlerts(stock.ndviAlerts);
        setFuelPriceUah(stock.fuelPriceUah);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFieldsLoading(true);

    type FieldsResponse = { fields?: FarmField[]; error?: string };
    type StockResponse = {
      ok?: boolean;
      stock?: AgroRadarStockContext | null;
      error?: string;
    };

    const fieldsFresh = peekAppCache<FieldsResponse>("api:fields");
    const fieldsStale = peekAppCacheStale<FieldsResponse>("api:fields");
    const stockFresh = peekAppCache<StockResponse>("api:agro-radar:stock");
    const stockStale = peekAppCacheStale<StockResponse>("api:agro-radar:stock");

    const seedFields = fieldsFresh?.fields ?? fieldsStale?.fields;
    const seedStock = stockFresh?.stock ?? stockStale?.stock;

    if (seedFields) setFields(seedFields);
    if (seedStock) {
      setInventory(seedStock.inventory);
      setFleet(seedStock.fleet);
      setNdviAlerts(seedStock.ndviAlerts);
      setFuelPriceUah(seedStock.fuelPriceUah);
      setFieldsLoading(false);
    }

    void Promise.all([
      cachedFetchJson<FieldsResponse>("api:fields", "/api/fields", undefined, {
        force: !fieldsFresh,
      }).then(({ data }) => data.fields ?? []),
      cachedFetchJson<StockResponse>(
        "api:agro-radar:stock",
        "/api/agro-radar/stock",
        undefined,
        { force: !stockFresh }
      )
        .then(({ data }) => {
          if (data.stock) return data.stock;
          return getAgroRadarStockContext();
        })
        .catch(() => getAgroRadarStockContext()),
      cachedFetchJson<{
        ok?: boolean;
        operations?: AgroplanSeasonOperation[];
      }>(
        "api:agroplan:season-ops",
        `/api/agroplan/season-ops?season=${seasonId}`
      ).then(({ data }) => data.operations ?? []),
    ])
      .then(([rows, stock, ops]) => {
        if (cancelled) return;
        setFields(rows);
        setInventory(stock.inventory);
        setFleet(stock.fleet);
        setNdviAlerts(stock.ndviAlerts);
        setFuelPriceUah(stock.fuelPriceUah);
        setSeasonOperations(ops);
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  useEffect(() => {
    let cancelled = false;
    void cachedFetchJson<{
      ok?: boolean;
      placements?: Record<
        string,
        {
          startMs: number;
          durationHours?: number;
          hidden?: boolean;
          updatedAt: string;
        }
      >;
    }>("api:agroplan:placements", `/api/agroplan/placements?season=${seasonId}`)
      .then(({ data }) => {
        if (cancelled || !data.placements) return;
        const merged = mergePlacementStores(loadPlacements(), data.placements);
        setBlockOverrides(placementsToOverrides(merged));
        setHiddenIds(hiddenFromRemote(data.placements));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  useEffect(() => {
    const controller = new AbortController();
    setWeatherLoading(true);

    void Promise.all([
      fetchWeather(
        DEFAULT_WEATHER_LOCATION.latitude,
        DEFAULT_WEATHER_LOCATION.longitude,
        controller.signal
      ),
      fetchPlanningWeather(
        DEFAULT_WEATHER_LOCATION.latitude,
        DEFAULT_WEATHER_LOCATION.longitude,
        controller.signal
      ),
    ])
      .then(([snap, planning]) => {
        setLiveWeather({
          tempC: snap.tempC,
          windMs: snap.windMs,
          soilTempC: snap.soilTempC,
          isRaining: snap.weatherCode >= 51 && snap.weatherCode <= 67,
          weatherCode: snap.weatherCode,
          precipitationMm: undefined,
        });
        setForecastHours(
          (planning.hourly ?? []).map((h) => ({
            time: h.time,
            tempC: h.tempC,
            windMs: h.windMs,
            precipitationMm: h.precipitationMm,
            weatherCode: h.weatherCode,
          }))
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLiveWeather(null);
          setForecastHours([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setWeatherLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void cachedFetchJson<{
        ok?: boolean;
        operations?: FleetActiveOperation[];
      }>("api:equipment:active-ops", "/api/equipment/active-ops")
        .then(({ data }) => {
          if (!cancelled) setActiveOps(data.operations ?? []);
        })
        .catch(() => {
          if (!cancelled) setActiveOps([]);
        });
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const insights = useMemo(() => {
    const activeFields = fields.map((f) => ({
      id: f.id,
      name: f.name,
      crop: f.crop,
      areaHa: f.areaHa,
    }));

    const months = buildSeasonMonths(now);
    const all: InsightCardData[] = [];

    for (const { year, month } of months) {
      const isCurrent =
        month === currentMonth && year === currentYear;
      all.push(
        ...generateAgroInsights({
          activeFields,
          targetMonth: month,
          targetYear: year,
          currentWeather: isCurrent ? liveWeather : null,
          now,
          inventory,
          fuelPriceUah,
          fleet,
          forecastHours: isCurrent ? forecastHours : null,
          ndviAlerts: isCurrent ? ndviAlerts : null,
        })
      );
    }

    return all;
  }, [
    fields,
    now,
    currentMonth,
    currentYear,
    liveWeather,
    inventory,
    fuelPriceUah,
    fleet,
    forecastHours,
    ndviAlerts,
  ]);

  const blocks = useMemo(() => {
    const insightBlocks = insightsToBlocks(insights, now);
    const operationBlocks = seasonOperationsToBlocks(seasonOperations, fields);
    const merged = mergeAgroplanBlocks({
      insightBlocks,
      operationBlocks,
      hiddenIds,
      operations: seasonOperations,
    });
    return applyBlockOverrides(merged, blockOverrides);
  }, [
    insights,
    now,
    seasonOperations,
    fields,
    hiddenIds,
    blockOverrides,
  ]);

  const filteredBlocks = useMemo(
    () => filterBlocks(blocks, filters),
    [blocks, filters]
  );

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const seasonYmds = useMemo(() => {
    const ymds: string[] = [];
    const year = now.getFullYear();
    let ymd = `${year}-01-01`;
    const endYmd = `${year + 1}-03-31`;
    while (ymd <= endYmd) {
      ymds.push(ymd);
      ymd = shiftKyivYmd(ymd, 1);
    }
    return ymds;
  }, [now]);

  const dayRisks = useMemo(
    () =>
      buildDayClimateRisks({
        forecastHours,
        seasonYmds,
      }),
    [forecastHours, seasonYmds]
  );

  const { pulse: realtimePulse } = useFieldRealtime({
    onFieldOperationsChange: () => refreshSeasonOps(),
    onInventoryMovesChange: () => refreshStock(),
  });

  const persistPlacement = useCallback(
    (
      block: AgroplanBlock,
      patch: { startMs: number; durationHours?: number; hidden?: boolean }
    ) => {
      savePlacementPatch(block.id, {
        startMs: patch.startMs,
        durationHours: patch.durationHours ?? block.durationHours,
      });
      queuePlacementSync(seasonId, block.id, {
        startMs: patch.startMs,
        durationHours: patch.durationHours ?? block.durationHours,
        hidden: patch.hidden,
      });
    },
    [seasonId]
  );

  const rescheduleOperation = useCallback(
    (block: AgroplanBlock, startMs: number, silent?: boolean) => {
      if (!block.operationClientKey) return;
      const ymd = toKyivDayKey(new Date(startMs));
      void fetch("/api/agroplan/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: block.operationClientKey,
          occurredAt: ymd,
        }),
      })
        .then(async (res) => {
          const json = (await res.json()) as { ok?: boolean; error?: string };
          if (!json.ok) throw new Error(json.error ?? "Помилка");
          if (!silent) toast.success("Дату наряду збережено");
          refreshSeasonOps();
        })
        .catch((err: unknown) => {
          toast.error(
            err instanceof Error ? err.message : "Не вдалося зберегти дату"
          );
        });
    },
    [refreshSeasonOps]
  );

  const blockToPatch = useCallback(
    (block: AgroplanBlock): PlacementPatch => ({
      blockId: block.id,
      startMs: block.startMs,
      durationHours: block.durationHours,
      operationClientKey: block.operationClientKey,
    }),
    []
  );

  const applyPlacementPatches = useCallback(
    (
      patches: readonly PlacementPatch[],
      opts?: {
        recordHistory?: boolean;
        label?: string;
        before?: readonly PlacementPatch[];
        silent?: boolean;
      }
    ) => {
      if (patches.length === 0) return;

      setBlockOverrides((prev) => {
        const startMs = { ...prev.startMs };
        const durationHours = { ...prev.durationHours };
        for (const patch of patches) {
          startMs[patch.blockId] = patch.startMs;
          durationHours[patch.blockId] = patch.durationHours;
        }
        return { startMs, durationHours };
      });

      for (const patch of patches) {
        const block = blocksRef.current.find((b) => b.id === patch.blockId);
        if (!block) continue;
        const nextBlock = {
          ...block,
          startMs: patch.startMs,
          durationHours: patch.durationHours,
        };
        persistPlacement(nextBlock, {
          startMs: patch.startMs,
          durationHours: patch.durationHours,
        });
        if (patch.operationClientKey) {
          rescheduleOperation(nextBlock, patch.startMs, true);
        }
      }

      if (opts?.recordHistory && opts.before?.length) {
        historyRef.current.push({
          label: opts.label ?? "Змінено розміщення",
          before: [...opts.before],
          after: [...patches],
        });
        if (!opts.silent) {
          toast.success(opts.label ?? "Змінено", {
            action: {
              label: "Скасувати",
              onClick: () => undoFromToastRef.current(),
            },
          });
        }
      }
    },
    [persistPlacement, rescheduleOperation]
  );

  const undoFromToastRef = useRef(() => undefined as void);
  const undoLastChange = useCallback(() => {
    const entry = historyRef.current.pop();
    if (!entry) {
      toast.message("Немає дій для скасування");
      return;
    }
    applyPlacementPatches(entry.before, { silent: true });
    toast.message(`Скасовано: ${entry.label}`);
  }, [applyPlacementPatches]);

  useEffect(() => {
    undoFromToastRef.current = undoLastChange;
  }, [undoLastChange]);

  const setBlockStartMs = useCallback(
    (block: AgroplanBlock, startMs: number) => {
      if (startMs === block.startMs) return;
      const before = [blockToPatch(block)];
      const after: PlacementPatch[] = [
        { ...before[0]!, startMs },
      ];
      applyPlacementPatches(after, {
        recordHistory: true,
        before,
        label: "Дату змінено",
      });
    },
    [applyPlacementPatches, blockToPatch]
  );

  const setBlockDurationHours = useCallback(
    (block: AgroplanBlock, durationHours: number) => {
      const hours = Math.max(1, Math.round(durationHours * 2) / 2);
      if (hours === block.durationHours) return;
      const before = [blockToPatch(block)];
      const after: PlacementPatch[] = [
        { ...before[0]!, durationHours: hours },
      ];
      applyPlacementPatches(after, {
        recordHistory: true,
        before,
        label: "Тривалість змінено",
      });
    },
    [applyPlacementPatches, blockToPatch]
  );

  const shiftBlockByDays = useCallback(
    (block: AgroplanBlock, daysDelta: number) => {
      if (daysDelta === 0) return;
      const next = clampMsToSeason(
        block.startMs + daysDelta * 86_400_000,
        season
      );
      if (next === block.startMs) return;
      const before = [blockToPatch(block)];
      const after: PlacementPatch[] = [{ ...before[0]!, startMs: next }];
      applyPlacementPatches(after, {
        recordHistory: true,
        before,
        label:
          daysDelta > 0 ? `Перенесено на +${daysDelta} дн.` : `Перенесено на ${daysDelta} дн.`,
      });
    },
    [applyPlacementPatches, blockToPatch, season]
  );

  const bulkShiftBlocks = useCallback(
    (blockIds: ReadonlySet<string>, daysDelta: number) => {
      if (blockIds.size === 0 || daysDelta === 0) return;
      const deltaMs = daysDelta * 86_400_000;
      const clamp = (ms: number) => clampMsToSeason(ms, season);
      const shifted = shiftBlocksMs(blocks, blockIds, deltaMs, clamp);

      const before: PlacementPatch[] = [];
      const after: PlacementPatch[] = [];
      for (const block of blocks) {
        if (!blockIds.has(block.id)) continue;
        const nextMs = shifted[block.id];
        if (nextMs == null || nextMs === block.startMs) continue;
        before.push(blockToPatch(block));
        after.push({ ...blockToPatch(block), startMs: nextMs });
      }
      if (after.length === 0) return;

      applyPlacementPatches(after, {
        recordHistory: true,
        before,
        label:
          daysDelta > 0
            ? `Перенесено на +${daysDelta} дн.`
            : `Перенесено на ${daysDelta} дн.`,
      });
    },
    [applyPlacementPatches, blockToPatch, blocks, season]
  );

  const dismissBlock = useCallback(
    (blockId: string) => {
      setHiddenIds(hideBlock(blockId));
      const block = blocks.find((b) => b.id === blockId);
      if (block) {
        queuePlacementSync(seasonId, blockId, {
          startMs: block.startMs,
          durationHours: block.durationHours,
          hidden: true,
        });
      }
      toast.message("Приховано з таймлайну");
    },
    [blocks, seasonId]
  );

  return {
    now,
    seasonId,
    fields,
    fieldsLoading,
    inventory,
    fleet,
    ndviAlerts,
    fuelPriceUah,
    liveWeather,
    weatherLoading,
    forecastHours,
    insights,
    seasonOperations,
    blocks,
    filteredBlocks,
    activeOps,
    dayRisks,
    season,
    filters,
    setFilters,
    setBlockStartMs,
    setBlockDurationHours,
    shiftBlockByDays,
    bulkShiftBlocks,
    undoLastChange,
    dismissBlock,
    refreshStock,
    refreshSeasonOps,
    realtimePulse,
  };
}

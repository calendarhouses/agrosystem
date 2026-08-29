"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CloudRain,
  Droplets,
  Radar,
  Snowflake,
  Thermometer,
  Wind,
} from "lucide-react";

import { PlanInsightSheet } from "@/components/dashboard/calendar/plan-insight-sheet";
import { OrderTmcSheet } from "@/components/dashboard/calendar/order-tmc-sheet";
import { AnomalyInsightCard } from "@/components/dashboard/calendar/anomaly-insight-card";
import { SmartInsightCard } from "@/components/dashboard/calendar/smart-insight-card";
import {
  getAgroRadarStockContext,
  type AgroRadarStockContext,
} from "@/app/calendar/actions";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import {
  generateAgroInsights,
  type AgroCurrentWeather,
  type AgroForecastHour,
  type AgroInsightStatus,
  type AgroNdviAlert,
  type InsightCardData,
} from "@/lib/agronomy-engine";
import type { AgroFleetUnit } from "@/lib/agronomy-fleet";
import type { AgroInventoryItem } from "@/lib/agronomy-resources";
import { fieldCentroid } from "@/lib/field-centroid";
import { type FarmField } from "@/lib/farm-fields";
import {
  DEFAULT_WEATHER_LOCATION,
  fetchPlanningWeather,
  fetchWeather,
} from "@/lib/weather";
import { cn } from "@/lib/utils";

const MONTH_LABELS_UK = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
] as const;

/** Орієнтовні кліматичні норми (Київська обл.) для майбутніх місяців */
const CLIMATE_NORMS: Record<
  number,
  { avgTempC: number; precipMm: number; frostRisk: boolean }
> = {
  1: { avgTempC: -3, precipMm: 38, frostRisk: true },
  2: { avgTempC: -2, precipMm: 35, frostRisk: true },
  3: { avgTempC: 3, precipMm: 40, frostRisk: true },
  4: { avgTempC: 10, precipMm: 42, frostRisk: false },
  5: { avgTempC: 16, precipMm: 55, frostRisk: false },
  6: { avgTempC: 19, precipMm: 70, frostRisk: false },
  7: { avgTempC: 21, precipMm: 75, frostRisk: false },
  8: { avgTempC: 20, precipMm: 55, frostRisk: false },
  9: { avgTempC: 15, precipMm: 50, frostRisk: false },
  10: { avgTempC: 9, precipMm: 42, frostRisk: false },
  11: { avgTempC: 4, precipMm: 45, frostRisk: true },
  12: { avgTempC: -1, precipMm: 40, frostRisk: true },
};

type ColumnDef = {
  status: AgroInsightStatus;
  title: string;
  accent: string;
  currentMonthOnly?: boolean;
};

const COLUMNS: ColumnDef[] = [
  {
    status: "PERFECT_CONDITIONS",
    title: "🔥 Ідеальні умови (Діяти зараз)",
    accent: "emerald",
    currentMonthOnly: true,
  },
  {
    status: "WAITING_WEATHER",
    title: "⏳ Очікування вікна",
    accent: "amber",
  },
  {
    status: "PLANNING",
    title: "📅 Стратегічне планування",
    accent: "sky",
  },
];

function formatSignedTemp(c: number): string {
  const rounded = Math.round(c * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°C`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

type LiveWeatherState = AgroCurrentWeather & {
  soilMoisturePercent: number | null;
};

/** Дашборд Агро-Радар: стрічка місяців + метео-пульт + канбан вікон */
export function AgroRadarView() {
  const now = useMemo(() => new Date(), []);
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [fields, setFields] = useState<FarmField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [inventory, setInventory] = useState<AgroInventoryItem[]>([]);
  const [fleet, setFleet] = useState<AgroFleetUnit[]>([]);
  const [ndviAlerts, setNdviAlerts] = useState<AgroNdviAlert[]>([]);
  const [fuelPriceUah, setFuelPriceUah] = useState(50);
  const [forecastHours, setForecastHours] = useState<AgroForecastHour[]>([]);

  const [liveWeather, setLiveWeather] = useState<LiveWeatherState | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [planInsight, setPlanInsight] = useState<InsightCardData | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [scoutCoords, setScoutCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [orderInsight, setOrderInsight] = useState<InsightCardData | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

  const isCurrentMonth =
    selectedMonth === currentMonth && selectedYear === currentYear;
  const isFutureMonth =
    selectedYear > currentYear ||
    (selectedYear === currentYear && selectedMonth > currentMonth);

  const timelineMonths = useMemo(() => {
    const items: { year: number; month: number; label: string }[] = [];
    for (let m = 1; m <= 12; m++) {
      items.push({
        year: currentYear,
        month: m,
        label: MONTH_LABELS_UK[m - 1]!,
      });
    }
    for (let m = 1; m <= 3; m++) {
      items.push({
        year: currentYear + 1,
        month: m,
        label: `${MONTH_LABELS_UK[m - 1]!} ’${String(currentYear + 1).slice(2)}`,
      });
    }
    return items;
  }, [currentYear]);

  const activeChipRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeChipRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selectedMonth, selectedYear]);

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
    ])
      .then(([rows, stock]) => {
        if (cancelled) return;
        setFields(rows);
        setInventory(stock.inventory);
        setFleet(stock.fleet);
        setNdviAlerts(stock.ndviAlerts);
        setFuelPriceUah(stock.fuelPriceUah);
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isCurrentMonth) {
      setLiveWeather(null);
      setForecastHours([]);
      return;
    }

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
          weatherCode: snap.weatherCode,
          soilMoisturePercent: snap.soilMoisturePercent,
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
  }, [isCurrentMonth]);

  const insights = useMemo(() => {
    const activeFields = fields.map((f) => ({
      id: f.id,
      name: f.name,
      crop: f.crop,
      areaHa: f.areaHa,
    }));

    return generateAgroInsights({
      activeFields,
      targetMonth: selectedMonth,
      targetYear: selectedYear,
      currentWeather: isCurrentMonth ? liveWeather : null,
      now,
      inventory,
      fuelPriceUah,
      fleet,
      forecastHours: isCurrentMonth ? forecastHours : null,
      ndviAlerts: isCurrentMonth ? ndviAlerts : null,
    });
  }, [
    fields,
    selectedMonth,
    selectedYear,
    isCurrentMonth,
    liveWeather,
    now,
    inventory,
    fuelPriceUah,
    fleet,
    forecastHours,
    ndviAlerts,
  ]);

  const insightsByStatus = useMemo(() => {
    const map: Record<AgroInsightStatus, InsightCardData[]> = {
      PERFECT_CONDITIONS: [],
      WAITING_WEATHER: [],
      PLANNING: [],
    };
    for (const card of insights) {
      map[card.status].push(card);
    }
    return map;
  }, [insights]);

  const visibleColumns = COLUMNS.filter(
    (col) => !(col.currentMonthOnly && !isCurrentMonth)
  );

  const climate = CLIMATE_NORMS[selectedMonth] ?? {
    avgTempC: 10,
    precipMm: 45,
    frostRisk: false,
  };

  function openPlan(insight: InsightCardData) {
    setScoutCoords(null);
    setPlanInsight(insight);
    setPlanOpen(true);
  }

  function openScout(insight: InsightCardData) {
    const fieldId = insight.fields[0]?.id;
    const farm = fields.find((f) => f.id === fieldId);
    const c = farm ? fieldCentroid(farm.geometry) : null;
    setScoutCoords(c);
    setPlanInsight(insight);
    setPlanOpen(true);
  }

  function openOrder(insight: InsightCardData) {
    setOrderInsight(insight);
    setOrderOpen(true);
  }

  function refreshStock() {
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
  }

  return (
    <div
      className={cn(
        "custom-scrollbar h-full overflow-y-auto overscroll-none",
        "bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))]",
        "from-slate-100 to-zinc-100 dark:from-slate-950 dark:to-zinc-950"
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-40",
          "border-b border-white/40 bg-background/80 shadow-sm backdrop-blur-2xl",
          "dark:border-white/10 dark:bg-background/70"
        )}
      >
        <div className="flex items-center gap-3 px-6 pt-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <Radar className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              Агро-Радар
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Вікна можливостей · {selectedYear}
              {fieldsLoading
                ? " · завантаження полів…"
                : ` · ${fields.length} полів`}
            </p>
          </div>
        </div>

        <div className="no-scrollbar flex gap-4 overflow-x-auto px-6 py-4">
          {timelineMonths.map((item) => {
            const active =
              item.month === selectedMonth && item.year === selectedYear;
            return (
              <button
                key={monthKey(item.year, item.month)}
                type="button"
                ref={active ? activeChipRef : undefined}
                onClick={() => {
                  setSelectedMonth(item.month);
                  setSelectedYear(item.year);
                }}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full px-6 py-2 transition-all",
                  active
                    ? "bg-primary font-medium text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <section
        className={cn(
          "mx-6 mt-6 flex items-center justify-between gap-4 rounded-2xl p-4",
          "border border-white/50 bg-white/40 backdrop-blur-xl",
          "dark:border-white/10 dark:bg-black/20"
        )}
      >
        {isCurrentMonth ? (
          <LiveMeteoPanel loading={weatherLoading} weather={liveWeather} />
        ) : (
          <ClimateMeteoPanel
            monthLabel={MONTH_LABELS_UK[selectedMonth - 1]!}
            avgTempC={climate.avgTempC}
            precipMm={climate.precipMm}
            frostRisk={climate.frostRisk}
            isFuture={isFutureMonth}
          />
        )}
      </section>

      <section
        className={cn(
          "mt-6 grid grid-cols-1 gap-6 px-6 pb-10",
          visibleColumns.length >= 3
            ? "lg:grid-cols-3"
            : visibleColumns.length === 2
              ? "lg:grid-cols-2"
              : "lg:grid-cols-1"
        )}
      >
        {visibleColumns.map((col) => {
          const cards = insightsByStatus[col.status];
          return (
            <KanbanColumn
              key={col.status}
              title={col.title}
              accent={col.accent}
              empty={cards.length === 0}
            >
              {cards.map((insight) =>
                insight.kind === "anomaly" ? (
                  <AnomalyInsightCard
                    key={insight.id}
                    insight={insight}
                    onScout={openScout}
                  />
                ) : (
                  <SmartInsightCard
                    key={insight.id}
                    insight={insight}
                    weather={isCurrentMonth ? liveWeather : null}
                    onPlan={openPlan}
                    onOrderTmc={openOrder}
                  />
                )
              )}
            </KanbanColumn>
          );
        })}
      </section>

      <PlanInsightSheet
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open);
          if (!open) {
            setPlanInsight(null);
            setScoutCoords(null);
          }
        }}
        insight={planInsight}
        scoutCoords={scoutCoords}
      />

      <OrderTmcSheet
        open={orderOpen}
        onOpenChange={(open) => {
          setOrderOpen(open);
          if (!open) setOrderInsight(null);
        }}
        insight={orderInsight}
        onSaved={refreshStock}
      />
    </div>
  );
}

function LiveMeteoPanel({
  loading,
  weather,
}: {
  loading: boolean;
  weather: LiveWeatherState | null;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            "bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-500/25",
            "dark:text-emerald-300"
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          LIVE Погода
        </span>

        {loading && !weather ? (
          <span className="text-sm text-muted-foreground">Оновлення…</span>
        ) : weather ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground/90">
            <li className="inline-flex items-center gap-1.5">
              <Thermometer className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <span>
                Ґрунт (10см):{" "}
                <span className="font-medium tabular-nums">
                  {weather.soilTempC != null
                    ? formatSignedTemp(weather.soilTempC)
                    : "—"}
                </span>
              </span>
            </li>
            <li className="hidden h-4 w-px bg-foreground/15 sm:block" aria-hidden />
            <li className="inline-flex items-center gap-1.5">
              <Droplets className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <span>
                Вологість:{" "}
                <span className="font-medium tabular-nums">
                  {weather.soilMoisturePercent != null
                    ? `${weather.soilMoisturePercent}%`
                    : "—"}
                </span>
              </span>
            </li>
            <li className="hidden h-4 w-px bg-foreground/15 sm:block" aria-hidden />
            <li className="inline-flex items-center gap-1.5">
              <Wind className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
              <span>
                Вітер:{" "}
                <span className="font-medium tabular-nums">
                  {Math.round(weather.windMs * 10) / 10} м/с
                </span>
              </span>
            </li>
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground">
            Немає даних погоди
          </span>
        )}
      </div>
      <p className="hidden shrink-0 text-xs text-muted-foreground md:block">
        Поточний місяць · рішення «діяти зараз»
      </p>
    </>
  );
}

function ClimateMeteoPanel({
  monthLabel,
  avgTempC,
  precipMm,
  frostRisk,
  isFuture,
}: {
  monthLabel: string;
  avgTempC: number;
  precipMm: number;
  frostRisk: boolean;
  isFuture: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            "bg-sky-500/15 text-sky-800 ring-1 ring-sky-500/25",
            "dark:text-sky-300"
          )}
        >
          📊 Кліматична норма
        </span>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground/90">
          <li className="inline-flex items-center gap-1.5">
            <Thermometer className="h-4 w-4 text-sky-700 dark:text-sky-400" />
            <span>
              Сер. темп:{" "}
              <span className="font-medium tabular-nums">
                {formatSignedTemp(avgTempC)}
              </span>
            </span>
          </li>
          <li className="hidden h-4 w-px bg-foreground/15 sm:block" aria-hidden />
          <li className="inline-flex items-center gap-1.5">
            <CloudRain className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            <span>
              Опади:{" "}
              <span className="font-medium tabular-nums">{precipMm} мм</span>
            </span>
          </li>
          {frostRisk ? (
            <>
              <li
                className="hidden h-4 w-px bg-foreground/15 sm:block"
                aria-hidden
              />
              <li className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                <Snowflake className="h-4 w-4" />
                <span className="font-medium">Ризик заморозків</span>
              </li>
            </>
          ) : null}
        </ul>
      </div>
      <p className="hidden shrink-0 text-xs text-muted-foreground md:block">
        {isFuture ? `${monthLabel} · стратегія` : `${monthLabel} · норма`}
      </p>
    </>
  );
}

function KanbanColumn({
  title,
  accent,
  empty,
  children,
}: {
  title: string;
  accent: "emerald" | "amber" | "sky" | string;
  empty?: boolean;
  children?: ReactNode;
}) {
  const accentBar =
    accent === "emerald"
      ? "bg-emerald-500"
      : accent === "amber"
        ? "bg-amber-500"
        : "bg-sky-500";

  const accentText =
    accent === "emerald"
      ? "text-emerald-800 dark:text-emerald-300"
      : accent === "amber"
        ? "text-amber-800 dark:text-amber-300"
        : "text-sky-800 dark:text-sky-300";

  return (
    <div className="flex min-h-[280px] flex-col gap-4">
      <div className="flex items-center gap-2.5 px-1">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", accentBar)} />
        <h2 className={cn("text-sm font-semibold tracking-tight", accentText)}>
          {title}
        </h2>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        {empty ? (
          <p className="rounded-2xl border border-dashed border-foreground/10 bg-white/20 px-4 py-8 text-center text-sm text-muted-foreground/70 backdrop-blur-sm dark:bg-white/5">
            Немає завдань у цій категорії
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarRange,
  Loader2,
  Radio,
  Route,
  Sparkles,
  Tractor,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  calculateTechInField,
  currentSeasonYear,
  listFieldTechSeasons,
  liveUnitsToVisits,
  recentWindowInSeason,
  seasonDateRange,
  seasonWeekChunksNewestFirst,
  summarizeVisits,
  type FieldTechVisit,
} from "@/lib/field-tech-history";
import type { WialonUnit } from "@/lib/wialon";
import { cn } from "@/lib/utils";

type FieldTechHistorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldName: string | null;
  areaHa: number | null;
  fieldGeometry?: FieldGeometry | null;
  units?: WialonUnit[];
};

type CacheEntry = {
  visits: FieldTechVisit[];
  partial: boolean;
  fullSeason: boolean;
};

/** v2 — фільтр візитів ≥20 хв */
const historyCache = new Map<string, CacheEntry>();
const CACHE_VER = "v2-min20m";

async function fetchHistoryChunk(args: {
  geometry: FieldGeometry;
  units: WialonUnit[];
  from: Date;
  to: Date;
  signal: AbortSignal;
}): Promise<{ visits: FieldTechVisit[]; partial: boolean }> {
  const res = await fetch("/api/wialon/field-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      geometry: args.geometry,
      from: Math.floor(args.from.getTime() / 1000),
      to: Math.floor(args.to.getTime() / 1000),
      // Спочатку live-юніти на полі — швидший релевантний результат
      units: prioritizeUnits(args.units, args.geometry).map((u) => ({
        id: u.id,
        name: u.nm,
      })),
    }),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    visits?: FieldTechVisit[];
    partial?: boolean;
  };

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Не вдалося завантажити треки");
  }

  return {
    visits: data.visits ?? [],
    partial: Boolean(data.partial),
  };
}

function prioritizeUnits(
  units: WialonUnit[],
  geometry: FieldGeometry
): WialonUnit[] {
  const insideIds = new Set(
    calculateTechInField({ geometry }, units).map((e) => Number(e.id))
  );
  return [...units].sort((a, b) => {
    const ai = insideIds.has(a.id) ? 0 : 1;
    const bi = insideIds.has(b.id) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return a.nm.localeCompare(b.nm, "uk");
  });
}

function mergeVisits(lists: FieldTechVisit[][]): FieldTechVisit[] {
  const map = new Map<string, FieldTechVisit>();
  for (const list of lists) {
    for (const visit of list) {
      map.set(visit.id, visit);
    }
  }
  return [...map.values()].sort((a, b) => b.startUnix - a.startUnix);
}

/** Бічна панель: історія техніки (швидке вікно + опційний весь сезон) */
export function FieldTechHistorySheet({
  open,
  onOpenChange,
  fieldName,
  areaHa,
  fieldGeometry = null,
  units = [],
}: FieldTechHistorySheetProps) {
  const seasons = useMemo(() => listFieldTechSeasons(), []);
  const [seasonYear, setSeasonYear] = useState(() => currentSeasonYear());
  const [trackVisits, setTrackVisits] = useState<FieldTechVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullSeasonLoaded, setFullSeasonLoaded] = useState(false);
  const [partial, setPartial] = useState(false);

  const geometryRef = useRef(fieldGeometry);
  const unitsRef = useRef(units);
  geometryRef.current = fieldGeometry;
  unitsRef.current = units;

  const dateRange = useMemo(
    () => seasonDateRange(seasonYear),
    [seasonYear]
  );
  const quickWindow = useMemo(
    () => recentWindowInSeason(dateRange, 7),
    [dateRange]
  );

  const liveEntries = useMemo(
    () =>
      calculateTechInField({ geometry: fieldGeometry }, units, dateRange),
    [fieldGeometry, units, dateRange]
  );

  const isCurrentSeason = seasonYear === currentSeasonYear();
  const seasonLabel = `Сезон ${seasonYear}`;
  const cacheKey = `${CACHE_VER}|${fieldName ?? "field"}|${seasonYear}`;

  // Швидке завантаження: лише останні 7 днів сезону
  useEffect(() => {
    if (!open) return;

    const geometry = geometryRef.current;
    const unitList = unitsRef.current;
    if (!geometry || unitList.length === 0) {
      setTrackVisits([]);
      setError(null);
      setLoading(false);
      setFullSeasonLoaded(false);
      return;
    }

    const cached = historyCache.get(cacheKey);
    if (cached) {
      setTrackVisits(cached.visits);
      setPartial(cached.partial);
      setFullSeasonLoaded(cached.fullSeason);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setFullSeasonLoaded(false);
    setProgressLabel("Останні 7 днів…");

    void fetchHistoryChunk({
      geometry,
      units: unitList,
      from: quickWindow.from,
      to: quickWindow.to,
      signal: controller.signal,
    })
      .then(({ visits, partial: isPartial }) => {
        setTrackVisits(visits);
        setPartial(isPartial);
        historyCache.set(cacheKey, {
          visits,
          partial: isPartial,
          fullSeason: false,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setTrackVisits([]);
        setError(err instanceof Error ? err.message : "Помилка Wialon");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setProgressLabel(null);
        }
      });

    return () => controller.abort();
  }, [open, seasonYear, cacheKey, quickWindow.from, quickWindow.to]);

  async function loadFullSeason() {
    const geometry = geometryRef.current;
    const allUnits = unitsRef.current;
    if (!geometry || allUnits.length === 0 || loadingSeason) return;

    // Лише релевантна техніка — інакше сезон душить Wialon
    const seenIds = new Set(trackVisits.map((v) => v.unitId));
    for (const entry of liveEntries) seenIds.add(Number(entry.id));
    const ranked = prioritizeUnits(allUnits, geometry);
    const unitList =
      seenIds.size > 0
        ? ranked.filter((u) => seenIds.has(u.id)).slice(0, 12)
        : ranked.slice(0, 8);

    const controller = new AbortController();
    setLoadingSeason(true);
    setError(null);

    const chunks = seasonWeekChunksNewestFirst(dateRange);
    const quickFrom = Math.floor(quickWindow.from.getTime() / 1000);
    const remaining = chunks.filter(
      (chunk) => Math.floor(chunk.to.getTime() / 1000) < quickFrom
    );

    let merged = [...trackVisits];

    try {
      if (remaining.length === 0) {
        setFullSeasonLoaded(true);
        historyCache.set(cacheKey, {
          visits: merged,
          partial: false,
          fullSeason: true,
        });
        return;
      }

      for (let i = 0; i < remaining.length; i++) {
        if (controller.signal.aborted) break;
        const chunk = remaining[i];
        setProgressLabel(`Сезон: ${i + 1}/${remaining.length}`);
        const { visits } = await fetchHistoryChunk({
          geometry,
          units: unitList,
          from: chunk.from,
          to: chunk.to,
          signal: controller.signal,
        });
        merged = mergeVisits([merged, visits]);
        setTrackVisits(merged);
      }
      setFullSeasonLoaded(true);
      setPartial(false);
      historyCache.set(cacheKey, {
        visits: merged,
        partial: false,
        fullSeason: true,
      });
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Помилка Wialon");
      }
    } finally {
      setLoadingSeason(false);
      setProgressLabel(null);
    }
  }

  const visits = useMemo(() => {
    const archived = trackVisits;
    const live = isCurrentSeason ? liveUnitsToVisits(liveEntries) : [];
    const liveFiltered = live.filter(
      (liveVisit) =>
        !archived.some(
          (v) =>
            v.unitId === liveVisit.unitId &&
            new Date(v.endUnix * 1000).toDateString() ===
              new Date().toDateString()
        )
    );
    return [...liveFiltered, ...archived].sort(
      (a, b) => b.startUnix - a.startUnix
    );
  }, [trackVisits, liveEntries, isCurrentSeason]);

  const summary = useMemo(() => summarizeVisits(visits), [visits]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-zinc-200/80 bg-[#FAFAF8] p-0 text-zinc-900 shadow-2xl sm:max-w-lg",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-white/80"
        )}
      >
        <div className="relative overflow-hidden border-b border-[#E5DFD3]/80 bg-gradient-to-br from-[#F4F1EA] via-white to-[#E8F0EA] px-6 pt-6 pb-5 pr-14">
          <div
            className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-[#276749]/10 blur-2xl"
            aria-hidden
          />
          <SheetHeader className="relative gap-0 space-y-0 p-0">
            <div className="mb-2 inline-flex items-center gap-1.5 self-start rounded-full border border-[#276749]/15 bg-white/70 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#276749] uppercase backdrop-blur-sm">
              <Sparkles className="h-3 w-3" />
              {seasonLabel}
              {isCurrentSeason ? " · поточний" : ""}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-xl font-bold tracking-tight text-zinc-900">
                Історія техніки
              </SheetTitle>
              {areaHa != null && Number.isFinite(areaHa) ? (
                <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/80 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 shadow-sm">
                  {areaHa.toFixed(2)} га
                </span>
              ) : null}
            </div>
            <SheetDescription className="mt-1.5 text-sm text-zinc-600">
              {fieldName ?? "Поле"} · треки Wialon
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            <CalendarRange className="h-3.5 w-3.5" />
            Період
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {seasons.map((season) => {
              const active = season.year === seasonYear;
              return (
                <button
                  key={season.year}
                  type="button"
                  disabled={loading || loadingSeason}
                  onClick={() => setSeasonYear(season.year)}
                  className={cn(
                    "rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60",
                    active
                      ? "bg-[#276749] text-white shadow-md shadow-[#276749]/25"
                      : "border border-[#E5DFD3] bg-white text-zinc-600 hover:border-[#276749]/30 hover:text-zinc-900"
                  )}
                >
                  {season.label}
                </button>
              );
            })}
          </div>

          <p className="mb-4 text-xs text-zinc-500">
            За замовчуванням — останні 7 днів сезону (швидко). Повний сезон
            можна довантажити окремо.
          </p>

          {!fullSeasonLoaded ? (
            <button
              type="button"
              disabled={loading || loadingSeason || !fieldGeometry}
              onClick={() => void loadFullSeason()}
              className="mb-5 inline-flex items-center justify-center gap-2 rounded-xl border border-[#276749]/20 bg-white px-4 py-2.5 text-sm font-semibold text-[#276749] transition-colors hover:bg-[#276749]/5 disabled:opacity-50"
            >
              {loadingSeason ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarRange className="h-4 w-4" />
              )}
              {loadingSeason
                ? progressLabel ?? "Завантаження…"
                : `Довантажити весь ${seasonLabel.toLowerCase()}`}
            </button>
          ) : (
            <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs font-medium text-emerald-800">
              Повний {seasonLabel.toLowerCase()} завантажено з Wialon
            </div>
          )}

          <div className="mb-5 grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-[#E5DFD3]/80 bg-white p-3 shadow-sm">
              <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                Візити
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">
                {summary.totalVisits}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {summary.uniqueUnits} од. техніки
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 shadow-sm">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-emerald-700/80 uppercase">
                <Activity className="h-3 w-3" />
                Години
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                {summary.totalHours}
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-700/70">на полі</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3 shadow-sm">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-amber-700/80 uppercase">
                <Route className="h-3 w-3" />
                Пробіг
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-800">
                {summary.totalDistanceKm}
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800/70">км у контурі</p>
            </div>
          </div>

          {isCurrentSeason && liveEntries.length > 0 ? (
            <div className="mb-4 inline-flex items-center gap-2 self-start rounded-full border border-[#276749]/15 bg-[#276749]/5 px-3 py-1.5 text-xs font-medium text-[#276749]">
              <Radio className="h-3.5 w-3.5 animate-pulse" />
              Live зараз: {liveEntries.length} на ділянці
            </div>
          ) : null}

          {loading ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 py-2.5 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin text-[#276749]" />
              {progressLabel ?? "Завантаження треків…"}
            </div>
          ) : null}

          {partial && !loading ? (
            <p className="mb-3 text-xs text-amber-700">
              Частина техніки ще не встигла підвантажитись (ліміт часу Wialon).
              Спробуйте «Довантажити весь сезон» або відкрийте знову.
            </p>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {!loading && visits.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-[#E5DFD3]/80 bg-white px-6 py-12 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-50">
                <Tractor className="opacity-25" size={36} />
              </div>
              <p className="text-sm font-semibold text-zinc-800">
                Техніка не зафіксована
              </p>
              <p className="mx-auto mt-2 max-w-[260px] text-sm leading-relaxed text-zinc-500">
                За останні 7 днів у треках немає перетину з цим полем.
              </p>
            </div>
          ) : visits.length > 0 ? (
            <div className="space-y-3">
              {visits.map((visit) => (
                <div
                  key={visit.id}
                  className="group relative overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                        visit.isLive
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-amber-50 text-amber-600"
                      )}
                    >
                      <Tractor className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-bold text-zinc-900">
                          {visit.unitName}
                        </p>
                        {visit.isLive ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            LIVE
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        {visit.timeRangeLabel}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {visit.isLive && visit.speedKmh != null ? (
                        <p className="text-lg font-bold tabular-nums text-emerald-600">
                          {visit.speedKmh}
                          <span className="ml-0.5 text-xs font-semibold text-zinc-400">
                            км/год
                          </span>
                        </p>
                      ) : (
                        <>
                          <p className="font-semibold text-emerald-600">
                            {visit.durationLabel}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400 tabular-nums">
                            {visit.distanceKm.toFixed(1)} км
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/equipment?id=${visit.unitId}`}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-100 bg-zinc-50 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 group-hover:border-[#276749]/20 group-hover:text-[#276749]"
                  >
                    Відкрити в Моніторингу
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

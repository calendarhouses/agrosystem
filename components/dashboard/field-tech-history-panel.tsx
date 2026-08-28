"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardPlus,
  Clock3,
  Fuel,
  Loader2,
  Radio,
  Route,
  Satellite,
  Sprout,
  Tractor,
} from "lucide-react";

import { getFieldEquipmentHistory } from "@/app/admin/fields/actions";
import { Badge } from "@/components/ui/badge";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  mergeTrackVisitsIntoHistory,
  summarizeEquipmentHistory,
  trackVisitToHistoryEntry,
  type FieldEquipmentHistoryEntry,
} from "@/lib/field-equipment-history";
import {
  calculateTechInField,
  currentSeasonYear,
  formatVisitClock,
  liveUnitsToVisits,
  recentWindowInSeason,
  seasonDateRange,
  type FieldTechVisit,
} from "@/lib/field-tech-history";
import { useSeasonStore } from "@/lib/season-store";
import type { WialonUnit } from "@/lib/wialon";
import { cn } from "@/lib/utils";

type FieldTechHistoryPanelProps = {
  enabled?: boolean;
  farmFieldId?: string | null;
  fieldGeometry?: FieldGeometry | null;
  fieldAreaHa?: number | null;
  units?: WialonUnit[];
  /** Інкремент з Realtime — оновити наряди (треки з кешу) */
  realtimeVersion?: number;
  onCreateOrderFromGps?: (entry: FieldEquipmentHistoryEntry) => void;
  className?: string;
};

type TrackCacheEntry = {
  visits: FieldTechVisit[];
  fetchedAt: number;
  unitSignature: string;
};

type DbCacheEntry = {
  entries: FieldEquipmentHistoryEntry[];
  fetchedAt: number;
  realtimeVersion: number;
};

const TRACK_CACHE_TTL_MS = 12 * 60 * 1000;
const trackCache = new Map<string, TrackCacheEntry>();
const dbCache = new Map<string, DbCacheEntry>();

function unitSignature(units: WialonUnit[]): string {
  return units
    .map((u) => u.id)
    .sort((a, b) => a - b)
    .join(",");
}

function trackCacheKey(
  fieldId: string,
  season: string,
  fromMs: number,
  toMs: number
): string {
  return `${fieldId}|${season}|${fromMs}|${toMs}`;
}

function readDbCache(
  farmFieldId: string,
  season: string,
  realtimeVersion: number
): FieldEquipmentHistoryEntry[] | null {
  const cached = dbCache.get(`${farmFieldId}|${season}`);
  if (!cached) return null;
  if (cached.realtimeVersion !== realtimeVersion) return null;
  if (Date.now() - cached.fetchedAt >= TRACK_CACHE_TTL_MS) return null;
  return cached.entries;
}

function readTrackCache(
  key: string,
  signature: string
): { visits: FieldTechVisit[]; fresh: boolean } | null {
  const cached = trackCache.get(key);
  if (!cached || cached.unitSignature !== signature) return null;
  const age = Date.now() - cached.fetchedAt;
  return { visits: cached.visits, fresh: age < TRACK_CACHE_TTL_MS };
}

function formatDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      weekday: "short",
      day: "numeric",
      month: "long",
    }).format(d);
  } catch {
    return ymd;
  }
}

function groupByDate(
  entries: FieldEquipmentHistoryEntry[]
): Array<{ date: string; items: FieldEquipmentHistoryEntry[] }> {
  const map = new Map<string, FieldEquipmentHistoryEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.date) ?? [];
    list.push(entry);
    map.set(entry.date, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
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

async function fetchTrackVisits(args: {
  geometry: FieldGeometry;
  units: WialonUnit[];
  from: Date;
  to: Date;
  signal: AbortSignal;
}): Promise<FieldTechVisit[]> {
  if (args.units.length === 0) return [];
  const res = await fetch("/api/wialon/field-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      geometry: args.geometry,
      from: Math.floor(args.from.getTime() / 1000),
      to: Math.floor(args.to.getTime() / 1000),
      units: prioritizeUnits(args.units, args.geometry)
        .slice(0, 12)
        .map((u) => ({ id: u.id, name: u.nm })),
    }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    visits?: FieldTechVisit[];
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Не вдалося завантажити GPS-треки");
  }
  return data.visits ?? [];
}

function OperationSourceBadge({ entry }: { entry: FieldEquipmentHistoryEntry }) {
  if (entry.status === "in_progress" && entry.id.startsWith("live:")) {
    return (
      <Badge
        className="animate-pulse border-emerald-200/90 bg-emerald-50 text-emerald-800"
        variant="outline"
      >
        ● Зараз на полі
      </Badge>
    );
  }

  if (entry.source === "gps_only") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-amber-200/80",
          "bg-gradient-to-r from-amber-50 to-orange-50/80 px-2.5 py-1",
          "text-[11px] font-semibold tracking-tight text-amber-900 shadow-sm"
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
          <Satellite className="h-2.5 w-2.5" strokeWidth={2.2} />
        </span>
        GPS
        <span className="font-medium text-amber-700/70">(Без наряду)</span>
      </span>
    );
  }

  const status = String(entry.status ?? "planned").toLowerCase();

  if (status === "completed") {
    return (
      <Badge
        className="border-emerald-200/80 bg-emerald-50 text-emerald-800"
        variant="outline"
      >
        ✓ Виконано
      </Badge>
    );
  }

  if (status === "in_progress") {
    return (
      <Badge
        className="animate-pulse border-sky-200/90 bg-sky-50 text-sky-800"
        variant="outline"
      >
        ⚙️ В роботі
      </Badge>
    );
  }

  return (
    <Badge
      className="border-zinc-200 bg-zinc-100 text-zinc-600"
      variant="outline"
    >
      🗓 Заплановано
    </Badge>
  );
}

function EquipmentHistoryCard({
  entry,
  onCreateOrder,
}: {
  entry: FieldEquipmentHistoryEntry;
  onCreateOrder?: (entry: FieldEquipmentHistoryEntry) => void;
}) {
  const isLive = entry.id.startsWith("live:");
  const isFromOrder = entry.source === "manual" || entry.source === "hybrid";
  const status = String(entry.status ?? "").toLowerCase();
  const isPlanned = isFromOrder && status === "planned";
  const fuelL = isFromOrder ? entry.fuelUsedL : entry.gpsFuelConsumedL;
  const areaHa = entry.areaHa;
  const showWorkMetrics = !isPlanned && !isLive;

  const iconTone = isLive
    ? "bg-emerald-50 text-emerald-700"
    : entry.source === "gps_only"
      ? "bg-amber-50 text-amber-700"
      : status === "in_progress"
        ? "bg-sky-50 text-sky-700"
        : status === "planned"
          ? "bg-zinc-100 text-zinc-500"
          : "bg-emerald-50 text-emerald-700";

  const cardBorder = isLive
    ? "border-emerald-200/90"
    : entry.source === "gps_only"
      ? "border-amber-200/80"
      : status === "in_progress"
        ? "border-sky-200/70"
        : "border-[#E5DFD3]/90";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
        cardBorder
      )}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
            iconTone
          )}
        >
          <Tractor className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-bold text-zinc-900">
              {entry.equipmentName}
            </p>
            <OperationSourceBadge entry={entry} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-zinc-500">
            <span>{formatDayLabel(entry.date)}</span>
            {entry.visitStartUnix != null && entry.visitEndUnix != null ? (
              <span className="inline-flex items-center gap-1 tabular-nums font-medium text-zinc-700">
                <Clock3 className="h-3.5 w-3.5 text-amber-600/80" strokeWidth={2} />
                {formatVisitClock(entry.visitStartUnix)} –{" "}
                {formatVisitClock(entry.visitEndUnix)}
              </span>
            ) : entry.workType ? (
              <span>· {entry.workType}</span>
            ) : null}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {areaHa != null && areaHa > 0 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 tabular-nums",
                  isPlanned ? "text-zinc-400" : "text-zinc-700"
                )}
              >
                <Sprout className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-semibold">{areaHa}</span>
                <span className="text-zinc-400">
                  га{isPlanned ? " план" : " роботи"}
                </span>
              </span>
            ) : null}
            {fuelL != null && fuelL > 0 && !isPlanned ? (
              <span className="inline-flex items-center gap-1 tabular-nums text-zinc-700">
                <Fuel className="h-3.5 w-3.5 text-zinc-400" />
                <span className="font-semibold">{fuelL}</span>
                <span className="text-zinc-400">л</span>
                {entry.source === "hybrid" &&
                entry.gpsFuelConsumedL != null ? (
                  <span className="text-[11px] text-zinc-400">
                    (GPS {entry.gpsFuelConsumedL} л)
                  </span>
                ) : null}
              </span>
            ) : null}
            {showWorkMetrics &&
            entry.trackerWorkHours != null &&
            entry.trackerWorkHours > 0 ? (
              <span className="inline-flex items-center gap-1 tabular-nums text-zinc-500">
                <Clock3 className="h-3.5 w-3.5 text-zinc-400" />
                {entry.trackerWorkHours} год
              </span>
            ) : null}
            {showWorkMetrics &&
            entry.trackerDistanceKm != null &&
            entry.trackerDistanceKm > 0 ? (
              <span className="tabular-nums text-zinc-500">
                {entry.trackerDistanceKm} км
              </span>
            ) : null}
            {entry.implementWidthM != null && entry.implementWidthM > 0 ? (
              <span className="tabular-nums text-zinc-400">
                захват {entry.implementWidthM} м
              </span>
            ) : null}
          </div>

          {entry.source === "gps_only" &&
          !isLive &&
          (areaHa == null || areaHa <= 0) &&
          (entry.trackerDistanceKm ?? 0) > 0 ? (
            <p className="mt-2 text-[11px] leading-snug text-zinc-400">
              Площа роботи зʼявиться після наряду з шириною захвату (км × м /
              10).
            </p>
          ) : null}
        </div>
      </div>

      {entry.source === "gps_only" && !isLive && onCreateOrder ? (
        <button
          type="button"
          onClick={() => onCreateOrder(entry)}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/80 py-2.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
        >
          <ClipboardPlus className="h-3.5 w-3.5" />
          Створити наряд
        </button>
      ) : null}
    </div>
  );
}

/** Вміст «Історія техніки» — гібрид: наряди + GPS-треки + live */
export function FieldTechHistoryPanel({
  enabled = true,
  farmFieldId = null,
  fieldGeometry = null,
  fieldAreaHa = null,
  units = [],
  realtimeVersion = 0,
  onCreateOrderFromGps,
  className,
}: FieldTechHistoryPanelProps) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const seasonYear = Number(activeSeason) || currentSeasonYear();

  const dateRange = useMemo(
    () => seasonDateRange(seasonYear),
    [seasonYear]
  );
  const quickWindow = useMemo(
    () => recentWindowInSeason(dateRange, 7),
    [dateRange]
  );

  const unitsKey = useMemo(() => unitSignature(units), [units]);
  // Не JSON.stringify(geometry) — важкі полігони + ризик падіння рендеру деталей
  const geometryKey = farmFieldId
    ? `farm:${farmFieldId}`
    : fieldGeometry
      ? `geom:${fieldGeometry.type}:${Array.isArray(fieldGeometry.coordinates) ? fieldGeometry.coordinates.length : 0}`
      : "";
  const windowFromMs = quickWindow.from.getTime();
  const windowToMs = quickWindow.to.getTime();
  const tracksKey =
    farmFieldId != null
      ? trackCacheKey(farmFieldId, activeSeason, windowFromMs, windowToMs)
      : geometryKey
        ? trackCacheKey(geometryKey, activeSeason, windowFromMs, windowToMs)
        : "";

  const unitsRef = useRef(units);
  unitsRef.current = units;
  const geometryRef = useRef(fieldGeometry);
  geometryRef.current = fieldGeometry;

  const [dbEntries, setDbEntries] = useState<FieldEquipmentHistoryEntry[]>([]);
  const [trackVisits, setTrackVisits] = useState<FieldTechVisit[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  // Підтягнути кеш одразу при зміні поля / сезону (без спінера)
  useEffect(() => {
    if (!farmFieldId) {
      setDbEntries((prev) => (prev.length === 0 ? prev : []));
      setTrackVisits((prev) => (prev.length === 0 ? prev : []));
      setLoadingDb(false);
      setLoadingTracks(false);
      setError(null);
      setTrackError(null);
      return;
    }
    const db = readDbCache(farmFieldId, activeSeason, realtimeVersion);
    if (db) {
      setDbEntries(db);
      setLoadingDb(false);
      setError(null);
    }
    if (tracksKey && unitsKey) {
      const tracks = readTrackCache(tracksKey, unitsKey);
      if (tracks) {
        setTrackVisits(tracks.visits);
        setLoadingTracks(false);
        setTrackError(null);
      }
    }
  }, [farmFieldId, activeSeason, realtimeVersion, tracksKey, unitsKey]);

  const loadDb = useCallback(async () => {
    if (!farmFieldId) {
      setDbEntries([]);
      setError(null);
      setLoadingDb(false);
      return;
    }

    const key = `${farmFieldId}|${activeSeason}`;
    const cached = dbCache.get(key);
    if (
      cached &&
      cached.realtimeVersion === realtimeVersion &&
      Date.now() - cached.fetchedAt < TRACK_CACHE_TTL_MS
    ) {
      setDbEntries(cached.entries);
      setError(null);
      setLoadingDb(false);
      return;
    }

    const hadData = Boolean(cached?.entries.length);
    if (!hadData) setLoadingDb(true);
    setError(null);
    const res = await getFieldEquipmentHistory(farmFieldId, activeSeason);
    setLoadingDb(false);
    if (!res.ok) {
      if (!hadData) setDbEntries([]);
      setError(res.error);
      return;
    }
    dbCache.set(key, {
      entries: res.data,
      fetchedAt: Date.now(),
      realtimeVersion,
    });
    setDbEntries(res.data);
  }, [farmFieldId, activeSeason, realtimeVersion]);

  useEffect(() => {
    if (!enabled) return;
    void loadDb();
  }, [enabled, loadDb]);

  useEffect(() => {
    if (!enabled || !farmFieldId || !geometryKey || !unitsKey) {
      return;
    }

    const geometry = geometryRef.current;
    if (!geometry) return;

    const key = trackCacheKey(
      farmFieldId,
      activeSeason,
      windowFromMs,
      windowToMs
    );
    const cached = readTrackCache(key, unitsKey);

    if (cached) {
      setTrackVisits(cached.visits);
      setTrackError(null);
      setLoadingTracks(false);
      if (cached.fresh) return;
    }

    const controller = new AbortController();
    if (!cached) {
      setLoadingTracks(true);
      setTrackError(null);
    }

    void fetchTrackVisits({
      geometry,
      units: unitsRef.current,
      from: new Date(windowFromMs),
      to: new Date(windowToMs),
      signal: controller.signal,
    })
      .then((visits) => {
        if (controller.signal.aborted) return;
        const prev = trackCache.get(key)?.visits;
        trackCache.set(key, {
          visits,
          fetchedAt: Date.now(),
          unitSignature: unitsKey,
        });
        // Не смикати UI, якщо треки ті самі
        if (
          prev &&
          prev.length === visits.length &&
          prev.every(
            (v, i) =>
              v.unitId === visits[i]?.unitId &&
              v.startUnix === visits[i]?.startUnix &&
              v.endUnix === visits[i]?.endUnix &&
              v.distanceKm === visits[i]?.distanceKm
          )
        ) {
          return;
        }
        setTrackVisits(visits);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (!cached) {
          setTrackError(
            err instanceof Error ? err.message : "Помилка GPS-треків"
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTracks(false);
      });

    return () => controller.abort();
  }, [
    enabled,
    farmFieldId,
    geometryKey,
    unitsKey,
    activeSeason,
    windowFromMs,
    windowToMs,
  ]);

  const isCurrentSeason = seasonYear === currentSeasonYear();
  const liveEntries = useMemo(
    () =>
      enabled && isCurrentSeason
        ? calculateTechInField({ geometry: fieldGeometry }, units)
        : [],
    [enabled, isCurrentSeason, fieldGeometry, units]
  );

  const entries = useMemo(() => {
    const merged = mergeTrackVisitsIntoHistory(dbEntries, trackVisits, {
      areaCapHa: fieldAreaHa,
    });
    if (!isCurrentSeason || liveEntries.length === 0) return merged;

    const liveVisits = liveUnitsToVisits(liveEntries);
    const liveCards = liveVisits.map((visit) =>
      trackVisitToHistoryEntry(visit, { areaCapHa: fieldAreaHa })
    );

    // Live зверху сьогоднішнього дня
    const withoutDupLive = merged.filter((e) => !e.id.startsWith("live:"));
    return [...liveCards, ...withoutDupLive];
  }, [
    dbEntries,
    trackVisits,
    fieldAreaHa,
    isCurrentSeason,
    liveEntries,
  ]);

  const summary = useMemo(
    () => summarizeEquipmentHistory(entries.filter((e) => !e.id.startsWith("live:"))),
    [entries]
  );
  const groups = useMemo(
    () => groupByDate(entries.filter((e) => !e.id.startsWith("live:"))),
    [entries]
  );
  const liveCards = useMemo(
    () => entries.filter((e) => e.id.startsWith("live:")),
    [entries]
  );

  const loading = (loadingDb || loadingTracks) && entries.length === 0;

  return (
    <div className={cn("space-y-4", className)}>
      {!farmFieldId ? (
        <div className="rounded-2xl border border-[#E5DFD3] bg-white px-4 py-6 text-center text-sm text-zinc-500">
          Збережіть паспорт поля, щоб бачити гібридну історію техніки.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
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
            <Sprout className="h-3 w-3" />
            Площа
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
            {summary.totalAreaHa}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-800/60">
            га роботи · {summary.totalHours} год
          </p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3 shadow-sm">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-amber-700/80 uppercase">
            <Route className="h-3 w-3" />
            Пробіг
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-800">
            {summary.totalDistanceKm}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800/70">км у полі</p>
        </div>
      </div>

      {liveCards.length > 0 ? (
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#276749]/15 bg-[#276749]/5 px-3 py-1.5 text-xs font-medium text-[#276749]">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            Зараз на полі: {liveCards.map((e) => e.equipmentName).join(", ")}
          </div>
          <div className="space-y-2.5">
            {liveCards.map((entry) => (
              <EquipmentHistoryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : null}

      {summary.gpsOnlyCount > 0 ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <span className="font-semibold">{summary.gpsOnlyCount}</span>{" "}
            {summary.gpsOnlyCount === 1
              ? "запис лише з GPS"
              : "записів лише з GPS"}
            — техніка була на полі без наряду. Створіть наряд із шириною
            захвату, щоб порахувати площу роботи.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 py-2.5 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin text-[#276749]" />
          {loadingTracks && !loadingDb
            ? "Аналіз GPS-треків за 7 днів…"
            : "Завантаження історії техніки…"}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {trackError && !error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          GPS-треки: {trackError}
        </div>
      ) : null}

      {!loading &&
      farmFieldId &&
      entries.filter((e) => !e.id.startsWith("live:")).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#E5DFD3] bg-white/70 px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-400">
            <Tractor className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <p className="text-sm font-semibold text-zinc-800">
            Поки немає записів за останні 7 днів
          </p>
          <p className="mx-auto mt-1.5 max-w-[280px] text-sm leading-relaxed text-zinc-500">
            Візити з GPS-треків і закриті наряди зʼявляться тут. Якщо техніка
            зараз на полі — вона вже показана вище.
          </p>
        </div>
      ) : null}

      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.date} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {formatDayLabel(group.date)}
              </p>
              <div className="h-px flex-1 bg-[#E5DFD3]/80" />
              <span className="text-[11px] tabular-nums text-zinc-400">
                {group.items.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {group.items.map((entry) => (
                <EquipmentHistoryCard
                  key={entry.id}
                  entry={entry}
                  onCreateOrder={onCreateOrderFromGps}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

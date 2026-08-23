"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ClipboardPlus,
  Fuel,
  Loader2,
  Radio,
  Route,
  Tractor,
} from "lucide-react";

import { getFieldEquipmentHistory } from "@/app/admin/fields/actions";
import { Badge } from "@/components/ui/badge";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  calculateTechInField,
  currentSeasonYear,
} from "@/lib/field-tech-history";
import {
  summarizeEquipmentHistory,
  type FieldEquipmentHistoryEntry,
} from "@/lib/field-equipment-history";
import { useSeasonStore } from "@/lib/season-store";
import type { WialonUnit } from "@/lib/wialon";
import { cn } from "@/lib/utils";

type FieldTechHistoryPanelProps = {
  enabled?: boolean;
  farmFieldId?: string | null;
  fieldGeometry?: FieldGeometry | null;
  units?: WialonUnit[];
  /** Інкремент з Realtime — перезавантажити гібридну історію */
  realtimeVersion?: number;
  onCreateOrderFromGps?: (entry: FieldEquipmentHistoryEntry) => void;
  className?: string;
};

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

function OperationSourceBadge({ entry }: { entry: FieldEquipmentHistoryEntry }) {
  if (entry.source === "gps_only") {
    return (
      <Badge
        className="border-amber-200/90 bg-amber-50 text-amber-900"
        variant="outline"
      >
        📍 Тільки GPS (Без наряду)
      </Badge>
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
  const isFromOrder = entry.source === "manual" || entry.source === "hybrid";
  const status = String(entry.status ?? "").toLowerCase();
  const isPlanned = isFromOrder && status === "planned";
  const fuelL = isFromOrder ? entry.fuelUsedL : entry.gpsFuelConsumedL;
  const areaHa = isFromOrder ? entry.areaHa : undefined;
  const showWorkMetrics = !isPlanned;

  const iconTone =
    entry.source === "gps_only"
      ? "bg-amber-50 text-amber-700"
      : status === "in_progress"
        ? "bg-sky-50 text-sky-700"
        : status === "planned"
          ? "bg-zinc-100 text-zinc-500"
          : "bg-emerald-50 text-emerald-700";

  const cardBorder =
    entry.source === "gps_only"
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
          <p className="mt-0.5 text-sm text-zinc-500">
            {formatDayLabel(entry.date)}
            {entry.workType ? ` · ${entry.workType}` : null}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {areaHa != null && areaHa > 0 ? (
              <span
                className={cn(
                  "tabular-nums",
                  isPlanned ? "text-zinc-400" : "text-zinc-700"
                )}
              >
                <span className="font-semibold">{areaHa}</span>
                <span className="ml-1 text-zinc-400">
                  га{isPlanned ? " план" : ""}
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
              <span className="tabular-nums text-zinc-500">
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
          </div>
        </div>
      </div>

      {entry.source === "gps_only" && onCreateOrder ? (
        <button
          type="button"
          onClick={() => onCreateOrder(entry)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/80 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
        >
          <ClipboardPlus className="h-3.5 w-3.5" />
          Створити наряд
        </button>
      ) : null}
    </div>
  );
}

/** Вміст «Історія техніки» — гібрид: наряди + GPS */
export function FieldTechHistoryPanel({
  enabled = true,
  farmFieldId = null,
  fieldGeometry = null,
  units = [],
  realtimeVersion = 0,
  onCreateOrderFromGps,
  className,
}: FieldTechHistoryPanelProps) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const seasonYear = Number(activeSeason) || currentSeasonYear();
  const [entries, setEntries] = useState<FieldEquipmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!farmFieldId) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await getFieldEquipmentHistory(farmFieldId, activeSeason);
    setLoading(false);
    if (!res.ok) {
      setEntries([]);
      setError(res.error);
      return;
    }
    setEntries(res.data);
  }, [farmFieldId, activeSeason]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load, realtimeVersion]);

  const isCurrentSeason = seasonYear === currentSeasonYear();
  const liveEntries = useMemo(
    () =>
      enabled && isCurrentSeason
        ? calculateTechInField({ geometry: fieldGeometry }, units)
        : [],
    [enabled, isCurrentSeason, fieldGeometry, units]
  );

  const summary = useMemo(
    () => summarizeEquipmentHistory(entries),
    [entries]
  );
  const groups = useMemo(() => groupByDate(entries), [entries]);

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
            <Activity className="h-3 w-3" />
            Години
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
            {summary.totalHours}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-800/60">
            {summary.confirmedCount} активних / виконаних
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
          <p className="mt-0.5 text-[11px] text-amber-800/70">км</p>
        </div>
      </div>

      {isCurrentSeason && liveEntries.length > 0 ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-[#276749]/15 bg-[#276749]/5 px-3 py-1.5 text-xs font-medium text-[#276749]">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          Зараз на полі: {liveEntries.map((e) => e.name).join(", ")}
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
            — техніка була на полі без наряду. Створіть наряд, щоб підтвердити
            роботу.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 py-2.5 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin text-[#276749]" />
          Завантаження історії техніки…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loading && farmFieldId && entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#E5DFD3] bg-white/70 px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-400">
            <Tractor className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <p className="text-sm font-semibold text-zinc-800">
            Поки немає записів за сезон
          </p>
          <p className="mx-auto mt-1.5 max-w-[280px] text-sm leading-relaxed text-zinc-500">
            Закриті наряди та GPS-логи з’являться тут автоматично. Якщо трекер
            зафіксує візит без наряду — ви побачите жовтий сигнал.
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

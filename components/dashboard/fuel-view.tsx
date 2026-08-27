"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endOfDay, format, startOfDay, startOfYear, subDays } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock3,
  Edit2,
  Factory,
  Fuel,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Tractor,
  Trash2,
  Truck,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import {
  getFieldFuelConsumed,
  getFuelRefueledForPeriod,
  type FieldFuelBreakdownRow,
  type FieldFuelPeriod,
} from "@/app/fuel/actions";
import { listEquipmentForOps } from "@/app/admin/equipment/actions";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";
import {
  FuelActionDialogs,
  type FleetUnitOption,
} from "@/components/dashboard/fuel-action-dialogs";
import { FuelDashboardHeader } from "@/components/dashboard/fuel-dashboard-header";
import { FuelDetailSheet } from "@/components/dashboard/fuel-detail-sheet";
import { FuelStorageDialog } from "@/components/dashboard/fuel-storage-dialog";
import { mergeEquipmentOpsOptions } from "@/lib/equipment-ops-options";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  mapFuelStorageRow,
  storageFillPercent,
  storageValueUah,
  totalFuelValue,
  totalFuelVolume,
  type FuelStorage,
} from "@/lib/fuel-storages";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransaction,
  type FuelSyncStatus,
} from "@/lib/fuel-transactions";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { unitHasFuelSensor, type WialonUnit } from "@/lib/wialon";
import { cn } from "@/lib/utils";

type JournalPeriod = "Сьогодні" | "Вчора" | "Тиждень" | "Місяць" | "Рік";

const PERIOD_OPTIONS: JournalPeriod[] = [
  "Сьогодні",
  "Вчора",
  "Тиждень",
  "Місяць",
  "Рік",
];

/** Діапазон дат для фільтра журналу (ISO через .toISOString()). */
function getDateRange(
  period: JournalPeriod | "custom",
  customRange?: DateRange
): { start: Date; end: Date } {
  const now = new Date();

  if (period === "custom" && customRange?.from) {
    return {
      start: startOfDay(customRange.from),
      end: endOfDay(customRange.to ?? customRange.from),
    };
  }

  if (period === "Вчора") {
    const day = subDays(now, 1);
    return { start: startOfDay(day), end: endOfDay(day) };
  }
  if (period === "Тиждень") {
    return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
  }
  if (period === "Місяць") {
    return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  }
  if (period === "Рік") {
    return { start: startOfYear(now), end: endOfDay(now) };
  }

  // Сьогодні — завжди до кінця доби (інакше нові заправки «після відкриття сторінки» не видно)
  return { start: startOfDay(now), end: endOfDay(now) };
}

/** Fallback, якщо Wialon і довідник недоступні */
const FALLBACK_UNITS: FleetUnitOption[] = [
  {
    key: "w:601301819",
    name: "МТЗ-82",
    wialonUnitId: 601301819,
    hasFuelSensor: false,
    hasTracker: true,
  },
  {
    key: "w:601301822",
    name: "John Deere 8R",
    wialonUnitId: 601301822,
    hasFuelSensor: true,
    hasTracker: true,
  },
  {
    key: "w:601301825",
    name: "Case IH Magnum",
    wialonUnitId: 601301825,
    hasFuelSensor: true,
    hasTracker: true,
  },
];

function formatTxDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM yyyy · HH:mm", { locale: uk });
}

function formatRoute(tx: FuelTransaction): string {
  if (tx.type === "inbound") {
    return tx.toName ? `→ ${tx.toName}` : "→ Склад";
  }
  if (tx.type === "transfer") {
    const from = tx.fromName ?? "—";
    const to = tx.toName ?? "—";
    return `${from} → ${to}`;
  }
  return tx.fromName ? `${tx.fromName} → техніка` : "→ техніка";
}

function BasSyncBadge({
  status,
  onSend,
  sending,
  canQueue1c = true,
}: {
  status: FuelSyncStatus;
  onSend?: () => void;
  sending?: boolean;
  /** Заправка (outbound) не йде в чергу 1С — лише закупівля/переміщення */
  canQueue1c?: boolean;
}) {
  if (status === "synced") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
          "bg-emerald-50 text-[11px] font-semibold tracking-wide text-emerald-800",
          "ring-1 ring-emerald-600/15"
        )}
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2.2} />
        Проведено в 1С
      </span>
    );
  }
  if (!canQueue1c) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
          "bg-zinc-100 text-[11px] font-semibold tracking-wide text-zinc-600",
          "ring-1 ring-zinc-500/10"
        )}
        title="Заправка"
      >
        <CheckCircle2 className="h-3 w-3 shrink-0 text-zinc-400" strokeWidth={2.2} />
        Збережено
      </span>
    );
  }
  if (status === "error") {
    return (
      <button
        type="button"
        disabled={sending || !onSend}
        onClick={onSend}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
          "bg-rose-50 text-[11px] font-semibold tracking-wide text-rose-800",
          "ring-1 ring-rose-600/15 transition hover:bg-rose-100",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {sending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2.2} />
        )}
        Повторити
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={sending || !onSend}
      onClick={onSend}
      title="Підготувати для бухгалтера"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "bg-amber-50 text-[11px] font-semibold tracking-wide text-amber-900",
        "ring-1 ring-amber-500/20 transition hover:bg-amber-100",
        "disabled:cursor-not-allowed disabled:opacity-60"
      )}
    >
      {sending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Clock3 className="h-3 w-3 shrink-0 text-amber-700" strokeWidth={2.2} />
      )}
      Для бухгалтера
    </button>
  );
}

/** Допуск звірки з ДУТ (±л) */
const WIALON_MATCH_TOLERANCE_L = 2;

type WialonCheckState =
  | { kind: "manual" }
  | {
      kind: "shortage";
      variance: number;
      claimed: number;
      sensor: number;
    }
  | { kind: "confirmed"; claimed: number };

/**
 * 3 стани: без ДУТ (null) | нестача (>2л) | підтверджено (≤2л)
 */
function resolveWialonCheck(tx: FuelTransaction): WialonCheckState {
  if (tx.wialonVariance == null || !Number.isFinite(tx.wialonVariance)) {
    return { kind: "manual" };
  }

  const claimed = tx.amountLiters;
  const variance = Math.abs(tx.wialonVariance);

  if (variance > WIALON_MATCH_TOLERANCE_L) {
    return {
      kind: "shortage",
      variance,
      claimed,
      sensor: Math.max(0, Math.round((claimed - variance) * 100) / 100),
    };
  }

  return { kind: "confirmed", claimed };
}

function WialonControlCell({
  tx,
  unitHasDut,
  onReverify,
  reverifyBusy,
  compact = false,
}: {
  tx: FuelTransaction;
  /** Чи в каталозі Wialon для цієї техніки є ДУТ (з вкладки Техніка) */
  unitHasDut?: boolean;
  onReverify?: (txId: string) => void;
  reverifyBusy?: boolean;
  compact?: boolean;
}) {
  if (tx.type !== "outbound") {
    return (
      <span
        className="inline-flex min-h-7 items-center text-sm font-medium text-zinc-400"
        title="Контроль GPS не застосовується"
      >
        —
      </span>
    );
  }

  const check = resolveWialonCheck(tx);

  if (check.kind === "manual") {
    const knownDut = unitHasDut === true;
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-zinc-600">
            <Settings2 className="h-3 w-3 text-zinc-500" />
            {knownDut ? "Очікування GPS" : "Ручний облік"}
          </div>
          {knownDut && onReverify ? (
            <button
              type="button"
              title="Підтягнути дані з ДУТ зараз"
              disabled={reverifyBusy}
              onClick={() => onReverify(tx.id)}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700",
                "outline-none transition hover:bg-sky-100",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <RefreshCw
                className={cn("h-3 w-3", reverifyBusy && "animate-spin")}
                strokeWidth={2}
              />
              <span className="sr-only">Оновити GPS-звірку</span>
            </button>
          ) : null}
        </div>
        {!compact ? (
          <span className="text-[11px] leading-snug text-zinc-500">
            {knownDut
              ? "ДУТ є, але немає даних заправки за період звірки"
              : "Техніка без датчика палива"}
          </span>
        ) : null}
      </div>
    );
  }

  if (check.kind === "confirmed") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-emerald-700">
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        GPS OK
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-rose-700">
        <AlertTriangle className="h-3 w-3 text-rose-600" />
        Нестача {formatLiters(check.variance)} л
      </div>
      {!compact ? (
        <span className="text-[11px] leading-snug text-zinc-500">
          Заявлено: {formatLiters(check.claimed)} л | Датчик:{" "}
          {formatLiters(check.sensor)} л
        </span>
      ) : null}
    </div>
  );
}

function txTypeMeta(
  tx: FuelTransaction,
  unitName: string | null
): {
  title: string;
  detail: string | null;
  Icon: typeof Plus;
  iconWrap: string;
  iconClass: string;
} {
  if (tx.type === "inbound") {
    return {
      title: "Закупівля",
      detail: "Прихід на склад",
      Icon: Plus,
      iconWrap: "bg-emerald-50",
      iconClass: "text-emerald-500",
    };
  }
  if (tx.type === "transfer") {
    return {
      title: "Внутрішнє переміщення",
      detail: null,
      Icon: ArrowRightLeft,
      iconWrap: "bg-blue-50",
      iconClass: "text-blue-500",
    };
  }
  return {
    title: "Заправка техніки",
    detail: unitName,
    Icon: Tractor,
    iconWrap: "bg-amber-50",
    iconClass: "text-amber-500",
  };
}

type TankStatus = "ok" | "low" | "critical";

function formatLiters(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function resolveStatus(percent: number, type: FuelStorage["type"]): {
  label: string;
  tone: TankStatus;
} {
  if (percent < 20) return { label: "Критично", tone: "critical" };
  if (percent < 35) return { label: "Низький", tone: "low" };
  if (type === "mobile") return { label: "У рейсі", tone: "ok" };
  return { label: "В нормі", tone: "ok" };
}

/** Вертикальна колба — вписана в правий край картки */
function TankCistern({ percent }: { percent: number }) {
  const [fill, setFill] = useState(0);
  const firstPaint = useRef(true);

  useEffect(() => {
    const next = Math.min(100, Math.max(0, percent));
    if (firstPaint.current) {
      firstPaint.current = false;
      setFill(0);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setFill(next));
      });
      return () => cancelAnimationFrame(id);
    }
    setFill(next);
  }, [percent]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 w-[4.5rem] overflow-hidden sm:w-20",
        "rounded-r-3xl border-l border-white/30",
        "bg-zinc-900/[0.03]"
      )}
      aria-hidden
    >
      <div
        className={cn(
          "fuel-liquid absolute inset-x-0 bottom-0 overflow-visible",
          "bg-gradient-to-t from-amber-600/90 via-amber-400/85 to-amber-200/75",
          "shadow-[inset_0_4px_12px_rgba(255,255,255,0.28)]",
          "transition-[height] duration-[1100ms] ease-in-out"
        )}
        style={{ height: `${fill}%` }}
      >
        <span className="fuel-liquid-surface" />
      </div>

      <div
        className={cn(
          "pointer-events-none absolute inset-y-8 left-2 w-2.5",
          "rotate-[14deg] rounded-full bg-white/25"
        )}
      />
    </div>
  );
}

function TankCard({
  storage,
  onOpen,
  onEdit,
  onDelete,
}: {
  storage: FuelStorage;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const percent = storageFillPercent(storage);
  const status = resolveStatus(percent, storage.type);
  const valueUah = storageValueUah(storage);
  const isMobile = storage.type === "mobile";
  const TypeIcon = isMobile ? Truck : Factory;
  const typeLabel = isMobile ? "Бензовоз" : "Стаціонарний";

  return (
    <div
      className={cn(
        "relative min-h-[220px] overflow-hidden rounded-3xl border p-6 text-left",
        "bg-card/50 shadow-sm backdrop-blur-md",
        "transition-all hover:shadow-md"
      )}
    >
      <div className="absolute top-3 right-3 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              "bg-background/40 text-zinc-500/80 backdrop-blur-sm",
              "outline-none transition hover:bg-background/70 hover:text-zinc-800",
              "focus-visible:ring-2 focus-visible:ring-zinc-900/15"
            )}
            aria-label="Дії зі складом"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[10.5rem] rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-lg"
          >
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-2.5 py-2"
              onClick={() => onEdit()}
            >
              <Edit2 className="h-3.5 w-3.5" />
              Редагувати
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-2.5 py-2"
              onClick={() => onOpen()}
            >
              <Fuel className="h-3.5 w-3.5" />
              Деталі залишку
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer rounded-lg px-2.5 py-2 text-rose-600 focus:text-rose-700"
              onClick={() => onDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Видалити
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "absolute inset-0 z-10 rounded-3xl",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15"
        )}
        aria-label={`Відкрити ${storage.name}`}
      />

      <TankCistern percent={percent} />

      <div className="relative z-[11] pointer-events-none pr-[5.25rem] sm:pr-24">
        <div className="flex items-start gap-2 pr-6">
          <h2 className="min-w-0 flex-1 text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
            {storage.name}
          </h2>
        </div>

        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.9} />
          <span>{typeLabel}</span>
          <span className="text-zinc-300">·</span>
          <span
            className={cn(
              status.tone === "critical" && "text-rose-600",
              status.tone === "low" && "text-amber-700",
              status.tone === "ok" && "text-muted-foreground"
            )}
          >
            {status.label}
          </span>
        </p>

        <div className="mt-6 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <p className="text-3xl font-bold tracking-tight tabular-nums text-zinc-900 sm:text-4xl">
            {formatLiters(storage.currentVolume)}
            <span className="ml-1 text-lg font-semibold text-zinc-400">л</span>
          </p>
          <p className="text-sm tabular-nums text-muted-foreground/80">
            / {formatLiters(storage.capacity)} л
          </p>
        </div>

        <p className="mt-2 text-xs font-medium tabular-nums text-emerald-600">
          ≈ {formatMoney(valueUah)} ₴
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {Math.round(percent)}% · {storage.pricePerLiter} ₴ / л
        </p>
      </div>
    </div>
  );
}

type FuelViewProps = {
  initialStorages: FuelStorage[];
  initialTransactions: FuelTransaction[];
};

/** Облік палива — склади з Supabase */
export function FuelView({
  initialStorages,
  initialTransactions,
}: FuelViewProps) {
  const [storages, setStorages] = useState<FuelStorage[]>(initialStorages);
  const [transactions, setTransactions] =
    useState<FuelTransaction[]>(initialTransactions);
  const [txLoading, setTxLoading] = useState(false);
  const [fuelSheetOpen, setFuelSheetOpen] = useState(false);
  const [selectedStorage, setSelectedStorage] = useState<FuelStorage | null>(
    null
  );
  const [live, setLive] = useState(false);

  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isRefuelOpen, setIsRefuelOpen] = useState(false);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<FuelStorage | null>(
    null
  );
  const [editTransaction, setEditTransaction] =
    useState<FuelTransaction | null>(null);
  const [deleteTx, setDeleteTx] = useState<FuelTransaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [period, setPeriod] = useState<JournalPeriod | "custom">("Сьогодні");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [rangeOpen, setRangeOpen] = useState(false);

  const [units, setUnits] = useState<FleetUnitOption[]>(FALLBACK_UNITS);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [fieldFuelToday, setFieldFuelToday] = useState<number | null>(null);
  const [fieldFuelTotal, setFieldFuelTotal] = useState<number | null>(null);
  const [fieldFuelHasData, setFieldFuelHasData] = useState(false);
  const [fieldFuelLoading, setFieldFuelLoading] = useState(true);
  const [fieldFuelPeriod, setFieldFuelPeriod] =
    useState<FieldFuelPeriod>("today");
  const [fieldFuelBreakdown, setFieldFuelBreakdown] = useState<
    FieldFuelBreakdownRow[]
  >([]);
  const [fieldFuelCoverage, setFieldFuelCoverage] = useState<{
    daysCovered: number;
    daysExpected: number;
    incomplete: boolean;
  } | null>(null);
  const [refuelLiters, setRefuelLiters] = useState<number | null>(null);
  const [refuelHasData, setRefuelHasData] = useState(false);
  const [refuelLoading, setRefuelLoading] = useState(true);
  const [refuelBreakdown, setRefuelBreakdown] = useState<
    Array<{
      equipmentName: string;
      liters: number;
      wialonUnitId: number | null;
      source?: "wialon" | "manual" | "mixed";
    }>
  >([]);
  const [kpiRefreshToken, setKpiRefreshToken] = useState(0);
  const [reverifyTxId, setReverifyTxId] = useState<string | null>(null);
  const [send1cTxId, setSend1cTxId] = useState<string | null>(null);
  const [deleteStorage, setDeleteStorage] = useState<FuelStorage | null>(null);
  const [deletingStorage, setDeletingStorage] = useState(false);

  const unitNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const unit of units) {
      if (unit.wialonUnitId != null) map.set(unit.wialonUnitId, unit.name);
    }
    return map;
  }, [units]);

  const equipmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of units) {
      if (unit.equipmentId) map.set(unit.equipmentId, unit.name);
    }
    return map;
  }, [units]);

  const unitHasDutById = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const unit of units) {
      if (unit.wialonUnitId != null) {
        map.set(unit.wialonUnitId, unit.hasFuelSensor);
      }
    }
    return map;
  }, [units]);

  function resolveUnitLabel(tx: FuelTransaction): string | null {
    if (tx.wialonUnitId != null) {
      return unitNameById.get(tx.wialonUnitId) ?? null;
    }
    if (tx.equipmentId) {
      return equipmentNameById.get(tx.equipmentId) ?? null;
    }
    return null;
  }

  useEffect(() => {
    setStorages(initialStorages);
  }, [initialStorages]);

  /** Тримати обраний резервуар у синхроні з live-даними */
  useEffect(() => {
    if (!selectedStorage) return;
    const next = storages.find((s) => s.id === selectedStorage.id);
    if (next) setSelectedStorage(next);
  }, [storages, selectedStorage]);

  const dateRange = useMemo(
    () => getDateRange(period, customRange),
    [period, customRange]
  );

  const refreshStorages = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase
      .from("fuel_storages")
      .select("*")
      .order("capacity", { ascending: false });
    if (error || !data) {
      const response = await fetch("/api/fuel/storages");
      const json = (await response.json()) as {
        ok?: boolean;
        storages?: FuelStorage[];
      };
      if (json.storages) setStorages(json.storages);
      return;
    }
    setStorages(
      (data as Record<string, unknown>[])
        .map((row) => mapFuelStorageRow(row))
        .sort((a, b) => b.capacity - a.capacity)
    );
  }, []);

  const refreshTransactions = useCallback(async () => {
    setTxLoading(true);
    // Свіжий кінець періоду (не «час відкриття сторінки»)
    const range = getDateRange(period, customRange);
    try {
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase
        .from("fuel_transactions")
        .select(FUEL_TRANSACTIONS_SELECT)
        .gte("transaction_date", range.start.toISOString())
        .lte("transaction_date", range.end.toISOString())
        .order("transaction_date", { ascending: false })
        .limit(200);

      if (!error && data) {
        setTransactions(
          (data as Record<string, unknown>[]).map((row) =>
            mapFuelTransactionRow(row)
          )
        );
        return;
      }

      const params = new URLSearchParams({
        limit: "200",
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      });
      const response = await fetch(`/api/fuel/transactions?${params}`);
      const json = (await response.json()) as {
        ok?: boolean;
        transactions?: FuelTransaction[];
      };
      if (json.transactions) setTransactions(json.transactions);
    } finally {
      setTxLoading(false);
    }
  }, [period, customRange]);

  /** Кнопка «Оновити»: повторна звірка Wialon + перезавантаження журналу */
  const refreshJournalWithReverify = useCallback(async () => {
    setTxLoading(true);
    const range = getDateRange(period, customRange);
    try {
      const reverify = await fetch("/api/fuel/transactions/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: range.start.toISOString(),
          to: range.end.toISOString(),
        }),
      });
      const reverifyJson = (await reverify.json()) as {
        ok?: boolean;
        transactions?: FuelTransaction[];
      };
      if (reverify.ok && reverifyJson.ok && reverifyJson.transactions) {
        setTransactions(reverifyJson.transactions);
        return;
      }
      await refreshTransactions();
    } catch (err) {
      console.error("[fuel] reverify failed", err);
      await refreshTransactions();
    } finally {
      setTxLoading(false);
    }
  }, [period, customRange, refreshTransactions]);

  /** Точкова звірка однієї outbound («Очікування GPS») */
  const reverifySingleTransaction = useCallback(
    async (txId: string) => {
      setReverifyTxId(txId);
      const range = getDateRange(period, customRange);
      try {
        const response = await fetch("/api/fuel/transactions/reverify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: txId,
            from: range.start.toISOString(),
            to: range.end.toISOString(),
          }),
        });
        const json = (await response.json()) as {
          ok?: boolean;
          updated?: number;
          transaction?: FuelTransaction | null;
          transactions?: FuelTransaction[];
          error?: string;
        };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Не вдалося оновити GPS-звірку");
        }
        if (json.transaction) {
          setTransactions((prev) =>
            prev.map((row) => (row.id === txId ? json.transaction! : row))
          );
        } else if (json.transactions) {
          setTransactions(json.transactions);
        } else {
          await refreshTransactions();
        }
      } catch (err) {
        console.error("[fuel] single reverify failed", err);
        alert(err instanceof Error ? err.message : "Помилка GPS-звірки");
      } finally {
        setReverifyTxId(null);
      }
    },
    [period, customRange, refreshTransactions]
  );

  const sendTransactionTo1c = useCallback(
    async (tx: FuelTransaction) => {
      setSend1cTxId(tx.id);
      try {
        const equipmentHint = resolveUnitLabel(tx);
        const response = await fetch("/api/fuel/transactions/send-1c", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: tx.id,
            equipmentHint,
          }),
        });
        const json = (await response.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
          status?: FuelSyncStatus;
        };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Не вдалося підготувати для бухгалтера");
        }
        if (json.status) {
          setTransactions((prev) =>
            prev.map((row) =>
              row.id === tx.id
                ? { ...row, syncStatus: json.status as FuelSyncStatus }
                : row
            )
          );
        }
        alert(
          json.message ??
            "Підготовлено для бухгалтера."
        );
      } catch (err) {
        alert(err instanceof Error ? err.message : "Помилка підготовки");
      } finally {
        setSend1cTxId(null);
      }
    },
    [unitNameById, equipmentNameById]
  );

  const confirmDeleteStorage = useCallback(async () => {
    if (!deleteStorage) return;
    setDeletingStorage(true);
    try {
      const response = await fetch(`/api/fuel/storages/${deleteStorage.id}`, {
        method: "DELETE",
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Не вдалося видалити склад");
      }
      setDeleteStorage(null);
      if (selectedStorage?.id === deleteStorage.id) {
        setSelectedStorage(null);
        setFuelSheetOpen(false);
      }
      await refreshStorages();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setDeletingStorage(false);
    }
  }, [deleteStorage, refreshStorages, selectedStorage]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStorages(), refreshTransactions()]);
    setKpiRefreshToken((n) => n + 1);
  }, [refreshStorages, refreshTransactions]);

  useEffect(() => {
    void refreshTransactions();
  }, [period, refreshTransactions]);

  function openEdit(tx: FuelTransaction) {
    setEditTransaction(tx);
    if (tx.type === "inbound") setIsReceiveOpen(true);
    else if (tx.type === "transfer") setIsTransferOpen(true);
    else setIsRefuelOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTx) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/fuel/transactions/${deleteTx.id}`, {
        method: "DELETE",
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Не вдалося видалити");
      }
      setDeleteTx(null);
      await refreshAll();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setDeleting(false);
    }
  }

  /** Realtime + м’який refetch — цистерни реагують на зміни в БД */
  useEffect(() => {
    const supabase = createBrowserSupabase();

    const channel = supabase
      .channel("fuel-storages-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fuel_storages" },
        () => {
          void refreshStorages();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fuel_transactions" },
        () => {
          void refreshTransactions();
        }
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    const onFocus = () => {
      void refreshAll();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [refreshStorages, refreshTransactions, refreshAll]);

  /** Витрата на полях + заправки зі складу за обраний період */
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setFieldFuelLoading(true);
    setRefuelLoading(true);
    void Promise.all([
      getFieldFuelConsumed(fieldFuelPeriod),
      getFuelRefueledForPeriod(fieldFuelPeriod),
    ]).then(([burned, refueled]) => {
      if (cancelled) return;
      if (burned.ok) {
        setFieldFuelToday(burned.data.liters);
        setFieldFuelTotal(burned.data.totalLiters);
        setFieldFuelHasData(burned.data.hasData);
        setFieldFuelBreakdown(burned.data.breakdown);
        setFieldFuelCoverage({
          daysCovered: burned.data.daysCovered,
          daysExpected: burned.data.daysExpected,
          incomplete: burned.data.coverageIncomplete,
        });
        // Поки історія не закрита — підтягуємо наступну порцію днів
        if (burned.data.coverageIncomplete) {
          retryTimer = setTimeout(() => {
            setKpiRefreshToken((n) => n + 1);
          }, 2500);
        }
      } else {
        setFieldFuelToday(null);
        setFieldFuelTotal(null);
        setFieldFuelHasData(false);
        setFieldFuelBreakdown([]);
        setFieldFuelCoverage(null);
      }
      if (refueled.ok) {
        setRefuelLiters(refueled.data.liters);
        setRefuelHasData(refueled.data.hasData);
        setRefuelBreakdown(refueled.data.breakdown);
      } else {
        setRefuelLiters(null);
        setRefuelHasData(false);
        setRefuelBreakdown([]);
      }
      setFieldFuelLoading(false);
      setRefuelLoading(false);
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [fieldFuelPeriod, kpiRefreshToken]);

  /** Список техніки: довідник equipment + live Wialon */
  useEffect(() => {
    const controller = new AbortController();
    setUnitsLoading(true);

    void (async () => {
      try {
        const [catalogRes, wialonRes] = await Promise.all([
          listEquipmentForOps(),
          fetch("/api/wialon", { signal: controller.signal })
            .then(async (response) => {
              const data = (await response.json()) as {
                ok?: boolean;
                units?: WialonUnit[];
              };
              if (!response.ok || !Array.isArray(data.units)) return [] as WialonUnit[];
              return data.units;
            })
            .catch(() => [] as WialonUnit[]),
        ]);

        if (controller.signal.aborted) return;

        const catalog = catalogRes.ok ? catalogRes.data : [];
        const merged = mergeEquipmentOpsOptions(catalog, wialonRes);
        const dutByWialon = new Map<number, boolean>();
        for (const u of wialonRes) {
          dutByWialon.set(u.id, unitHasFuelSensor(u));
        }

        const next: FleetUnitOption[] = merged.map((opt) => ({
          key: opt.key,
          name: opt.label,
          equipmentId: opt.equipmentId,
          wialonUnitId: opt.wialonUnitId,
          hasTracker: opt.hasTracker,
          hasFuelSensor:
            opt.wialonUnitId != null
              ? (dutByWialon.get(opt.wialonUnitId) ?? false)
              : false,
        }));

        if (next.length > 0) setUnits(next);
      } catch {
        /* лишаємо FALLBACK_UNITS */
      } finally {
        if (!controller.signal.aborted) setUnitsLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const totalLiters = useMemo(() => totalFuelVolume(storages), [storages]);
  const totalValue = useMemo(() => totalFuelValue(storages), [storages]);

  return (
    <main className="h-full w-full overflow-y-auto overscroll-none">
      <FuelDashboardHeader
        storages={storages}
        totalLiters={totalLiters}
        totalValue={totalValue}
        live={live}
        fieldFuelLiters={fieldFuelToday}
        fieldFuelTotalLiters={fieldFuelTotal}
        fieldFuelHasData={fieldFuelHasData}
        fieldFuelLoading={fieldFuelLoading}
        fieldFuelPeriod={fieldFuelPeriod}
        fieldFuelBreakdown={fieldFuelBreakdown}
        fieldFuelCoverage={fieldFuelCoverage}
        refuelLiters={refuelLiters}
        refuelHasData={refuelHasData}
        refuelLoading={refuelLoading}
        refuelBreakdown={refuelBreakdown}
        onFieldFuelPeriodChange={setFieldFuelPeriod}
        onPurchase={() => {
          setEditTransaction(null);
          setIsReceiveOpen(true);
        }}
        onTransfer={() => {
          setEditTransaction(null);
          setIsTransferOpen(true);
        }}
        onRefuel={() => {
          setEditTransaction(null);
          setIsRefuelOpen(true);
        }}
        onRadarApproved={() => {
          void refreshStorages();
          void refreshTransactions();
          setKpiRefreshToken((n) => n + 1);
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
      <section className="mb-3 md:mb-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
              Склади
            </h2>
            <p className="text-xs text-zinc-500">
              Цистерни та бензовози · залишок і середня ціна
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingStorage(null);
              setStorageDialogOpen(true);
            }}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 shadow-sm",
              "outline-none transition hover:bg-zinc-50 hover:text-zinc-900",
              "focus-visible:ring-2 focus-visible:ring-emerald-500/20"
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            Додати склад
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {storages.length === 0 ? (
            <div className="col-span-full rounded-3xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
              <p className="text-sm font-semibold text-zinc-900">
                Склади палива ще не налаштовані
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Натисніть «Додати склад», щоб створити першу ємність
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingStorage(null);
                  setStorageDialogOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Додати склад
              </button>
            </div>
          ) : (
            storages.map((storage) => (
              <TankCard
                key={storage.id}
                storage={storage}
                onOpen={() => {
                  setSelectedStorage(storage);
                  setFuelSheetOpen(true);
                }}
                onEdit={() => {
                  setEditingStorage(storage);
                  setStorageDialogOpen(true);
                }}
                onDelete={() => setDeleteStorage(storage)}
              />
            ))
          )}
        </div>
      </section>

      <GlassCard className="hover:scale-100">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-500">
                Журнал операцій
              </p>
              <p className="text-xs text-zinc-500/80">
                Банківська виписка · статус підготовки для бухгалтера
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshJournalWithReverify()}
              disabled={txLoading}
              title="Оновити журнал і перевірити GPS-звірку заправок"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 text-xs font-semibold text-zinc-800 shadow-sm",
                "outline-none transition hover:bg-zinc-50 hover:text-zinc-900",
                "focus-visible:ring-2 focus-visible:ring-emerald-500/20",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", txLoading && "animate-spin")}
                strokeWidth={2}
              />
              {txLoading ? "Звірка…" : "Оновити"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={period === "custom" ? undefined : period}
              onValueChange={(value) => {
                if (
                  value === "Сьогодні" ||
                  value === "Вчора" ||
                  value === "Тиждень" ||
                  value === "Місяць" ||
                  value === "Рік"
                ) {
                  setPeriod(value);
                }
              }}
            >
              <TabsList
                className={cn(
                  "h-auto flex-wrap gap-0.5 rounded-lg bg-muted p-1",
                  "group-data-horizontal/tabs:h-auto"
                )}
              >
                {PERIOD_OPTIONS.map((option) => (
                  <TabsTrigger
                    key={option}
                    value={option}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground",
                      "hover:text-foreground",
                      "data-active:bg-background data-active:text-foreground data-active:shadow-sm"
                    )}
                  >
                    {option}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
              <PopoverTrigger
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm",
                  "outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/15",
                  period === "custom" && "border-zinc-400 bg-zinc-50"
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5 text-zinc-500" />
                {period === "custom" && customRange?.from
                  ? `${format(customRange.from, "d MMM", { locale: uk })}${
                      customRange.to
                        ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                        : ""
                    }`
                  : "Діапазон"}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
              >
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={customRange}
                  onSelect={(range) => {
                    setCustomRange(range);
                    setPeriod("custom");
                    if (range?.from && range?.to) setRangeOpen(false);
                  }}
                  locale={uk}
                  className="rounded-xl"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200/80">
          <div className="w-full overflow-x-auto pb-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200/80 bg-zinc-50/90">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Час
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Тип / техніка
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Звідки / куди
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Літри
                  </th>
                  <th className="min-w-[140px] px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    1С
                  </th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {transactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-zinc-500"
                    >
                      Немає операцій за обраний період
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const unitName = resolveUnitLabel(tx);
                    const meta = txTypeMeta(tx, unitName);
                    const TypeIcon = meta.Icon;
                    const litersLabel =
                      tx.type === "inbound"
                        ? `+${formatLiters(tx.amountLiters)} L`
                        : `−${formatLiters(tx.amountLiters)} L`;

                    return (
                      <tr
                        key={tx.id}
                        className="transition-colors hover:bg-zinc-50/80"
                      >
                        <td className="px-4 py-4 text-left whitespace-nowrap text-sm text-zinc-500 tabular-nums">
                          {formatTxDate(tx.transactionDate)}
                        </td>
                        <td className="px-4 py-4 text-left">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-2",
                                meta.iconWrap
                              )}
                            >
                              <TypeIcon
                                size={18}
                                className={meta.iconClass}
                                strokeWidth={1.8}
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-zinc-900">
                                {meta.title}
                              </p>
                              {meta.detail ? (
                                <p className="mt-0.5 truncate text-xs text-zinc-500">
                                  {meta.detail}
                                </p>
                              ) : null}
                              {tx.type === "outbound" ? (
                                <div className="mt-1.5">
                                  <WialonControlCell
                                    tx={tx}
                                    unitHasDut={
                                      tx.wialonUnitId != null
                                        ? unitHasDutById.get(tx.wialonUnitId)
                                        : undefined
                                    }
                                    onReverify={(id) =>
                                      void reverifySingleTransaction(id)
                                    }
                                    reverifyBusy={reverifyTxId === tx.id}
                                    compact
                                  />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-left text-sm text-zinc-600">
                          {formatRoute(tx)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-4 text-right text-lg font-semibold tracking-tight whitespace-nowrap tabular-nums",
                            tx.type === "inbound"
                              ? "text-emerald-600"
                              : "text-zinc-900"
                          )}
                        >
                          {litersLabel}
                        </td>
                        <td className="min-w-[140px] px-4 py-4 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <BasSyncBadge
                              status={tx.syncStatus}
                              sending={send1cTxId === tx.id}
                              canQueue1c={
                                tx.type === "inbound" || tx.type === "transfer"
                              }
                              onSend={() => void sendTransactionTo1c(tx)}
                            />
                            {(tx.attachmentCount ?? 0) > 0 ? (
                              <AttachmentViewerButton
                                entityType="fuel_transaction"
                                entityId={tx.id}
                                count={tx.attachmentCount ?? 0}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="w-12 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400",
                                "outline-none transition hover:bg-zinc-100 hover:text-zinc-700",
                                "focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                              )}
                            >
                              <MoreHorizontal size={18} />
                              <span className="sr-only">Дії</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="min-w-44 rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-lg"
                            >
                              <DropdownMenuItem
                                className="cursor-pointer rounded-lg px-2.5 py-2"
                                onClick={() => openEdit(tx)}
                              >
                                <Edit2 size={16} />
                                Редагувати
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                className="cursor-pointer rounded-lg px-2.5 py-2 text-rose-600 focus:text-rose-700"
                                onClick={() => setDeleteTx(tx)}
                              >
                                <Trash2 size={16} />
                                Видалити
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </GlassCard>
      </div>

      <FuelActionDialogs
        storages={storages}
        units={units}
        unitsLoading={unitsLoading}
        isReceiveOpen={isReceiveOpen}
        isTransferOpen={isTransferOpen}
        isRefuelOpen={isRefuelOpen}
        onReceiveOpenChange={setIsReceiveOpen}
        onTransferOpenChange={setIsTransferOpen}
        onRefuelOpenChange={setIsRefuelOpen}
        editTransaction={editTransaction}
        onEditTransactionChange={setEditTransaction}
        onSuccess={refreshAll}
      />

      <FuelStorageDialog
        open={storageDialogOpen}
        onOpenChange={(open) => {
          setStorageDialogOpen(open);
          if (!open) setEditingStorage(null);
        }}
        storage={editingStorage}
        onSuccess={refreshStorages}
      />

      <Dialog
        open={deleteStorage != null}
        onOpenChange={(open) => {
          if (!open && !deletingStorage) setDeleteStorage(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={cn(
            "gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-8 text-zinc-900 shadow-2xl sm:max-w-md",
            "[&_[data-slot=dialog-close]]:hidden"
          )}
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
              <Trash2 className="text-rose-600" size={24} />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle className="text-xl font-bold text-zinc-900">
                Видалити склад?
              </DialogTitle>
              <DialogDescription className="mt-2 text-base text-zinc-500">
                «
                <strong className="font-semibold text-zinc-900">
                  {deleteStorage?.name}
                </strong>
                » зникне з обліку. Можна лише якщо залишок 0 л і немає операцій
                в журналі.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 flex w-full gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={deletingStorage}
                onClick={() => setDeleteStorage(null)}
                className="h-11 flex-1 rounded-xl"
              >
                Скасувати
              </Button>
              <Button
                type="button"
                disabled={deletingStorage}
                onClick={() => void confirmDeleteStorage()}
                className="h-11 flex-1 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                {deletingStorage ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Видалити"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTx != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTx(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={cn(
            "gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-8 text-zinc-900 shadow-2xl sm:max-w-md",
            "[&_[data-slot=dialog-close]]:hidden"
          )}
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
              <Trash2 className="text-rose-600" size={24} />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle className="text-xl font-bold text-zinc-900">
                Видалити операцію?
              </DialogTitle>
              <DialogDescription className="mt-2 text-base text-zinc-500">
                Запис на{" "}
                <strong className="font-semibold text-zinc-900">
                  {deleteTx
                    ? `${formatLiters(deleteTx.amountLiters)} L`
                    : "—"}
                </strong>{" "}
                буде видалено з журналу, а залишки палива відкотяться відповідно
                до типу операції.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-xl border-none bg-zinc-100 font-medium text-zinc-700 hover:bg-zinc-200"
                onClick={() => setDeleteTx(null)}
                disabled={deleting}
              >
                Скасувати
              </Button>
              <Button
                type="button"
                className="h-12 rounded-xl border-none bg-rose-500 font-medium text-white hover:bg-rose-600"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Так, видалити"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <FuelDetailSheet
        open={fuelSheetOpen}
        onOpenChange={(open) => {
          setFuelSheetOpen(open);
          if (!open) setSelectedStorage(null);
        }}
        storage={selectedStorage}
        transactions={transactions}
      />
    </main>
  );
}

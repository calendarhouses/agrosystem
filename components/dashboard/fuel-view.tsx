"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endOfDay, format, startOfDay, startOfYear, subDays } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Edit2,
  Fuel,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Tractor,
  Trash2,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import {
  FuelActionDialogs,
  type FleetUnitOption,
} from "@/components/dashboard/fuel-action-dialogs";
import { FuelDetailSheet } from "@/components/dashboard/fuel-detail-sheet";
import { PageHeader } from "@/components/layout/page-header";
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
import {
  mapFuelStorageRow,
  storageFillPercent,
  storageSubtitle,
  storageValueUah,
  totalFuelValue,
  totalFuelVolume,
  type FuelStorage,
} from "@/lib/fuel-storages";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransaction,
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
    return { start: startOfDay(subDays(now, 6)), end: now };
  }
  if (period === "Місяць") {
    return { start: startOfDay(subDays(now, 29)), end: now };
  }
  if (period === "Рік") {
    return { start: startOfYear(now), end: now };
  }

  // Сьогодні (і fallback)
  return { start: startOfDay(now), end: now };
}

/** Fallback, якщо Wialon недоступний */
const FALLBACK_UNITS: FleetUnitOption[] = [
  { id: 601301819, name: "МТЗ-82", hasFuelSensor: false },
  { id: 601301822, name: "John Deere 8R", hasFuelSensor: true },
  { id: 601301825, name: "Case IH Magnum", hasFuelSensor: true },
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
}: {
  tx: FuelTransaction;
  /** Чи в каталозі Wialon для цієї техніки є ДУТ (з вкладки Техніка) */
  unitHasDut?: boolean;
}) {
  if (tx.type !== "outbound") {
    return <span className="text-zinc-300">—</span>;
  }

  const check = resolveWialonCheck(tx);

  if (check.kind === "manual") {
    const knownDut = unitHasDut === true;
    return (
      <div className="flex flex-col items-start gap-1.5">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-zinc-600 shadow-sm">
          <Settings2 className="h-3.5 w-3.5 text-zinc-500" />
          {knownDut ? "Очікування GPS" : "Ручний облік"}
        </div>
        <span className="text-[11px] leading-snug text-zinc-500">
          {knownDut
            ? "ДУТ є, але немає даних заправки за період звірки"
            : "Техніка без датчика палива"}
        </span>
      </div>
    );
  }

  if (check.kind === "confirmed") {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-emerald-700 shadow-sm">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Підтверджено
        </div>
        <span className="text-[11px] leading-snug text-zinc-500">
          Збігається з даними GPS
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-rose-700 shadow-sm">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        Нестача {formatLiters(check.variance)} л
      </div>
      <span className="text-[11px] leading-snug text-zinc-500">
        Заявлено: {formatLiters(check.claimed)} л | Датчик:{" "}
        {formatLiters(check.sensor)} л
      </span>
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

const STATUS_BADGE: Record<TankStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15",
  low: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/15",
  critical: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/15",
};

/** Вертикальна цистерна — висота плавно стежить за % з БД */
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
        "absolute top-6 right-6 ml-auto flex h-48 w-24 items-end overflow-hidden",
        "rounded-3xl border-4 border-white bg-zinc-100",
        "shadow-[inset_0_4px_10px_rgba(0,0,0,0.1)]"
      )}
      aria-hidden
    >
      <div
        className={cn(
          "fuel-liquid relative w-full overflow-visible",
          "bg-gradient-to-t from-amber-500 to-amber-300",
          "shadow-[inset_0_4px_10px_rgba(255,255,255,0.35)]",
          "transition-[height] duration-1000 ease-out"
        )}
        style={{ height: `${fill}%` }}
      >
        <span className="fuel-liquid-surface" />
      </div>

      <div
        className={cn(
          "pointer-events-none absolute inset-y-5 left-2.5 w-4",
          "rotate-12 rounded-full bg-white/25"
        )}
      />
    </div>
  );
}

function TankCard({
  storage,
  onOpen,
}: {
  storage: FuelStorage;
  onOpen: () => void;
}) {
  const percent = storageFillPercent(storage);
  const status = resolveStatus(percent, storage.type);
  const valueUah = storageValueUah(storage);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "relative min-h-[220px] overflow-hidden rounded-3xl border border-zinc-200/60 bg-white p-6 text-left shadow-sm",
        "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(245,158,11,0.07),transparent_55%)]"
      />

      <TankCistern percent={percent} />

      <div className="relative pr-28">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
            {storage.name}
          </h2>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              STATUS_BADGE[status.tone]
            )}
          >
            {status.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {storageSubtitle(storage)}
        </p>

        <div className="mt-5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className="text-4xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatLiters(storage.currentVolume)}{" "}
            <span className="text-xl font-semibold text-zinc-400">л</span>
          </p>
          <p className="text-sm font-medium text-zinc-500 tabular-nums">
            з {formatLiters(storage.capacity)} л
          </p>
        </div>

        <p className="mt-2 text-xl font-semibold text-emerald-600 tabular-nums">
          ≈ {formatMoney(valueUah)} ₴
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {Math.round(percent)}% · {storage.pricePerLiter} ₴ / л
        </p>
      </div>
    </button>
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
  const [editTransaction, setEditTransaction] =
    useState<FuelTransaction | null>(null);
  const [deleteTx, setDeleteTx] = useState<FuelTransaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [period, setPeriod] = useState<JournalPeriod | "custom">("Сьогодні");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [rangeOpen, setRangeOpen] = useState(false);

  const [units, setUnits] = useState<FleetUnitOption[]>(FALLBACK_UNITS);
  const [unitsLoading, setUnitsLoading] = useState(false);

  const unitNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const unit of units) map.set(unit.id, unit.name);
    return map;
  }, [units]);

  const unitHasDutById = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const unit of units) map.set(unit.id, unit.hasFuelSensor);
    return map;
  }, [units]);

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
    try {
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase
        .from("fuel_transactions")
        .select(FUEL_TRANSACTIONS_SELECT)
        .gte("transaction_date", dateRange.start.toISOString())
        .lte("transaction_date", dateRange.end.toISOString())
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
        from: dateRange.start.toISOString(),
        to: dateRange.end.toISOString(),
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
  }, [dateRange]);

  /** Кнопка «Оновити»: повторна звірка Wialon + перезавантаження журналу */
  const refreshJournalWithReverify = useCallback(async () => {
    setTxLoading(true);
    try {
      const reverify = await fetch("/api/fuel/transactions/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: dateRange.start.toISOString(),
          to: dateRange.end.toISOString(),
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
  }, [dateRange, refreshTransactions]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStorages(), refreshTransactions()]);
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

  /** Список техніки з Wialon для модалки заправки */
  useEffect(() => {
    const controller = new AbortController();
    setUnitsLoading(true);
    fetch("/api/wialon", { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          units?: WialonUnit[];
        };
        if (!response.ok || !Array.isArray(data.units) || data.units.length === 0) {
          return;
        }
        setUnits(
          data.units
            .map((u) => ({
              id: u.id,
              name: u.nm,
              /** Той самий критерій ДУТ, що й на вкладці «Техніка» / у Smart Match */
              hasFuelSensor: unitHasFuelSensor(u),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "uk"))
        );
      })
      .catch(() => {
        /* лишаємо FALLBACK_UNITS */
      })
      .finally(() => {
        if (!controller.signal.aborted) setUnitsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const totalLiters = useMemo(() => totalFuelVolume(storages), [storages]);
  const totalValue = useMemo(() => totalFuelValue(storages), [storages]);

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Fuel}
        title="Облік Палива"
        description="Управління дизельними активами"
        actions={
          <div className="text-right">
            <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              Усього в системі
              {live ? (
                <span className="ml-1.5 inline-flex items-center gap-1 font-medium normal-case tracking-normal text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  live
                </span>
              ) : null}
            </p>
            {storages.length === 0 ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Немає складів
              </p>
            ) : (
              <>
                <p className="text-lg font-bold tabular-nums text-zinc-900">
                  {formatLiters(totalLiters)} л
                </p>
                <p className="text-sm font-semibold tabular-nums text-emerald-600">
                  ≈ {formatMoney(totalValue)} ₴
                </p>
              </>
            )}
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setEditTransaction(null);
            setIsReceiveOpen(true);
          }}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3",
            "bg-zinc-900 text-sm font-semibold text-white shadow-sm",
            "transition-all hover:bg-zinc-800 hover:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30"
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Закупівля
        </button>
        <button
          type="button"
          onClick={() => {
            setEditTransaction(null);
            setIsTransferOpen(true);
          }}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3",
            "border border-zinc-200/80 bg-white/70 text-sm font-semibold text-zinc-700 shadow-sm backdrop-blur-sm",
            "transition-all hover:border-zinc-300 hover:bg-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15"
          )}
        >
          <ArrowRightLeft className="h-4 w-4" strokeWidth={1.8} />
          Переміщення
        </button>
        <button
          type="button"
          onClick={() => {
            setEditTransaction(null);
            setIsRefuelOpen(true);
          }}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3",
            "bg-emerald-500 text-sm font-semibold text-white shadow-sm",
            "transition-all hover:bg-emerald-600 hover:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
          )}
        >
          <Tractor className="h-4 w-4" strokeWidth={1.8} />
          Заправка
        </button>
      </div>

      <section className="mb-4 grid grid-cols-1 gap-6 md:mb-5 md:grid-cols-2">
        {storages.length === 0 ? (
          <div className="col-span-full rounded-3xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
            <p className="text-sm font-semibold text-zinc-900">
              Склади палива ще не налаштовані
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Додайте рядки в таблицю fuel_storages у Supabase
            </p>
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
            />
          ))
        )}
      </section>

      <GlassCard className="hover:scale-100">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-500">
                Журнал операцій
              </p>
              <p className="text-xs text-zinc-500/80">
                Банківська виписка · авто-звірка Wialon для заправок
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
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl bg-zinc-100 p-1">
              {PERIOD_OPTIONS.map((option) => {
                const active = period === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPeriod(option)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs transition-all",
                      active
                        ? "bg-white font-medium text-zinc-900 shadow-sm"
                        : "font-medium text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
              <PopoverTrigger
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm",
                  "outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-emerald-500/20",
                  period === "custom" && "border-emerald-300 bg-emerald-50/40"
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
                  <th className="min-w-[200px] px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Контроль Wialon
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
                    const unitName =
                      tx.wialonUnitId != null
                        ? unitNameById.get(tx.wialonUnitId) ?? null
                        : null;
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
                        <td className="min-w-[200px] px-4 py-4 text-left">
                          <WialonControlCell
                            tx={tx}
                            unitHasDut={
                              tx.wialonUnitId != null
                                ? unitHasDutById.get(tx.wialonUnitId)
                                : undefined
                            }
                          />
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

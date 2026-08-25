"use client";

import { useEffect, useMemo, useState } from "react";
import {
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { uk } from "date-fns/locale";
import {
  Calendar,
  Fuel,
  Radar,
  TrendingDown,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  storageValueUah,
  type FuelStorage,
} from "@/lib/fuel-storages";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransaction,
} from "@/lib/fuel-transactions";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Вікно для розрахунку середньої витрати */
const BURN_LOOKBACK_DAYS = 30;
const SPARKLINE_DAYS = 7;
/** Допуск звірки з ДУТ (±л) — як у журналі */
const WIALON_MATCH_TOLERANCE_L = 2;

type FuelDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: FuelStorage | null;
  transactions: FuelTransaction[];
};

type VolumePoint = {
  dayKey: string;
  label: string;
  liters: number;
};

function formatLiters(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function txTitle(tx: FuelTransaction): string {
  if (tx.type === "inbound") return "Закупівля";
  if (tx.type === "transfer") return "Переміщення";
  return "Заправка техніки";
}

function daysWord(n: number): string {
  if (n === 1) return "день";
  if (n >= 2 && n <= 4) return "дні";
  return "днів";
}

function signedDeltaForStorage(
  tx: FuelTransaction,
  storageId: string
): number {
  const toHere = tx.toStorageId === storageId;
  const fromHere = tx.fromStorageId === storageId;
  if (toHere && !fromHere) return tx.amountLiters;
  if (fromHere && !toHere) return -tx.amountLiters;
  return 0;
}

function isOutboundConfirmed(tx: FuelTransaction): boolean {
  if (tx.type !== "outbound") return false;
  if (tx.wialonVariance == null || !Number.isFinite(tx.wialonVariance)) {
    return false;
  }
  return Math.abs(tx.wialonVariance) <= WIALON_MATCH_TOLERANCE_L;
}

/**
 * Середня добова витрата з реального журналу:
 * усі списання з бака (outbound + transfer from) за lookback / к-сть днів.
 */
function computeBurnAnalytics(
  storage: FuelStorage,
  txs: FuelTransaction[]
): { dailyBurnL: number | null; daysLeft: number | null } {
  const now = new Date();
  const since = subDays(now, BURN_LOOKBACK_DAYS);

  const outflows = txs.filter((tx) => {
    if (tx.fromStorageId !== storage.id) return false;
    const d = new Date(tx.transactionDate);
    if (Number.isNaN(d.getTime())) return false;
    return d >= since;
  });

  if (outflows.length === 0) {
    return { dailyBurnL: null, daysLeft: null };
  }

  const totalOut = outflows.reduce((sum, tx) => sum + tx.amountLiters, 0);
  const oldest = outflows.reduce((min, tx) => {
    const t = new Date(tx.transactionDate).getTime();
    return t < min ? t : min;
  }, now.getTime());

  const spanDays = Math.max(
    1,
    differenceInCalendarDays(now, new Date(oldest)) + 1
  );
  const dailyBurnL = Math.round((totalOut / spanDays) * 10) / 10;

  if (!Number.isFinite(dailyBurnL) || dailyBurnL <= 0) {
    return { dailyBurnL: null, daysLeft: null };
  }

  const daysLeft = Math.max(
    0,
    Math.round(storage.currentVolume / dailyBurnL)
  );
  return { dailyBurnL, daysLeft };
}

/** Реконструкція залишку на кінець кожного з останніх N днів */
function buildVolumeSparkline(
  storage: FuelStorage,
  txs: FuelTransaction[],
  days: number = SPARKLINE_DAYS
): VolumePoint[] {
  const now = new Date();
  const windowStart = startOfDay(subDays(now, days - 1));

  const relevant = txs
    .map((tx) => {
      const at = new Date(tx.transactionDate);
      if (Number.isNaN(at.getTime())) return null;
      if (at < windowStart) return null;
      const delta = signedDeltaForStorage(tx, storage.id);
      if (delta === 0) return null;
      return { at, delta };
    })
    .filter((row): row is { at: Date; delta: number } => row != null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const deltaInWindow = relevant.reduce((sum, row) => sum + row.delta, 0);
  let volume = Math.max(0, storage.currentVolume - deltaInWindow);

  const points: VolumePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfDay(subDays(now, i));
    const dayEnd = endOfDay(dayStart);
    for (const row of relevant) {
      if (row.at >= dayStart && row.at <= dayEnd) {
        volume = Math.max(0, volume + row.delta);
      }
    }
    points.push({
      dayKey: format(dayStart, "yyyy-MM-dd"),
      label: format(dayStart, "d MMM", { locale: uk }),
      liters: Math.round(volume * 10) / 10,
    });
  }

  if (points.length > 0) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      liters: Math.round(storage.currentVolume * 10) / 10,
    };
  }

  return points;
}

function VolumeSparkline({ points }: { points: VolumePoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">
        Немає історії за 7 днів
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-28 w-full outline-none",
        "[&_.recharts-wrapper]:outline-none",
        "[&_.recharts-surface]:outline-none",
        "[&_svg]:outline-none",
        "[&_.recharts-wrapper:focus]:outline-none",
        "[&_.recharts-wrapper:focus-visible]:outline-none"
      )}
      style={{ outline: "none" }}
      tabIndex={-1}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 6, right: 2, left: 2, bottom: 2 }}
          style={{ outline: "none" }}
        >
          <defs>
            <linearGradient id="fuelVolumeFillAmber" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
              <stop offset="55%" stopColor="#f59e0b" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "rgba(245,158,11,0.35)", strokeWidth: 1 }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgba(228,228,231,0.9)",
              background: "rgba(255,255,255,0.97)",
              color: "#18181b",
              fontSize: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
              outline: "none",
            }}
            wrapperStyle={{ outline: "none" }}
            formatter={(value) => [
              `${formatLiters(Number(value ?? 0))} л`,
              "Залишок",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Area
            type="monotone"
            dataKey="liters"
            stroke="#f59e0b"
            strokeWidth={2.25}
            fill="url(#fuelVolumeFillAmber)"
            activeDot={{
              r: 4,
              fill: "#f59e0b",
              stroke: "#fff",
              strokeWidth: 2,
            }}
            isAnimationActive
            animationDuration={700}
            animationEasing="ease-in-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Аналітика активу — бічна панель для одного резервуара */
export function FuelDetailSheet({
  open,
  onOpenChange,
  storage,
  transactions,
}: FuelDetailSheetProps) {
  const [history, setHistory] = useState<FuelTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const storageId = storage?.id ?? null;

  useEffect(() => {
    if (!open || !storageId) {
      setHistory([]);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);

    const fromIso = subDays(new Date(), BURN_LOOKBACK_DAYS).toISOString();
    const supabase = createBrowserSupabase();

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select(FUEL_TRANSACTIONS_SELECT)
          .or(`from_storage_id.eq.${storageId},to_storage_id.eq.${storageId}`)
          .gte("transaction_date", fromIso)
          .order("transaction_date", { ascending: false })
          .limit(100);

        if (cancelled) return;
        if (!error && data) {
          setHistory(
            (data as Record<string, unknown>[]).map((row) =>
              mapFuelTransactionRow(row)
            )
          );
          return;
        }
        setHistory(
          transactions.filter(
            (tx) =>
              tx.fromStorageId === storageId || tx.toStorageId === storageId
          )
        );
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, storageId, transactions]);

  const valueUah = storage ? storageValueUah(storage) : 0;

  const { dailyBurnL, daysLeft } = useMemo(() => {
    if (!storage) return { dailyBurnL: null, daysLeft: null };
    return computeBurnAnalytics(storage, history);
  }, [storage, history]);

  const sparkline = useMemo(() => {
    if (!storage) return [];
    return buildVolumeSparkline(storage, history, SPARKLINE_DAYS);
  }, [storage, history]);

  const gpsAccuracy = useMemo(() => {
    const outbound = history.filter((tx) => tx.type === "outbound");
    if (outbound.length === 0) {
      return { pct: null as number | null, confirmed: 0, total: 0 };
    }
    const confirmed = outbound.filter(isOutboundConfirmed).length;
    const pct = Math.round((confirmed / outbound.length) * 100);
    return { pct, confirmed, total: outbound.length };
  }, [history]);

  const storageTx = useMemo(() => history.slice(0, 12), [history]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-border/60 bg-background p-0 text-zinc-900 shadow-sm sm:max-w-md",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-muted"
        )}
      >
        {storage ? (
          <>
            <SheetHeader className="border-b border-border/50 px-6 py-5 pr-12">
              <SheetTitle className="text-xl font-bold tracking-tight text-zinc-900">
                {storage.name}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
                {formatLiters(storage.currentVolume)} л · ≈{" "}
                {formatMoney(valueUah)} ₴ · місткість{" "}
                {formatLiters(storage.capacity)} л
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
              {/* Динаміка залишку */}
              <section className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Динаміка залишку · 7 днів
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                      {formatLiters(storage.currentVolume)}{" "}
                      <span className="text-sm font-semibold text-muted-foreground">
                        л
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-3 text-right">
                    <div>
                      <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        <TrendingDown className="h-3 w-3" />
                        Витрата
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-zinc-800">
                        {dailyBurnL != null
                          ? `${formatLiters(dailyBurnL)} л/д`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        <Calendar className="h-3 w-3" />
                        Запас
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-zinc-800">
                        {daysLeft != null
                          ? `~${daysLeft} ${daysWord(daysLeft)}`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 pt-1">
                  {historyLoading && sparkline.length === 0 ? (
                    <div className="h-28 animate-pulse rounded-xl bg-muted/40" />
                  ) : (
                    <VolumeSparkline points={sparkline} />
                  )}
                </div>
              </section>

              {/* GPS KPI */}
              <section className="flex items-center justify-between gap-4 rounded-2xl bg-muted/30 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700">
                    <Radar className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900">
                      Підтверджено Wialon
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {gpsAccuracy.total === 0
                        ? "Немає outbound за період"
                        : `${gpsAccuracy.confirmed}/${gpsAccuracy.total} заправок (±${WIALON_MATCH_TOLERANCE_L} л)`}
                    </p>
                  </div>
                </div>
                <p className="shrink-0 text-3xl font-bold tracking-tight tabular-nums text-zinc-900">
                  {gpsAccuracy.pct != null ? `${gpsAccuracy.pct}%` : "—"}
                </p>
              </section>

              {/* Виписка */}
              <section className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Останні операції
                </p>

                {historyLoading && storageTx.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Завантаження…
                  </p>
                ) : storageTx.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Немає операцій для цього резервуара
                  </p>
                ) : (
                  <ul>
                    {storageTx.map((tx) => {
                      const isInboundToTank = tx.toStorageId === storage.id;
                      const isOutboundFromTank =
                        tx.fromStorageId === storage.id;
                      const litersSigned =
                        isInboundToTank && !isOutboundFromTank
                          ? tx.amountLiters
                          : isOutboundFromTank && !isInboundToTank
                            ? -tx.amountLiters
                            : tx.type === "inbound"
                              ? tx.amountLiters
                              : -tx.amountLiters;
                      const positive = litersSigned > 0;

                      return (
                        <li
                          key={tx.id}
                          className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900">
                              {txTitle(tx)}
                            </p>
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              {tx.transactionDate
                                ? format(
                                    new Date(tx.transactionDate),
                                    "d MMM · HH:mm",
                                    { locale: uk }
                                  )
                                : "—"}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 text-sm font-semibold tabular-nums",
                              positive ? "text-emerald-600" : "text-zinc-900"
                            )}
                          >
                            {positive ? "+" : "−"}
                            {formatLiters(Math.abs(litersSigned))} л
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
            <Fuel className="h-4 w-4" />
            Оберіть резервуар
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

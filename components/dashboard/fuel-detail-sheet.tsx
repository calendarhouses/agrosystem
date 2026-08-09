"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, subDays } from "date-fns";
import { uk } from "date-fns/locale";
import {
  ArrowRightLeft,
  Calendar,
  Fuel,
  Plus,
  Tractor,
  TrendingDown,
} from "lucide-react";

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

type FuelDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: FuelStorage | null;
  transactions: FuelTransaction[];
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

function TxIcon({ type }: { type: FuelTransaction["type"] }) {
  if (type === "inbound") return <Plus size={16} strokeWidth={2} />;
  if (type === "transfer") return <ArrowRightLeft size={16} strokeWidth={1.8} />;
  return <Tractor size={16} strokeWidth={1.8} />;
}

function daysWord(n: number): string {
  if (n === 1) return "день";
  if (n >= 2 && n <= 4) return "дні";
  return "днів";
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

  /** Підвантажити до 30 днів історії саме для цього бака */
  useEffect(() => {
    if (!open || !storageId) {
      setHistory([]);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);

    const fromIso = subDays(new Date(), BURN_LOOKBACK_DAYS).toISOString();
    const supabase = createBrowserSupabase();

    void supabase
      .from("fuel_transactions")
      .select(FUEL_TRANSACTIONS_SELECT)
      .or(`from_storage_id.eq.${storageId},to_storage_id.eq.${storageId}`)
      .gte("transaction_date", fromIso)
      .order("transaction_date", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
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
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, storageId, transactions]);

  const valueUah = storage ? storageValueUah(storage) : 0;

  const { dailyBurnL, daysLeft } = useMemo(() => {
    if (!storage) return { dailyBurnL: null, daysLeft: null };
    return computeBurnAnalytics(storage, history);
  }, [storage, history]);

  const storageTx = useMemo(() => history.slice(0, 12), [history]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-sm sm:max-w-md",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-zinc-100"
        )}
      >
        {storage ? (
          <>
            <SheetHeader className="border-b border-zinc-100 px-6 py-5 pr-12">
              <SheetTitle className="text-2xl font-bold tracking-tight text-zinc-900">
                {storage.name}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Аналітика резервуара {storage.name}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              <div className="relative mt-1 overflow-hidden rounded-2xl bg-zinc-900 p-5 text-white">
                <Fuel
                  className="pointer-events-none absolute -right-4 -bottom-4 h-28 w-28 text-white/5"
                  strokeWidth={1}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-amber-500/10" />

                <div className="relative">
                  <p className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                    Поточний залишок
                  </p>
                  <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums">
                    {formatLiters(storage.currentVolume)}{" "}
                    <span className="text-lg font-semibold text-zinc-400">
                      L
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-semibold text-emerald-400 tabular-nums">
                    ≈ {formatMoney(valueUah)} ₴
                  </p>

                  <div className="mt-4 flex items-center gap-2 text-zinc-300">
                    <TrendingDown size={16} className="shrink-0 text-emerald-400" />
                    <span className="text-sm">
                      Середня витрата:{" "}
                      <strong className="font-semibold text-white">
                        {dailyBurnL != null
                          ? `${formatLiters(dailyBurnL)} л / день`
                          : "немає даних"}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-zinc-300">
                    <Calendar size={16} className="shrink-0 text-amber-400" />
                    <span className="text-sm">
                      Запасу вистачить на:{" "}
                      <strong className="font-semibold text-white">
                        {daysLeft != null
                          ? `~${daysLeft} ${daysWord(daysLeft)}`
                          : "—"}
                      </strong>
                    </span>
                  </div>
                  <p className="mt-3 text-[11px] text-zinc-500">
                    Розрахунок за списаннями за останні {BURN_LOOKBACK_DAYS} днів
                  </p>
                </div>
              </div>

              <section>
                <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Останні операції резервуара
                </p>
                {historyLoading && storageTx.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-500">
                    Завантаження…
                  </p>
                ) : storageTx.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-500">
                    Немає операцій для цього резервуара
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100">
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
                        <div
                          key={tx.id}
                          className="flex items-center justify-between border-b border-zinc-100 py-3 last:border-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                tx.type === "inbound"
                                  ? "bg-emerald-50 text-emerald-600"
                                  : tx.type === "transfer"
                                    ? "bg-blue-50 text-blue-600"
                                    : "bg-amber-50 text-amber-600"
                              )}
                            >
                              <TxIcon type={tx.type} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-zinc-900">
                                {txTitle(tx)}
                              </p>
                              <p className="text-[11px] text-zinc-500 tabular-nums">
                                {tx.transactionDate
                                  ? format(
                                      new Date(tx.transactionDate),
                                      "d MMM · HH:mm",
                                      { locale: uk }
                                    )
                                  : "—"}
                              </p>
                            </div>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 text-sm font-semibold tabular-nums",
                              positive ? "text-emerald-600" : "text-zinc-900"
                            )}
                          >
                            {positive ? "+" : "−"}
                            {formatLiters(Math.abs(litersSigned))} L
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-16 text-sm text-zinc-500">
            Оберіть резервуар
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

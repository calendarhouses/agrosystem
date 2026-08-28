"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Fuel,
  Loader2,
  Package,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  listAccountantQueue,
  markAccountantQueuePrepared,
  type AccountantQueueItem,
} from "@/app/export/actions";
import { Button } from "@/components/ui/button";
import { normalizeBasRefKey } from "@/lib/bas-mapping";
import {
  getFinancePeriodRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { downloadAccountantPackageExcel } from "@/lib/inventory-excel-export";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "tmc" | "fuel" | "salary";

function formatQty(qty: number, unit: string) {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatUah(n: number) {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatDate(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: uk });
}

function kindLabel(kind: AccountantQueueItem["kind"]) {
  if (kind === "inbound") return "Прихід";
  if (kind === "sale") return "Продаж";
  if (kind === "fuel_inbound") return "Закупівля ДП";
  if (kind === "fuel_transfer") return "Переміщення ДП";
  return "Списання";
}

/** Чи бракує звʼязку з BAS AGRO для безпечного Excel. */
export function missingBasLink(item: AccountantQueueItem): boolean {
  if (item.source === "inventory") {
    const itemKey = normalizeBasRefKey(item.basRefKey);
    if (!itemKey || item.isLocalItem) return true;
    if (item.fieldId && !normalizeBasRefKey(item.fieldBasRefKey)) return true;
    return false;
  }
  if (item.kind === "fuel_transfer") {
    return (
      !normalizeBasRefKey(item.fromStorageBasRefKey) ||
      !normalizeBasRefKey(item.toStorageBasRefKey)
    );
  }
  return !normalizeBasRefKey(item.toStorageBasRefKey);
}

const glassPanel = cn(
  "rounded-3xl border border-border/60 bg-card/40 p-6 shadow-sm",
  "backdrop-blur-xl"
);

export function AccountingExportTab() {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const seasonYear = Number(activeSeason) || 2026;

  const [period, setPeriod] = useState<FinancePeriod>("Сезон");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [items, setItems] = useState<AccountantQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const dateRange = useMemo(
    () => getFinancePeriodRange(period, seasonYear),
    [period, seasonYear]
  );
  const isoRange = useMemo(() => toIsoRange(dateRange), [dateRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listAccountantQueue({
      season: String(seasonYear),
      startIso: isoRange.startIso,
      endIso: isoRange.endIso,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setItems([]);
      setSelected(new Set());
      return;
    }
    setItems(res.data.items);
    setSelected(new Set());
  }, [seasonYear, isoRange.startIso, isoRange.endIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter === "tmc") return item.source === "inventory";
      if (typeFilter === "fuel") return item.source === "fuel";
      if (typeFilter === "salary") return false;
      return true;
    });
  }, [items, typeFilter]);

  const selectedRows = useMemo(
    () => visible.filter((i) => selected.has(i.id)),
    [visible, selected]
  );

  const selectedBlocked = useMemo(
    () => selectedRows.filter(missingBasLink),
    [selectedRows]
  );

  const counts = useMemo(() => {
    let tmc = 0;
    let fuel = 0;
    for (const i of items) {
      if (i.source === "inventory") tmc += 1;
      else fuel += 1;
    }
    return { tmc, fuel, all: items.length };
  }, [items]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const ids = visible.map((v) => v.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }

  function downloadExcel() {
    if (selectedRows.length === 0) {
      toast.error("Оберіть документи");
      return;
    }
    if (selectedBlocked.length > 0) {
      toast.error("Є позиції без звʼязку з BAS AGRO", {
        description: `${selectedBlocked.length} у виборі — спочатку зробіть мапінг`,
      });
      return;
    }
    try {
      const filename = downloadAccountantPackageExcel(selectedRows);
      toast.success("Excel збережено", { description: filename });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося сформувати Excel"
      );
    }
  }

  function markTransferred() {
    if (selectedRows.length === 0) return;
    if (selectedBlocked.length > 0) {
      toast.error("Спочатку закрийте мапінг для обраних позицій");
      return;
    }
    startTransition(async () => {
      const res = await markAccountantQueuePrepared(
        selectedRows.map((r) => ({ id: r.id, source: r.source }))
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Позначено ${res.data.inventory + res.data.fuel} документів`
      );
      await load();
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((v) => selected.has(v.id));

  return (
    <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* Filters */}
      <aside className={cn(glassPanel, "h-fit lg:sticky lg:top-28")}>
        <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
          Період
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {(["Місяць", "Сезон"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold transition",
                period === p
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              {p === "Сезон" ? seasonLabel(String(seasonYear)) : p}
            </button>
          ))}
        </div>

        <p className="mt-8 text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
          Тип документів
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {(
            [
              { id: "all", label: "Усі", count: counts.all, icon: Package },
              { id: "tmc", label: "ТМЦ", count: counts.tmc, icon: Package },
              { id: "fuel", label: "Паливо", count: counts.fuel, icon: Fuel },
              {
                id: "salary",
                label: "Зарплата",
                count: 0,
                icon: Wallet,
                soon: true,
              },
            ] as const
          ).map((f) => {
            const Icon = f.icon;
            const soon = "soon" in f && f.soon;
            return (
              <button
                key={f.id}
                type="button"
                disabled={soon}
                onClick={() => setTypeFilter(f.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold transition",
                  typeFilter === f.id
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  soon && "cursor-not-allowed opacity-45"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{f.label}</span>
                <span className="font-mono text-[11px] tabular-nums opacity-60">
                  {soon ? "скоро" : f.count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || pending}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Оновити чергу
        </button>
      </aside>

      {/* Inbox queue */}
      <section className={cn(glassPanel, "overflow-hidden p-0 lg:col-span-3")}>
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-foreground">Черга чернеток</p>
            <p className="text-xs text-muted-foreground">
              Inbox Zero · лише непередані операції
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAllVisible}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border",
                allVisibleSelected
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-border bg-background"
              )}
            >
              {allVisibleSelected ? <Check className="h-3 w-3" /> : null}
            </span>
            Обрати всі
          </button>
        </div>

        {error ? (
          <div className="m-5 rounded-2xl border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Збираємо чергу…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600/80" />
            <p className="mt-4 text-base font-semibold text-foreground">
              Inbox Zero
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeFilter === "salary"
                ? "Зарплата зʼявиться тут пізніше"
                : "Немає чернеток за вибраний фільтр"}
            </p>
          </div>
        ) : (
          <ul>
            {visible.map((item) => {
              const checked = selected.has(item.id);
              const noLink = missingBasLink(item);
              return (
                <li key={`${item.source}-${item.id}`}>
                  <div
                    className={cn(
                      "flex items-center gap-4 border-b border-border/30 p-4 transition-colors",
                      "hover:bg-muted/30",
                      checked && "bg-muted/20"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
                        checked
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border bg-background"
                      )}
                      aria-label="Обрати"
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                          {kindLabel(item.kind)}
                        </span>
                        {noLink ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase shadow-sm">
                            <AlertTriangle className="h-3 w-3" />
                            Немає звʼязку з BAS AGRO
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[item.party, formatDate(item.date)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatQty(item.qty, item.unit)}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {item.amountUah != null
                          ? `${formatUah(item.amountUah)} ₴`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Floating Action Bar */}
      <AnimatePresence>
        {selectedRows.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 24, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 16, x: "-50%" }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={cn(
              "fixed bottom-8 left-1/2 z-50 flex items-center gap-6",
              "rounded-full bg-slate-900 px-8 py-4 text-white shadow-2xl",
              "dark:bg-white dark:text-black"
            )}
          >
            <p className="text-sm font-semibold whitespace-nowrap">
              Обрано:{" "}
              <span className="tabular-nums">{selectedRows.length}</span>{" "}
              документів
              {selectedBlocked.length > 0 ? (
                <span className="ml-2 text-xs font-medium text-red-300 dark:text-red-600">
                  · {selectedBlocked.length} без BAS AGRO
                </span>
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || selectedBlocked.length > 0}
                onClick={downloadExcel}
                className="h-10 rounded-full bg-white px-4 font-bold text-slate-900 hover:bg-zinc-100 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                Завантажити Excel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending || selectedBlocked.length > 0}
                onClick={markTransferred}
                className="h-10 rounded-full bg-emerald-500 px-4 font-bold text-white hover:bg-emerald-400 dark:bg-emerald-600"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Позначити як передані
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

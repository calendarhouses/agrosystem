"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Fuel,
  History,
  Loader2,
  Package,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Wheat,
} from "lucide-react";
import { toast } from "sonner";

import {
  listAccountantHistory,
  listAccountantQueue,
  markAccountantQueuePrepared,
  type AccountantQueueItem,
  type AccountantQueueStats,
  type AccountantQueueTab,
} from "@/app/export/actions";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getFinancePeriodRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { downloadAccountantPackageExcel } from "@/lib/inventory-excel-export";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

const PERIOD_TABS: FinancePeriod[] = ["Сьогодні", "Місяць", "Сезон"];

const QUEUE_TABS: { id: AccountantQueueTab; label: string }[] = [
  { id: "all", label: "Усі" },
  { id: "outbound", label: "Списання" },
  { id: "inbound", label: "Прихід" },
  { id: "sale", label: "Продажі" },
  { id: "fuel", label: "Паливо" },
];

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatUah(n: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM", { locale: uk });
}

function kindMeta(kind: AccountantQueueItem["kind"]): {
  label: string;
  icon: typeof Package;
  tone: string;
} {
  if (kind === "inbound") {
    return {
      label: "Прихід",
      icon: PackagePlus,
      tone: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/15",
    };
  }
  if (kind === "sale") {
    return {
      label: "Продаж",
      icon: ShoppingCart,
      tone: "bg-amber-500/10 text-amber-900 ring-amber-500/15",
    };
  }
  if (kind === "fuel_inbound" || kind === "fuel_transfer") {
    return {
      label: kind === "fuel_transfer" ? "Переміщення" : "Закупівля ДТ",
      icon: Fuel,
      tone: "bg-orange-500/10 text-orange-900 ring-orange-500/15",
    };
  }
  return {
    label: "Списання",
    icon: PackageMinus,
    tone: "bg-sky-500/10 text-sky-900 ring-sky-500/15",
  };
}

function matchesTab(
  item: AccountantQueueItem,
  tab: AccountantQueueTab
): boolean {
  if (tab === "all") return true;
  if (tab === "fuel") {
    return item.kind === "fuel_inbound" || item.kind === "fuel_transfer";
  }
  return item.kind === tab;
}

const glass = cn(
  "rounded-3xl border border-white/50 bg-white/45 shadow-sm",
  "backdrop-blur-2xl dark:border-white/10 dark:bg-black/20"
);

const periodPill = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition-all",
    active
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-500 hover:text-zinc-800"
  );

export function AccountantHubView() {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);
  const seasonYear = Number(activeSeason) || 2026;

  const [period, setPeriod] = useState<FinancePeriod>("Сезон");
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [tab, setTab] = useState<AccountantQueueTab>("all");
  const [items, setItems] = useState<AccountantQueueItem[]>([]);
  const [stats, setStats] = useState<AccountantQueueStats | null>(null);
  const [history, setHistory] = useState<AccountantQueueItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      setStats(null);
      setSelected(new Set());
      return;
    }
    setItems(res.data.items);
    setStats(res.data.stats);
    setSelected(new Set(res.data.items.map((i) => i.id)));
  }, [seasonYear, isoRange.startIso, isoRange.endIso]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await listAccountantHistory({ season: String(seasonYear) });
    setHistoryLoading(false);
    if (res.ok) setHistory(res.data);
    else setHistory([]);
  }, [seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory]);

  const visible = useMemo(
    () => items.filter((i) => matchesTab(i, tab)),
    [items, tab]
  );

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected]
  );

  const packageSummary = useMemo(() => {
    const rows = selectedItems.length > 0 ? selectedItems : visible;
    let outbound = 0;
    let inbound = 0;
    let sale = 0;
    let fuel = 0;
    let amount = 0;
    for (const r of rows) {
      if (r.kind === "outbound") outbound += 1;
      else if (r.kind === "inbound") inbound += 1;
      else if (r.kind === "sale") sale += 1;
      else fuel += 1;
      if (r.amountUah != null) amount += r.amountUah;
    }
    return {
      count: rows.length,
      outbound,
      inbound,
      sale,
      fuel,
      amount: Math.round(amount),
      rows,
    };
  }, [selectedItems, visible]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleAll() {
    const ids = visible.map((v) => v.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  function handleDownload(rows: AccountantQueueItem[]) {
    if (rows.length === 0) {
      toast.error("Немає рядків для експорту");
      return;
    }
    try {
      const filename = downloadAccountantPackageExcel(rows);
      toast.success("Excel збережено", { description: filename });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося сформувати Excel"
      );
    }
  }

  function confirmMark() {
    const rows = packageSummary.rows;
    if (rows.length === 0) return;
    startTransition(async () => {
      const res = await markAccountantQueuePrepared(
        rows.map((r) => ({ id: r.id, source: r.source }))
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const n = res.data.inventory + res.data.fuel;
      toast.success(`Позначено ${n} операцій як передані`);
      setConfirmOpen(false);
      await load();
      if (historyOpen) await loadHistory();
    });
  }

  function selectSeason(year: number) {
    setActiveSeason(String(year));
    setPeriod("Сезон");
    setSeasonOpen(false);
  }

  function applyKpiFilter(next: AccountantQueueTab) {
    setTab(next);
  }

  return (
    <main
      className={cn(
        "relative h-full w-full overflow-y-auto overscroll-none",
        "min-h-screen bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]"
      )}
    >
      <div
        className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-[#276749]/10 blur-3xl"
        aria-hidden
      />

      <header className="sticky top-0 z-40 w-full border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/80 px-4 py-4 backdrop-blur-2xl sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
              Бухгалтерія
            </h1>
            <p className="mt-1 truncate text-sm text-zinc-500">
              Черга → Excel → передано · {seasonLabel(String(seasonYear))}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-zinc-200/90 bg-white/80 p-1 shadow-sm">
              {PERIOD_TABS.filter((t) => t !== "Сезон").map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={periodPill(period === p)}
                >
                  {p}
                </button>
              ))}
              <Popover open={seasonOpen} onOpenChange={setSeasonOpen}>
                <PopoverTrigger
                  className={periodPill(period === "Сезон")}
                  onClick={() => setPeriod("Сезон")}
                >
                  Сезон {seasonYear}
                  <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-40 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl"
                >
                  {availableSeasons.map((s) => {
                    const y = Number(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => selectSeason(y)}
                        className={cn(
                          "flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium",
                          seasonYear === y
                            ? "bg-[#276749]/10 text-[#276749]"
                            : "text-zinc-700 hover:bg-zinc-50"
                        )}
                      >
                        {seasonLabel(s)}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading || pending}
              className="h-9 rounded-full border-[#E5DFD3] bg-white/90"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
              Оновити
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={loading || pending || packageSummary.count === 0}
              onClick={() => handleDownload(packageSummary.rows)}
              className="h-9 rounded-full bg-[#276749] px-4 font-bold text-white hover:bg-[#1f5239]"
            >
              <Download className="h-4 w-4" />
              Excel ({packageSummary.count || "—"})
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
        {/* KPI */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              {
                id: "all" as const,
                label: "У черзі",
                value: stats?.total ?? 0,
                icon: FileSpreadsheet,
              },
              {
                id: "outbound" as const,
                label: "Списання",
                value: stats?.outbound ?? 0,
                icon: PackageMinus,
              },
              {
                id: "inbound" as const,
                label: "Прихід",
                value: stats?.inbound ?? 0,
                icon: PackagePlus,
              },
              {
                id: "sale" as const,
                label: "Продажі",
                value: stats?.sale ?? 0,
                icon: ShoppingCart,
              },
              {
                id: "fuel" as const,
                label: "Паливо",
                value: stats?.fuel ?? 0,
                icon: Fuel,
              },
            ] as const
          ).map((kpi) => {
            const active = tab === kpi.id;
            const Icon = kpi.icon;
            return (
              <button
                key={kpi.id}
                type="button"
                onClick={() => applyKpiFilter(kpi.id)}
                className={cn(
                  glass,
                  "px-4 py-3.5 text-left transition",
                  active
                    ? "ring-2 ring-[#276749]/35"
                    : "hover:border-[#276749]/25"
                )}
              >
                <div className="flex items-center gap-2 text-zinc-400">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-bold tracking-wider uppercase">
                    {kpi.label}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1.5 font-mono text-2xl font-semibold tabular-nums",
                    kpi.value > 0 ? "text-zinc-900" : "text-zinc-400"
                  )}
                >
                  {loading ? "—" : kpi.value}
                </p>
              </button>
            );
          })}

          <div className={cn(glass, "px-4 py-3.5")}>
            <p className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
              Сума ₴
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
              {loading || !stats ? "—" : formatUah(stats.amountUah)}
            </p>
          </div>
        </section>

        {/* Insights */}
        {stats && stats.total > 0 ? (
          <section className="flex flex-wrap gap-2">
            {stats.withoutAttachment > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
                <AlertTriangle className="h-3.5 w-3.5" />
                {stats.withoutAttachment} без накладної
              </span>
            ) : null}
            {stats.newItems > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-900 ring-1 ring-sky-200/80">
                <Sparkles className="h-3.5 w-3.5" />
                {stats.newItems} нових позицій
              </span>
            ) : null}
            {stats.fuelWithoutPrice > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-200/80">
                <Fuel className="h-3.5 w-3.5" />
                {stats.fuelWithoutPrice} паливо без ціни
              </span>
            ) : null}
            <Link
              href="/admin/bas-request"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200/90 transition hover:bg-white"
            >
              <Wheat className="h-3.5 w-3.5 text-[#276749]" />
              Звірка полів
            </Link>
          </section>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {error}
          </div>
        ) : null}

        {/* Queue */}
        <section className={cn(glass, "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5DFD3]/70 px-4 py-3 sm:px-5">
            <div className="inline-flex flex-wrap gap-1 rounded-full bg-zinc-900/[0.04] p-1">
              {QUEUE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    tab === t.id
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-600">
              <input
                type="checkbox"
                checked={
                  visible.length > 0 &&
                  visible.every((v) => selected.has(v.id))
                }
                onChange={toggleVisibleAll}
                className="h-4 w-4 rounded border-zinc-300 text-[#276749] focus:ring-[#276749]/30"
              />
              Обрати видимі
            </label>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Завантаження черги…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500/80" />
              <p className="mt-3 text-sm font-semibold text-zinc-800">
                Черга порожня
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Немає операцій за вибраний період
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E5DFD3]/60">
              {visible.map((item) => {
                const meta = kindMeta(item.kind);
                const Icon = meta.icon;
                const checked = selected.has(item.id);
                return (
                  <li
                    key={`${item.source}-${item.id}`}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3.5 transition sm:px-5",
                      checked ? "bg-white/50" : "hover:bg-white/30"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300 text-[#276749] focus:ring-[#276749]/30"
                    />
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1",
                        meta.tone
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {item.title}
                        </p>
                        {item.isLocalItem ? (
                          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-sky-800 uppercase">
                            нова
                          </span>
                        ) : null}
                        <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {formatDate(item.date)}
                        {item.party ? ` · ${item.party}` : ""}
                        {item.note ? ` · ${item.note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                        {formatQty(item.qty, item.unit)}
                      </p>
                      {item.amountUah != null ? (
                        <p className="text-[11px] tabular-nums text-zinc-500">
                          {formatUah(item.amountUah)} ₴
                        </p>
                      ) : null}
                      {item.hasAttachment ? (
                        <AttachmentViewerButton
                          entityType={
                            item.source === "fuel"
                              ? "fuel_transaction"
                              : "inventory_move"
                          }
                          entityId={item.id}
                          count={1}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* History */}
        <section className={cn(glass, "overflow-hidden")}>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-zinc-500" />
              <div>
                <p className="text-sm font-bold text-zinc-900">Передані</p>
                <p className="text-xs text-zinc-500">
                  Історія за {seasonLabel(String(seasonYear))}
                </p>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-zinc-400 transition",
                historyOpen && "rotate-180"
              )}
            />
          </button>
          {historyOpen ? (
            <div className="border-t border-[#E5DFD3]/70">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Завантаження…
                </div>
              ) : history.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-zinc-500">
                  Ще немає переданих операцій за сезон
                </p>
              ) : (
                <>
                  <div className="flex justify-end px-5 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full"
                      onClick={() => handleDownload(history)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Excel історії
                    </Button>
                  </div>
                  <ul className="max-h-80 divide-y divide-[#E5DFD3]/50 overflow-y-auto">
                    {history.slice(0, 80).map((item) => {
                      const meta = kindMeta(item.kind);
                      return (
                        <li
                          key={`h-${item.source}-${item.id}`}
                          className="flex items-center gap-3 px-5 py-2.5"
                        >
                          <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                            {meta.label}
                          </span>
                          <p className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                            {item.title}
                            {item.party ? (
                              <span className="text-zinc-400">
                                {" "}
                                · {item.party}
                              </span>
                            ) : null}
                          </p>
                          <p className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
                            {formatQty(item.qty, item.unit)}
                          </p>
                          <p className="w-16 shrink-0 text-right text-[11px] text-zinc-400">
                            {formatDate(item.date)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Sticky package bar */}
      {packageSummary.count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5DFD3]/90 bg-[#F4F1EA]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm text-zinc-700">
              <span className="font-bold text-zinc-900">
                {packageSummary.count} обрано
              </span>
              <span className="text-zinc-400"> · </span>
              {[
                packageSummary.outbound
                  ? `${packageSummary.outbound} списань`
                  : null,
                packageSummary.inbound
                  ? `${packageSummary.inbound} приходів`
                  : null,
                packageSummary.sale
                  ? `${packageSummary.sale} продажів`
                  : null,
                packageSummary.fuel
                  ? `${packageSummary.fuel} паливо`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {packageSummary.amount > 0 ? (
                <span className="ml-1 font-semibold tabular-nums text-[#276749]">
                  · {formatUah(packageSummary.amount)} ₴
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => handleDownload(packageSummary.rows)}
                className="h-11 flex-1 rounded-2xl border-[#E5DFD3] bg-white sm:flex-none"
              >
                <Download className="h-4 w-4" />
                Завантажити Excel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => setConfirmOpen(true)}
                className="h-11 flex-1 rounded-2xl bg-[#276749] font-bold text-white hover:bg-[#1f5239] sm:flex-none"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Позначити передані
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md rounded-2xl border-[#E5DFD3] bg-[#FDFBF7]">
          <DialogHeader>
            <DialogTitle>Позначити як передані?</DialogTitle>
            <DialogDescription>
              {packageSummary.count} операцій зникнуть з черги. Редагувати їх
              уже не можна. Спочатку завантажте Excel, якщо ще не зробили.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-stretch">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
              className="flex-1"
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirmMark}
              className="flex-1 bg-[#276749] font-bold text-white hover:bg-[#1f5239]"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              Так, позначити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

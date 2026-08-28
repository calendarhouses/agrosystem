"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  Check,
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
  Paperclip,
  Pencil,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import {
  archiveAccountantDeletion,
  listAccountantArchive,
  listAccountantQueue,
  markAccountantQueuePrepared,
  type AccountantArchiveItem,
  type AccountantQueueItem,
  type AccountantQueueStats,
  type AccountantQueueTab,
} from "@/app/export/actions";
import {
  deleteLocalMove,
  getLocalMoveById,
  type LocalMoveRow,
} from "@/app/admin/inventory/actions";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";
import { EditLocalMoveInline } from "@/components/dashboard/local-moves-history-sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
const SIDEBAR_COLLAPSED_KEY = "agrosystem-sidebar-collapsed";

const QUEUE_TABS: {
  id: AccountantQueueTab;
  label: string;
  icon: typeof Package;
}[] = [
  { id: "all", label: "Усі", icon: FileSpreadsheet },
  { id: "outbound", label: "Списання", icon: PackageMinus },
  { id: "inbound", label: "Прихід", icon: PackagePlus },
  { id: "sale", label: "Продажі", icon: ShoppingCart },
  { id: "fuel", label: "Паливо", icon: Fuel },
];

/** Українські форми: 1 / 2–4 / 5+ */
function ukPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function labelOutbound(n: number) {
  return `${n} ${ukPlural(n, "списання", "списання", "списань")}`;
}
function labelInbound(n: number) {
  return `${n} ${ukPlural(n, "прихід", "приходи", "приходів")}`;
}
function labelSale(n: number) {
  return `${n} ${ukPlural(n, "продаж", "продажі", "продажів")}`;
}
function labelFuel(n: number) {
  return `${n} ${ukPlural(n, "паливо", "палива", "палива")}`;
}
function labelOps(n: number) {
  return `${n} ${ukPlural(n, "операція", "операції", "операцій")}`;
}
function labelWithoutInvoice(n: number) {
  return `${n} без ${ukPlural(n, "накладної", "накладних", "накладних")}`;
}
function labelSelected(n: number) {
  return `Обрано ${n}`;
}
function labelNewSku(n: number) {
  return `${n} ${ukPlural(n, "новий SKU", "нові SKU", "нових SKU")}`;
}
function labelFuelNoPrice(n: number) {
  return `${n} ${ukPlural(n, "паливо", "палива", "палива")} без ціни`;
}

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

function formatHeroNumber(n: number): { text: string; unit: "млн ₴" | "₴" } {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return {
      text: new Intl.NumberFormat("uk-UA", {
        maximumFractionDigits: 1,
      }).format(n / 1_000_000),
      unit: "млн ₴",
    };
  }
  return { text: formatUah(n), unit: "₴" };
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM", { locale: uk });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  return format(d, "d MMM, HH:mm", { locale: uk });
}

function kindMeta(kind: AccountantQueueItem["kind"]): {
  label: string;
  icon: typeof Package;
  chip: string;
  well: string;
} {
  if (kind === "inbound") {
    return {
      label: "Прихід",
      icon: PackagePlus,
      chip: "bg-emerald-100 text-emerald-800 ring-emerald-200/80",
      well: "bg-emerald-100 text-emerald-700",
    };
  }
  if (kind === "sale") {
    return {
      label: "Продаж",
      icon: ShoppingCart,
      chip: "bg-amber-100 text-amber-900 ring-amber-200/80",
      well: "bg-amber-100 text-amber-800",
    };
  }
  if (kind === "fuel_inbound" || kind === "fuel_transfer") {
    return {
      label: kind === "fuel_transfer" ? "Переміщення" : "Закупівля ДП",
      icon: Fuel,
      chip: "bg-orange-100 text-orange-900 ring-orange-200/80",
      well: "bg-orange-100 text-orange-800",
    };
  }
  return {
    label: "Списання",
    icon: PackageMinus,
    chip: "bg-sky-100 text-sky-900 ring-sky-200/80",
    well: "bg-sky-100 text-sky-800",
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

function summarizeRows(rows: AccountantQueueItem[]) {
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
}

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      } catch {
        /* ignore */
      }
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return collapsed;
}

const glassCard = cn(
  "rounded-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA]/75",
  "shadow-[0_8px_30px_rgb(39,33,24,0.06)] backdrop-blur-2xl"
);

const kpiShell = cn(
  "group relative isolate flex min-h-[148px] flex-col overflow-hidden rounded-2xl p-4 text-left sm:p-5",
  "border border-white/70 shadow-[0_6px_24px_rgb(0,0,0,0.06)]",
  "backdrop-blur-2xl transition-all duration-200",
  "hover:shadow-[0_10px_28px_rgb(0,0,0,0.09)]",
  "outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/25"
);

const kpiLabelClass =
  "relative mb-2 text-left text-[10px] font-bold tracking-[0.14em] text-zinc-500 uppercase";

const kpiValueClass =
  "text-[1.85rem] leading-none font-semibold tracking-tight tabular-nums sm:text-3xl lg:text-[2.15rem]";

const periodPill = (active: boolean) =>
  cn(
    "inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition-all",
    active
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-500 hover:text-zinc-800"
  );

export function AccountantHubView({
  embedded = false,
}: {
  /** Вкладений у Accounting Hub — без другого full-page chrome */
  embedded?: boolean;
}) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);
  const seasonYear = Number(activeSeason) || 2026;
  const sidebarCollapsed = useSidebarCollapsed();

  const [period, setPeriod] = useState<FinancePeriod>("Сезон");
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [tab, setTab] = useState<AccountantQueueTab>("all");
  const [items, setItems] = useState<AccountantQueueItem[]>([]);
  const [stats, setStats] = useState<AccountantQueueStats | null>(null);
  const [archive, setArchive] = useState<AccountantArchiveItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [editInventory, setEditInventory] = useState<LocalMoveRow | null>(null);
  const [editFuel, setEditFuel] = useState<AccountantQueueItem | null>(null);
  const [fuelLiters, setFuelLiters] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [insightFilter, setInsightFilter] = useState<
    "no_attachment" | "no_fuel_price" | "new_sku" | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountantQueueItem | null>(
    null
  );

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
    setSelected(new Set());
  }, [seasonYear, isoRange.startIso, isoRange.endIso]);

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    const res = await listAccountantArchive({ season: String(seasonYear) });
    setArchiveLoading(false);
    if (res.ok) setArchive(res.data);
    else setArchive([]);
  }, [seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (archiveOpen) void loadArchive();
  }, [archiveOpen, loadArchive]);

  const visible = useMemo(() => {
    return items.filter((i) => {
      if (!matchesTab(i, tab)) return false;
      if (insightFilter === "no_attachment") return !i.hasAttachment;
      if (insightFilter === "new_sku") return i.isLocalItem;
      if (insightFilter === "no_fuel_price") {
        return (
          (i.kind === "fuel_inbound" || i.kind === "fuel_transfer") &&
          (i.pricePerLiter == null || i.pricePerLiter <= 0)
        );
      }
      return true;
    });
  }, [items, tab, insightFilter]);

  function toggleInsight(
    next: "no_attachment" | "no_fuel_price" | "new_sku"
  ) {
    setInsightFilter((prev) => (prev === next ? null : next));
    if (next === "no_fuel_price") setTab("fuel");
    else setTab("all");
  }

  function closeInlineEdit() {
    setEditingId(null);
    setEditLoadingId(null);
    setEditInventory(null);
    setEditFuel(null);
  }

  const packageSummary = useMemo(
    () => summarizeRows(visible.filter((i) => selected.has(i.id))),
    [visible, selected]
  );

  const readinessPct = useMemo(() => {
    if (!stats || stats.total === 0) return 100;
    const ok = stats.total - stats.withoutAttachment;
    return Math.round((ok / stats.total) * 100);
  }, [stats]);

  const packageHero = formatHeroNumber(
    packageSummary.count > 0
      ? packageSummary.amount
      : (stats?.amountUah ?? 0)
  );

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
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
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
      toast.success(
        `Позначено ${res.data.inventory + res.data.fuel} операцій`
      );
      setConfirmOpen(false);
      await load();
      if (archiveOpen) await loadArchive();
    });
  }

  function selectSeason(year: number) {
    setActiveSeason(String(year));
    setPeriod("Сезон");
    setSeasonOpen(false);
  }

  async function openEdit(item: AccountantQueueItem) {
    if (editingId === item.id) {
      closeInlineEdit();
      return;
    }
    if (item.source === "inventory") {
      setEditFuel(null);
      setEditInventory(null);
      setEditingId(item.id);
      setEditLoadingId(item.id);
      const res = await getLocalMoveById(item.id);
      setEditLoadingId(null);
      if (!res.ok) {
        toast.error(res.error);
        setEditingId(null);
        return;
      }
      setEditInventory(res.move);
      return;
    }
    setEditInventory(null);
    setEditLoadingId(null);
    setEditFuel(item);
    setFuelLiters(String(item.qty));
    setFuelPrice(
      item.pricePerLiter != null ? String(item.pricePerLiter) : ""
    );
    setEditingId(item.id);
  }

  function saveFuelEdit() {
    if (!editFuel) return;
    const liters = Number(String(fuelLiters).replace(",", "."));
    if (!Number.isFinite(liters) || liters <= 0) {
      toast.error("Вкажіть кількість літрів > 0");
      return;
    }
    const priceRaw = fuelPrice.trim();
    const price = priceRaw
      ? Number(String(priceRaw).replace(",", "."))
      : null;
    if (priceRaw && (price == null || !Number.isFinite(price) || price < 0)) {
      toast.error("Невірна ціна");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/fuel/transactions/${editFuel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountLiters: liters,
          pricePerLiter: price,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Не вдалося оновити паливо");
        return;
      }
      toast.success("Паливо оновлено");
      closeInlineEdit();
      await load();
    });
  }

  function confirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    startTransition(async () => {
      const archived = await archiveAccountantDeletion(item);
      if (!archived.ok) {
        toast.error(archived.error);
        return;
      }
      if (item.source === "inventory") {
        const { suppressLocalInventoryMovesRealtimeToast } = await import(
          "@/lib/realtime-toast-guard"
        );
        suppressLocalInventoryMovesRealtimeToast();
        const res = await deleteLocalMove(item.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
      } else {
        const res = await fetch(`/api/fuel/transactions/${item.id}`, {
          method: "DELETE",
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          toast.error(json.error ?? "Не вдалося видалити паливо");
          return;
        }
      }
      toast.success("Видалено · запис в архіві сезону");
      setDeleteTarget(null);
      await load();
      if (archiveOpen) await loadArchive();
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((v) => selected.has(v.id));

  const showDock = packageSummary.count > 0;

  return (
    <div
      className={cn(
        "relative w-full overflow-y-auto overscroll-none",
        embedded
          ? "h-full min-h-0 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]"
          : "h-full min-h-0 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]"
      )}
    >
      <div
        className="pointer-events-none absolute -top-28 right-0 h-[28rem] w-[28rem] rounded-full bg-[#276749]/[0.12] blur-3xl"
        aria-hidden
      />

      <header
        className={cn(
          "sticky z-40 w-full border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/85 px-4 py-4 backdrop-blur-2xl sm:px-6",
          embedded ? "top-0" : "top-0"
        )}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {!embedded ? (
              <h1 className="truncate text-3xl font-extrabold tracking-tight text-zinc-900">
                Бухгалтерія
              </h1>
            ) : (
              <h2 className="truncate text-lg font-bold tracking-tight text-zinc-900">
                Експорт
              </h2>
            )}
            <p className={cn("text-sm text-zinc-500", embedded ? "mt-0.5" : "mt-1")}>
              {seasonLabel(String(seasonYear))}
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
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-44 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl"
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

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || pending}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/90 bg-white/90 text-zinc-600 shadow-sm transition hover:bg-white disabled:opacity-50"
              aria-label="Оновити"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
              />
            </button>

            <Button
              type="button"
              size="sm"
              disabled={loading || pending || packageSummary.count === 0}
              onClick={() => handleDownload(packageSummary.rows)}
              className={cn(
                "h-9 rounded-full px-4 font-bold text-white",
                "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
                "shadow-[0_8px_20px_-6px_rgba(39,103,73,0.55)]",
                "hover:brightness-105"
              )}
            >
              <Download className="h-4 w-4" />
              Excel · {packageSummary.count || "—"}
            </Button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8",
          showDock ? "pb-24" : "pb-8"
        )}
      >
        {error ? (
          <div
            className={cn(
              glassCard,
              "border-amber-300/60 bg-amber-50/80 px-5 py-4 text-sm text-amber-950"
            )}
          >
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          <button
            type="button"
            onClick={() => setTab("all")}
            className={cn(
              kpiShell,
              "bg-gradient-to-br from-emerald-50/95 via-white/80 to-teal-50/70",
              "hover:border-emerald-300/50",
              tab === "all" && "ring-2 ring-[#276749]/30"
            )}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_top_left,rgba(52,211,153,0.38),transparent_58%)]"
              aria-hidden
            />
            <div className="relative flex h-full flex-col">
              <p className={kpiLabelClass}>У черзі</p>
              <p className={cn(kpiValueClass, "text-emerald-800")}>
                {loading ? "…" : (stats?.total ?? 0)}
              </p>
              <p className="mt-auto pt-3 text-[11px] leading-snug text-emerald-900/55">
                {stats
                  ? [
                      labelOutbound(stats.outbound),
                      labelInbound(stats.inbound),
                      labelSale(stats.sale),
                      labelFuel(stats.fuel),
                    ].join(" · ")
                  : "Операції до передачі"}
              </p>
            </div>
          </button>

          <div
            className={cn(
              kpiShell,
              "bg-gradient-to-br from-teal-50/95 via-white/80 to-emerald-50/70"
            )}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_top_right,rgba(45,212,191,0.32),transparent_58%)]"
              aria-hidden
            />
            <div className="relative flex h-full flex-col">
              <p className={kpiLabelClass}>Сума пакету</p>
              <p
                className={cn(
                  kpiValueClass,
                  "inline-flex items-baseline gap-1.5 text-teal-800"
                )}
              >
                <span>{loading ? "…" : packageHero.text}</span>
                <span className="text-sm font-medium tracking-tight text-zinc-500/90">
                  {packageHero.unit}
                </span>
              </p>
              <p className="mt-auto pt-3 text-[11px] leading-snug text-teal-900/55">
                {packageSummary.count > 0
                  ? `${labelSelected(packageSummary.count)} · ${formatUah(packageSummary.amount)} ₴`
                  : "Оберіть рядки в черзі"}
              </p>
            </div>
          </div>

          <div
            className={cn(
              kpiShell,
              readinessPct >= 80
                ? "bg-gradient-to-br from-white via-zinc-50/80 to-emerald-50/50"
                : "bg-gradient-to-br from-amber-50/95 via-white/80 to-orange-50/60"
            )}
          >
            <div
              className={cn(
                "pointer-events-none absolute inset-0 rounded-[inherit]",
                readinessPct >= 80
                  ? "bg-[radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.22),transparent_55%)]"
                  : "bg-[radial-gradient(ellipse_at_top_right,rgba(251,146,60,0.35),transparent_58%)]"
              )}
              aria-hidden
            />
            <div className="relative flex h-full flex-col">
              <p className={kpiLabelClass}>Готовність</p>
              <p
                className={cn(
                  kpiValueClass,
                  readinessPct >= 80 ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {loading ? "…" : `${readinessPct}%`}
              </p>
              <div className="mt-auto space-y-2 pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900/5">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      readinessPct >= 80 ? "bg-emerald-500" : "bg-amber-500"
                    )}
                    style={{ width: `${loading ? 0 : readinessPct}%` }}
                  />
                </div>
                <p className="text-[11px] leading-snug text-zinc-500">
                  {stats?.withoutAttachment
                    ? labelWithoutInvoice(stats.withoutAttachment)
                    : "Усі з документами"}
                  {stats?.newItems
                    ? ` · ${labelNewSku(stats.newItems)}`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        </section>

        {stats && stats.total > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {stats.withoutAttachment > 0 ? (
              <button
                type="button"
                onClick={() => toggleInsight("no_attachment")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition",
                  insightFilter === "no_attachment"
                    ? "bg-amber-500 text-white ring-amber-500"
                    : "bg-amber-500/10 text-amber-900 ring-amber-500/15 hover:bg-amber-500/15"
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {labelWithoutInvoice(stats.withoutAttachment)}
              </button>
            ) : null}
            {stats.newItems > 0 ? (
              <button
                type="button"
                onClick={() => toggleInsight("new_sku")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition",
                  insightFilter === "new_sku"
                    ? "bg-sky-600 text-white ring-sky-600"
                    : "bg-sky-500/10 text-sky-900 ring-sky-500/15 hover:bg-sky-500/15"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {labelNewSku(stats.newItems)}
              </button>
            ) : null}
            {stats.fuelWithoutPrice > 0 ? (
              <button
                type="button"
                onClick={() => toggleInsight("no_fuel_price")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition",
                  insightFilter === "no_fuel_price"
                    ? "bg-orange-600 text-white ring-orange-600"
                    : "bg-orange-500/10 text-orange-900 ring-orange-500/15 hover:bg-orange-500/15"
                )}
              >
                <Fuel className="h-3.5 w-3.5" />
                {labelFuelNoPrice(stats.fuelWithoutPrice)}
              </button>
            ) : null}
            {insightFilter ? (
              <button
                type="button"
                onClick={() => setInsightFilter(null)}
                className="text-[11px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              >
                Скинути фільтр
              </button>
            ) : null}
          </div>
        ) : null}

        <section
          className={cn(
            "overflow-hidden rounded-[1.75rem]",
            "border border-[#E5DFD3]/90 bg-[#FDFBF7]/90",
            "shadow-[0_16px_40px_-18px_rgba(39,33,24,0.18)] backdrop-blur-xl"
          )}
        >
          <div className="flex flex-col gap-3 border-b border-[#E5DFD3]/80 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-[#F4F1EA]/90 p-1 ring-1 ring-[#E5DFD3]/90">
              {QUEUE_TABS.map((t) => {
                const Icon = t.icon;
                const count =
                  t.id === "all"
                    ? stats?.total
                    : t.id === "outbound"
                      ? stats?.outbound
                      : t.id === "inbound"
                        ? stats?.inbound
                        : t.id === "sale"
                          ? stats?.sale
                          : stats?.fuel;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition",
                      active
                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                        : "text-zinc-500 hover:bg-white/60 hover:text-zinc-800"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {t.label}
                    <span className="ml-0.5 text-[10px] text-zinc-400 tabular-nums">
                      {loading ? "—" : (count ?? 0)}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={toggleVisibleAll}
              className="inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-xs font-semibold text-zinc-500 transition hover:bg-white hover:text-zinc-800 sm:self-auto"
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border",
                  allVisibleSelected
                    ? "border-[#276749] bg-[#276749] text-white"
                    : "border-zinc-300 bg-white"
                )}
              >
                {allVisibleSelected ? <Check className="h-3 w-3" /> : null}
              </span>
              Обрати видимі
            </button>
          </div>

          <div className="hidden grid-cols-[auto_7rem_minmax(0,1.2fr)_minmax(0,0.9fr)_6.5rem_6.5rem_4.5rem_5.5rem] gap-2 border-b border-[#E5DFD3]/70 px-5 py-2.5 text-[10px] font-bold tracking-[0.14em] text-zinc-400 uppercase md:grid">
            <span className="w-4" />
            <span>Тип</span>
            <span>Операція</span>
            <span>Поле / контрагент</span>
            <span className="text-right">Кількість</span>
            <span className="text-right">Сума</span>
            <span className="text-right">Дата</span>
            <span className="text-right">Дії</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Збираємо чергу…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <CheckCircle2 className="mx-auto h-11 w-11 text-[#276749]/70" />
              <p className="mt-4 text-base font-semibold text-zinc-900">
                Черга порожня
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Немає операцій за вибраний період
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E5DFD3]/60">
              {visible.map((item) => {
                const meta = kindMeta(item.kind);
                const Icon = meta.icon;
                const checked = selected.has(item.id);
                const isEditing = editingId === item.id;
                const isEditLoading = editLoadingId === item.id;
                const showInventoryEdit =
                  isEditing &&
                  item.source === "inventory" &&
                  editInventory != null;
                const showFuelEdit =
                  isEditing && item.source === "fuel" && editFuel != null;
                const showEditShell =
                  showInventoryEdit || showFuelEdit || isEditLoading;

                return (
                  <li
                    key={`${item.source}-${item.id}`}
                    id={`queue-edit-${item.id}`}
                    className={cn(showEditShell && "overflow-hidden")}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {showInventoryEdit ? (
                        <motion.div
                          key="edit-inventory"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{
                            duration: 0.34,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="overflow-hidden bg-emerald-50/40"
                          onAnimationComplete={(def) => {
                            if (def === "animate") {
                              document
                                .getElementById(`queue-edit-${item.id}`)
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                            }
                          }}
                        >
                          <div className="px-4 py-4 sm:px-5">
                            <EditLocalMoveInline
                              move={editInventory}
                              onCancel={closeInlineEdit}
                              onSaved={() => {
                                closeInlineEdit();
                                void load();
                              }}
                            />
                          </div>
                        </motion.div>
                      ) : showFuelEdit ? (
                        <motion.div
                          key="edit-fuel"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{
                            duration: 0.34,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="overflow-hidden bg-orange-50/50"
                          onAnimationComplete={(def) => {
                            if (def === "animate") {
                              document
                                .getElementById(`queue-edit-${item.id}`)
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                            }
                          }}
                        >
                          <div className="px-4 py-4 sm:px-5">
                            <div className="space-y-3 rounded-2xl border border-orange-200/70 bg-white/80 p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold tracking-[0.14em] text-orange-800 uppercase">
                                    Редагування палива
                                  </p>
                                  <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900">
                                    {editFuel.title}
                                    {editFuel.party ? (
                                      <span className="font-normal text-zinc-500">
                                        {" "}
                                        · {editFuel.party}
                                      </span>
                                    ) : null}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={closeInlineEdit}
                                  className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-700"
                                >
                                  Скасувати
                                </button>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium text-zinc-500">
                                    Літри
                                  </label>
                                  <Input
                                    value={fuelLiters}
                                    inputMode="decimal"
                                    onChange={(e) =>
                                      setFuelLiters(e.target.value)
                                    }
                                    className="h-10 bg-white font-semibold tabular-nums"
                                    autoFocus
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium text-zinc-500">
                                    Ціна ₴ / л (опційно)
                                  </label>
                                  <Input
                                    value={fuelPrice}
                                    inputMode="decimal"
                                    onChange={(e) =>
                                      setFuelPrice(e.target.value)
                                    }
                                    className="h-10 bg-white font-semibold tabular-nums"
                                    placeholder="Додати ціну"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={closeInlineEdit}
                                  className="h-9 rounded-xl"
                                >
                                  Скасувати
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={pending}
                                  onClick={saveFuelEdit}
                                  className="h-9 rounded-xl bg-[#276749] font-bold text-white hover:bg-[#1f5239]"
                                >
                                  {pending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : null}
                                  Зберегти
                                </Button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ) : isEditLoading ? (
                        <motion.div
                          key="edit-loading"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{
                            duration: 0.22,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="overflow-hidden bg-emerald-50/30"
                        >
                          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-zinc-500">
                            <Loader2 className="h-4 w-4 animate-spin text-[#276749]" />
                            Відкриваємо редагування…
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="row"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          <div
                            className={cn(
                              "grid items-center gap-2 px-4 py-3.5 transition sm:px-5",
                              "grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_7rem_minmax(0,1.2fr)_minmax(0,0.9fr)_6.5rem_6.5rem_4.5rem_5.5rem]",
                              checked
                                ? "bg-[#276749]/[0.06]"
                                : "hover:bg-[#F4F1EA]/70"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => toggle(item.id)}
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
                                checked
                                  ? "border-[#276749] bg-[#276749] text-white"
                                  : "border-zinc-300 bg-white"
                              )}
                              aria-label="Обрати"
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </button>

                            <span
                              className={cn(
                                "hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide uppercase ring-1 md:inline-flex",
                                meta.chip
                              )}
                            >
                              <Icon className="h-3 w-3" strokeWidth={2.2} />
                              {meta.label}
                            </span>

                            <div className="min-w-0">
                              <div className="mb-1 flex items-center gap-2 md:hidden">
                                <span
                                  className={cn(
                                    "inline-flex h-7 w-7 items-center justify-center rounded-lg",
                                    meta.well
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                                  {meta.label}
                                </span>
                              </div>
                              <p className="truncate text-sm font-semibold text-zinc-900">
                                {item.title}
                                {item.isLocalItem ? (
                                  <span className="ml-2 align-middle text-[9px] font-bold tracking-wider text-sky-600 uppercase">
                                    нова
                                  </span>
                                ) : null}
                                {item.basDraftSent ? (
                                  <span
                                    className="ml-2 align-middle text-[9px] font-bold tracking-wider text-emerald-700 uppercase"
                                    title="Чернетка вже створена в BAS AGRO"
                                  >
                                    у BAS
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-zinc-400 md:hidden">
                                {[item.party, item.note]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </p>
                            </div>

                            <p className="hidden min-w-0 truncate text-sm text-zinc-500 md:block">
                              {item.party || item.note || "—"}
                            </p>

                            <p className="hidden text-right text-sm font-semibold tabular-nums text-zinc-900 md:block">
                              {formatQty(item.qty, item.unit)}
                            </p>

                            <p className="hidden text-right text-sm tabular-nums text-zinc-600 md:block">
                              {item.amountUah != null
                                ? `${formatUah(item.amountUah)} ₴`
                                : "—"}
                            </p>

                            <p className="hidden text-right text-xs text-zinc-400 md:block">
                              {formatDate(item.date)}
                            </p>

                            <div className="flex items-center justify-end gap-0.5">
                              <span className="mr-1 text-right text-sm font-semibold tabular-nums text-zinc-900 md:hidden">
                                {formatQty(item.qty, item.unit)}
                              </span>
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
                              ) : (
                                <span className="inline-flex h-8 w-8 items-center justify-center text-zinc-300">
                                  <Paperclip className="h-3.5 w-3.5" />
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => void openEdit(item)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white hover:text-zinc-800"
                                title="Редагувати"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(item)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-red-50 hover:text-red-700"
                                title="Видалити"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Архів сезону */}
        <section className={cn(glassCard, "overflow-hidden")}>
          <div className="flex items-center gap-2 px-4 py-3.5 sm:px-5">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-900/5 text-zinc-600">
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-900">
                  Архів сезону {seasonYear}
                </p>
                <p className="text-xs text-zinc-500">
                  Передані та видалені операції
                </p>
              </div>
            </button>

            {archiveOpen &&
            !archiveLoading &&
            archive.some((a) => a.eventType === "transferred") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-full border-[#E5DFD3] bg-white"
                onClick={() =>
                  handleDownload(
                    archive.filter((a) => a.eventType === "transferred")
                  )
                }
              >
                <Download className="h-3.5 w-3.5" />
                Excel
              </Button>
            ) : null}

            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white hover:text-zinc-700"
              aria-label={archiveOpen ? "Згорнути архів" : "Розгорнути архів"}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition duration-200",
                  archiveOpen && "rotate-180"
                )}
              />
            </button>
          </div>

          {archiveOpen ? (
            <div className="border-t border-[#E5DFD3]/80">
              {archiveLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Завантаження…
                </div>
              ) : archive.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-zinc-500">
                  Архів порожній
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto px-4 py-4">
                  {archive.slice(0, 100).map((item) => {
                    const meta = kindMeta(item.kind);
                    const Icon = meta.icon;
                    const deleted = item.eventType === "deleted";
                    return (
                      <li
                        key={item.archiveId}
                        className={cn(
                          "flex items-start gap-3 rounded-2xl border px-3.5 py-3",
                          deleted
                            ? "border-red-200/70 bg-red-50/40"
                            : "border-[#E5DFD3]/80 bg-white/70"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                            meta.well
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1",
                                meta.chip
                              )}
                            >
                              {meta.label}
                            </span>
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                                deleted
                                  ? "bg-red-100 text-red-800"
                                  : "bg-emerald-100 text-emerald-800"
                              )}
                            >
                              {deleted ? "Видалено" : "Передано"}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm font-semibold text-zinc-900">
                            {item.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                            {[
                              item.party,
                              formatQty(item.qty, item.unit),
                              item.amountUah != null
                                ? `${formatUah(item.amountUah)} ₴`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="mt-1 text-[10px] text-zinc-400">
                            {deleted
                              ? `${formatDateTime(item.eventAt)}${
                                  item.actorName
                                    ? ` · ${item.actorName}`
                                    : ""
                                }`
                              : formatDate(item.eventAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Compact centered dock — only when selection > 0 */}
      <div
        className={cn(
          "pointer-events-none fixed bottom-3 z-40 flex justify-center px-3 transition-all duration-300",
          "right-0 left-16",
          !sidebarCollapsed && "md:left-[250px]",
          showDock
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        )}
        aria-hidden={!showDock}
      >
        {showDock ? (
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-2xl px-3 py-2",
              "border border-[#E5DFD3]/95 bg-[#FDFBF7]/95",
              "shadow-[0_12px_40px_-10px_rgba(39,33,24,0.35)] backdrop-blur-xl"
            )}
          >
            <div className="min-w-0 pl-1">
              <p className="text-[10px] font-bold tracking-[0.14em] text-zinc-400 uppercase">
                Пакет
              </p>
              <p className="whitespace-nowrap text-sm font-semibold text-zinc-900">
                {labelOps(packageSummary.count)}
                {packageSummary.amount > 0 ? (
                  <span className="ml-2 tabular-nums text-[#276749]">
                    {(() => {
                      const h = formatHeroNumber(packageSummary.amount);
                      return `${h.text} ${h.unit}`;
                    })()}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="h-8 w-px bg-[#E5DFD3]" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => handleDownload(packageSummary.rows)}
              className="h-9 shrink-0 rounded-xl border-[#E5DFD3] bg-white px-3 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              Excel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
              className="h-9 shrink-0 rounded-xl bg-[#276749] px-3.5 text-xs font-bold text-white hover:bg-[#1f5239]"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Передати
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md rounded-3xl border-[#E5DFD3] bg-[#FDFBF7]">
          <DialogHeader>
            <DialogTitle>Позначити як передані?</DialogTitle>
            <DialogDescription>
              {labelOps(packageSummary.count)} зникнуть з черги. Спочатку
              завантажте Excel, якщо ще не зробили.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-stretch">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
              className="flex-1 rounded-2xl"
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirmMark}
              className="flex-1 rounded-2xl bg-[#276749] font-bold text-white hover:bg-[#1f5239]"
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

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md gap-0 overflow-hidden rounded-[1.75rem] border border-red-100 bg-[#FDFBF7] p-0 shadow-[0_24px_60px_-20px_rgba(127,29,29,0.35)] sm:max-w-md">
          <div className="px-7 pt-8 pb-2">
            <DialogHeader className="gap-2.5 space-y-0 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-700 ring-1 ring-red-100">
                  <Trash2 className="h-5 w-5" />
                </div>
                <DialogTitle className="text-xl font-bold tracking-tight text-zinc-900">
                  Видалити операцію?
                </DialogTitle>
              </div>
              <DialogDescription className="text-[14px] leading-relaxed text-zinc-500">
                {deleteTarget ? (
                  <>
                    <span className="font-semibold text-zinc-800">
                      «{deleteTarget.title}»
                    </span>{" "}
                    зникне зі складу або палива. Запис про видалення залишиться
                    в архіві сезону {seasonYear}.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex gap-3 px-7 pt-5 pb-7">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setDeleteTarget(null)}
              className="h-11 flex-1 rounded-2xl border-[#E5DFD3] bg-white text-sm font-semibold"
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirmDelete}
              className="h-11 flex-1 rounded-2xl bg-[#B42318] text-sm font-bold text-white hover:bg-[#912018]"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Видалити
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

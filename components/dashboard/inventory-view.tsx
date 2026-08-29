"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { uk } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  History,
  Leaf,
  Loader2,
  MoreHorizontal,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Sprout,
  Trash2,
  Wheat,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  getInventoryCacheMetaMap,
  getLocalMoveById,
  getLocalMoveQtyByItem,
  deleteLocalMove,
  setInventoryItemHidden,
  updateInventoryItemCard,
  type InventoryCacheMeta,
  type LocalMoveRow,
  type LocalOutboundRow,
} from "@/app/admin/inventory/actions";
import { AccountantExportSheet } from "@/components/dashboard/accountant-export-sheet";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";
import { QuickIssueSheet } from "@/components/dashboard/quick-issue-sheet";
import { InventoryInboundSheet } from "@/components/dashboard/inventory-inbound-sheet";
import {
  InventorySaleSheet,
} from "@/components/dashboard/inventory-sale-sheet";
import {
  EditLocalMoveInline,
  LocalMovesHistorySheet,
} from "@/components/dashboard/local-moves-history-sheet";

import {
  FuelPanelShell,
  FuelSheetHeader,
  type FuelSheetAccent,
  fuelSheetBodyClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  filterDashboardByRange,
  formatInventoryMoney,
  formatInventoryQty,
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_META,
  type InventoryCategory,
  type InventoryFullDashboard,
  type InventoryItem,
  type ItemMove,
} from "@/lib/inventory-bas";
import { useSeasonStore } from "@/lib/season-store";
import { useFieldRealtime } from "@/lib/use-field-realtime";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

type FlowFilter = "purchase" | "sale" | "harvest";

const FLOW_FILTER_LABEL: Record<FlowFilter, string> = {
  purchase: "Закупки",
  sale: "Продажі",
  harvest: "Випуск",
};

const CATEGORY_ORDER: InventoryCategory[] = INVENTORY_CATEGORIES;
const CATEGORY_ICONS: Record<InventoryCategory, LucideIcon> = {
  zzr: FlaskConical,
  harvest: Wheat,
  fertilizer: Sprout,
  seed: Leaf,
  parts: Wrench,
};

const CATEGORY_CARD_STYLE: Record<
  InventoryCategory,
  { card: string; icon: string; chip: string }
> = {
  zzr: {
    card: "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white hover:border-emerald-300/80",
    icon: "bg-emerald-600 text-white shadow-emerald-600/25",
    chip: "bg-emerald-100 text-emerald-800",
  },
  fertilizer: {
    card: "border-orange-200/70 bg-gradient-to-br from-orange-50 to-white hover:border-orange-300/80",
    icon: "bg-orange-500 text-white shadow-orange-500/25",
    chip: "bg-orange-100 text-orange-800",
  },
  harvest: {
    card: "border-amber-200/70 bg-gradient-to-br from-amber-50 to-white hover:border-amber-300/80",
    icon: "bg-amber-500 text-white shadow-amber-500/25",
    chip: "bg-amber-100 text-amber-900",
  },
  seed: {
    card: "border-lime-200/70 bg-gradient-to-br from-lime-50 to-white hover:border-lime-300/80",
    icon: "bg-lime-600 text-white shadow-lime-600/25",
    chip: "bg-lime-100 text-lime-800",
  },
  parts: {
    card: "border-zinc-200/80 bg-gradient-to-br from-zinc-50 to-white hover:border-zinc-300",
    icon: "bg-zinc-800 text-white shadow-zinc-800/20",
    chip: "bg-zinc-100 text-zinc-700",
  },
};

const CATEGORY_SHEET_ACCENT: Record<InventoryCategory, FuelSheetAccent> = {
  zzr: "emerald",
  fertilizer: "amber",
  harvest: "amber",
  seed: "emerald",
  parts: "zinc",
};

type HistoryPeriod =
  | "Сьогодні"
  | "Вчора"
  | "Тиждень"
  | "Місяць"
  | "Сезон"
  | "custom";

const SEASON_OPTIONS = [2026, 2025, 2024] as const;
const PERIOD_OPTIONS: Exclude<HistoryPeriod, "custom" | "Сезон">[] = [
  "Сьогодні",
  "Вчора",
  "Тиждень",
  "Місяць",
];

/** Агросезон: 1 березня → кінець лютого наступного року */
function getSeasonRange(seasonYear: number, now = new Date()): {
  start: Date;
  end: Date;
} {
  const start = startOfDay(new Date(seasonYear, 2, 1));
  const endRaw = endOfDay(new Date(seasonYear + 1, 2, 0));
  return {
    start,
    end: endRaw.getTime() > now.getTime() ? endOfDay(now) : endRaw,
  };
}

function getPeriodRange(
  period: HistoryPeriod,
  seasonYear: number,
  customRange?: DateRange
): { start: Date; end: Date } {
  const now = new Date();
  if (period === "Сезон") {
    return getSeasonRange(seasonYear, now);
  }
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
  return { start: startOfDay(now), end: endOfDay(now) };
}

function toIsoDay(d: Date): string {
  return format(d, "yyyy-MM-dd");
}


function formatCompactUah(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 1,
    }).format(amount / 1_000_000)} млн ₴`;
  }
  if (abs >= 1_000) {
    return `${new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 0,
    }).format(amount / 1_000)} тис. ₴`;
  }
  return formatInventoryMoney(amount);
}


type Props = {
  dashboard: InventoryFullDashboard | null;
  error: string | null;
};

export function InventoryView({ dashboard, error }: Props) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<InventoryCategory | null>(null);
  const [flowFilter, setFlowFilter] = useState<FlowFilter | null>(null);
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [quickIssueOpen, setQuickIssueOpen] = useState(false);
  const [inboundOpen, setInboundOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [presetIssueKey, setPresetIssueKey] = useState<string | null>(null);
  const [presetSaleKey, setPresetSaleKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [cacheMetaByRef, setCacheMetaByRef] = useState<
    Record<string, InventoryCacheMeta>
  >({});
  const [localOutboundByRef, setLocalOutboundByRef] = useState<
    Record<string, number>
  >({});
  const [localInboundByRef, setLocalInboundByRef] = useState<
    Record<string, number>
  >({});
  const [localMoveRows, setLocalMoveRows] = useState<LocalOutboundRow[]>([]);
  const [movesRefreshToken, setMovesRefreshToken] = useState(0);

  const [period, setPeriod] = useState<HistoryPeriod>("Сезон");
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const seasonYear = Number(activeSeason) || 2026;
  const setSeasonYear = (year: number) => setActiveSeason(String(year));
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  async function refreshOperational() {
    const [movesRes, metaRes] = await Promise.all([
      getLocalMoveQtyByItem(),
      getInventoryCacheMetaMap(),
    ]);
    if (movesRes.ok) {
      setLocalOutboundByRef(movesRes.outboundByRef);
      setLocalInboundByRef(movesRes.inboundByRef);
      setLocalMoveRows(movesRes.rows);
    }
    if (metaRes.ok) setCacheMetaByRef(metaRes.byRef);
  }

  useEffect(() => {
    void refreshOperational();
  }, []);

  useFieldRealtime({
    onInventoryMovesChange: () => {
      void refreshOperational();
      setMovesRefreshToken((token) => token + 1);
    },
  });

  const dateRange = useMemo(
    () => getPeriodRange(period, seasonYear, customRange),
    [period, seasonYear, customRange]
  );

  const view = useMemo(() => {
    if (!dashboard) return null;
    return filterDashboardByRange(
      dashboard,
      toIsoDay(dateRange.start),
      toIsoDay(dateRange.end)
    );
  }, [dashboard, dateRange]);

  /** Lifetime BAS qtyIn/qtyOut (не зрізане періодом) — для «На складі». */
  const lifetimeQtyInByRef = useMemo(() => {
    const map: Record<string, number> = {};
    if (!dashboard) return map;
    for (const item of dashboard.items) {
      map[item.id.toLowerCase()] = Number(item.qtyIn) || 0;
    }
    return map;
  }, [dashboard]);

  const lifetimeQtyOutByRef = useMemo(() => {
    const map: Record<string, number> = {};
    if (!dashboard) return map;
    for (const item of dashboard.items) {
      map[item.id.toLowerCase()] = Number(item.qtyOut) || 0;
    }
    return map;
  }, [dashboard]);

  const localPeriodByRef = useMemo(() => {
    const startIso = toIsoDay(dateRange.start);
    const endIso = toIsoDay(dateRange.end);
    const byRef: Record<
      string,
      { inbound: number; outbound: number; sale: number }
    > = {};
    for (const row of localMoveRows) {
      if (row.status === "sent_to_1c") continue;
      if (!row.dateYmd || row.dateYmd < startIso || row.dateYmd > endIso) {
        continue;
      }
      const cur = byRef[row.ref] ?? { inbound: 0, outbound: 0, sale: 0 };
      if (row.type === "inbound") cur.inbound += row.qty;
      else if (row.type === "sale") {
        cur.sale += row.qty;
        cur.outbound += row.qty;
      } else cur.outbound += row.qty;
      byRef[row.ref] = cur;
    }
    return byRef;
  }, [localMoveRows, dateRange]);

  const localOutboundPeriodByRef = useMemo(() => {
    const byRef: Record<string, number> = {};
    for (const [ref, qty] of Object.entries(localPeriodByRef)) {
      if (qty.outbound > 0) byRef[ref] = qty.outbound;
    }
    return byRef;
  }, [localPeriodByRef]);

  const periodItemById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    if (!view) return map;
    for (const row of view.items) map.set(row.id, row);
    return map;
  }, [view]);

  /** Позиції з відповідним типом руху за період (BAS + локальні). */
  const flowMatchedIds = useMemo(() => {
    const purchase = new Set<string>();
    const sale = new Set<string>();
    const harvest = new Set<string>();
    if (view) {
      for (const m of view.moves) {
        const id = m.itemId.toLowerCase();
        if (m.kind === "purchase") purchase.add(id);
        else if (m.kind === "sale") sale.add(id);
        else if (m.kind === "harvest") harvest.add(id);
      }
    }
    const startIso = toIsoDay(dateRange.start);
    const endIso = toIsoDay(dateRange.end);
    for (const row of localMoveRows) {
      if (row.status === "sent_to_1c") continue;
      if (!row.dateYmd || row.dateYmd < startIso || row.dateYmd > endIso) {
        continue;
      }
      const id = row.ref.toLowerCase();
      if (row.type === "inbound") purchase.add(id);
      else if (row.type === "sale") sale.add(id);
    }
    return { purchase, sale, harvest } as const;
  }, [view, localMoveRows, dateRange]);

  /** Позиції з рухами BAS/локальними за вибраний період (+ локальні SKU без BAS). */
  const periodScopedItems = useMemo(() => {
    if (!view) return [];
    const byId = new Map(
      view.items.map((item) => [item.id.toLowerCase(), item])
    );
    const stockCats = new Set([
      "zzr",
      "fertilizer",
      "seed",
      "parts",
      "harvest",
    ]);
    for (const meta of Object.values(cacheMetaByRef)) {
      const key = meta.basRefKey.toLowerCase();
      if (byId.has(key)) continue;
      if (!stockCats.has(meta.category)) continue;
      const localPeriod = localPeriodByRef[key];
      const hasLocalPeriod =
        (localPeriod?.inbound ?? 0) > 0 || (localPeriod?.outbound ?? 0) > 0;
      if (!meta.isLocal && !hasLocalPeriod) continue;
      byId.set(key, {
        id: key,
        name: meta.customName?.trim() || meta.basName,
        code: null,
        category: meta.category as InventoryItem["category"],
        unit: meta.unit,
        qtyIn: 0,
        qtyOut: 0,
        costIn: 0,
        costOut: 0,
        cost: 0,
        moveCount: hasLocalPeriod ? 1 : 0,
        lastDate: null,
      });
    }
    return [...byId.values()];
  }, [view, cacheMetaByRef, localPeriodByRef]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return periodScopedItems.filter((item) => {
      if (category && item.category !== category) return false;
      if (!category && !flowFilter) return false;

      if (flowFilter) {
        const id = item.id.toLowerCase();
        if (!flowMatchedIds[flowFilter].has(id)) return false;
      }

      const meta =
        cacheMetaByRef[item.id] ?? cacheMetaByRef[item.id.toLowerCase()];
      const hidden = meta?.isHidden ?? false;
      if (!showHidden && hidden) return false;

      const periodItem = periodItemById.get(item.id);
      const localPeriod = localPeriodByRef[item.id.toLowerCase()];
      const hasPeriodBas = (periodItem?.moveCount ?? item.moveCount) > 0;
      const hasPeriodLocal =
        (localPeriod?.inbound ?? 0) > 0 || (localPeriod?.outbound ?? 0) > 0;
      const isLocalSku = meta?.isLocal === true;

      if (onlyActive) {
        if (!hasPeriodBas && !hasPeriodLocal) return false;
      }

      if (!q) return true;
      const displayName = (meta?.customName || item.name).toLowerCase();
      return (
        displayName.includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.code?.toLowerCase().includes(q) ?? false) ||
        isLocalSku
      );
    });
  }, [
    periodScopedItems,
    category,
    flowFilter,
    flowMatchedIds,
    query,
    showHidden,
    onlyActive,
    cacheMetaByRef,
    periodItemById,
    localPeriodByRef,
  ]);

  const showingItems = category != null || flowFilter != null;

  function applyPeriod(next: HistoryPeriod) {
    setSeasonOpen(false);
    if (next !== "custom") setRangeOpen(false);
    setPeriod(next);
  }

  function toggleFlowFilter(next: FlowFilter) {
    setFlowFilter((prev) => (prev === next ? null : next));
    setOpenItemId(null);
    setQuery("");
  }

  const categorySummaries = view?.categories ?? [];

  /** Локальні ₴ за період → KPI Закупки / Продажі (+ оборот категорій). */
  const localPeriodFinance = useMemo(() => {
    const startIso = toIsoDay(dateRange.start);
    const endIso = toIsoDay(dateRange.end);
    const categoryByRef: Record<string, InventoryCategory> = {};
    for (const item of periodScopedItems) {
      categoryByRef[item.id.toLowerCase()] = item.category;
    }
    for (const [key, meta] of Object.entries(cacheMetaByRef)) {
      if (meta.category) {
        categoryByRef[key.toLowerCase()] =
          meta.category as InventoryCategory;
      }
    }

    let receiptsUah = 0;
    let receiptDocs = 0;
    let salesUah = 0;
    let saleDocs = 0;
    let harvestUah = 0;
    const costByCategory: Partial<Record<InventoryCategory, number>> = {};

    for (const row of localMoveRows) {
      // sent_to_1c уже в BAS KPI після синку — не дублюємо
      if (row.status === "sent_to_1c") continue;
      if (!row.dateYmd || row.dateYmd < startIso || row.dateYmd > endIso) {
        continue;
      }
      const price = row.unitPriceUah;
      const amount =
        price != null && Number.isFinite(price)
          ? Math.round(row.qty * price * 100) / 100
          : 0;
      const cat = categoryByRef[row.ref];

      if (row.type === "inbound") {
        receiptDocs += 1;
        receiptsUah += amount;
        if (cat === "harvest") harvestUah += amount;
        if (cat && amount > 0) {
          costByCategory[cat] = (costByCategory[cat] ?? 0) + amount;
        }
      } else if (row.type === "sale") {
        saleDocs += 1;
        salesUah += amount;
      }
    }

    return {
      receiptsUah: Math.round(receiptsUah),
      receiptDocs,
      salesUah: Math.round(salesUah),
      saleDocs,
      harvestUah: Math.round(harvestUah),
      costByCategory,
    };
  }, [
    localMoveRows,
    dateRange,
    periodScopedItems,
    cacheMetaByRef,
  ]);

  /** Категорійні лічильники з урахуванням локальних рухів за період */
  const categoryCounts = useMemo(() => {
    const counts: Record<
      string,
      { active: number; total: number; cost: number }
    > = {};
    for (const cat of CATEGORY_ORDER) {
      counts[cat] = { active: 0, total: 0, cost: 0 };
    }
    for (const item of periodScopedItems) {
      const bucket = counts[item.category];
      if (!bucket) continue;
      const meta =
        cacheMetaByRef[item.id] ?? cacheMetaByRef[item.id.toLowerCase()];
      if (meta?.isHidden && !showHidden) continue;
      bucket.total += 1;
      const localPeriod = localPeriodByRef[item.id.toLowerCase()];
      const hasPeriod =
        item.moveCount > 0 ||
        (localPeriod?.inbound ?? 0) > 0 ||
        (localPeriod?.outbound ?? 0) > 0;
      if (hasPeriod) {
        bucket.active += 1;
        bucket.cost += item.cost;
      }
    }
    for (const cat of CATEGORY_ORDER) {
      counts[cat].cost += localPeriodFinance.costByCategory[cat] ?? 0;
    }
    return counts;
  }, [
    periodScopedItems,
    cacheMetaByRef,
    localPeriodByRef,
    showHidden,
    localPeriodFinance,
  ]);

  return (
    <main
      className={cn(
        "relative h-full w-full overflow-y-auto overscroll-none",
        "bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]",
        "pb-[calc(var(--app-bottom-inset)+1.25rem)] md:pb-0"
      )}
    >
      <div
        className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#276749]/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-48 -left-12 h-52 w-52 rounded-full bg-sky-400/10 blur-3xl"
        aria-hidden
      />

      <div
        className={cn(
          "relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8",
          isMobile
            ? "pt-[max(0.75rem,var(--safe-top))] pb-2"
            : "py-5 sm:py-6"
        )}
      >
        <div
          className={cn(
            "mb-4 flex flex-col gap-3 sm:mb-5",
            !isMobile && "sm:flex-row sm:items-center sm:justify-between"
          )}
        >
          {!isMobile ? (
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
                Склад
              </h1>
              <p className="mt-1 text-sm text-zinc-500">Оперативний облік ТМЦ</p>
            </div>
          ) : null}

          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => setInboundOpen(true)}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-sky-200/90 bg-sky-50 px-3.5 text-sm font-bold text-sky-950 shadow-sm transition hover:bg-sky-100 sm:flex-none sm:px-4"
            >
              <PackagePlus className="h-4 w-4" />
              Прихід
            </button>
            <button
              type="button"
              onClick={() => setQuickIssueOpen(true)}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3.5 text-sm font-bold text-white shadow-sm shadow-zinc-900/25 transition hover:bg-zinc-800 sm:flex-none sm:px-4"
            >
              <PackageMinus className="h-4 w-4" />
              Списати
            </button>
            <button
              type="button"
              onClick={() => setSaleOpen(true)}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-200/90 bg-amber-50 px-3.5 text-sm font-bold text-amber-950 shadow-sm transition hover:bg-amber-100 sm:flex-none sm:px-4"
            >
              <ShoppingCart className="h-4 w-4" />
              Продаж
            </button>
            <div className="flex w-full items-center gap-1.5 sm:ml-1 sm:w-auto">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD3]/90 bg-white/90 px-3 text-sm font-semibold text-zinc-600 shadow-sm transition hover:bg-[#F4F1EA] hover:text-zinc-900 sm:flex-none sm:px-3.5"
                title="Історія"
              >
                <History className="h-4 w-4" />
                Історія
              </button>
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD3]/90 bg-white/90 px-3 text-sm font-semibold text-zinc-600 shadow-sm transition hover:bg-[#F4F1EA] hover:text-zinc-900 sm:flex-none sm:px-3.5"
                title="Експорт"
              >
                <Download className="h-4 w-4" />
                Експорт
              </button>
            </div>
          </div>
        </div>

        <QuickIssueSheet
          open={quickIssueOpen}
          onOpenChange={(open) => {
            setQuickIssueOpen(open);
            if (!open) setPresetIssueKey(null);
          }}
          presetItemRefKey={presetIssueKey}
          onSuccess={() => {
            void refreshOperational();
            setMovesRefreshToken((token) => token + 1);
            router.refresh();
          }}
        />

        <InventoryInboundSheet
          open={inboundOpen}
          onOpenChange={setInboundOpen}
          presetCategory={category}
          onSuccess={() => {
            void refreshOperational();
            setMovesRefreshToken((token) => token + 1);
            router.refresh();
          }}
        />

        <InventorySaleSheet
          open={saleOpen}
          onOpenChange={(open) => {
            setSaleOpen(open);
            if (!open) setPresetSaleKey(null);
          }}
          presetItemRefKey={presetSaleKey}
          onSuccess={() => {
            void refreshOperational();
            setMovesRefreshToken((token) => token + 1);
            router.refresh();
          }}
        />

        <LocalMovesHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          refreshToken={movesRefreshToken}
          season={activeSeason}
          onChanged={() => {
            void refreshOperational();
            setMovesRefreshToken((token) => token + 1);
          }}
        />

        <AccountantExportSheet
          open={exportOpen}
          onOpenChange={setExportOpen}
          onChanged={() => {
            void refreshOperational();
            setMovesRefreshToken((token) => token + 1);
          }}
        />

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {view ? (
          <>
            <div className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Popover
                  open={seasonOpen}
                  onOpenChange={(next) => {
                    setSeasonOpen(next);
                    if (next) {
                      setRangeOpen(false);
                      setPeriod("Сезон");
                    }
                  }}
                >
                  <PopoverTrigger
                    className={cn(
                      "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-2.5 text-left text-sm font-semibold transition-all md:h-9 md:text-xs",
                      period === "Сезон"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                    )}
                    aria-label="Обрати агросезон"
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-lg",
                        period === "Сезон"
                          ? "bg-white/15 text-white"
                          : "bg-[#276749]/12 text-[#276749]"
                      )}
                    >
                      <Sprout className="h-3.5 w-3.5" />
                    </span>
                    <span className="tabular-nums">Сезон {seasonYear}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5",
                        period === "Сезон" ? "text-white/80" : "text-zinc-400"
                      )}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    sheetOnMobile={false}
                    className="w-[min(100vw-3rem,20rem)] rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
                  >
                    <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-snug text-zinc-500">
                      Фільтр обороту ТМЦ за агросезоном (березень–лютий).
                    </p>
                    <div className="space-y-1">
                      {SEASON_OPTIONS.map((year) => (
                        <button
                          key={year}
                          type="button"
                          onClick={() => {
                            setSeasonYear(year);
                            setPeriod("Сезон");
                            setSeasonOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors",
                            seasonYear === year
                              ? "bg-[#276749] text-white"
                              : "text-zinc-800 hover:bg-zinc-50"
                          )}
                        >
                          <span className="text-sm font-semibold">
                            Сезон {year}
                          </span>
                          <span
                            className={cn(
                              "text-[11px] font-medium",
                              seasonYear === year
                                ? "text-white/75"
                                : "text-zinc-400"
                            )}
                          >
                            бер {year} – лют {year + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-xl bg-[#EDE8DF] p-0.5">
                  {PERIOD_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => applyPeriod(option)}
                      className={cn(
                        "h-11 rounded-[10px] px-2.5 text-xs font-semibold transition-all sm:px-3 md:h-8",
                        period === option
                          ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                          : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                <Popover
                  open={rangeOpen}
                  onOpenChange={(next) => {
                    setRangeOpen(next);
                    if (next) {
                      setSeasonOpen(false);
                      applyPeriod("custom");
                    }
                  }}
                >
                  <PopoverTrigger
                    className={cn(
                      "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold transition-all md:h-9 md:text-xs",
                      period === "custom"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                    )}
                  >
                    <CalendarIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        period === "custom" ? "text-white/90" : "opacity-70"
                      )}
                    />
                    {period === "custom" && customRange?.from
                      ? `${format(customRange.from, "d MMM", { locale: uk })}${
                          customRange.to
                            ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                            : " → …"
                        }`
                      : "Діапазон"}
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    sheetOnMobile={false}
                    className="w-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl"
                  >
                    <p className="mb-2 px-1 text-[11px] text-zinc-500">
                      {customRange?.from && customRange?.to
                        ? "Натисніть дату, щоб обрати новий початок"
                        : customRange?.from
                          ? "Тепер оберіть кінець періоду"
                          : "Оберіть початок, потім кінець періоду"}
                    </p>
                    <Calendar
                      mode="range"
                      numberOfMonths={1}
                      selected={customRange}
                      defaultMonth={customRange?.from ?? new Date()}
                      onSelect={(range, triggerDate) => {
                        applyPeriod("custom");
                        if (
                          customRange?.from &&
                          customRange?.to &&
                          triggerDate
                        ) {
                          setCustomRange({
                            from: triggerDate,
                            to: undefined,
                          });
                          return;
                        }
                        setCustomRange(range);
                      }}
                      locale={uk}
                      className="rounded-xl"
                    />
                    <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRange(undefined);
                          applyPeriod("Сезон");
                          setRangeOpen(false);
                        }}
                        className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
                      >
                        Скинути
                      </button>
                      <button
                        type="button"
                        disabled={!customRange?.from}
                        onClick={() => {
                          if (!customRange?.from) return;
                          if (!customRange.to) {
                            setCustomRange({
                              from: customRange.from,
                              to: customRange.from,
                            });
                          }
                          setPeriod("custom");
                          setRangeOpen(false);
                        }}
                        className="h-11 flex-[1.4] rounded-xl bg-[#276749] text-sm font-bold text-white hover:bg-[#22543d] disabled:opacity-50"
                      >
                        Застосувати
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {(
                  [
                    {
                      id: "purchase" as const,
                      label: "Закупки",
                      value: formatCompactUah(
                        view.totalReceipts + localPeriodFinance.receiptsUah
                      ),
                      hint: `${
                        view.docs.filter((d) => d.type === "receipt").length +
                        localPeriodFinance.receiptDocs
                      } док.`,
                      tone: "from-white via-zinc-50/80 to-emerald-50/40",
                      activeTone:
                        "border-emerald-400/70 ring-2 ring-emerald-500/20",
                    },
                    {
                      id: "sale" as const,
                      label: "Продажі",
                      value: formatCompactUah(
                        view.totalSales + localPeriodFinance.salesUah
                      ),
                      hint: `${
                        view.docs.filter((d) => d.type === "sale").length +
                        localPeriodFinance.saleDocs
                      } док.`,
                      tone: "from-white via-zinc-50/80 to-sky-50/40",
                      activeTone: "border-sky-400/70 ring-2 ring-sky-500/20",
                    },
                    {
                      id: "harvest" as const,
                      label: "Випуск",
                      value: formatCompactUah(
                        view.totalHarvest + localPeriodFinance.harvestUah
                      ),
                      hint: "собівартість",
                      tone: "from-white via-zinc-50/80 to-amber-50/40",
                      activeTone:
                        "border-amber-400/70 ring-2 ring-amber-500/20",
                    },
                  ] as const
                ).map((kpi) => {
                  const active = flowFilter === kpi.id;
                  return (
                    <button
                      key={kpi.id}
                      type="button"
                      onClick={() => toggleFlowFilter(kpi.id)}
                      className={cn(
                        "min-h-[5.25rem] rounded-2xl border bg-gradient-to-br p-3 text-left shadow-[0_8px_24px_rgb(39,33,24,0.05)] transition sm:min-h-[5.5rem] sm:p-4",
                        "hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(39,33,24,0.08)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/30",
                        kpi.tone,
                        active
                          ? kpi.activeTone
                          : "border-[#E5DFD3]/90"
                      )}
                      title={`${kpi.label}: ${kpi.value}`}
                      aria-pressed={active}
                    >
                      <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                        {kpi.label}
                      </p>
                      <p className="mt-1.5 truncate text-lg font-bold tracking-tight text-zinc-900 tabular-nums sm:text-xl">
                        {kpi.value}
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        {active ? "Фільтр · натисніть ще раз" : kpi.hint}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {!showingItems ? (
              <section className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
                {CATEGORY_ORDER.map((cat) => {
                  const card =
                    categorySummaries.find((c) => c.category === cat) ??
                    view.categories.find((c) => c.category === cat);
                  const counts = categoryCounts[cat] ?? {
                    active: 0,
                    total: 0,
                    cost: 0,
                  };
                  const meta = INVENTORY_CATEGORY_META[cat];
                  const style = CATEGORY_CARD_STYLE[cat];
                  const Icon = CATEGORY_ICONS[cat];
                  const count = onlyActive ? counts.active : counts.total;
                  const periodCost = counts.cost || (card?.totalCost ?? 0);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setCategory(cat);
                        setOpenItemId(null);
                        setQuery("");
                      }}
                      className={cn(
                        "group relative overflow-hidden rounded-2xl border text-left shadow-[0_8px_30px_rgb(39,33,24,0.05)] transition-all",
                        "p-3 sm:min-h-[168px] sm:rounded-3xl sm:p-6",
                        "hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgb(39,33,24,0.08)]",
                        style.card
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 sm:gap-3">
                        <div
                          className={cn(
                            "flex items-center justify-center rounded-xl shadow-md sm:rounded-2xl",
                            "h-9 w-9 sm:h-12 sm:w-12",
                            style.icon
                          )}
                        >
                          <Icon
                            className="h-4 w-4 sm:h-5 sm:w-5"
                            strokeWidth={1.9}
                          />
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums sm:px-2.5 sm:py-1 sm:text-[11px]",
                            style.chip
                          )}
                        >
                          {count}
                          <span className="hidden sm:inline"> поз.</span>
                        </span>
                      </div>
                      <p className="mt-2.5 text-[13px] font-extrabold tracking-tight text-zinc-900 sm:mt-5 sm:text-xl">
                        {meta.label}
                      </p>
                      <p className="mt-0.5 hidden text-sm text-zinc-500 sm:mt-1 sm:block">
                        {meta.description}
                      </p>
                      <div className="mt-2 flex items-end justify-between gap-2 sm:mt-4">
                        <div className="min-w-0">
                          <p className="hidden text-[10px] font-semibold tracking-wider text-zinc-400 uppercase sm:block">
                            Оборот за період
                          </p>
                          <p className="truncate text-sm font-bold tabular-nums text-zinc-900 sm:mt-0.5 sm:text-base">
                            {formatCompactUah(periodCost)}
                          </p>
                        </div>
                        <span className="hidden items-center gap-1 text-xs font-semibold text-zinc-400 transition group-hover:text-zinc-700 sm:inline-flex">
                          Відкрити
                          <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </section>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (category) {
                        setCategory(null);
                        setOpenItemId(null);
                        setQuery("");
                        return;
                      }
                      setFlowFilter(null);
                      setOpenItemId(null);
                      setQuery("");
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-600 shadow-sm transition hover:text-zinc-900"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {category ? "Усі категорії" : "До огляду"}
                  </button>
                  {category ? (
                    <div
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold",
                        CATEGORY_CARD_STYLE[category].chip
                      )}
                    >
                      {(() => {
                        const Icon = CATEGORY_ICONS[category];
                        return <Icon className="h-3.5 w-3.5" strokeWidth={2} />;
                      })()}
                      {INVENTORY_CATEGORY_META[category].label}
                    </div>
                  ) : null}
                  {flowFilter ? (
                    <button
                      type="button"
                      onClick={() => setFlowFilter(null)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/25 bg-[#276749]/10 px-3 py-1.5 text-xs font-semibold text-[#1f5339]"
                    >
                      {FLOW_FILTER_LABEL[flowFilter]}
                      <span className="text-[#276749]/60">×</span>
                    </button>
                  ) : null}
                  {category ? (
                    <span className="text-xs text-zinc-400">
                      {categoryCounts[category]?.active ?? 0} за період ·{" "}
                      {categoryCounts[category]?.total ?? 0} у списку
                    </span>
                  ) : flowFilter ? (
                    <span className="text-xs text-zinc-400">
                      {items.length} поз. · {FLOW_FILTER_LABEL[flowFilter]}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[180px] flex-1 sm:max-w-xs sm:flex-none">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Пошук номенклатури…"
                      className="h-9 rounded-full border-zinc-200 bg-white pl-9 text-xs shadow-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant={onlyActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setOnlyActive((v) => !v)}
                    className={cn(
                      "h-9 shrink-0 rounded-full px-3 text-xs font-semibold",
                      onlyActive
                        ? "bg-[#276749] text-white hover:bg-[#1f5339]"
                        : "border-[#E5DFD3] bg-white text-zinc-600"
                    )}
                  >
                    {onlyActive ? "Лише за період" : "Увесь довідник"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowHidden((v) => !v)}
                    title="Показує позиції, які ви приховали з екрану"
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all",
                      showHidden
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
                    )}
                  >
                    {showHidden ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                    Приховані
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-6 py-12 text-center text-sm text-zinc-500">
                    Нічого не знайдено.
                  </div>
                ) : (
                  <NomenclatureGrid
                    items={items}
                    periodItemById={periodItemById}
                    periodMoves={view.moves}
                    lifetimeQtyInByRef={lifetimeQtyInByRef}
                    lifetimeQtyOutByRef={lifetimeQtyOutByRef}
                    localMoveRows={localMoveRows}
                    periodStartIso={toIsoDay(dateRange.start)}
                    periodEndIso={toIsoDay(dateRange.end)}
                    localOutboundByRef={localOutboundByRef}
                    localInboundByRef={localInboundByRef}
                    localOutboundPeriodByRef={localOutboundPeriodByRef}
                    localSalePeriodByRef={Object.fromEntries(
                      Object.entries(localPeriodByRef).map(([k, v]) => [
                        k,
                        v.sale,
                      ])
                    )}
                    localInboundPeriodByRef={Object.fromEntries(
                      Object.entries(localPeriodByRef).map(([k, v]) => [
                        k,
                        v.inbound,
                      ])
                    )}
                    cacheMetaByRef={cacheMetaByRef}
                    openItemId={openItemId}
                    onOpenItem={(id) => setOpenItemId(id)}
                    onIssueToField={(item) => {
                      if (item.category === "harvest") {
                        setPresetSaleKey(item.id);
                        setSaleOpen(true);
                        return;
                      }
                      setPresetIssueKey(item.id);
                      setQuickIssueOpen(true);
                    }}
                    onCardSaved={() => {
                      void refreshOperational();
                    }}
                    onToggleHidden={async (item, hide) => {
                      const res = await setInventoryItemHidden({
                        basRefKey: item.id,
                        isHidden: hide,
                        seed: {
                          name: item.name,
                          category: item.category,
                          unit: item.unit,
                        },
                      });
                      if (!res.ok) {
                        toast.error(res.error);
                        return;
                      }
                      toast.success(
                        hide ? "Приховано з екрану" : "Відновлено"
                      );
                      void refreshOperational();
                    }}
                    onLocalMovesChanged={() => {
                      void refreshOperational();
                      setMovesRefreshToken((t) => t + 1);
                    }}
                  />
                )}
              </div>
            )}
          </>
        ) : !error ? (
          <div className="mt-6 text-sm text-zinc-500">Завантаження…</div>
        ) : null}
      </div>
    </main>
  );
}

function NomenclatureGrid({
  items,
  periodItemById,
  periodMoves,
  lifetimeQtyInByRef,
  lifetimeQtyOutByRef,
  localMoveRows,
  periodStartIso,
  periodEndIso,
  localOutboundByRef,
  localInboundByRef,
  localOutboundPeriodByRef,
  localSalePeriodByRef,
  localInboundPeriodByRef,
  cacheMetaByRef,
  openItemId,
  onOpenItem,
  onIssueToField,
  onCardSaved,
  onToggleHidden,
  onLocalMovesChanged,
}: {
  items: InventoryItem[];
  periodItemById: Map<string, InventoryItem>;
  periodMoves: ItemMove[];
  lifetimeQtyInByRef: Record<string, number>;
  lifetimeQtyOutByRef: Record<string, number>;
  localMoveRows: LocalOutboundRow[];
  periodStartIso: string;
  periodEndIso: string;
  localOutboundByRef: Record<string, number>;
  localInboundByRef: Record<string, number>;
  localOutboundPeriodByRef: Record<string, number>;
  localSalePeriodByRef: Record<string, number>;
  localInboundPeriodByRef: Record<string, number>;
  cacheMetaByRef: Record<string, InventoryCacheMeta>;
  openItemId: string | null;
  onOpenItem: (id: string | null) => void;
  onIssueToField: (item: InventoryItem) => void;
  onCardSaved: () => void;
  onToggleHidden: (item: InventoryItem, hide: boolean) => void | Promise<void>;
  onLocalMovesChanged: () => void;
}) {
  const openItem = items.find((i) => i.id === openItemId) ?? null;
  const openId = openItem?.id.toLowerCase() ?? "";
  const openBasMoves = openItem
    ? periodMoves.filter((m) => m.itemId.toLowerCase() === openId)
    : [];
  const openLocalMoves = openItem
    ? localMoveRows.filter(
        (r) =>
          r.ref === openId &&
          r.dateYmd &&
          r.dateYmd >= periodStartIso &&
          r.dateYmd <= periodEndIso
      )
    : [];
  const openDisplayName = openItem
    ? cacheMetaByRef[openId]?.customName?.trim() ||
      cacheMetaByRef[openItem.id]?.customName?.trim() ||
      openItem.name
    : "";

  const [editMove, setEditMove] = useState<LocalMoveRow | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (openItemId && !openItem) onOpenItem(null);
  }, [openItemId, openItem, onOpenItem]);

  async function handleEditLocal(localId: string) {
    setEditLoadingId(localId);
    const res = await getLocalMoveById(localId);
    setEditLoadingId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditMove(res.move);
  }

  return (
    <>
      <TooltipProvider delay={120}>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const id = item.id.toLowerCase();
          return (
          <InventoryItemCard
            key={item.id}
            item={item}
            periodItem={periodItemById.get(item.id) ?? null}
            lifetimeQtyIn={lifetimeQtyInByRef[id] ?? 0}
            lifetimeQtyOut={lifetimeQtyOutByRef[id] ?? 0}
            qtyOutLocal={localOutboundByRef[id] ?? 0}
            qtyInLocal={localInboundByRef[id] ?? 0}
            qtyInLocalPeriod={localInboundPeriodByRef[id] ?? 0}
            qtyOutLocalPeriod={localOutboundPeriodByRef[id] ?? 0}
            qtySaleLocalPeriod={localSalePeriodByRef[id] ?? 0}
            cacheMeta={cacheMetaByRef[id] ?? cacheMetaByRef[item.id]}
            selected={openItemId === item.id}
            onOpen={() => onOpenItem(item.id)}
            onIssueToField={() => onIssueToField(item)}
            onCardSaved={onCardSaved}
            onToggleHidden={(hide) => void onToggleHidden(item, hide)}
          />
          );
        })}
      </section>
      </TooltipProvider>

      <ItemDocumentsSheet
        item={openItem}
        displayName={openDisplayName}
        basMoves={openBasMoves}
        localMoves={openLocalMoves}
        open={Boolean(openItem)}
        editMove={editMove}
        editLoadingId={editLoadingId}
        onOpenChange={(next) => {
          if (!next) {
            onOpenItem(null);
            setEditMove(null);
          }
        }}
        onEditLocal={(id) => void handleEditLocal(id)}
        onCancelEdit={() => setEditMove(null)}
        onSavedEdit={() => {
          setEditMove(null);
          onLocalMovesChanged();
        }}
        onDeletedLocal={onLocalMovesChanged}
      />
    </>
  );
}

function openDocument(move: ItemMove) {
  if (!move.docRefKey || !move.docType) return;
  const type =
    move.docType === "production"
      ? "production"
      : move.docType === "sale"
        ? "sale"
        : "receipt";
  window.open(
    `/api/inventory/document/print?type=${type}&refKey=${encodeURIComponent(move.docRefKey)}&format=html`,
    "_blank",
    "noopener,noreferrer"
  );
}

function moveKindLabel(kind: ItemMove["kind"]) {
  if (kind === "sale") return "Реалізація";
  if (kind === "harvest") return "Випуск продукції";
  return "Надходження";
}

/** Показує 0 замість «—» (для врожаю). */
function formatQtyInclZero(qty: number, unit: string): string {
  const n = Number.isFinite(qty) ? qty : 0;
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
  }).format(n);
  return unit ? `${formatted} ${unit}` : formatted;
}

function splitQtyParts(qty: number, unit: string): { value: string; unit: string } {
  const n = Number.isFinite(qty) ? qty : 0;
  return {
    value: new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
    }).format(n),
    unit: unit.trim(),
  };
}

function HarvestMetricTile({
  label,
  qty,
  unit,
}: {
  label: string;
  qty: number;
  unit: string;
}) {
  const parts = splitQtyParts(qty, unit);
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
        {label}
      </p>
      <p
        className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums text-zinc-900"
        title={`${parts.value}${parts.unit ? ` ${parts.unit}` : ""}`}
      >
        {parts.value}
      </p>
      {parts.unit ? (
        <p className="mt-0.5 text-[11px] font-medium text-zinc-400">
          {parts.unit}
        </p>
      ) : null}
    </div>
  );
}

const VIRTUAL_BALANCE_CATEGORIES = new Set<InventoryCategory>([
  "zzr",
  "fertilizer",
  "seed",
  "parts",
]);

function priceUnitHint(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (!u) return "грн/од.";
  if (u === "л" || u.startsWith("л ")) return "грн/л";
  if (u === "кг" || u.startsWith("кг")) return "грн/кг";
  if (u === "т" || u.startsWith("т ")) return "грн/т";
  if (u.includes("шт")) return "грн/шт";
  return `грн/${unit.trim()}`;
}

function InventoryItemCard({
  item,
  periodItem,
  lifetimeQtyIn,
  lifetimeQtyOut,
  qtyOutLocal,
  qtyInLocal,
  qtyInLocalPeriod,
  qtyOutLocalPeriod,
  qtySaleLocalPeriod,
  cacheMeta,
  selected,
  onOpen,
  onIssueToField,
  onCardSaved,
  onToggleHidden,
}: {
  item: InventoryItem;
  periodItem: InventoryItem | null;
  lifetimeQtyIn: number;
  lifetimeQtyOut: number;
  qtyOutLocal: number;
  qtyInLocal: number;
  qtyInLocalPeriod: number;
  qtyOutLocalPeriod: number;
  qtySaleLocalPeriod: number;
  cacheMeta?: InventoryCacheMeta;
  selected: boolean;
  onOpen: () => void;
  onIssueToField: () => void;
  onCardSaved: () => void;
  onToggleHidden: (hide: boolean) => void;
}) {
  const meta = INVENTORY_CATEGORY_META[item.category];
  const Icon = CATEGORY_ICONS[item.category];
  const isHarvest = item.category === "harvest";
  const useVirtual = VIRTUAL_BALANCE_CATEGORIES.has(item.category);
  const isHidden = cacheMeta?.isHidden ?? false;
  const displayName = cacheMeta?.customName?.trim() || item.name;
  const hasCustomName = Boolean(cacheMeta?.customName?.trim());
  const isLocalSku = cacheMeta?.isLocal === true;

  const [editing, setEditing] = useState(false);
  const [customName, setCustomName] = useState("");
  const [price, setPrice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!editing) return;
    setCustomName(cacheMeta?.customName ?? "");
    setPrice(
      cacheMeta && cacheMeta.plannedPriceUah > 0
        ? String(cacheMeta.plannedPriceUah)
        : ""
    );
  }, [editing, cacheMeta]);

  const qtyInPeriod = periodItem?.qtyIn ?? 0;
  const qtyOutPeriod = periodItem?.qtyOut ?? 0;
  // Цифра на картці = рух за вибраний період (BAS + локально)
  const stockBase = qtyInPeriod + qtyInLocalPeriod;
  const virtualBalance =
    Math.round((stockBase - qtyOutPeriod - qtyOutLocalPeriod) * 100) / 100;
  const remainingPct =
    stockBase > 0
      ? Math.max(0, Math.min(100, (virtualBalance / stockBase) * 100))
      : 0;
  const isLow = stockBase > 0 ? remainingPct < 20 : virtualBalance <= 0;

  // Тіньовий залишок: BAS in/out + локальні рухи за весь час
  const warehouseBalance = Math.round(
    (lifetimeQtyIn + qtyInLocal - lifetimeQtyOut - qtyOutLocal) * 100
  ) / 100;

  function handleSaveEdit() {
    const num = Number(String(price).replace(",", "."));
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Вкажіть коректну ціну");
      return;
    }
    startTransition(async () => {
      const res = await updateInventoryItemCard({
        basRefKey: item.id,
        customName: customName.trim() || null,
        plannedPriceUah: num,
        seed: {
          name: item.name,
          category: item.category,
          unit: item.unit,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Картку збережено");
      setEditing(false);
      onCardSaved();
    });
  }

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-[#E5DFD3]/90 bg-[#F4F1EA]/95 p-5 shadow-[0_8px_30px_rgb(39,33,24,0.05)]",
        "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgb(39,33,24,0.08)]",
        selected && "border-emerald-300/80 ring-1 ring-emerald-500/20",
        isHidden && "opacity-50"
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: meta.accent }}
      />

      <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5">
        {!editing ? (
          <Tooltip>
            <TooltipTrigger
              delay={120}
              onClick={(e) => {
                e.stopPropagation();
                onIssueToField();
              }}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full",
                isHarvest
                  ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                "transition",
                "outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25"
              )}
              aria-label={isHarvest ? "Продаж" : "Списати"}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent side="top">
              {isHarvest ? "Продаж" : item.category === "parts" ? "Списати зі складу" : "Списати на поле"}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400",
              "outline-none transition hover:bg-zinc-100 hover:text-zinc-700",
              "focus-visible:ring-2 focus-visible:ring-zinc-900/10"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Дії</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-52 rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-lg"
          >
            <DropdownMenuItem
              className="cursor-pointer gap-2 rounded-lg px-2.5 py-2"
              onClick={(e) => {
                e.stopPropagation();
                onIssueToField();
              }}
            >
              <PackageMinus className="h-4 w-4 text-emerald-600" />
              {isHarvest
                ? "Продаж"
                : item.category === "parts"
                  ? "Списати зі складу"
                  : "Списати на поле"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 rounded-lg px-2.5 py-2"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              <Pencil className="h-4 w-4 text-zinc-400" />
              Редагувати картку
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 rounded-lg px-2.5 py-2"
              onClick={(e) => {
                e.stopPropagation();
                onToggleHidden(!isHidden);
              }}
            >
              {isHidden ? (
                <>
                  <Eye className="h-4 w-4 text-zinc-400" />
                  Відновити на екрані
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 text-zinc-400" />
                  Приховати з екрану
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {editing ? (
        <div className="space-y-3 pr-2">
          <div className="flex items-center gap-2">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}18`,
                color: meta.accent,
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <p className="text-sm font-semibold text-zinc-900">Редагування</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              Локальна назва
            </label>
            <Input
              value={customName}
              disabled={pending}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={item.name}
              className="h-10 rounded-xl border-zinc-200 bg-zinc-50"
            />
            <p className="text-[11px] text-zinc-400">
              Якщо порожньо — назва з BAS AGRO
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              Планова ціна ({priceUnitHint(item.unit)})
            </label>
            <Input
              type="text"
              inputMode="decimal"
              value={price}
              disabled={pending}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="h-10 rounded-xl border-zinc-200 bg-zinc-50 font-semibold tabular-nums"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSaveEdit();
                }
              }}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setEditing(false)}
              className="h-9 flex-1 rounded-xl"
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={handleSaveEdit}
              className="h-9 flex-1 rounded-xl bg-[#276749] text-white hover:bg-[#1f5339]"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Зберегти"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="w-full pr-14 text-left outline-none"
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}18`,
                color: meta.accent,
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-base font-bold leading-snug text-zinc-900">
                {displayName}
                {isLocalSku ? (
                  <span className="ml-1.5 align-middle text-[10px] font-bold tracking-wide text-sky-700 uppercase">
                    нова
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                {item.code ? (
                  <span className="font-mono">{item.code}</span>
                ) : null}
                {item.code && hasCustomName ? " · " : null}
                {hasCustomName ? item.name : null}
                {!item.code && !hasCustomName ? meta.label : null}
              </p>
            </div>
          </div>

          {isHarvest ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <HarvestMetricTile
                label="Випуск"
                qty={qtyInPeriod}
                unit={item.unit}
              />
              <HarvestMetricTile
                label="Продано"
                qty={qtyOutPeriod + qtySaleLocalPeriod}
                unit={item.unit}
              />
            </div>
          ) : useVirtual ? (
            <>
              <p
                className={cn(
                  "mt-5 text-3xl font-bold tracking-tight tabular-nums",
                  virtualBalance < 0 ? "text-rose-600" : "text-zinc-900"
                )}
              >
                {formatQtyInclZero(virtualBalance, item.unit)}
              </p>
              <p className="mt-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                За період
              </p>
              <p
                className={cn(
                  "mt-2 text-sm font-semibold tabular-nums",
                  warehouseBalance < 0 ? "text-rose-600" : "text-zinc-700"
                )}
              >
                {formatQtyInclZero(warehouseBalance, item.unit)}
                <span className="ml-1.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                  На складі
                </span>
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isLow ? "bg-rose-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${remainingPct}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-semibold tabular-nums",
                    isLow ? "text-rose-500" : "text-zinc-400"
                  )}
                >
                  {stockBase > 0 ? `${Math.round(remainingPct)}%` : "—"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-5 text-3xl font-bold tracking-tight tabular-nums text-zinc-900">
              {formatQtyInclZero(qtyInPeriod || qtyOutPeriod, item.unit)}
            </p>
          )}
        </button>
      )}
    </div>
  );
}


function ItemDocumentsSheet({
  item,
  displayName,
  basMoves,
  localMoves,
  open,
  onOpenChange,
  onEditLocal,
  onCancelEdit,
  onSavedEdit,
  onDeletedLocal,
  editLoadingId,
  editMove,
}: {
  item: InventoryItem | null;
  displayName: string;
  basMoves: ItemMove[];
  localMoves: LocalOutboundRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditLocal: (localId: string) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onDeletedLocal: () => void;
  editLoadingId: string | null;
  editMove: LocalMoveRow | null;
}) {
  const [kindFilter, setKindFilter] = useState<"all" | "in" | "sale">("all");

  useEffect(() => {
    setKindFilter("all");
  }, [item?.id]);

  const titleName = (displayName.trim() || item?.name || "Позиція").trim();

  if (!item) {
    return (
      <FuelPanelShell open={open} onOpenChange={onOpenChange} title="Позиція">
        <div className="px-5 py-10 text-center text-sm text-zinc-500">
          Позицію не знайдено
        </div>
      </FuelPanelShell>
    );
  }

  const meta = INVENTORY_CATEGORY_META[item.category];
  const SheetIcon = CATEGORY_ICONS[item.category];
  const accent = CATEGORY_SHEET_ACCENT[item.category];

  type SheetDoc = {
    key: string;
    date: string;
    qty: number;
    direction: "in" | "out";
    bucket: "in" | "sale" | "other";
    title: string;
    subtitle: string;
    amountLabel?: string | null;
    basMove?: ItemMove;
    localId?: string;
    attachmentCount?: number;
  };

  const docs: SheetDoc[] = [
    ...basMoves.map((m, i) => {
      const inbound = m.kind !== "sale";
      return {
        key: `bas-${m.docRefKey || m.date}-${i}`,
        date: m.date,
        qty: m.qty,
        direction: (inbound ? "in" : "out") as "in" | "out",
        bucket: (inbound ? "in" : "sale") as "in" | "sale",
        title: m.counterparty?.trim() || moveKindLabel(m.kind),
        subtitle: [
          formatUaDate(m.date),
          m.docNumber ? `№${m.docNumber}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        amountLabel:
          m.cost > 0
            ? `${Math.round(m.cost).toLocaleString("uk-UA")} ₴`
            : null,
        basMove: m,
      };
    }),
    ...localMoves.map((r) => {
      const isIn = r.type === "inbound";
      const isSale = r.type === "sale";
      const title = isIn
        ? r.buyerName?.trim() || r.note?.trim() || "Прихід"
        : isSale
          ? r.buyerName?.trim() || "Продаж"
          : r.fieldName?.trim() || r.note?.trim() || "Списання";
      const subtitleParts = [
        formatUaDate(r.dateYmd),
        isIn && r.note?.trim() && r.buyerName ? r.note.trim() : null,
        isSale && r.note?.trim() ? r.note.trim() : null,
        !isSale && !isIn && r.note?.trim() && r.fieldName
          ? r.note.trim()
          : null,
      ].filter(Boolean);
      const sum =
        r.unitPriceUah != null
          ? Math.round(r.qty * r.unitPriceUah * 100) / 100
          : null;
      return {
        key: `local-${r.id || `${r.dateYmd}-${r.type}-${r.qty}`}`,
        date: r.dateYmd,
        qty: r.qty,
        direction: (isIn ? "in" : "out") as "in" | "out",
        bucket: (isIn ? "in" : isSale ? "sale" : "other") as
          | "in"
          | "sale"
          | "other",
        title,
        subtitle: subtitleParts.join(" · "),
        amountLabel:
          sum != null
            ? `${sum.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`
            : r.unitPriceUah != null
              ? `${r.unitPriceUah.toLocaleString("uk-UA")} ₴/${item.unit || "од."}`
              : null,
        localId: r.id || undefined,
        attachmentCount: r.attachmentCount,
      };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const filtered = docs.filter((d) => {
    if (kindFilter === "sale") return d.bucket === "sale";
    if (kindFilter === "in") return d.bucket === "in";
    return true;
  });

  const periodIn =
    (basMoves.filter((m) => m.kind !== "sale").reduce((s, m) => s + m.qty, 0) ||
      0) +
    localMoves
      .filter((r) => r.type === "inbound")
      .reduce((s, r) => s + r.qty, 0);
  const periodOut =
    (basMoves.filter((m) => m.kind === "sale").reduce((s, m) => s + m.qty, 0) ||
      0) +
    localMoves
      .filter((r) => r.type === "sale")
      .reduce((s, r) => s + r.qty, 0);
  const periodIssued = localMoves
    .filter((r) => r.type !== "inbound" && r.type !== "sale")
    .reduce((s, r) => s + r.qty, 0);

  const inLabel = item.category === "harvest" ? "Випуск" : "Надходження";

  return (
    <FuelPanelShell open={open} onOpenChange={onOpenChange} title={titleName}>
      <FuelSheetHeader
        icon={SheetIcon}
        accent={accent}
        title={titleName}
        description={
          <>
            {item.code ? `${item.code} · ` : ""}
            {meta.label} · рухи за період
          </>
        }
      />

      <div
        className={cn(fuelSheetBodyClass, "gap-4")}
        data-vaul-no-drag=""
        data-allow-pan="true"
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-[#E5DFD3]/90 bg-white/90 p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">
              {inLabel}
            </p>
            <p className="mt-1 text-lg font-bold tracking-tight tabular-nums text-emerald-700">
              {formatInventoryQty(periodIn, item.unit)}
            </p>
          </div>
          <div className="rounded-2xl border border-[#E5DFD3]/90 bg-white/90 p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">
              {item.category === "harvest" || periodOut > 0
                ? "Продано"
                : "Списано"}
            </p>
            <p className="mt-1 text-lg font-bold tracking-tight tabular-nums text-zinc-900">
              {formatInventoryQty(
                periodOut > 0 ? periodOut : periodIssued,
                item.unit
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-[#EDE8DF] p-0.5">
          {(
            [
              ["all", "Усі"],
              ["in", inLabel],
              ["sale", "Продажі"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKindFilter(id)}
              className={cn(
                "h-9 flex-1 rounded-[10px] px-2 text-[11px] font-semibold transition",
                kindFilter === id
                  ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                  : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
            Документи
          </p>
          <span className="text-[11px] font-medium tabular-nums text-zinc-400">
            {filtered.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E5DFD3] bg-white/60 px-4 py-12 text-center text-sm text-zinc-500">
            Немає документів у цьому фільтрі
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white/90 shadow-sm">
            {filtered.map((doc) => (
              <SheetDocumentRow
                key={doc.key}
                doc={doc}
                unit={item.unit}
                editMove={
                  doc.localId && editMove?.id === doc.localId
                    ? editMove
                    : null
                }
                editLoading={
                  doc.localId != null && editLoadingId === doc.localId
                }
                onEditLocal={
                  doc.localId ? () => onEditLocal(doc.localId!) : undefined
                }
                onCancelEdit={onCancelEdit}
                onSavedEdit={onSavedEdit}
                onDeletedLocal={onDeletedLocal}
              />
            ))}
          </ul>
        )}
      </div>
    </FuelPanelShell>
  );
}

function SheetDocumentRow({
  doc,
  unit,
  onEditLocal,
  onCancelEdit,
  onSavedEdit,
  onDeletedLocal,
  editLoading,
  editMove,
}: {
  doc: {
    date: string;
    qty: number;
    direction: "in" | "out";
    title: string;
    subtitle: string;
    amountLabel?: string | null;
    basMove?: ItemMove;
    localId?: string;
    attachmentCount?: number;
  };
  unit: string;
  onEditLocal?: () => void;
  onCancelEdit?: () => void;
  onSavedEdit?: () => void;
  onDeletedLocal?: () => void;
  editLoading?: boolean;
  editMove?: LocalMoveRow | null;
}) {
  const inbound = doc.direction === "in";
  const canOpenBas = Boolean(doc.basMove?.docRefKey && doc.basMove?.docType);
  const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
  const [deleting, startDelete] = useTransition();

  function handleDelete() {
    if (!doc.localId) return;
    startDelete(async () => {
      const { suppressLocalInventoryMovesRealtimeToast } = await import(
        "@/lib/realtime-toast-guard"
      );
      suppressLocalInventoryMovesRealtimeToast();
      const res = await deleteLocalMove(doc.localId!);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(inbound ? "Прихід видалено" : "Операцію видалено");
      onDeletedLocal?.();
    });
  }

  if (editMove) {
    return (
      <li className="border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/50 p-3 last:border-0">
        <EditLocalMoveInline
          move={editMove}
          onCancel={() => onCancelEdit?.()}
          onSaved={() => onSavedEdit?.()}
        />
      </li>
    );
  }

  const rowClass =
    "group flex w-full items-center justify-between gap-3 border-b border-[#E5DFD3]/80 px-3.5 py-3.5 text-left transition-colors last:border-0 hover:bg-[#F4F1EA]/70";

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
            inbound
              ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/15"
              : "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/15"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {doc.title}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            {doc.subtitle}
            {doc.amountLabel ? ` · ${doc.amountLabel}` : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {doc.localId && (doc.attachmentCount ?? 0) > 0 ? (
          <AttachmentViewerButton
            entityType="inventory_move"
            entityId={doc.localId}
            count={doc.attachmentCount ?? 0}
          />
        ) : null}
        {doc.localId ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditLocal?.();
              }}
              disabled={deleting || editLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white hover:text-zinc-800"
              title="Редагувати"
            >
              {editLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              disabled={deleting || editLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
              title="Видалити"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        ) : null}
        <p
          className={cn(
            "min-w-[4.5rem] text-right text-base font-bold tabular-nums",
            inbound ? "text-emerald-700" : "text-zinc-900"
          )}
        >
          {formatSignedQty(doc.qty, unit, inbound)}
        </p>
        {canOpenBas ? (
          <ExternalLink className="h-3.5 w-3.5 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>
    </>
  );

  if (canOpenBas && doc.basMove) {
    return (
      <li>
        <button
          type="button"
          onClick={() => openDocument(doc.basMove!)}
          className={rowClass}
        >
          {body}
        </button>
      </li>
    );
  }

  return <li className={rowClass}>{body}</li>;
}

function formatSignedQty(qty: number, unit: string, inbound: boolean): string {
  const n = Number.isFinite(qty) ? qty : 0;
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
  }).format(n);
  const withUnit = unit ? `${formatted} ${unit}` : formatted;
  return inbound ? `+${withUnit}` : `−${withUnit}`;
}

function formatUaDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

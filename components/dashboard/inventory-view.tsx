"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  format,
} from "date-fns";
import { uk } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
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
  ShoppingBag,
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
  getLocalMoveQtyByItem,
  deleteLocalMove,
  setInventoryItemHidden,
  updateInventoryItemCard,
  type InventoryCacheMeta,
  type LocalMoveRow,
  type LocalOutboundRow,
} from "@/app/admin/inventory/actions";
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
import {
  FINANCE_QUICK_PERIODS,
  getFinancePeriodRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { useSeasonStore } from "@/lib/season-store";
import { localMoveFromOutboundRow } from "@/lib/local-move-edit";
import { nextDateRangeSelection } from "@/lib/date-range-select";
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
    card: "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white",
    icon: "bg-emerald-600 text-white shadow-emerald-600/25",
    chip: "bg-emerald-100 text-emerald-800",
  },
  fertilizer: {
    card: "border-orange-200/70 bg-gradient-to-br from-orange-50 to-white",
    icon: "bg-orange-500 text-white shadow-orange-500/25",
    chip: "bg-orange-100 text-orange-800",
  },
  harvest: {
    card: "border-amber-200/70 bg-gradient-to-br from-amber-50 to-white",
    icon: "bg-amber-500 text-white shadow-amber-500/25",
    chip: "bg-amber-100 text-amber-900",
  },
  seed: {
    card: "border-lime-200/70 bg-gradient-to-br from-lime-50 to-white",
    icon: "bg-lime-600 text-white shadow-lime-600/25",
    chip: "bg-lime-100 text-lime-800",
  },
  parts: {
    card: "border-zinc-200/80 bg-gradient-to-br from-zinc-50 to-white",
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

const SEASON_OPTIONS = [2026, 2025, 2024] as const;

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
  dashboard: InventoryFullDashboard;
  error: string | null;
  /** Перше завантаження без кешу — скелетон лише в блоці даних */
  isLoading?: boolean;
};

export function InventoryView({
  dashboard,
  error,
  isLoading = false,
}: Props) {
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
  const [operationalLoading, setOperationalLoading] = useState(true);

  const [period, setPeriod] = useState<FinancePeriod>("Сезон");
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const seasonYear = Number(activeSeason) || 2026;
  const setSeasonYear = (year: number) => setActiveSeason(String(year));
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  async function refreshOperational() {
    setOperationalLoading(true);
    try {
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
    } finally {
      setOperationalLoading(false);
    }
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

  const isoRange = useMemo(
    () => getFinancePeriodRange(period, seasonYear, customRange),
    [period, seasonYear, customRange]
  );

  const view = useMemo(
    () =>
      filterDashboardByRange(
        dashboard,
        isoRange.startIso,
        isoRange.endIso
      ),
    [dashboard, isoRange]
  );

  /** Lifetime BAS qtyIn/qtyOut (не зрізане періодом) — для «На складі». */
  const lifetimeQtyInByRef = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of dashboard.items) {
      map[item.id.toLowerCase()] = Number(item.qtyIn) || 0;
    }
    return map;
  }, [dashboard]);

  const lifetimeQtyOutByRef = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of dashboard.items) {
      map[item.id.toLowerCase()] = Number(item.qtyOut) || 0;
    }
    return map;
  }, [dashboard]);

  const localPeriodByRef = useMemo(() => {
    const startIso = isoRange.startIso;
    const endIso = isoRange.endIso;
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
  }, [localMoveRows, isoRange]);

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

  const refCategoryById = useMemo(() => {
    const map = new Map<string, InventoryCategory>();
    for (const item of dashboard.items) {
      map.set(item.id.toLowerCase(), item.category);
    }
    for (const [key, meta] of Object.entries(cacheMetaByRef)) {
      if (meta.category) {
        map.set(key.toLowerCase(), meta.category as InventoryCategory);
      }
    }
    return map;
  }, [dashboard.items, cacheMetaByRef]);

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
    const startIso = isoRange.startIso;
    const endIso = isoRange.endIso;
    for (const row of localMoveRows) {
      if (row.status === "sent_to_1c") continue;
      if (!row.dateYmd || row.dateYmd < startIso || row.dateYmd > endIso) {
        continue;
      }
      const id = row.ref.toLowerCase();
      if (row.type === "inbound") {
        const cat = refCategoryById.get(id);
        if (cat === "harvest") harvest.add(id);
        else purchase.add(id);
      } else if (row.type === "sale") {
        sale.add(id);
      }
    }
    return { purchase, sale, harvest } as const;
  }, [view, localMoveRows, isoRange, refCategoryById]);

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

  const showingItems = category != null;

  function applyPeriod(next: FinancePeriod) {
    setSeasonOpen(false);
    if (next !== "Діапазон") setRangeOpen(false);
    setPeriod(next);
  }

  function toggleFlowFilter(next: FlowFilter) {
    setFlowFilter((prev) => (prev === next ? null : next));
    setCategory(null);
    setOpenItemId(null);
    setQuery("");
  }

  async function handleInventorySuccess(meta?: {
    category?: InventoryCategory | null;
    itemRefKey?: string;
    flowFilter?: FlowFilter | null;
  }) {
    await refreshOperational();
    setMovesRefreshToken((token) => token + 1);
    router.refresh();
    if (meta?.flowFilter) {
      setFlowFilter(meta.flowFilter);
      setCategory(meta.category ?? null);
      setQuery("");
    } else if (meta?.category) {
      setCategory(meta.category);
      setFlowFilter(null);
      setQuery("");
    }
    if (meta?.itemRefKey) {
      setOpenItemId(meta.itemRefKey);
    }
  }

  /** Id позицій, що потрапляють у поточний KPI-фільтр (з урахуванням hidden). */
  const flowItemIdsForFilter = useMemo(() => {
    if (!flowFilter) return null;
    const matched = flowMatchedIds[flowFilter];
    const ids = new Set<string>();
    for (const item of periodScopedItems) {
      const id = item.id.toLowerCase();
      if (!matched.has(id)) continue;
      const meta =
        cacheMetaByRef[item.id] ?? cacheMetaByRef[item.id.toLowerCase()];
      if (meta?.isHidden && !showHidden) continue;
      if (onlyActive) {
        const localPeriod = localPeriodByRef[id];
        const hasPeriod =
          item.moveCount > 0 ||
          (localPeriod?.inbound ?? 0) > 0 ||
          (localPeriod?.outbound ?? 0) > 0;
        if (!hasPeriod) continue;
      }
      ids.add(id);
    }
    return ids;
  }, [
    flowFilter,
    flowMatchedIds,
    periodScopedItems,
    cacheMetaByRef,
    showHidden,
    onlyActive,
    localPeriodByRef,
  ]);

  /**
   * Єдине джерело грошей для KPI і карток категорій:
   * сума рухів BAS (+ локальні) за типом — без costIn+costOut на позиції.
   */
  const flowMoney = useMemo(() => {
    const emptyCat = (): Record<InventoryCategory, number> => ({
      zzr: 0,
      fertilizer: 0,
      seed: 0,
      parts: 0,
      harvest: 0,
    });
    const byKind: Record<
      FlowFilter,
      { total: number; docs: Set<string>; byCategory: Record<InventoryCategory, number> }
    > = {
      purchase: { total: 0, docs: new Set(), byCategory: emptyCat() },
      sale: { total: 0, docs: new Set(), byCategory: emptyCat() },
      harvest: { total: 0, docs: new Set(), byCategory: emptyCat() },
    };

    const catById = new Map<string, InventoryCategory>();
    for (const item of periodScopedItems) {
      catById.set(item.id.toLowerCase(), item.category);
    }

    const hidden = (id: string) => {
      const meta = cacheMetaByRef[id] ?? cacheMetaByRef[id.toLowerCase()];
      return Boolean(meta?.isHidden) && !showHidden;
    };

    for (const m of view.moves) {
      const id = m.itemId.toLowerCase();
      if (hidden(id)) continue;
      const cat = catById.get(id);
      if (!cat) continue;
      const kind =
        m.kind === "purchase" || m.kind === "sale" || m.kind === "harvest"
          ? m.kind
          : null;
      if (!kind) continue;
      const bucket = byKind[kind];
      const amount = Number(m.cost) || 0;
      bucket.total += amount;
      bucket.byCategory[cat] += amount;
      bucket.docs.add(
        (m.docRefKey || `${m.date}:${m.qty}:${m.cost}`).toLowerCase()
      );
    }

    const startIso = isoRange.startIso;
    const endIso = isoRange.endIso;
    for (const row of localMoveRows) {
      if (row.status === "sent_to_1c") continue;
      if (!row.dateYmd || row.dateYmd < startIso || row.dateYmd > endIso) {
        continue;
      }
      const id = row.ref.toLowerCase();
      if (hidden(id)) continue;
      const cat = catById.get(id) ?? refCategoryById.get(id);
      if (!cat) continue;
      const price = row.unitPriceUah;
      const amount =
        price != null && Number.isFinite(price)
          ? Math.round(row.qty * price * 100) / 100
          : 0;
      if (!(amount > 0)) continue;

      let kind: FlowFilter | null = null;
      if (row.type === "sale") kind = "sale";
      else if (row.type === "inbound") {
        kind = cat === "harvest" ? "harvest" : "purchase";
      }
      if (!kind) continue;
      const bucket = byKind[kind];
      bucket.total += amount;
      bucket.byCategory[cat] += amount;
      bucket.docs.add(row.id || `${row.dateYmd}:${row.type}:${row.qty}`);
    }

    const roundCat = (src: Record<InventoryCategory, number>) => {
      const out = emptyCat();
      for (const cat of CATEGORY_ORDER) {
        out[cat] = Math.round(src[cat]);
      }
      return out;
    };

    return {
      purchase: {
        total: Math.round(byKind.purchase.total),
        docs: byKind.purchase.docs.size,
        byCategory: roundCat(byKind.purchase.byCategory),
      },
      sale: {
        total: Math.round(byKind.sale.total),
        docs: byKind.sale.docs.size,
        byCategory: roundCat(byKind.sale.byCategory),
      },
      harvest: {
        total: Math.round(byKind.harvest.total),
        docs: byKind.harvest.docs.size,
        byCategory: roundCat(byKind.harvest.byCategory),
      },
      /** Без фільтра: оборот = in+out по категорії (закупки/випуск + продажі). */
      turnoverByCategory: (() => {
        const out = emptyCat();
        for (const cat of CATEGORY_ORDER) {
          out[cat] = Math.round(
            byKind.purchase.byCategory[cat] +
              byKind.harvest.byCategory[cat] +
              byKind.sale.byCategory[cat]
          );
        }
        return out;
      })(),
    };
  }, [
    view.moves,
    periodScopedItems,
    cacheMetaByRef,
    showHidden,
    localMoveRows,
    isoRange,
    refCategoryById,
  ]);

  const warehouseKpi = useMemo(
    () => ({
      purchasesUah: flowMoney.purchase.total,
      purchaseDocs: flowMoney.purchase.docs,
      salesUah: flowMoney.sale.total,
      saleDocs: flowMoney.sale.docs,
      harvestUah: flowMoney.harvest.total,
    }),
    [flowMoney]
  );

  /** Категорійні лічильники; сума ₴ — з flowMoney (той самий розріз, що KPI). */
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
      const id = item.id.toLowerCase();
      if (flowItemIdsForFilter && !flowItemIdsForFilter.has(id)) continue;
      const meta =
        cacheMetaByRef[item.id] ?? cacheMetaByRef[item.id.toLowerCase()];
      if (meta?.isHidden && !showHidden) continue;
      bucket.total += 1;
      const localPeriod = localPeriodByRef[id];
      const hasPeriod =
        item.moveCount > 0 ||
        (localPeriod?.inbound ?? 0) > 0 ||
        (localPeriod?.outbound ?? 0) > 0;
      if (hasPeriod) bucket.active += 1;
    }
    for (const cat of CATEGORY_ORDER) {
      const money = flowFilter
        ? flowMoney[flowFilter].byCategory[cat]
        : flowMoney.turnoverByCategory[cat];
      counts[cat].cost = money;
    }
    return counts;
  }, [
    periodScopedItems,
    cacheMetaByRef,
    localPeriodByRef,
    showHidden,
    flowItemIdsForFilter,
    flowFilter,
    flowMoney,
  ]);

  const visibleCategories = useMemo(() => {
    if (!flowFilter) return CATEGORY_ORDER;
    return CATEGORY_ORDER.filter((cat) => {
      const c = categoryCounts[cat];
      if (!c) return false;
      return onlyActive ? c.active > 0 : c.total > 0;
    });
  }, [flowFilter, categoryCounts, onlyActive]);

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
        {!isMobile ? (
          <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
                Склад
              </h1>
              <p className="mt-1 text-sm text-zinc-500">Оперативний облік ТМЦ</p>
            </div>
            <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto sm:justify-end">
              <button
                type="button"
                onClick={() => setInboundOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-sky-200/90 bg-sky-50 px-4 text-sm font-bold text-sky-950 shadow-sm transition"
              >
                <PackagePlus className="h-4 w-4 shrink-0" />
                Прихід
              </button>
              <button
                type="button"
                onClick={() => setQuickIssueOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white shadow-sm shadow-zinc-900/25 transition"
              >
                <PackageMinus className="h-4 w-4 shrink-0" />
                Списати
              </button>
              <button
                type="button"
                onClick={() => setSaleOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50 px-4 text-sm font-bold text-amber-950 shadow-sm transition"
              >
                <ShoppingCart className="h-4 w-4 shrink-0" />
                Продаж
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD3]/90 bg-white/90 text-zinc-600 shadow-sm transition"
                title="Історія"
                aria-label="Історія"
              >
                <History className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        <QuickIssueSheet
          open={quickIssueOpen}
          onOpenChange={(open) => {
            setQuickIssueOpen(open);
            if (!open) setPresetIssueKey(null);
          }}
          presetItemRefKey={presetIssueKey}
          onSuccess={(payload) => {
            void handleInventorySuccess({
              category: payload.category,
              itemRefKey: payload.itemRefKey,
            });
          }}
        />

        <InventoryInboundSheet
          open={inboundOpen}
          onOpenChange={setInboundOpen}
          presetCategory={category}
          onSuccess={(meta) => {
            void handleInventorySuccess(meta);
          }}
        />

        <InventorySaleSheet
          open={saleOpen}
          onOpenChange={(open) => {
            setSaleOpen(open);
            if (!open) setPresetSaleKey(null);
          }}
          presetItemRefKey={presetSaleKey}
          onSuccess={(meta) => {
            void handleInventorySuccess(meta);
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

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <>
            <div className="mb-5 space-y-2.5">
              {/* 1: сезон + діапазон */}
              <div className="flex items-center gap-2">
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
                      "inline-flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 text-left text-sm font-semibold transition-all md:h-9 md:flex-none md:text-xs",
                      period === "Сезон"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700"
                    )}
                    aria-label="Обрати агросезон"
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                        period === "Сезон"
                          ? "bg-white/15 text-white"
                          : "bg-[#276749]/12 text-[#276749]"
                      )}
                    >
                      <Sprout className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate tabular-nums">
                      Сезон {seasonYear}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-3.5 w-3.5 shrink-0",
                        period === "Сезон" ? "text-white/80" : "text-zinc-400"
                      )}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    sheetOnMobile={false}
                    className="w-[min(100vw-2rem,22rem)] rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
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
                              : "text-zinc-800"
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

                <Popover
                  open={rangeOpen}
                  onOpenChange={(next) => {
                    setRangeOpen(next);
                    if (next) {
                      setSeasonOpen(false);
                      applyPeriod("Діапазон");
                    }
                  }}
                >
                  <PopoverTrigger
                    className={cn(
                      "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-all md:h-9 md:text-xs",
                      period === "Діапазон"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700"
                    )}
                  >
                    <CalendarIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        period === "Діапазон" ? "text-white/90" : "opacity-70"
                      )}
                    />
                    {period === "Діапазон" && customRange?.from
                      ? `${format(customRange.from, "d MMM", { locale: uk })}${
                          customRange.to
                            ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                            : " → …"
                        }`
                      : "Діапазон"}
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={6}
                    sheetOnMobile={false}
                    className="w-[min(100vw-1.5rem,22.5rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl"
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
                        applyPeriod("Діапазон");
                        setCustomRange(
                          nextDateRangeSelection(customRange, range, triggerDate)
                        );
                      }}
                      locale={uk}
                      className="w-full rounded-xl [--cell-size:2.5rem]"
                    />
                    <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRange(undefined);
                          applyPeriod("Сезон");
                          setRangeOpen(false);
                        }}
                        className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-600"
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
                          setPeriod("Діапазон");
                          setRangeOpen(false);
                        }}
                        className="h-11 flex-[1.4] rounded-xl bg-[#276749] text-sm font-bold text-white disabled:opacity-50"
                      >
                        Застосувати
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 2: швидкі періоди (+ історія на мобільному) */}
              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl bg-[#EDE8DF] p-0.5">
                  {FINANCE_QUICK_PERIODS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => applyPeriod(option)}
                      className={cn(
                        "h-11 min-w-0 flex-1 rounded-[10px] px-1 text-[11px] font-semibold transition-all sm:px-2 sm:text-xs md:h-8",
                        period === option
                          ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                          : "text-zinc-500"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(true)}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD3]/90 bg-white/90 text-zinc-600 shadow-sm transition"
                    title="Історія"
                    aria-label="Історія"
                  >
                    <History className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {/* 3: KPI */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {(
                  [
                    {
                      id: "purchase" as const,
                      label: "Закупки",
                      icon: ShoppingBag,
                      iconTone: "bg-emerald-100 text-emerald-700",
                      value: formatCompactUah(warehouseKpi.purchasesUah),
                      hint: `${warehouseKpi.purchaseDocs} док.`,
                      tone: "from-white via-zinc-50/80 to-emerald-50/40",
                      activeTone:
                        "border-emerald-400/70 ring-2 ring-emerald-500/20",
                    },
                    {
                      id: "sale" as const,
                      label: "Продажі",
                      icon: ShoppingCart,
                      iconTone: "bg-sky-100 text-sky-700",
                      value: formatCompactUah(warehouseKpi.salesUah),
                      hint: `${warehouseKpi.saleDocs} док.`,
                      tone: "from-white via-zinc-50/80 to-sky-50/40",
                      activeTone: "border-sky-400/70 ring-2 ring-sky-500/20",
                    },
                    {
                      id: "harvest" as const,
                      label: "Випуск",
                      icon: Wheat,
                      iconTone: "bg-amber-100 text-amber-800",
                      value: formatCompactUah(warehouseKpi.harvestUah),
                      hint: "собівартість",
                      tone: "from-white via-zinc-50/80 to-amber-50/40",
                      activeTone:
                        "border-amber-400/70 ring-2 ring-amber-500/20",
                    },
                  ] as const
                ).map((kpi) => {
                  const active = flowFilter === kpi.id;
                  const Icon = kpi.icon;
                  return (
                    <button
                      key={kpi.id}
                      type="button"
                      onClick={() => toggleFlowFilter(kpi.id)}
                      className={cn(
                        "min-h-[5.25rem] rounded-2xl border bg-gradient-to-br p-3 text-left shadow-[0_8px_24px_rgb(39,33,24,0.05)] transition sm:min-h-[5.5rem] sm:p-4",
                        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/30",
                        kpi.tone,
                        active
                          ? kpi.activeTone
                          : "border-[#E5DFD3]/90"
                      )}
                      title={`${kpi.label}: ${kpi.value}`}
                      aria-pressed={active}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                            kpi.iconTone
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                        </span>
                        <p className="truncate text-[10px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">
                          {kpi.label}
                        </p>
                      </div>
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

              {/* 4: дії (мобільний) — повні підписи без обрізання */}
              {isMobile ? (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setInboundOpen(true)}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-sky-200/90 bg-sky-50 px-2 text-[13px] font-bold text-sky-950 shadow-sm transition active:scale-[0.98]"
                  >
                    <PackagePlus className="h-4 w-4 shrink-0" />
                    Прихід
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickIssueOpen(true)}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-2 text-[13px] font-bold text-white shadow-sm shadow-zinc-900/25 transition active:scale-[0.98]"
                  >
                    <PackageMinus className="h-4 w-4 shrink-0" />
                    Списати
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleOpen(true)}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50 px-2 text-[13px] font-bold text-amber-950 shadow-sm transition active:scale-[0.98]"
                  >
                    <ShoppingCart className="h-4 w-4 shrink-0" />
                    Продаж
                  </button>
                </div>
              ) : null}
            </div>

            {isLoading ? (
              <InventoryBootSkeleton />
            ) : !showingItems ? (
              <div className="space-y-3">
                {flowFilter ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFlowFilter(null);
                        setOpenItemId(null);
                        setQuery("");
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-600 shadow-sm transition active:bg-zinc-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      До огляду
                    </button>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/25 bg-[#276749]/10 px-3 py-1.5 text-xs font-semibold text-[#1f5339]">
                      {FLOW_FILTER_LABEL[flowFilter]}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {visibleCategories.length} категор.
                      {flowItemIdsForFilter
                        ? ` · ${flowItemIdsForFilter.size} поз.`
                        : ""}
                    </span>
                  </div>
                ) : null}
                {operationalLoading ? (
                  <InventoryBootSkeleton />
                ) : visibleCategories.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-6 py-12 text-center text-sm text-zinc-500">
                    Немає категорій з такими рухами за період.
                  </div>
                ) : (
                  <section className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
                    {visibleCategories.map((cat) => {
                      const counts = categoryCounts[cat] ?? {
                        active: 0,
                        total: 0,
                        cost: 0,
                      };
                      const meta = INVENTORY_CATEGORY_META[cat];
                      const style = CATEGORY_CARD_STYLE[cat];
                      const Icon = CATEGORY_ICONS[cat];
                      const count = onlyActive ? counts.active : counts.total;
                      const periodCost = counts.cost;
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
                            "group relative overflow-hidden rounded-2xl border text-left shadow-[0_8px_30px_rgb(39,33,24,0.05)]",
                            "p-3 sm:min-h-[168px] sm:rounded-3xl sm:p-6",
                            "active:scale-[0.99]",
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
                              <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                                {flowFilter === "harvest"
                                  ? "Випуск за період"
                                  : flowFilter === "sale"
                                    ? "Продажі за період"
                                    : flowFilter === "purchase"
                                      ? "Закупки за період"
                                      : "Оборот за період"}
                              </p>
                              <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-zinc-900 sm:text-base">
                                {formatCompactUah(periodCost)}
                              </p>
                            </div>
                            <span className="hidden items-center gap-1 text-xs font-semibold text-zinc-400 sm:inline-flex">
                              Відкрити
                              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </section>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCategory(null);
                      setOpenItemId(null);
                      setQuery("");
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-600 shadow-sm transition"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {flowFilter ? "До категорій" : "Усі категорії"}
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
                      onClick={() => {
                        setFlowFilter(null);
                        setCategory(null);
                        setOpenItemId(null);
                        setQuery("");
                      }}
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
                        ? "bg-[#276749] text-white"
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
                        : "border-zinc-200 bg-white text-zinc-500"
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

                {operationalLoading ? (
                  <InventoryBootSkeleton />
                ) : items.length === 0 ? (
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
                    periodStartIso={isoRange.startIso}
                    periodEndIso={isoRange.endIso}
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
      </div>
    </main>
  );
}

function InventoryBootSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Завантаження складу">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[7.5rem] animate-pulse rounded-2xl border border-[#E5DFD3]/80 bg-white/60 sm:min-h-[168px] sm:rounded-3xl"
          />
        ))}
      </div>
    </div>
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

  useEffect(() => {
    if (openItemId && !openItem) onOpenItem(null);
  }, [openItemId, openItem, onOpenItem]);

  function handleEditLocal(localId: string, row?: LocalOutboundRow) {
    if (row && openItem) {
      setEditMove(
        localMoveFromOutboundRow(row, {
          id: openItem.id,
          name: openDisplayName || openItem.name,
          unit: openItem.unit,
          category: openItem.category,
        })
      );
      return;
    }
    const hit = openLocalMoves.find((r) => r.id === localId);
    if (hit && openItem) {
      setEditMove(
        localMoveFromOutboundRow(hit, {
          id: openItem.id,
          name: openDisplayName || openItem.name,
          unit: openItem.unit,
          category: openItem.category,
        })
      );
    }
  }

  return (
    <>
      <TooltipProvider delay={120}>
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
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
        onOpenChange={(next) => {
          if (!next) {
            onOpenItem(null);
            setEditMove(null);
          }
        }}
        onEditLocal={(id, row) => void handleEditLocal(id, row)}
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
    <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2 py-1.5">
      <p className="text-[9px] font-medium tracking-wider text-zinc-400 uppercase">
        {label}
      </p>
      <p
        className="mt-0.5 truncate text-sm font-bold tracking-tight tabular-nums text-zinc-900"
        title={`${parts.value}${parts.unit ? ` ${parts.unit}` : ""}`}
      >
        {parts.value}
        {parts.unit ? (
          <span className="ml-1 text-[10px] font-medium text-zinc-400">
            {parts.unit}
          </span>
        ) : null}
      </p>
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
        "group relative overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-[#F4F1EA]/95 p-3 shadow-[0_8px_30px_rgb(39,33,24,0.05)]",
        selected && "border-emerald-300/80 ring-1 ring-emerald-500/20",
        isHidden && "opacity-50"
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: meta.accent }}
      />

      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5">
        {!editing ? (
          <Tooltip>
            <TooltipTrigger
              delay={120}
              onClick={(e) => {
                e.stopPropagation();
                onIssueToField();
              }}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full",
                isHarvest
                  ? "bg-amber-50 text-amber-800"
                  : "bg-emerald-50 text-emerald-700",
                "transition",
                "outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25"
              )}
              aria-label={isHarvest ? "Продаж" : "Списати"}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent side="top">
              {isHarvest ? "Продаж" : item.category === "parts" ? "Списати зі складу" : "Списати на поле"}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400",
              "outline-none transition",
              "focus-visible:ring-2 focus-visible:ring-zinc-900/10"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}18`,
                color: meta.accent,
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
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
              Якщо порожньо — показується основна назва
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
              className="h-9 flex-1 rounded-xl bg-[#276749] text-white"
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
          className="w-full pr-12 text-left outline-none"
        >
          <div className="flex items-start gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}18`,
                color: meta.accent,
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] font-extrabold leading-snug tracking-tight text-zinc-900">
                {displayName}
                {isLocalSku ? (
                  <span className="ml-1.5 align-middle text-[9px] font-bold tracking-wide text-sky-700 uppercase">
                    нова
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-zinc-400">
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
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
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
            <div className="mt-2.5 space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-medium tracking-wide text-zinc-400 uppercase">
                    За період
                  </p>
                  <p
                    className={cn(
                      "truncate text-base font-bold tracking-tight tabular-nums",
                      virtualBalance < 0 ? "text-rose-600" : "text-zinc-900"
                    )}
                  >
                    {formatQtyInclZero(virtualBalance, item.unit)}
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[9px] font-medium tracking-wide text-zinc-400 uppercase">
                    На складі
                  </p>
                  <p
                    className={cn(
                      "truncate text-xs font-semibold tabular-nums",
                      warehouseBalance < 0 ? "text-rose-600" : "text-zinc-700"
                    )}
                  >
                    {formatQtyInclZero(warehouseBalance, item.unit)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100">
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
            </div>
          ) : (
            <p className="mt-2.5 text-base font-bold tracking-tight tabular-nums text-zinc-900">
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
  editMove,
}: {
  item: InventoryItem | null;
  displayName: string;
  basMoves: ItemMove[];
  localMoves: LocalOutboundRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditLocal: (localId: string, row?: LocalOutboundRow) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onDeletedLocal: () => void;
  editMove: LocalMoveRow | null;
}) {
  const [kindFilter, setKindFilter] = useState<"all" | "in" | "out">("all");

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
    localRow?: LocalOutboundRow;
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
        localRow: r,
        attachmentCount: r.attachmentCount,
      };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const filtered = docs.filter((d) => {
    if (kindFilter === "out") {
      return item.category === "harvest"
        ? d.bucket === "sale"
        : d.bucket === "other";
    }
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
  const outTabLabel = item.category === "harvest" ? "Продажі" : "Списання";

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
              ["out", outTabLabel],
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
                  : "text-zinc-500"
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
          <ul className="space-y-2">
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
                onEditLocal={
                  doc.localId
                    ? () => onEditLocal(doc.localId!, doc.localRow)
                    : undefined
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
      <li className="rounded-2xl border border-[#E5DFD3]/90 bg-[#F4F1EA]/70 p-3 shadow-sm">
        <EditLocalMoveInline
          move={editMove}
          onCancel={() => onCancelEdit?.()}
          onSaved={() => onSavedEdit?.()}
        />
      </li>
    );
  }

  const rowClass =
    "group flex w-full items-center justify-between gap-3 rounded-2xl border border-[#E5DFD3]/90 bg-white/90 px-3.5 py-3.5 text-left shadow-sm transition-colors";

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
              disabled={deleting}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition"
              title="Редагувати"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              disabled={deleting}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition"
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
          <ExternalLink className="h-3.5 w-3.5 text-zinc-300 opacity-0 transition-opacity" />
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

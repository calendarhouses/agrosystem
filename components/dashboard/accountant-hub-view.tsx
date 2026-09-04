"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Fuel,
  History,
  Loader2,
  Package,
  PackageMinus,
  PackagePlus,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import {
  archiveAccountantDeletion,
  cancelServiceAct,
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
  type LocalMoveRow,
} from "@/app/admin/inventory/actions";
import { AttachmentDropzone } from "@/components/dashboard/attachment-dropzone";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";
import { FinancePeriodToolbar } from "@/components/dashboard/finance-period-toolbar";
import { EditLocalMoveInline } from "@/components/dashboard/local-moves-history-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { ConfirmTransferDialog } from "@/components/ui/confirm-transfer-dialog";
import { Input } from "@/components/ui/input";
import {
  cachedCall,
  invalidateAppCache,
  peekAppCache,
} from "@/lib/client-data-cache";
import {
  defaultFinanceSeasonYear,
  getSeasonRange,
} from "@/lib/finance-period";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_META,
  type InventoryCategory,
} from "@/lib/inventory-bas";
import { downloadAccountantPackageExcel } from "@/lib/inventory-excel-export";
import { localMoveFromQueueItem } from "@/lib/local-move-edit";
import {
  useFinancePeriodFilter,
  type FinancePeriodFilter,
} from "@/lib/use-finance-period-filter";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

type FuelStorageTypeFilter = "stationary" | "mobile";

const SERVICE_ACT_CATEGORIES = [
  "Сервіс техніки",
  "Логістика",
  "Польові послуги",
  "Адміністративні",
] as const;

type ActCategoryFilter = (typeof SERVICE_ACT_CATEGORIES)[number];

const ACT_CATEGORY_SHORT: Record<ActCategoryFilter, string> = {
  "Сервіс техніки": "Сервіс",
  Логістика: "Логістика",
  "Польові послуги": "Польові",
  Адміністративні: "Адмін",
};

const FUEL_STORAGE_FILTERS: {
  id: FuelStorageTypeFilter;
  label: string;
}[] = [
  { id: "stationary", label: "Цистерни" },
  { id: "mobile", label: "Бензовоз" },
];

const SIDEBAR_COLLAPSED_KEY = "agrosystem-sidebar-collapsed";

type QueueCachePayload = {
  ok: boolean;
  items?: AccountantQueueItem[];
  stats?: AccountantQueueStats | null;
  seasonYear?: number;
  startIso?: string;
  endIso?: string;
};

const QUEUE_TABS: {
  id: AccountantQueueTab;
  label: string;
  short: string;
  icon: typeof Package;
}[] = [
  { id: "all", label: "Усі", short: "Усі", icon: FileSpreadsheet },
  { id: "outbound", label: "Списання", short: "Спис.", icon: PackageMinus },
  { id: "inbound", label: "Прихід", short: "Прих.", icon: PackagePlus },
  { id: "sale", label: "Продажі", short: "Прод.", icon: ShoppingCart },
  { id: "fuel", label: "Паливо", short: "ДП", icon: Fuel },
  { id: "acts", label: "Акти", short: "Акти", icon: FileText },
];

function labelActs(n: number) {
  return `${n} ${ukPlural(n, "акт", "акти", "актів")}`;
}

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
  return `${n} ${ukPlural(n, "новий", "нові", "нових")}`;
}
function labelFuelNoPrice(n: number) {
  return `${n} ${ukPlural(n, "паливо", "палива", "палива")} без ціни`;
}

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  if (!unit) return n;
  if (unit === "послуга" || unit === "посл." || unit === "послуги") {
    const count = Math.abs(Math.trunc(qty));
    return `${n} ${ukPlural(count, "послуга", "послуги", "послуг")}`;
  }
  return `${n} ${unit}`;
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
  if (kind === "service_act") {
    return {
      label: "Акт",
      icon: FileText,
      chip: "bg-violet-100 text-violet-900 ring-violet-200/80",
      well: "bg-violet-100 text-violet-800",
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
  if (tab === "acts") {
    return item.kind === "service_act";
  }
  return item.kind === tab;
}

function matchesInventoryCategory(
  item: AccountantQueueItem,
  category: InventoryCategory | null
): boolean {
  if (!category) return true;
  if (item.source !== "inventory") return false;
  return item.category === category;
}

function matchesFuelStorageType(
  item: AccountantQueueItem,
  storageType: FuelStorageTypeFilter | null
): boolean {
  if (!storageType) return true;
  if (item.source !== "fuel") return false;
  return (
    item.fromStorageType === storageType || item.toStorageType === storageType
  );
}

function matchesActCategory(
  item: AccountantQueueItem,
  category: ActCategoryFilter | null
): boolean {
  if (!category) return true;
  if (item.source !== "service_act") return false;
  return item.category === category;
}

function isInventoryCategory(value: string | null): value is InventoryCategory {
  return (
    value != null &&
    (INVENTORY_CATEGORIES as readonly string[]).includes(value)
  );
}

function isActCategory(value: string | null): value is ActCategoryFilter {
  return (
    value != null &&
    (SERVICE_ACT_CATEGORIES as readonly string[]).includes(value)
  );
}

function summarizeRows(rows: AccountantQueueItem[]) {
  let outbound = 0;
  let inbound = 0;
  let sale = 0;
  let fuel = 0;
  let acts = 0;
  let amount = 0;
  for (const r of rows) {
    if (r.kind === "outbound") outbound += 1;
    else if (r.kind === "inbound") inbound += 1;
    else if (r.kind === "sale") sale += 1;
    else if (r.kind === "service_act") acts += 1;
    else if (r.kind === "fuel_inbound" || r.kind === "fuel_transfer") fuel += 1;
    if (r.amountUah != null) amount += r.amountUah;
  }
  return {
    count: rows.length,
    outbound,
    inbound,
    sale,
    fuel,
    acts,
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
  "group relative isolate flex flex-col overflow-hidden rounded-2xl text-left",
  "min-h-[96px] p-3 sm:min-h-[148px] sm:p-5",
  "border border-white/70 shadow-[0_6px_24px_rgb(0,0,0,0.06)]",
  "backdrop-blur-2xl transition-all duration-200",
  "hover:shadow-[0_10px_28px_rgb(0,0,0,0.09)]",
  "outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/25"
);

const kpiLabelClass =
  "relative mb-1 text-left text-[9px] font-bold tracking-[0.12em] text-zinc-500 uppercase sm:mb-2 sm:text-[10px] sm:tracking-[0.14em]";

const kpiValueClass =
  "text-[1.35rem] leading-none font-semibold tracking-tight tabular-nums sm:text-[1.85rem] lg:text-[2.15rem]";

function QueueCheck({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-2"
      aria-label={label ?? "Обрати"}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-md border transition",
          checked
            ? "border-[#276749] bg-[#276749] text-white"
            : "border-zinc-300 bg-white"
        )}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function QueueInvoiceTrigger({
  item,
  open,
  onToggle,
}: {
  item: AccountantQueueItem;
  open: boolean;
  onToggle: () => void;
}) {
  const entityType =
    item.source === "fuel"
      ? "fuel_transaction"
      : item.source === "service_act"
        ? "accounting_act"
        : "inventory_move";

  if (item.hasAttachment) {
    return (
      <AttachmentViewerButton
        entityType={entityType}
        entityId={item.id}
        count={1}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition",
        open
          ? "bg-[#276749]/15 text-[#276749]"
          : "bg-zinc-100 text-zinc-500 hover:bg-[#276749]/10 hover:text-[#276749]"
      )}
      title={
        item.source === "service_act" ? "Додати скан акта" : "Додати накладну"
      }
      aria-expanded={open}
    >
      <Plus className="h-3.5 w-3.5" />
      <Paperclip className="h-3.5 w-3.5" />
    </button>
  );
}

function QueueInvoicePanel({
  item,
  onClose,
  onChanged,
}: {
  item: AccountantQueueItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const entityType =
    item.source === "fuel"
      ? "fuel_transaction"
      : item.source === "service_act"
        ? "accounting_act"
        : "inventory_move";

  return (
    <div
      className="border-t border-[#E5DFD3]/60 bg-zinc-50/80 px-3 py-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="mb-2 text-[11px] font-semibold text-zinc-600">
        {item.source === "service_act"
          ? "Скан акта до операції"
          : "Накладна до операції"}
      </p>
      <AttachmentDropzone
        entityType={entityType}
        entityId={item.id}
        compact
      />
      <button
        type="button"
        className="mt-2 w-full rounded-xl bg-[#276749] py-2 text-[11px] font-bold text-white"
        onClick={() => {
          onClose();
          invalidateAppCache("api:inventory");
          invalidateAppCache("api:fuel");
          invalidateAppCache("api:accounting");
          onChanged();
        }}
      >
        Готово
      </button>
    </div>
  );
}

export function AccountantHubView({
  embedded = false,
  periodFilter: externalPeriodFilter,
  hidePeriodHeader = false,
  onPeriodActionsChange,
}: {
  /** Вкладений у Accounting Hub — без другого full-page chrome */
  embedded?: boolean;
  periodFilter?: FinancePeriodFilter;
  /** На ПК період у шапці hub — тут лише дії */
  hidePeriodHeader?: boolean;
  /** ПК: передати «Оновити / Скачати» у шапку AccountingHub */
  onPeriodActionsChange?: (actions: ReactNode | null) => void;
}) {
  const isMobile = useIsMobile();
  const internalPeriodFilter = useFinancePeriodFilter();
  const periodFilter = externalPeriodFilter ?? internalPeriodFilter;
  const { period, seasonYear, isoRange } = periodFilter;
  const sidebarCollapsed = useSidebarCollapsed();

  const [tab, setTab] = useState<AccountantQueueTab>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<InventoryCategory | null>(null);
  const [fuelStorageFilter, setFuelStorageFilter] =
    useState<FuelStorageTypeFilter | null>(null);
  const [actCategoryFilter, setActCategoryFilter] =
    useState<ActCategoryFilter | null>(null);

  const warmSeason = defaultFinanceSeasonYear();
  const warmRange = getSeasonRange(warmSeason);
  const usesWarmQueueCache =
    period === "Сезон" &&
    seasonYear === warmSeason &&
    isoRange.startIso === warmRange.startIso &&
    isoRange.endIso === warmRange.endIso;
  const queueCacheKey = usesWarmQueueCache
    ? "api:accounting:queue"
    : `api:accounting:queue:${seasonYear}:${isoRange.startIso}:${isoRange.endIso}`;

  const seedQueue = peekAppCache<QueueCachePayload>(queueCacheKey);

  const [items, setItems] = useState<AccountantQueueItem[]>(
    seedQueue?.ok ? (seedQueue.items ?? []) : []
  );
  const [stats, setStats] = useState<AccountantQueueStats | null>(
    seedQueue?.ok ? (seedQueue.stats ?? null) : null
  );
  const [archive, setArchive] = useState<AccountantArchiveItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [loading, setLoading] = useState(!seedQueue?.ok);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const loadGen = useRef(0);

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
  const [invoiceOpenId, setInvoiceOpenId] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      const gen = ++loadGen.current;
      const force = opts?.force === true;

      if (!force) {
        const cached = peekAppCache<QueueCachePayload>(queueCacheKey);
        if (cached?.ok) {
          setItems(cached.items ?? []);
          setStats(cached.stats ?? null);
          setLoading(false);
          setError(null);
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const { data } = await cachedCall(
          queueCacheKey,
          async () => {
            const res = await listAccountantQueue({
              season: String(seasonYear),
              startIso: isoRange.startIso,
              endIso: isoRange.endIso,
            });
            if (!res.ok) {
              throw new Error(res.error);
            }
            return {
              ok: true as const,
              items: res.data.items,
              stats: res.data.stats,
              seasonYear,
              startIso: isoRange.startIso,
              endIso: isoRange.endIso,
            } satisfies QueueCachePayload;
          },
          { force: true }
        );

        if (gen !== loadGen.current) return;
        setItems(data.items ?? []);
        setStats(data.stats ?? null);
        setSelected(new Set());
      } catch (err) {
        if (gen !== loadGen.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Не вдалося завантажити чергу бухгалтера"
        );
        setItems([]);
        setStats(null);
        setSelected(new Set());
      } finally {
        if (gen === loadGen.current) setLoading(false);
      }
    },
    [queueCacheKey, seasonYear, isoRange.startIso, isoRange.endIso]
  );

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    const res = await listAccountantArchive({ season: String(seasonYear) });
    setArchiveLoading(false);
    if (res.ok) setArchive(res.data);
    else setArchive([]);
  }, [seasonYear]);

  useEffect(() => {
    const cached = peekAppCache<QueueCachePayload>(queueCacheKey);
    if (cached?.ok) {
      setItems(cached.items ?? []);
      setStats(cached.stats ?? null);
      setLoading(false);
    } else {
      setItems([]);
      setStats(null);
      setLoading(true);
    }
    setSelected(new Set());
    setError(null);
    void load();
  }, [load, queueCacheKey]);

  useEffect(() => {
    if (archiveOpen) void loadArchive();
  }, [archiveOpen, loadArchive]);

  useEffect(() => {
    const onAccountingUpdated = () => {
      invalidateAppCache("api:inventory");
      invalidateAppCache("api:fuel");
      invalidateAppCache("api:accounting");
      invalidateAppCache("api:finance");
      void load({ force: true });
    };
    window.addEventListener("accounting-updated", onAccountingUpdated);
    return () =>
      window.removeEventListener("accounting-updated", onAccountingUpdated);
  }, [load]);

  const visible = useMemo(() => {
    return items.filter((i) => {
      if (!matchesTab(i, tab)) return false;
      if (tab === "fuel") {
        if (!matchesFuelStorageType(i, fuelStorageFilter)) return false;
      } else if (tab === "acts") {
        if (!matchesActCategory(i, actCategoryFilter)) return false;
      } else if (!matchesInventoryCategory(i, categoryFilter)) {
        return false;
      }
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
  }, [
    items,
    tab,
    insightFilter,
    categoryFilter,
    fuelStorageFilter,
    actCategoryFilter,
  ]);

  const tabItems = useMemo(
    () => items.filter((i) => matchesTab(i, tab)),
    [items, tab]
  );

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<InventoryCategory, number>> = {};
    for (const item of tabItems) {
      if (!isInventoryCategory(item.category)) continue;
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [tabItems]);

  const fuelStorageCounts = useMemo(() => {
    const counts: Record<FuelStorageTypeFilter, number> = {
      stationary: 0,
      mobile: 0,
    };
    for (const item of tabItems) {
      if (item.source !== "fuel") continue;
      if (
        item.fromStorageType === "stationary" ||
        item.toStorageType === "stationary"
      ) {
        counts.stationary += 1;
      }
      if (
        item.fromStorageType === "mobile" ||
        item.toStorageType === "mobile"
      ) {
        counts.mobile += 1;
      }
    }
    return counts;
  }, [tabItems]);

  const actCategoryCounts = useMemo(() => {
    const counts: Partial<Record<ActCategoryFilter, number>> = {};
    for (const item of tabItems) {
      if (!isActCategory(item.category)) continue;
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [tabItems]);

  const visibleCategories = useMemo(
    () =>
      INVENTORY_CATEGORIES.filter((cat) => (categoryCounts[cat] ?? 0) > 0),
    [categoryCounts]
  );

  const visibleActCategories = useMemo(
    () =>
      SERVICE_ACT_CATEGORIES.filter(
        (cat) => (actCategoryCounts[cat] ?? 0) > 0
      ),
    [actCategoryCounts]
  );

  function selectTab(next: AccountantQueueTab) {
    setTab(next);
    setCategoryFilter(null);
    setFuelStorageFilter(null);
    setActCategoryFilter(null);
  }

  function toggleInsight(
    next: "no_attachment" | "no_fuel_price" | "new_sku"
  ) {
    setInsightFilter((prev) => (prev === next ? null : next));
    if (next === "no_fuel_price") {
      selectTab("fuel");
    } else {
      selectTab("all");
    }
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
        `Позначено ${res.data.inventory + res.data.fuel + (res.data.acts ?? 0)} операцій`
      );
      setConfirmOpen(false);
      await load({ force: true });
      if (archiveOpen) await loadArchive();
    });
  }

  function bumpSyncedCaches() {
    invalidateAppCache("api:inventory");
    invalidateAppCache("api:fuel");
    invalidateAppCache("api:accounting");
    invalidateAppCache("api:finance");
  }

  async function openEdit(item: AccountantQueueItem) {
    if (item.source === "service_act") {
      toast.message("Акти послуг поки редагуються через LEVADIUS");
      return;
    }
    if (editingId === item.id) {
      closeInlineEdit();
      return;
    }
    if (item.source === "inventory") {
      setEditFuel(null);
      setEditingId(item.id);
      setEditLoadingId(null);
      setEditInventory(localMoveFromQueueItem(item));
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
      bumpSyncedCaches();
      await load({ force: true });
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
      } else if (item.source === "service_act") {
        const res = await cancelServiceAct(item.id);
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
      bumpSyncedCaches();
      await load({ force: true });
      if (archiveOpen) await loadArchive();
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((v) => selected.has(v.id));

  const periodActions = (
    <>
      <button
        type="button"
        onClick={() => void load({ force: true })}
        disabled={loading || pending}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E0DBD0] bg-white text-zinc-600 shadow-sm disabled:opacity-50 md:h-8 md:w-8"
        aria-label="Оновити"
      >
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      </button>
      <Button
        type="button"
        size="sm"
        disabled={loading || pending || packageSummary.count === 0}
        onClick={() => handleDownload(packageSummary.rows)}
        className={cn(
          "h-11 shrink-0 rounded-xl px-3 font-bold text-white md:h-8",
          "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]"
        )}
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Скачати</span>
        <span className="sm:hidden">{packageSummary.count || "—"}</span>
      </Button>
    </>
  );

  useEffect(() => {
    if (!onPeriodActionsChange) return;
    onPeriodActionsChange(periodActions);
    return () => onPeriodActionsChange(null);
    // periodActions depends on loading/pending/count — re-register when they change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync trailing actions to parent header
  }, [
    onPeriodActionsChange,
    loading,
    pending,
    packageSummary.count,
    packageSummary.rows,
  ]);

  const showDock = packageSummary.count > 0;
  const showPeriodHeader = !hidePeriodHeader;

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

      {(!embedded || showPeriodHeader) && (
      <header
        className={cn(
          "w-full border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/90 backdrop-blur-xl",
          isMobile ? "px-3 py-2.5" : "px-4 py-4 sm:px-6"
        )}
      >
        <div className="mx-auto w-full max-w-7xl space-y-2.5">
          {!embedded ? (
            <h1 className="truncate text-base font-extrabold tracking-tight text-zinc-900 sm:text-2xl lg:text-3xl">
              Бухгалтерія
            </h1>
          ) : null}

          {showPeriodHeader ? (
            <FinancePeriodToolbar
              {...periodFilter}
              variant={isMobile ? "mobile" : "desktop"}
              seasonHint="Фільтр черги за агросезоном (березень–лютий)."
              loading={loading}
              trailing={periodActions}
            />
          ) : (
            <div className="flex justify-end gap-2">{periodActions}</div>
          )}
        </div>
      </header>
      )}

        <div
          className={cn(
            "mx-auto w-full max-w-7xl",
            isMobile
              ? cn(
                  "space-y-3 px-3 py-3",
                  showDock
                    ? "pb-[calc(var(--app-bottom-inset)+5.5rem)]"
                    : "pb-[calc(var(--app-bottom-inset)+1rem)]"
                )
              : cn(
                  "space-y-5 px-4 py-6 sm:px-6 lg:px-8",
                  showDock ? "pb-24" : "pb-8"
                )
          )}
        >
        {hidePeriodHeader && !onPeriodActionsChange ? (
          <div className="flex justify-end gap-2">{periodActions}</div>
        ) : null}

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

        <section className="grid grid-cols-3 gap-2 md:gap-4">
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
              <p className="mt-auto hidden pt-3 text-[11px] leading-snug text-emerald-900/55 sm:block">
                {stats
                  ? [
                      labelOutbound(stats.outbound),
                      labelInbound(stats.inbound),
                      labelSale(stats.sale),
                      labelFuel(stats.fuel),
                      labelActs(stats.acts),
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
              <p className={kpiLabelClass}>Сума</p>
              <p
                className={cn(
                  kpiValueClass,
                  "inline-flex flex-wrap items-baseline gap-x-1 gap-y-0 text-teal-800"
                )}
              >
                <span>{loading ? "…" : packageHero.text}</span>
                <span className="text-[10px] font-medium tracking-tight text-zinc-500/90 sm:text-sm">
                  {packageHero.unit}
                </span>
              </p>
              <p className="mt-auto hidden pt-3 text-[11px] leading-snug text-teal-900/55 sm:block">
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
              <div className="mt-auto space-y-1.5 pt-2 sm:space-y-2 sm:pt-3">
                <div className="h-1 overflow-hidden rounded-full bg-zinc-900/5 sm:h-1.5">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      readinessPct >= 80 ? "bg-emerald-500" : "bg-amber-500"
                    )}
                    style={{ width: `${loading ? 0 : readinessPct}%` }}
                  />
                </div>
                <p className="hidden text-[11px] leading-snug text-zinc-500 sm:block">
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
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {stats.withoutAttachment > 0 ? (
              <button
                type="button"
                onClick={() => toggleInsight("no_attachment")}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition",
                  insightFilter === "no_attachment"
                    ? "bg-amber-500 text-white ring-amber-500"
                    : "bg-amber-500/10 text-amber-900 ring-amber-500/15 hover:bg-amber-500/15"
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {isMobile
                  ? `${stats.withoutAttachment} без накл.`
                  : labelWithoutInvoice(stats.withoutAttachment)}
              </button>
            ) : null}
            {stats.newItems > 0 ? (
              <button
                type="button"
                onClick={() => toggleInsight("new_sku")}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition",
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
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition",
                  insightFilter === "no_fuel_price"
                    ? "bg-orange-600 text-white ring-orange-600"
                    : "bg-orange-500/10 text-orange-900 ring-orange-500/15 hover:bg-orange-500/15"
                )}
              >
                <Fuel className="h-3.5 w-3.5" />
                {isMobile
                  ? `${stats.fuelWithoutPrice} без ціни`
                  : labelFuelNoPrice(stats.fuelWithoutPrice)}
              </button>
            ) : null}
            {insightFilter ? (
              <button
                type="button"
                onClick={() => setInsightFilter(null)}
                className="shrink-0 self-center text-[11px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              >
                Скинути
              </button>
            ) : null}
          </div>
        ) : null}

        <section
          className={cn(
            "overflow-hidden",
            isMobile
              ? "rounded-2xl border border-[#E5DFD3]/90 bg-[#FDFBF7]/95 shadow-sm"
              : "rounded-[1.75rem] border border-[#E5DFD3]/90 bg-[#FDFBF7]/90 shadow-[0_16px_40px_-18px_rgba(39,33,24,0.18)] backdrop-blur-xl"
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-2 border-b border-[#E5DFD3]/80",
              isMobile ? "px-2.5 py-2.5" : "gap-3 px-4 py-3.5 sm:px-5"
            )}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="-mx-0.5 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#F4F1EA]/90 p-1 ring-1 ring-[#E5DFD3]/90 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:inline-flex sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
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
                            : t.id === "acts"
                              ? stats?.acts
                              : stats?.fuel;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTab(t.id)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:rounded-xl sm:px-3 sm:text-xs",
                        active
                          ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                          : "text-zinc-500 hover:bg-white/60 hover:text-zinc-800"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                      {isMobile ? t.short : t.label}
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {loading ? "—" : (count ?? 0)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={toggleVisibleAll}
                className="inline-flex items-center gap-2 self-start rounded-xl px-2.5 py-2 text-[11px] font-semibold text-zinc-600 transition hover:bg-white hover:text-zinc-900 sm:self-auto sm:px-3 sm:text-xs"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border transition",
                    allVisibleSelected
                      ? "border-[#276749] bg-[#276749] text-white"
                      : "border-zinc-300 bg-white"
                  )}
                >
                  {allVisibleSelected ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : null}
                </span>
                Виділити всі
              </button>
            </div>

            {tab === "fuel" ? (
              <div className="-mx-0.5 flex max-w-full gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setFuelStorageFilter(null)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                    fuelStorageFilter == null
                      ? "bg-[#276749] text-white shadow-sm"
                      : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                  )}
                >
                  Усі
                  <span className="tabular-nums opacity-70">
                    {tabItems.length}
                  </span>
                </button>
                {FUEL_STORAGE_FILTERS.map((f) => {
                  const count = fuelStorageCounts[f.id];
                  if (count === 0 && fuelStorageFilter !== f.id) return null;
                  const active = fuelStorageFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() =>
                        setFuelStorageFilter((prev) =>
                          prev === f.id ? null : f.id
                        )
                      }
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                        active
                          ? "bg-[#276749] text-white shadow-sm"
                          : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                      )}
                    >
                      {f.label}
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : tab === "acts" ? (
              visibleActCategories.length > 0 || actCategoryFilter ? (
                <div className="-mx-0.5 flex max-w-full gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    onClick={() => setActCategoryFilter(null)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                      actCategoryFilter == null
                        ? "bg-[#276749] text-white shadow-sm"
                        : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                    )}
                  >
                    Усі
                    <span className="tabular-nums opacity-70">
                      {tabItems.length}
                    </span>
                  </button>
                  {SERVICE_ACT_CATEGORIES.map((cat) => {
                    const count = actCategoryCounts[cat] ?? 0;
                    if (count === 0 && actCategoryFilter !== cat) return null;
                    const active = actCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() =>
                          setActCategoryFilter((prev) =>
                            prev === cat ? null : cat
                          )
                        }
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                          active
                            ? "bg-[#276749] text-white shadow-sm"
                            : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                        )}
                      >
                        {isMobile ? ACT_CATEGORY_SHORT[cat] : cat}
                        <span className="tabular-nums opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null
            ) : visibleCategories.length > 0 || categoryFilter ? (
              <div className="-mx-0.5 flex max-w-full gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                    categoryFilter == null
                      ? "bg-[#276749] text-white shadow-sm"
                      : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                  )}
                >
                  Усі
                  <span className="tabular-nums opacity-70">
                    {tabItems.length}
                  </span>
                </button>
                {INVENTORY_CATEGORIES.map((cat) => {
                  const count = categoryCounts[cat] ?? 0;
                  if (count === 0 && categoryFilter !== cat) return null;
                  const active = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        setCategoryFilter((prev) =>
                          prev === cat ? null : cat
                        )
                      }
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition sm:text-[11px]",
                        active
                          ? "bg-[#276749] text-white shadow-sm"
                          : "bg-white/80 text-zinc-600 ring-1 ring-[#E5DFD3] hover:bg-white hover:text-zinc-900"
                      )}
                    >
                      {INVENTORY_CATEGORY_META[cat].label}
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="hidden" />

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
            <ul className="space-y-2 p-2.5 sm:p-3">
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
                const priceLine =
                  item.unitPriceUah != null
                    ? `${formatUah(item.unitPriceUah)} ₴/${item.unit || "од."}`
                    : item.pricePerLiter != null
                      ? `${formatUah(item.pricePerLiter)} ₴/л`
                      : null;

                return (
                  <li
                    key={`${item.source}-${item.id}`}
                    id={`queue-edit-${item.id}`}
                    className={cn(
                      "overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white/95 shadow-sm",
                      checked && "ring-1 ring-[#276749]/35"
                    )}
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
                                bumpSyncedCaches();
                                void load({ force: true });
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
                                  <p className="mt-0.5 text-sm font-semibold text-zinc-900">
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
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Збереження…
                                    </>
                                  ) : (
                                    "Зберегти"
                                  )}
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
                              "flex gap-2.5 px-3 py-3 sm:gap-3 sm:px-3.5",
                              checked && "bg-[#276749]/[0.04]"
                            )}
                          >
                            <QueueCheck
                              checked={checked}
                              onClick={() => toggle(item.id)}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <span
                                  className={cn(
                                    "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                                    meta.well
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-bold tracking-wider text-zinc-400 uppercase">
                                      {meta.label}
                                    </span>
                                    {item.isLocalItem ? (
                                      <span className="text-[9px] font-bold tracking-wider text-sky-600 uppercase">
                                        нова
                                      </span>
                                    ) : null}
                                    {item.basDraftSent ? (
                                      <span className="text-[9px] font-bold tracking-wider text-emerald-700 uppercase">
                                        у BAS
                                      </span>
                                    ) : null}
                                    <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-zinc-400">
                                      {formatDate(item.date)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[13px] leading-snug font-semibold text-zinc-900 sm:text-sm">
                                    {item.title}
                                  </p>
                                  {(item.party || item.note) && (
                                    <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                                      {[item.party, item.note]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 border-t border-[#E5DFD3]/60 pt-2">
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-sm font-bold tabular-nums text-zinc-900">
                                    {formatQty(item.qty, item.unit)}
                                  </p>
                                  <p className="text-[11px] tabular-nums text-zinc-500">
                                    {[
                                      priceLine,
                                      item.amountUah != null
                                        ? `сума ${formatUah(item.amountUah)} ₴`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "без ціни"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <QueueInvoiceTrigger
                                    item={item}
                                    open={invoiceOpenId === item.id}
                                    onToggle={() =>
                                      setInvoiceOpenId((prev) =>
                                        prev === item.id ? null : item.id
                                      )
                                    }
                                  />
                                  {item.source !== "service_act" ? (
                                    <button
                                      type="button"
                                      onClick={() => void openEdit(item)}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-[#F4F1EA] hover:text-zinc-800"
                                      title="Редагувати"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  ) : null}
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
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {invoiceOpenId === item.id && !item.hasAttachment ? (
                      <QueueInvoicePanel
                        item={item}
                        onClose={() => setInvoiceOpenId(null)}
                        onChanged={() => void load({ force: true })}
                      />
                    ) : null}
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
                <ul className="desktop-scrollbar max-h-80 space-y-2 overflow-y-auto px-4 py-4" data-desktop-scroll="true">
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
          "pointer-events-none fixed z-40 flex justify-center px-3 transition-all duration-300",
          isMobile
            ? "right-0 bottom-[calc(var(--app-bottom-inset)+0.65rem)] left-0"
            : cn(
                "right-0 bottom-3 left-16",
                !sidebarCollapsed && "md:left-[250px]"
              ),
          showDock
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        )}
        aria-hidden={!showDock}
      >
        {showDock ? (
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-2xl px-2.5 py-2 sm:gap-3 sm:px-3",
              "border border-[#E5DFD3]/95 bg-[#FDFBF7]/95",
              "shadow-[0_12px_40px_-10px_rgba(39,33,24,0.35)] backdrop-blur-xl",
              "max-w-[min(100%,28rem)]"
            )}
          >
            <div className="min-w-0 pl-0.5 sm:pl-1">
              <p className="text-[9px] font-bold tracking-[0.12em] text-zinc-400 uppercase sm:text-[10px] sm:tracking-[0.14em]">
                Пакет
              </p>
              <p className="truncate text-[13px] font-semibold text-zinc-900 sm:whitespace-nowrap sm:text-sm">
                {labelOps(packageSummary.count)}
                {packageSummary.amount > 0 ? (
                  <span className="ml-1.5 tabular-nums text-[#276749] sm:ml-2">
                    {(() => {
                      const h = formatHeroNumber(packageSummary.amount);
                      return `${h.text} ${h.unit}`;
                    })()}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="h-8 w-px shrink-0 bg-[#E5DFD3]" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => handleDownload(packageSummary.rows)}
              className="h-9 shrink-0 rounded-xl border-[#E5DFD3] bg-white px-2.5 text-xs font-semibold sm:px-3"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Excel</span>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
              className="h-9 shrink-0 rounded-xl bg-[#276749] px-3 text-xs font-bold text-white hover:bg-[#1f5239] sm:px-3.5"
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

      <ConfirmTransferDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        description={
          <>
            {labelOps(packageSummary.count)} зникнуть з черги. Спочатку
            завантажте Excel, якщо ще не зробили.
          </>
        }
        onConfirm={confirmMark}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Видалити операцію?"
        description={
          deleteTarget ? (
            <>
              <span className="font-semibold text-zinc-800">
                «{deleteTarget.title}»
              </span>{" "}
              {deleteTarget.source === "service_act"
                ? "зникне з черги актів."
                : deleteTarget.source === "fuel"
                  ? "зникне з палива."
                  : "зникне зі складу."}{" "}
              Запис про видалення залишиться в архіві сезону {seasonYear}.
            </>
          ) : null
        }
        pending={pending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

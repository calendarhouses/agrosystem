"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  Bug,
  Calendar as CalendarIcon,
  ChevronDown,
  CloudUpload,
  Eye,
  EyeOff,
  ExternalLink,
  Leaf,
  Loader2,
  MapPinned,
  MoreHorizontal,
  Package,
  PackageMinus,
  Pencil,
  Search,
  Sprout,
  TrendingUp,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  getInventoryCacheMetaMap,
  getLocalOutboundQtyByItem,
  setInventoryItemHidden,
  syncLocalMovesToBasAction,
  type InventoryCacheMeta,
} from "@/app/admin/inventory/actions";
import {
  QuickIssueButton,
  QuickIssueSheet,
} from "@/components/dashboard/quick-issue-sheet";
import { FieldEconomicsDashboard } from "@/components/dashboard/field-economics-dashboard";
import { InventoryItemEditDialog } from "@/components/dashboard/inventory-item-edit-dialog";
import {
  LocalMovesHistoryButton,
  LocalMovesHistorySheet,
} from "@/components/dashboard/local-moves-history-sheet";
import { PageHeader } from "@/components/layout/page-header";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  filterDashboardByRange,
  formatInventoryMoney,
  formatInventoryQty,
  INVENTORY_CATEGORY_META,
  type InventoryCategory,
  type InventoryFullDashboard,
  type InventoryItem,
  type ItemMove,
} from "@/lib/inventory-bas";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: InventoryCategory[] = [
  "zzr",
  "harvest",
  "fertilizer",
  "parts",
];
const CATEGORY_ICONS: Record<InventoryCategory, LucideIcon> = {
  zzr: Bug,
  harvest: Sprout,
  fertilizer: Leaf,
  parts: Wrench,
};

type Tab = "stock" | "economics";

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

type Props = {
  dashboard: InventoryFullDashboard | null;
  error: string | null;
};

export function InventoryView({ dashboard, error }: Props) {
  const [tab, setTab] = useState<Tab>("stock");
  const [category, setCategory] = useState<InventoryCategory>("zzr");
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [quickIssueOpen, setQuickIssueOpen] = useState(false);
  const [presetIssueKey, setPresetIssueKey] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [cacheMetaByRef, setCacheMetaByRef] = useState<
    Record<string, InventoryCacheMeta>
  >({});
  const [localOutboundByRef, setLocalOutboundByRef] = useState<
    Record<string, number>
  >({});
  const [syncPending, startSyncTransition] = useTransition();
  const [opsTick, setOpsTick] = useState(0);
  const [movesRefreshToken, setMovesRefreshToken] = useState(0);

  const [period, setPeriod] = useState<HistoryPeriod>("Сезон");
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);
  const seasonYear = Number(activeSeason) || 2026;
  const setSeasonYear = (year: number) => setActiveSeason(String(year));
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const rangePickStarted = useRef(false);

  async function refreshOperational() {
    const [outRes, metaRes] = await Promise.all([
      getLocalOutboundQtyByItem(),
      getInventoryCacheMetaMap(),
    ]);
    if (outRes.ok) setLocalOutboundByRef(outRes.byRef);
    if (metaRes.ok) setCacheMetaByRef(metaRes.byRef);
    setOpsTick((t) => t + 1);
  }

  useEffect(() => {
    void refreshOperational();
  }, []);

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

  const periodHint = useMemo(() => {
    if (period === "Сезон") return `Сезон ${seasonYear}`;
    if (period === "custom" && customRange?.from) {
      return `${format(customRange.from, "d MMM", { locale: uk })}${
        customRange.to
          ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
          : ""
      }`;
    }
    return period;
  }, [period, seasonYear, customRange]);

  const items = useMemo(() => {
    if (!view) return [];
    const q = query.trim().toLowerCase();
    return view.items.filter((item) => {
      if (item.category !== category) return false;
      const meta = cacheMetaByRef[item.id];
      const hidden = meta?.isHidden ?? false;
      if (!showHidden && hidden) return false;
      if (onlyActive && item.moveCount <= 0 && !hidden) return false;
      if (!q) return true;
      const displayName = (meta?.customName || item.name).toLowerCase();
      return (
        displayName.includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.code?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [view, category, query, onlyActive, cacheMetaByRef, showHidden]);

  const summary = view?.categories.find((c) => c.category === category);

  function handleSyncToBas() {
    startSyncTransition(async () => {
      const res = await syncLocalMovesToBasAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.moveCount === 0) {
        toast.message("Немає чернеток для тесту", {
          description: "Список draft порожній або все вже передано через /export.",
        });
        return;
      }
      if (res.data.dryRun) {
        toast.message("Тестовий JSON згенеровано. Авто-відправка в 1С наразі вимкнена", {
          description: `${res.data.draftCount} карт · ${res.data.moveCount} рухів лишаються draft (див. логи сервера). Передайте через «Експорт в 1С».`,
        });
        return;
      }
      toast.success("Тестовий JSON згенеровано", {
        description: `${res.data.draftCount} карт · ${res.data.moveCount} рухів. Статус не змінено — підтвердіть на /export.`,
      });
    });
  }

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Warehouse}
        title="Склад"
        description={`BAS AGRO · ${periodHint}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LocalMovesHistoryButton
              onClick={() => setHistoryOpen(true)}
              className="h-9 flex-none rounded-xl px-3 text-xs sm:h-10"
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={handleSyncToBas}
              disabled={syncPending}
              className={cn(
                "h-9 gap-2 rounded-xl border-[#276749]/30 bg-white/80 px-3 text-xs font-semibold text-[#276749] shadow-sm",
                "hover:bg-[#276749]/5 hover:text-[#276749] sm:h-10 sm:px-3.5"
              )}
            >
              {syncPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4" />
              )}
              <span className="hidden truncate sm:inline">
                Синхронізувати з 1С
              </span>
              <span className="sm:hidden">1С</span>
            </Button>
            <QuickIssueButton
              onClick={() => setQuickIssueOpen(true)}
              className="h-9 flex-none rounded-xl px-3 text-xs sm:h-10 sm:px-3.5 sm:text-sm"
            />
          </div>
        }
      />

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
        }}
      />

      <InventoryItemEditDialog
        item={editItem}
        open={editItem != null}
        onOpenChange={(open) => {
          if (!open) setEditItem(null);
        }}
        onSaved={() => {
          void refreshOperational();
        }}
      />

      <LocalMovesHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        refreshToken={movesRefreshToken}
        onChanged={() => {
          void refreshOperational();
          setMovesRefreshToken((token) => token + 1);
        }}
      />

      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {view ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
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

              <Popover
                open={seasonOpen}
                onOpenChange={(next) => {
                  setSeasonOpen(next);
                  if (next) setPeriod("Сезон");
                }}
              >
                <PopoverTrigger
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-all",
                    period === "Сезон"
                      ? "bg-white font-medium text-zinc-900 shadow-sm"
                      : "font-medium text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  Сезон {seasonYear}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="z-[100] w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
                >
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
                        "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        seasonYear === year && period === "Сезон"
                          ? "bg-[#276749]/10 font-semibold text-[#276749]"
                          : "text-zinc-700 hover:bg-zinc-50"
                      )}
                    >
                      Сезон {year}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            <Popover
              open={rangeOpen}
              onOpenChange={(open) => {
                setRangeOpen(open);
                if (open) rangePickStarted.current = false;
              }}
            >
              <PopoverTrigger
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm",
                  "outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#276749]/25",
                  period === "custom" &&
                    "border-[#276749]/35 bg-[#276749]/5 text-[#276749]"
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
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
                className="z-[100] w-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
              >
                <Calendar
                  mode="range"
                  numberOfMonths={1}
                  selected={customRange}
                  onSelect={(range) => {
                    setPeriod("custom");
                    if (!range?.from) {
                      setCustomRange(undefined);
                      rangePickStarted.current = false;
                      return;
                    }

                    if (!rangePickStarted.current) {
                      rangePickStarted.current = true;
                      setCustomRange({ from: range.from, to: undefined });
                      return;
                    }

                    if (!range.to) {
                      setCustomRange({ from: range.from, to: undefined });
                      return;
                    }

                    setCustomRange(range);
                    rangePickStarted.current = false;
                    setRangeOpen(false);
                  }}
                  locale={uk}
                  className="rounded-xl"
                />
              </PopoverContent>
            </Popover>
          </div>

          <section className="mt-3 grid grid-cols-3 gap-2">
            <KpiCard
              label="Закупки"
              value={formatInventoryMoney(view.totalReceipts)}
              sub={`${view.docs.filter((d) => d.type === "receipt").length} док.`}
              icon={ArrowDownLeft}
              accent="#2563EB"
            />
            <KpiCard
              label="Продажі"
              value={formatInventoryMoney(view.totalSales)}
              sub={`${view.docs.filter((d) => d.type === "sale").length} док.`}
              icon={ArrowUpRight}
              accent="#16A34A"
            />
            <KpiCard
              label="Випуск"
              value={formatInventoryMoney(view.totalHarvest)}
              sub="Собівартість"
              icon={TrendingUp}
              accent="#D97706"
            />
          </section>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="mt-4 gap-4"
          >
            <TabsList className="h-10 w-full rounded-xl bg-zinc-100 p-1 sm:w-auto">
              <TabsTrigger
                value="stock"
                className="flex-1 gap-1.5 rounded-lg px-3 text-xs font-semibold sm:flex-none sm:px-4"
              >
                <Package className="h-3.5 w-3.5" />
                Оперативний склад
              </TabsTrigger>
              <TabsTrigger
                value="economics"
                className="flex-1 gap-1.5 rounded-lg px-3 text-xs font-semibold sm:flex-none sm:px-4"
              >
                <MapPinned className="h-3.5 w-3.5" />
                Економіка полів
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stock" className="mt-0 space-y-4 outline-none">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CATEGORY_ORDER.map((cat) => {
                    const card = view.categories.find((c) => c.category === cat)!;
                    const meta = INVENTORY_CATEGORY_META[cat];
                    const Icon = CATEGORY_ICONS[cat];
                    const active = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setCategory(cat);
                          setOpenItemId(null);
                        }}
                        className={cn(
                          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all",
                          active
                            ? "border-transparent text-white shadow-sm"
                            : "border-[#E5DFD3] bg-[#FDFBF7] text-zinc-600 hover:border-zinc-300 hover:bg-white"
                        )}
                        style={
                          active ? { backgroundColor: meta.accent } : undefined
                        }
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                            active
                              ? "bg-white/20 text-white"
                              : "bg-zinc-100 text-zinc-500"
                          )}
                        >
                          {onlyActive ? card.activeCount : card.itemCount}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[180px] flex-1 sm:max-w-xs sm:flex-none">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Пошук…"
                      className="h-9 rounded-full border-[#E5DFD3] bg-[#FDFBF7] pl-9 text-xs shadow-sm"
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
                        : "border-[#E5DFD3] bg-[#FDFBF7] text-zinc-600"
                    )}
                  >
                    {onlyActive ? "Лише з документами" : "Увесь довідник"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowHidden((v) => !v)}
                    title="Показує позиції, які ви приховали з екрану (меню ⋯ на картці)"
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all",
                      showHidden
                        ? "border-[#276749]/30 bg-[#276749]/10 text-[#276749]"
                        : "border-[#E5DFD3] bg-[#FDFBF7] text-zinc-500 hover:bg-white"
                    )}
                  >
                    {showHidden ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                    {showHidden ? "Приховані: увімк." : "Приховані"}
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400">
                {summary
                  ? `${summary.activeCount} з документами · ${summary.itemCount} у довіднику`
                  : null}
                {view.stockNote ? ` · ${view.stockNote}` : null}
              </p>

              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E5DFD3] bg-[#FDFBF7]/60 px-6 py-12 text-center text-sm text-zinc-500">
                  Нічого не знайдено.
                </div>
              ) : (
                <NomenclatureGrid
                  items={items}
                  moves={view.moves}
                  localOutboundByRef={localOutboundByRef}
                  cacheMetaByRef={cacheMetaByRef}
                  openItemId={openItemId}
                  onOpenItem={(id) => setOpenItemId(id)}
                  onIssueToField={(item) => {
                    if (
                      item.category === "harvest" ||
                      item.category === "parts"
                    ) {
                      toast.message(
                        "Списання на поле — для ЗЗР, добрив і насіння",
                        {
                          description:
                            "Ця позиція не входить до оперативного списання.",
                        }
                      );
                      return;
                    }
                    setPresetIssueKey(item.id);
                    setQuickIssueOpen(true);
                  }}
                  onEditItem={(item) => setEditItem(item)}
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
                    toast.success(hide ? "Приховано з екрану" : "Відновлено");
                    void refreshOperational();
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="economics" className="mt-0 outline-none">
              <FieldEconomicsDashboard refreshToken={opsTick} />
            </TabsContent>
          </Tabs>
        </>
      ) : !error ? (
        <div className="mt-6 text-sm text-zinc-500">Завантаження…</div>
      ) : null}
    </main>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <GlassCard className="flex items-center gap-2.5 px-2.5 py-2 sm:gap-3 sm:px-3.5 sm:py-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 sm:rounded-xl"
        style={{ backgroundColor: `${accent}14`, color: accent }}
      >
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium text-zinc-500 sm:text-[11px]">
          {label}
        </p>
        <p className="truncate text-sm font-extrabold tracking-tight text-zinc-900 sm:text-base">
          {value}
        </p>
        <p className="hidden truncate text-[10px] text-zinc-400 sm:block">{sub}</p>
      </div>
    </GlassCard>
  );
}

function NomenclatureGrid({
  items,
  moves,
  localOutboundByRef,
  cacheMetaByRef,
  openItemId,
  onOpenItem,
  onIssueToField,
  onEditItem,
  onToggleHidden,
}: {
  items: InventoryItem[];
  moves: ItemMove[];
  localOutboundByRef: Record<string, number>;
  cacheMetaByRef: Record<string, InventoryCacheMeta>;
  openItemId: string | null;
  onOpenItem: (id: string | null) => void;
  onIssueToField: (item: InventoryItem) => void;
  onEditItem: (item: InventoryItem) => void;
  onToggleHidden: (item: InventoryItem, hide: boolean) => void | Promise<void>;
}) {
  const openItem = items.find((i) => i.id === openItemId) ?? null;
  const openMoves = openItem
    ? moves.filter((m) => m.itemId === openItem.id)
    : [];

  useEffect(() => {
    if (openItemId && !openItem) onOpenItem(null);
  }, [openItemId, openItem, onOpenItem]);

  return (
    <>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <InventoryItemCard
            key={item.id}
            item={item}
            moves={moves.filter((m) => m.itemId === item.id)}
            qtyOutLocal={localOutboundByRef[item.id] ?? 0}
            cacheMeta={cacheMetaByRef[item.id]}
            selected={openItemId === item.id}
            onOpen={() => onOpenItem(item.id)}
            onIssueToField={() => onIssueToField(item)}
            onEdit={() => onEditItem(item)}
            onToggleHidden={(hide) => void onToggleHidden(item, hide)}
          />
        ))}
      </section>

      <ItemDocumentsSheet
        item={openItem}
        moves={openMoves}
        open={Boolean(openItem)}
        onOpenChange={(next) => {
          if (!next) onOpenItem(null);
        }}
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
  accent,
}: {
  label: string;
  qty: number;
  unit: string;
  accent: string;
}) {
  const parts = splitQtyParts(qty, unit);
  return (
    <div className="min-w-0 rounded-xl border border-[#E5DFD3]/80 bg-white/70 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </p>
      <p
        className="mt-1 truncate text-xl font-extrabold tracking-tight tabular-nums text-zinc-900 sm:text-2xl"
        style={{ color: accent }}
        title={`${parts.value}${parts.unit ? ` ${parts.unit}` : ""}`}
      >
        {parts.value}
      </p>
      {parts.unit ? (
        <p className="mt-0.5 text-[11px] font-medium text-zinc-400">{parts.unit}</p>
      ) : null}
    </div>
  );
}

const VIRTUAL_BALANCE_CATEGORIES = new Set<InventoryCategory>([
  "zzr",
  "fertilizer",
  "parts",
]);

function InventoryItemCard({
  item,
  moves,
  qtyOutLocal,
  cacheMeta,
  selected,
  onOpen,
  onIssueToField,
  onEdit,
  onToggleHidden,
}: {
  item: InventoryItem;
  moves: ItemMove[];
  qtyOutLocal: number;
  cacheMeta?: InventoryCacheMeta;
  selected: boolean;
  onOpen: () => void;
  onIssueToField: () => void;
  onEdit: () => void;
  onToggleHidden: (hide: boolean) => void;
}) {
  const meta = INVENTORY_CATEGORY_META[item.category];
  const Icon = CATEGORY_ICONS[item.category];
  const isHarvest = item.category === "harvest";
  const useVirtual = VIRTUAL_BALANCE_CATEGORIES.has(item.category);
  const isHidden = cacheMeta?.isHidden ?? false;
  const displayName = cacheMeta?.customName?.trim() || item.name;
  const hasCustomName = Boolean(cacheMeta?.customName?.trim());

  const qtyIn = item.qtyIn;
  const virtualBalance = qtyIn - qtyOutLocal;
  const remainingPct =
    qtyIn > 0
      ? Math.max(0, Math.min(100, (virtualBalance / qtyIn) * 100))
      : 0;
  const isLow = qtyIn > 0 ? remainingPct < 20 : virtualBalance <= 0;
  const uniqueDocs = new Set(
    moves.map((m) => m.docRefKey || `${m.date}:${m.kind}:${m.cost}`)
  ).size;

  return (
    <GlassCard
      className={cn(
        "overflow-hidden border-[#E5DFD3] bg-[#FDFBF7] p-0 shadow-sm hover:translate-y-0 hover:shadow-sm",
        selected && "border-[#276749]/35 ring-1 ring-[#276749]/10",
        isHidden && "opacity-50"
      )}
    >
      <div className="relative p-4 sm:p-5">
        <div className="absolute top-3 right-3 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400",
                "outline-none transition hover:bg-white/80 hover:text-zinc-700",
                "focus-visible:ring-2 focus-visible:ring-[#276749]/20"
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
              {!isHarvest ? (
                <DropdownMenuItem
                  className="cursor-pointer gap-2 rounded-lg px-2.5 py-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onIssueToField();
                  }}
                >
                  <PackageMinus className="h-4 w-4 text-[#276749]" />
                  Списати на поле
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg px-2.5 py-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-4 w-4 text-zinc-500" />
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
                    <Eye className="h-4 w-4 text-zinc-500" />
                    Відновити на екрані
                  </>
                ) : (
                  <>
                    <EyeOff className="h-4 w-4 text-zinc-500" />
                    Приховати з екрану
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="w-full pr-8 text-left outline-none"
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}14`,
                color: meta.accent,
              }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-zinc-900">
                {displayName}
              </p>
              {hasCustomName ? (
                <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-400">
                  {item.name}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-[#E5DFD3] bg-white/70 text-[10px] text-zinc-500"
                >
                  {meta.label}
                </Badge>
                {isHidden ? (
                  <Badge
                    variant="outline"
                    className="border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400"
                  >
                    Приховано
                  </Badge>
                ) : null}
                {item.code ? (
                  <span className="text-[11px] text-zinc-400">{item.code}</span>
                ) : null}
              </div>
            </div>
          </div>

          {isHarvest ? (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <HarvestMetricTile
                label="Випуск"
                qty={item.qtyIn}
                unit={item.unit}
                accent="#B7791F"
              />
              <HarvestMetricTile
                label="Продано"
                qty={item.qtyOut}
                unit={item.unit}
                accent="#276749"
              />
            </div>
          ) : useVirtual ? (
            <>
              <div className="mt-4">
                <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                  Доступно зараз
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl",
                    virtualBalance < 0 ? "text-red-600" : "text-zinc-900"
                  )}
                >
                  {formatQtyInclZero(virtualBalance, item.unit)}
                </p>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">Залишок від приходу</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      isLow ? "text-red-600" : "text-[#276749]"
                    )}
                  >
                    {qtyIn > 0 ? `${Math.round(remainingPct)}%` : "—"}
                  </span>
                </div>
                <Progress
                  value={remainingPct}
                  className={cn(
                    "w-full gap-0",
                    isLow
                      ? "[&_[data-slot=progress-indicator]]:bg-red-500 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-red-100"
                      : "[&_[data-slot=progress-indicator]]:bg-[#276749] [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[#276749]/15"
                  )}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                <span>Прихід {formatQtyInclZero(qtyIn, item.unit)}</span>
                <span>
                  Списано {formatQtyInclZero(qtyOutLocal, item.unit)}
                </span>
                {uniqueDocs > 0 ? <span>{uniqueDocs} док. BAS</span> : null}
              </div>
            </>
          ) : (
            <div className="mt-4">
              <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                Рух за період
              </p>
              <p className="mt-0.5 text-2xl font-extrabold tracking-tight tabular-nums text-zinc-900">
                {formatQtyInclZero(item.qtyIn || item.qtyOut, item.unit)}
              </p>
              {uniqueDocs > 0 ? (
                <p className="mt-2 text-[11px] text-zinc-500">
                  {uniqueDocs} док. BAS
                </p>
              ) : null}
            </div>
          )}
        </button>
      </div>
    </GlassCard>
  );
}


function ItemDocumentsSheet({
  item,
  moves,
  open,
  onOpenChange,
}: {
  item: InventoryItem | null;
  moves: ItemMove[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kindFilter, setKindFilter] = useState<"all" | "in" | "sale">("all");

  useEffect(() => {
    setKindFilter("all");
  }, [item?.id]);

  if (!item) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-xl" />
      </Sheet>
    );
  }

  const meta = INVENTORY_CATEGORY_META[item.category];
  const Icon = CATEGORY_ICONS[item.category];
  const filtered = moves.filter((m) => {
    if (kindFilter === "sale") return m.kind === "sale";
    if (kindFilter === "in") return m.kind !== "sale";
    return true;
  });
  const uniqueDocs = new Set(
    filtered.map((m) => m.docRefKey || `${m.date}:${m.kind}:${m.cost}`)
  ).size;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 border-l border-[#E5DFD3] bg-[#FAF8F4] p-0 text-zinc-900 sm:max-w-xl",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-white/80"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-[#E5DFD3] bg-white px-6 py-5 pr-14 text-left">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `${meta.accent}14`,
                color: meta.accent,
              }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg font-bold tracking-tight text-zinc-900">
                {item.name}
              </SheetTitle>
              <SheetDescription className="mt-1 text-[12px] text-zinc-500">
                {item.code ? `${item.code} · ` : ""}
                {meta.label} · документи за обраний період
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-[#E5DFD3] bg-[#FAF8F4]/80 px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                {item.category === "harvest" ? "Випуск" : "Надходження"}
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-zinc-900">
                {formatInventoryQty(item.qtyIn, item.unit)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {formatInventoryMoney(item.costIn)}
              </p>
            </div>
            <div className="rounded-xl border border-[#E5DFD3] bg-[#FAF8F4]/80 px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                Продано
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-zinc-900">
                {formatInventoryQty(item.qtyOut, item.unit)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {formatInventoryMoney(item.costOut)}
              </p>
            </div>
          </div>
          {item.qtyOut > 0 && item.qtyIn <= 0 ? (
            <p className="mt-3 text-[11px] leading-relaxed text-amber-800/90">
              За обраний період є лише продажі. Випуск/надходження цієї позиції в
              BAS зафіксовані в інші дати — перевір сусідній сезон (часто
              врожай осені/зими потрапляє в попередній агросезон).
            </p>
          ) : null}
        </SheetHeader>

        <div className="flex shrink-0 items-center gap-2 border-b border-[#E5DFD3] bg-white px-6 py-3">
          {(
            [
              ["all", "Усі"],
              ["in", item.category === "harvest" ? "Випуск" : "Надходження"],
              ["sale", "Продажі"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKindFilter(id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition",
                kindFilter === id
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              )}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-400">
            {uniqueDocs} док.
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">
              Немає документів у цьому фільтрі
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((move, i) => {
                const canOpen = Boolean(move.docRefKey && move.docType);
                const isSale = move.kind === "sale";
                return (
                  <button
                    key={`${move.docRefKey || move.date}-${i}`}
                    type="button"
                    disabled={!canOpen}
                    onClick={() => openDocument(move)}
                    className={cn(
                      "w-full rounded-2xl border border-[#E5DFD3] bg-white px-4 py-3 text-left shadow-sm transition",
                      canOpen
                        ? "hover:border-[#276749]/35 hover:shadow-md"
                        : "opacity-80"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-zinc-900">
                            {formatUaDate(move.date)}
                            {move.docNumber ? ` · №${move.docNumber}` : ""}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              isSale
                                ? "border-amber-500/30 bg-amber-50 text-amber-800"
                                : "border-[#276749]/25 bg-[#276749]/8 text-[#276749]"
                            )}
                          >
                            {moveKindLabel(move.kind)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[12px] text-zinc-500">
                          {move.counterparty || "—"}
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-800">
                          {isSale ? "−" : "+"}
                          {formatInventoryQty(move.qty, item.unit)}
                        </p>
                        {canOpen ? (
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#276749]">
                            Відкрити накладну
                            <ExternalLink className="h-3 w-3" />
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-bold text-zinc-900">
                        {formatInventoryMoney(move.cost)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatUaDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Banknote,
  CalendarPlus,
  Droplet,
  Leaf,
  Loader2,
  Package,
  PackageMinus,
  RefreshCw,
  Sprout,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { getLiveFieldEconomics } from "@/app/admin/fields/actions";
import { updateInventoryItemUnitCost } from "@/app/admin/inventory/actions";
import { FieldBudgetTracker } from "@/components/dashboard/field-budget-tracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  LiveFieldEconomics,
  LiveFieldEconomicsCategoryKey,
  UnpricedFieldMaterial,
} from "@/lib/field-analytics";
import { formatUahCurrency } from "@/lib/fuel-price";
import { formatCountPlural } from "@/lib/plural";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

const CAT_META: Record<
  LiveFieldEconomicsCategoryKey,
  { label: string; color: string; Icon: typeof Leaf }
> = {
  zzr: { label: "ЗЗР", color: "#276749", Icon: Leaf },
  fertilizer: { label: "Добрива", color: "#C05621", Icon: Package },
  seed: { label: "Насіння", color: "#B7791F", Icon: Sprout },
  fuel: { label: "Паливо", color: "#475569", Icon: Droplet },
  salary: { label: "Зарплата", color: "#7C3AED", Icon: Banknote },
};

const CAT_ORDER: LiveFieldEconomicsCategoryKey[] = [
  "zzr",
  "fertilizer",
  "seed",
  "fuel",
  "salary",
];

function formatUah(value: number): string {
  return formatUahCurrency(value);
}

function formatUahPerHa(value: number): string {
  return `${formatUahCurrency(value)}/га`;
}

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function emptyEconomics(fieldId: string): LiveFieldEconomics {
  return {
    fieldId,
    areaHa: 0,
    totalSpentUah: 0,
    totalFuelUsed: 0,
    fuelCostUah: 0,
    dieselPriceUah: 0,
    totalSalaryUah: 0,
    plannedBudgetPerHa: null,
    totalPlannedBudget: null,
    budgetUsedPercentage: null,
    moveCount: 0,
    categoriesBreakdown: {
      zzr: { key: "zzr", label: "ЗЗР", qty: 0, unit: "", costUah: 0 },
      fertilizer: {
        key: "fertilizer",
        label: "Добрива",
        qty: 0,
        unit: "",
        costUah: 0,
      },
      seed: { key: "seed", label: "Насіння", qty: 0, unit: "", costUah: 0 },
      fuel: { key: "fuel", label: "Паливо", qty: 0, unit: "л", costUah: 0 },
      salary: {
        key: "salary",
        label: "Зарплата",
        qty: 0,
        unit: "",
        costUah: 0,
      },
    },
    recentMoves: [],
    unpricedMaterials: [],
  };
}

function EconomicsSkeleton() {
  return (
    <div
      className="space-y-5"
      aria-busy="true"
      aria-label="Завантаження економіки"
    >
      <div className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white p-5 shadow-sm">
        <Skeleton className="h-3 w-40" />
        <div className="mt-4 flex items-end justify-between gap-4">
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-7 w-24" />
        </div>
        <Skeleton className="mt-5 h-3 w-full rounded-full" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-3 w-36" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function CostStructureBar({ data }: { data: LiveFieldEconomics }) {
  const total = Math.max(
    0,
    CAT_ORDER.reduce(
      (sum, key) => sum + data.categoriesBreakdown[key].costUah,
      0
    )
  );

  if (total <= 0) {
    return (
      <div
        className="h-3 w-full rounded-full bg-zinc-100"
        role="img"
        aria-label="Немає витрат для структури"
      />
    );
  }

  return (
    <TooltipProvider delay={120}>
      <div
        className="relative flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/60"
        role="img"
        aria-label="Структура витрат за категоріями"
      >
        {CAT_ORDER.map((key) => {
          const cost = data.categoriesBreakdown[key].costUah;
          if (cost <= 0) return null;
          const pct = (cost / total) * 100;
          const pctLabel = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
          const { label, color } = CAT_META[key];

          return (
            <Tooltip key={key}>
              <TooltipTrigger
                delay={120}
                className="h-full min-w-[3px] cursor-default border-0 p-0 transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                }}
                aria-label={`${label}: ${formatUah(cost)} (${pctLabel}%)`}
              />
              <TooltipContent side="top" className="px-3 py-2">
                <p className="font-semibold tracking-tight">{label}</p>
                <p className="mt-0.5 tabular-nums text-white/85">
                  {formatUah(cost)} · {pctLabel}%
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function formatQtyShort(qty: number, unit: string): string {
  return formatQty(qty, unit);
}

function UnpricedCategoryPopover({
  categoryLabel,
  items,
  onSaved,
}: {
  categoryLabel: string;
  items: UnpricedFieldMaterial[];
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setDrafts(
      Object.fromEntries(items.map((item) => [item.basRefKey, ""]))
    );
  }, [open, items]);

  function saveItem(item: UnpricedFieldMaterial) {
    const raw = (drafts[item.basRefKey] ?? "").replace(/\s/g, "").replace(",", ".");
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Вкажіть коректну ціну");
      return;
    }

    setSavingKey(item.basRefKey);
    startTransition(async () => {
      const res = await updateInventoryItemUnitCost({
        basRefKey: item.basRefKey,
        unitCost: price,
      });
      setSavingKey(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Ціну збережено · ${item.name}`);
      onSaved?.();
      if (items.length <= 1) {
        setOpen(false);
      }
    });
  }

  if (items.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="ml-1 font-semibold text-orange-600 underline-offset-2 hover:text-orange-700 hover:underline"
      >
        Встановити ціну
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 p-3">
        <PopoverHeader className="mb-2">
          <PopoverTitle className="text-sm font-bold text-zinc-900">
            {categoryLabel} без ціни
          </PopoverTitle>
          <p className="text-[11px] text-zinc-500">
            Планова ціна за одиницю для розрахунку собівартості поля.
          </p>
        </PopoverHeader>
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {items.map((item) => {
            const unitSuffix = item.unit.trim() || "од.";
            const isSaving = pending && savingKey === item.basRefKey;
            return (
              <li
                key={item.basRefKey}
                className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-2.5"
              >
                <p className="truncate text-[12px] font-semibold text-zinc-800">
                  {item.name}
                </p>
                <p className="mt-0.5 text-[10px] tabular-nums text-zinc-500">
                  Списано: {formatQtyShort(item.totalQty, item.unit)}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      inputMode="decimal"
                      value={drafts[item.basRefKey] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.basRefKey]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveItem(item);
                        }
                      }}
                      placeholder="0"
                      className="h-11 pr-14 text-base tabular-nums md:h-8 md:text-xs"
                      disabled={isSaving}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-zinc-400">
                      ₴/{unitSuffix}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => saveItem(item)}
                    className="h-8 shrink-0 bg-[#276749] px-2.5 text-[11px] text-white hover:bg-[#22543d]"
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Зберегти"
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CostLegend({
  data,
  onReload,
}: {
  data: LiveFieldEconomics;
  onReload?: () => void;
}) {
  const unpricedByCategory = useMemo(() => {
    const map: Record<"zzr" | "fertilizer" | "seed", UnpricedFieldMaterial[]> = {
      zzr: [],
      fertilizer: [],
      seed: [],
    };
    for (const item of data.unpricedMaterials) {
      map[item.category].push(item);
    }
    return map;
  }, [data.unpricedMaterials]);

  return (
    <ul className="mt-3.5 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-100/90 bg-white/75">
      {CAT_ORDER.map((key) => {
        const cat = data.categoriesBreakdown[key];
        const { Icon, color, label } = CAT_META[key];
        const qtyLabel =
          key === "fuel"
            ? cat.qty > 0
              ? `${formatQty(cat.qty, "л")}${
                  data.dieselPriceUah > 0
                    ? ` · ${formatUahCurrency(data.dieselPriceUah, { precise: true })}/л`
                    : ""
                }`
              : data.dieselPriceUah > 0
                ? `${formatUahCurrency(data.dieselPriceUah, { precise: true })}/л`
                : "0 л"
            : key === "salary"
              ? cat.qty > 0
                ? formatQty(cat.qty, cat.unit || "наряди")
                : null
              : cat.qty > 0
                ? formatQty(cat.qty, cat.unit)
                : null;
        const needsPrice =
          cat.qty > 0 &&
          cat.costUah <= 0 &&
          (key === "zzr" || key === "fertilizer" || key === "seed");
        const unpricedItems =
          key === "zzr" || key === "fertilizer" || key === "seed"
            ? unpricedByCategory[key]
            : [];

        return (
          <li
            key={key}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}18`, color }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-800">{label}</p>
                {qtyLabel ? (
                  <p className="text-[11px] tabular-nums text-zinc-400">
                    {qtyLabel}
                    {needsPrice && unpricedItems.length > 0 ? (
                      <UnpricedCategoryPopover
                        categoryLabel={label}
                        items={unpricedItems}
                        onSaved={onReload}
                      />
                    ) : null}
                  </p>
                ) : needsPrice && unpricedItems.length > 0 ? (
                  <p className="text-[11px]">
                    <UnpricedCategoryPopover
                      categoryLabel={label}
                      items={unpricedItems}
                      onSaved={onReload}
                    />
                  </p>
                ) : null}
              </div>
            </div>
            <p className="shrink-0 text-[13px] font-bold tabular-nums text-zinc-900">
              {formatUah(cat.costUah)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function EconomicsEmptyState({
  onQuickIssue,
  onAddPastOperation,
}: {
  onQuickIssue?: () => void;
  onAddPastOperation?: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-[#C9D4CA] bg-gradient-to-br from-white via-[#F8FAF8] to-[#EEF4EF] px-5 py-8 text-center shadow-sm">
      <div
        className="pointer-events-none absolute -top-10 -right-8 h-32 w-32 rounded-full bg-[#276749]/10 blur-2xl"
        aria-hidden
      />
      <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#276749]/10 text-[#276749]">
        <Wallet className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <p className="relative mt-4 text-base font-bold tracking-tight text-zinc-900">
        Економіка не сформована
      </p>
      <p className="relative mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-600">
        Витрат у цьому сезоні ще не зафіксовано. Додайте списання ТМЦ або
        закритий наряд — тоді тут зʼявиться собівартість і структура витрат.
      </p>
      <div className="relative mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {onQuickIssue ? (
          <button
            type="button"
            onClick={onQuickIssue}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#276749]/25 bg-white px-4 text-sm font-semibold text-[#276749] shadow-sm transition-colors hover:bg-[#276749]/5"
          >
            <PackageMinus className="h-4 w-4" />
            Списати ТМЦ
          </button>
        ) : null}
        {onAddPastOperation ? (
          <button
            type="button"
            onClick={onAddPastOperation}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#276749] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#22543d]"
          >
            <CalendarPlus className="h-4 w-4" />
            Внести виконану роботу
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Один fetch на відкриття sheet + ре-фетч при Realtime / ручному reload. */
export function useLiveFieldEconomics(
  farmFieldId: string | null,
  enabled: boolean,
  /** Інкремент з useFieldRealtime — жорстко перезавантажує економіку */
  realtimeVersion = 0
) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LiveFieldEconomics | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!farmFieldId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    const res = await getLiveFieldEconomics(farmFieldId, activeSeason);
    if (requestId !== requestRef.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, [farmFieldId, activeSeason]);

  useEffect(() => {
    if (!enabled || !farmFieldId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    void reload();
  }, [enabled, farmFieldId, activeSeason, realtimeVersion, reload]);

  return { loading, error, data, reload, setData };
}

export type LiveFieldEconomicsPanelProps = {
  farmFieldId: string | null;
  areaHa: number;
  loading?: boolean;
  error?: string | null;
  data?: LiveFieldEconomics | null;
  onRetry?: () => void;
  onDataChange?: (next: LiveFieldEconomics) => void;
  onQuickIssue?: () => void;
  onAddPastOperation?: () => void;
  className?: string;
};

export function LiveFieldEconomicsPanel({
  farmFieldId,
  areaHa,
  loading = false,
  error = null,
  data = null,
  onRetry,
  onDataChange,
  onQuickIssue,
  onAddPastOperation,
  className,
}: LiveFieldEconomicsPanelProps) {
  if (!farmFieldId) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-10 text-center",
          className
        )}
      >
        <Wallet className="mx-auto h-8 w-8 text-zinc-300" />
        <p className="mt-3 text-sm font-semibold text-zinc-800">
          Немає паспорта поля
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Привʼяжіть ділянку до реєстру, щоб бачити операційну собівартість зі
          складу.
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className={className}>
        <EconomicsSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950",
          className
        )}
      >
        <p className="font-semibold">Не вдалося завантажити економіку</p>
        <p className="mt-1 text-amber-900/80">{error}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-2 hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Спробувати знову
          </button>
        ) : null}
      </div>
    );
  }

  const economics = data ?? emptyEconomics(farmFieldId);
  const effectiveArea =
    economics.areaHa > 0 ? economics.areaHa : areaHa > 0 ? areaHa : 0;
  const perHa =
    effectiveArea > 0
      ? Math.round(economics.totalSpentUah / effectiveArea)
      : null;

  const budgetBlock =
    farmFieldId && onDataChange ? (
      <FieldBudgetTracker
        fieldId={farmFieldId}
        economics={
          economics.areaHa > 0
            ? economics
            : { ...economics, areaHa: effectiveArea }
        }
        onEconomicsChange={onDataChange}
      />
    ) : null;

  // Списання без ціни дають totalSpent=0, але це не «порожня» економіка
  const isEmptyEconomics =
    economics.moveCount <= 0 &&
    economics.totalSpentUah <= 0 &&
    economics.unpricedMaterials.length === 0;

  if (isEmptyEconomics) {
    return (
      <div className={cn("space-y-5", className)}>
        <EconomicsEmptyState
          onQuickIssue={onQuickIssue}
          onAddPastOperation={onAddPastOperation}
        />
        {budgetBlock}
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      <section className="relative overflow-hidden rounded-2xl border border-[#E5DFD3] bg-gradient-to-br from-white via-[#FDFBF7] to-[#F0EBE3] p-5 shadow-sm">
        <div
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-[#276749]/8 blur-2xl"
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#276749]/10 text-[#276749]">
              <Wallet className="h-3.5 w-3.5" />
            </span>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
              Операційна собівартість
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-extrabold tracking-tight tabular-nums text-zinc-900 sm:text-4xl">
                {formatUah(economics.totalSpentUah)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {economics.moveCount > 0
                  ? `${formatCountPlural(economics.moveCount, ["подія", "події", "подій"])} · ТМЦ, паливо, ЗП`
                  : "Ще немає списань і закритих нарядів"}
              </p>
            </div>
            <div className="rounded-xl border border-[#276749]/20 bg-[#276749]/8 px-3.5 py-2 text-right">
              <p className="text-[10px] font-medium tracking-wider text-[#276749]/80 uppercase">
                На площу
              </p>
              <p className="text-lg font-extrabold tabular-nums text-[#276749]">
                {perHa != null ? formatUahPerHa(perHa) : "—"}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <CostStructureBar data={economics} />
            <CostLegend data={economics} onReload={onRetry} />
          </div>
        </div>
      </section>

      {budgetBlock}
    </div>
  );
}

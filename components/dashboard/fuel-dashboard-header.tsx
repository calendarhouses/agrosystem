"use client";

import {
  ArrowRightLeft,
  ChevronDown,
  Fuel,
  Info,
  Loader2,
  Plus,
  Tractor,
  Warehouse,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import type {
  FieldFuelBreakdownRow,
  FieldFuelPeriod,
} from "@/app/fuel/actions";
import type { FleetFuelConsumedBreakdownRow } from "@/lib/wialon-equipment-day-sync";
import { FuelRefuelRadar } from "@/components/dashboard/fuel-refuel-radar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { FuelStorage } from "@/lib/fuel-storages";
import { useFuelLoadProgress } from "@/lib/fuel-kpi-load-progress";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

function formatLiters(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

const FIELD_FUEL_PERIODS: Array<{ id: FieldFuelPeriod; label: string }> = [
  { id: "today", label: "Сьогодні" },
  { id: "yesterday", label: "Вчора" },
  { id: "week", label: "7 днів" },
  { id: "month", label: "Місяць" },
  { id: "season", label: "Сезон" },
];

function fieldFuelPeriodCaption(period: FieldFuelPeriod): string {
  if (period === "yesterday") return "вчора";
  if (period === "week") return "7 днів";
  if (period === "month") return "місяць";
  if (period === "season") return "сезон";
  return "сьогодні";
}

type RefuelBreakdownRow = {
  equipmentName: string;
  liters: number;
  wialonUnitId: number | null;
  source?: "wialon" | "manual" | "mixed" | "delivery" | "overnight" | "correction";
};

type FuelDashboardHeaderProps = {
  storages: FuelStorage[];
  totalLiters: number;
  totalValue: number;
  /** Залишок складів за обраний період (null → live totalLiters) */
  periodStorageLiters?: number | null;
  periodStorageValue?: number | null;
  periodStorageLive?: boolean;
  live: boolean;
  fieldFuelLiters: number | null;
  /** Спалено всією технікою: поля + дорога + база */
  fieldFuelTotalLiters: number | null;
  fieldFuelHasData: boolean;
  fieldFuelLoading: boolean;
  fieldFuelPeriod: FieldFuelPeriod;
  fieldFuelBreakdown: FieldFuelBreakdownRow[];
  fleetFuelBreakdown?: FleetFuelConsumedBreakdownRow[];
  fieldFuelCoverage?: {
    daysCovered: number;
    daysExpected: number;
    incomplete: boolean;
    progressPct?: number;
  } | null;
  /** Спільна оцінка часу KPI з сервера (для шкали у всіх) */
  kpiExpectedLoadMs?: number | null;
  refuelLiters: number | null;
  refuelHasData: boolean;
  refuelLoading: boolean;
  refuelBreakdown: RefuelBreakdownRow[];
  /** Паливо в баках тракторів на початок / кінець періоду (ДУТ) */
  openingTankLiters?: number | null;
  closingTankLiters?: number | null;
  refuelDutLiters?: number | null;
  refuelDispensedLiters?: number | null;
  refuelOvernightLiters?: number | null;
  onFieldFuelPeriodChange: (period: FieldFuelPeriod) => void;
  onPurchase: () => void;
  onTransfer: () => void;
  onRefuel: () => void;
  onRadarApproved: () => void;
};

function KpiBreakdownList({
  emptyLabel,
  rows,
  embedded = false,
}: {
  emptyLabel: string;
  rows: Array<{ title: string; subtitle?: string; liters: number }>;
  /** Без власного скролу — прокручує батьківський контейнер попапу */
  embedded?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-center text-xs text-zinc-400">{emptyLabel}</p>
    );
  }
  return (
    <ul
      className={cn(
        "space-y-0.5 pr-0.5",
        !embedded &&
          "desktop-scrollbar max-h-[min(40vh,16rem)] overflow-y-auto overscroll-contain"
      )}
    >
      {rows.map((row, index) => (
        <li
          key={`${row.title}-${row.subtitle ?? ""}-${index}`}
          className="flex items-start justify-between gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-[#F4F1EA]/90"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-zinc-900">
              {row.title}
            </p>
            {row.subtitle ? (
              <p className="truncate text-[11px] text-zinc-500">{row.subtitle}</p>
            ) : null}
          </div>
          <p className="shrink-0 text-[13px] font-bold tabular-nums text-zinc-900">
            {formatLiters(row.liters)}{" "}
            <span className="text-[10px] font-semibold text-zinc-400">л</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function PeriodSelect({
  period,
  onChange,
}: {
  period: FieldFuelPeriod;
  onChange: (period: FieldFuelPeriod) => void;
}) {
  const label =
    FIELD_FUEL_PERIODS.find((p) => p.id === period)?.label ?? "Сьогодні";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full px-3",
          "border border-[#E5DFD3]/90 bg-white/90 text-[12px] font-semibold text-zinc-700",
          "shadow-sm outline-none transition",
          "hover:border-[#D9D2C4] hover:bg-white hover:text-zinc-900",
          "focus-visible:ring-2 focus-visible:ring-emerald-500/20"
        )}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2.2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[9rem] rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-lg"
      >
        {FIELD_FUEL_PERIODS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className={cn(
              "cursor-pointer rounded-lg px-2.5 py-2 text-sm",
              period === option.id && "bg-emerald-50 font-semibold text-emerald-900"
            )}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const kpiDetailSurfaceClass = cn(
  "overflow-hidden rounded-2xl border border-[#E5DFD3]/90 text-zinc-900",
  "bg-[linear-gradient(180deg,#ffffff_0%,#FBF9F5_55%,#F4F1EA_100%)]",
  "shadow-[0_18px_48px_-16px_rgba(39,33,24,0.35),0_0_0_1px_rgba(255,255,255,0.7)_inset]"
);

function KpiDetailPanel({
  popoverTitle,
  popoverDescription,
  breakdownEmpty,
  breakdownRows,
  popoverFooter,
  onClose,
}: {
  popoverTitle: string;
  popoverDescription: string;
  breakdownEmpty: string;
  breakdownRows: Array<{ title: string; subtitle?: string; liters: number }>;
  popoverFooter?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex shrink-0 items-start gap-3 border-b border-[#E5DFD3]/70 px-3.5 py-3 pr-12">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#276749]/12 text-[#276749] shadow-sm ring-1 ring-[#276749]/10">
          <Fuel className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-bold tracking-tight text-zinc-900">
            {popoverTitle}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {popoverDescription}
          </p>
        </div>
        <button
          type="button"
          aria-label="Закрити"
          onClick={onClose}
          className={cn(
            "absolute top-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full",
            "bg-white/90 text-zinc-400 shadow-sm ring-1 ring-[#E5DFD3]/90",
            "transition hover:bg-white hover:text-zinc-700"
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y"
        data-allow-pan="true"
      >
        <div className="px-2 py-2">
          <KpiBreakdownList
            embedded
            emptyLabel={breakdownEmpty}
            rows={breakdownRows}
          />
        </div>
        {popoverFooter ? (
          <div className="border-t border-[#E5DFD3]/70 px-3.5 py-3 text-[11px] leading-relaxed text-zinc-600">
            {popoverFooter}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiValue({
  liters,
  loading,
  empty,
  interactive,
  popoverTitle,
  popoverDescription,
  breakdownEmpty,
  breakdownRows,
  popoverFooter,
  accentClass,
}: {
  liters: number | null;
  loading: boolean;
  empty: boolean;
  interactive: boolean;
  popoverTitle: string;
  popoverDescription: string;
  breakdownEmpty: string;
  breakdownRows: Array<{ title: string; subtitle?: string; liters: number }>;
  popoverFooter?: ReactNode;
  accentClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <div className="flex h-10 items-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (empty) {
    return (
      <p className="max-w-[14rem] text-sm font-medium leading-snug text-zinc-400">
        {breakdownEmpty}
      </p>
    );
  }

  const value = (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5",
        interactive &&
          "rounded-xl px-1.5 py-0.5 -mx-1.5 transition hover:bg-zinc-100/90"
      )}
    >
      <span
        className={cn(
          "text-[1.75rem] font-bold tracking-tight tabular-nums leading-none sm:text-[2rem]",
          accentClass ?? "text-zinc-950"
        )}
      >
        {formatLiters(liters ?? 0)}
      </span>
      <span className="text-sm font-semibold text-zinc-400">л</span>
      {interactive ? (
        <Info
          className="mb-0.5 h-3.5 w-3.5 shrink-0 text-zinc-300 transition group-hover:text-zinc-500"
          strokeWidth={2}
        />
      ) : null}
    </span>
  );

  if (!interactive) return value;

  const triggerClassName = cn(
    "group inline-flex text-left outline-none",
    "focus-visible:ring-2 focus-visible:ring-emerald-500/20 rounded-xl"
  );

  const detailPanel = (
    <KpiDetailPanel
      popoverTitle={popoverTitle}
      popoverDescription={popoverDescription}
      breakdownEmpty={breakdownEmpty}
      breakdownRows={breakdownRows}
      popoverFooter={popoverFooter}
      onClose={() => setOpen(false)}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={triggerClassName}>{value}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            "gap-0 rounded-t-[1.25rem] border-x-0 border-t border-[#E5DFD3]/90 p-0",
            kpiDetailSurfaceClass
          )}
        >
          {detailPanel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className={triggerClassName}>
        {value}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        data-vaul-no-drag=""
        className={cn(
          "z-[270] flex w-[min(calc(100vw-1.5rem),20.5rem)] min-w-0 max-h-(--available-height) flex-col gap-0 overflow-hidden rounded-2xl p-0",
          kpiDetailSurfaceClass
        )}
      >
        {detailPanel}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Energy Header + Command Bar для /fuel */
export function FuelDashboardHeader({
  storages,
  totalLiters,
  totalValue,
  periodStorageLiters = null,
  periodStorageValue = null,
  periodStorageLive = true,
  live,
  fieldFuelLiters,
  fieldFuelTotalLiters,
  fieldFuelHasData,
  fieldFuelLoading,
  fieldFuelPeriod,
  fieldFuelBreakdown,
  fleetFuelBreakdown = [],
  fieldFuelCoverage,
  kpiExpectedLoadMs = null,
  refuelLiters,
  refuelHasData,
  refuelLoading,
  refuelBreakdown,
  openingTankLiters = null,
  closingTankLiters = null,
  refuelDutLiters = null,
  refuelDispensedLiters = null,
  refuelOvernightLiters = null,
  onFieldFuelPeriodChange,
  onPurchase,
  onTransfer,
  onRefuel,
  onRadarApproved,
}: FuelDashboardHeaderProps) {
  const periodLabel =
    FIELD_FUEL_PERIODS.find((p) => p.id === fieldFuelPeriod)?.label ??
    "Сьогодні";

  const displayStorageLiters =
    periodStorageLiters != null ? periodStorageLiters : totalLiters;
  const displayStorageValue =
    periodStorageValue != null ? periodStorageValue : totalValue;
  const storageIsLive =
    periodStorageLive && (fieldFuelPeriod === "today" || live);

  // Показуємо всю витрату флоту: інакше «Спалено» непорівнянне із «Заправлено»,
  // бо заправляють і те паливо, що йде на переїзди та роботу на базі.
  const burnedTotal = fieldFuelTotalLiters ?? fieldFuelLiters;
  const onFieldListed = fieldFuelBreakdown.reduce(
    (acc, row) => acc + row.liters,
    0
  );
  const onFieldResidual =
    fieldFuelLiters != null
      ? Math.max(0, Math.round((fieldFuelLiters - onFieldListed) * 10) / 10)
      : 0;
  const offFieldLiters =
    fieldFuelTotalLiters != null && fieldFuelLiters != null
      ? Math.max(0, Math.round((fieldFuelTotalLiters - fieldFuelLiters) * 10) / 10)
      : null;

  const onFieldByUnit = new Map<number, number>();
  for (const row of fieldFuelBreakdown) {
    if (row.wialonUnitId == null) continue;
    onFieldByUnit.set(
      row.wialonUnitId,
      (onFieldByUnit.get(row.wialonUnitId) ?? 0) + row.liters
    );
  }

  const offFieldRows =
    fleetFuelBreakdown.length > 0
      ? fleetFuelBreakdown
          .map((unit) => {
            const onField = onFieldByUnit.get(unit.wialonUnitId) ?? 0;
            const off = Math.round((unit.liters - onField) * 10) / 10;
            if (off <= 0.5) return null;
            return {
              title: unit.equipmentName,
              subtitle: "поза полями · переїзди, база, холостий",
              liters: off,
            };
          })
          .filter(
            (
              row
            ): row is {
              title: string;
              subtitle: string;
              liters: number;
            } => row != null
          )
      : offFieldLiters != null && offFieldLiters > 0.5
        ? [
            {
              title: "Поза полями",
              subtitle: "переїзди, база, холостий хід",
              liters: offFieldLiters,
            },
          ]
        : [];

  const burnedRows = [
    ...fieldFuelBreakdown.map((row) => ({
      title: row.equipmentName,
      subtitle: row.fieldName,
      liters: row.liters,
    })),
    ...(onFieldResidual > 1
      ? [
          {
            title: "Інші записи на полях",
            subtitle: "дрібні сесії, не зведені в рядки вище",
            liters: onFieldResidual,
          },
        ]
      : []),
    ...offFieldRows,
  ];
  const fleetBurnRows =
    fleetFuelBreakdown.length > 0
      ? fleetFuelBreakdown.map((unit) => ({
          title: unit.equipmentName,
          subtitle: "витрата ДВЗ · ДУТ",
          liters: unit.liters,
        }))
      : burnedRows;

  const burnGapLiters =
    burnedTotal != null && refuelLiters != null
      ? Math.round((burnedTotal - refuelLiters) * 10) / 10
      : null;

  const burnPopoverFooter = (
    <div className="space-y-2.5">
      <p>
        <span className="font-semibold text-zinc-800">Спалено</span> — скільки
        палива пішло в роботу: що було в баках + заливки − залишок на кінець
        періоду. Рахуємо окремо по кожному трактору (Wialon).
      </p>
      {(refuelDutLiters != null && refuelDutLiters > 0) ||
      (refuelOvernightLiters != null && refuelOvernightLiters > 0) ||
      (refuelDispensedLiters != null && refuelDispensedLiters > 0) ? (
        <div className="space-y-1 rounded-xl bg-white/70 px-2.5 py-2 ring-1 ring-[#E5DFD3]/80">
          <p className="font-semibold text-zinc-800">
            Щоб звірити з «Заправлено»
          </p>
          {refuelDutLiters != null && refuelDutLiters > 0 ? (
            <p>
              Залили вдень:{" "}
              <span className="font-bold tabular-nums text-zinc-900">
                {formatLiters(refuelDutLiters)} л
              </span>
            </p>
          ) : null}
          {refuelOvernightLiters != null && refuelOvernightLiters > 0 ? (
            <p>
              Залили вночі в полі:{" "}
              <span className="font-bold tabular-nums text-zinc-900">
                {formatLiters(refuelOvernightLiters)} л
              </span>
            </p>
          ) : null}
          {refuelDispensedLiters != null && refuelDispensedLiters > 0 ? (
            <p>
              Бензовоз роздав ≈{" "}
              <span className="font-bold tabular-nums text-zinc-900">
                {formatLiters(refuelDispensedLiters)} л
              </span>{" "}
              <span className="text-zinc-500">
                (падіння рівня в цистерні, не в бак трактора)
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      {openingTankLiters != null && openingTankLiters > 0 ? (
        <p>
          У баках усього парку:{" "}
          <span className="font-bold tabular-nums text-zinc-900">
            ≈ {formatLiters(openingTankLiters)} л
          </span>{" "}
          на початок
          {closingTankLiters != null && closingTankLiters > 0 ? (
            <>
              {" "}
              →{" "}
              <span className="font-bold tabular-nums text-zinc-900">
                ≈ {formatLiters(closingTankLiters)} л
              </span>{" "}
              на кінець
            </>
          ) : null}
        </p>
      ) : null}
      {burnGapLiters != null && burnGapLiters > 200 ? (
        <p className="text-zinc-500">
          Спалено на {formatLiters(burnGapLiters)} л більше, ніж залито — це
          нормально, якщо частина палива вже була в баках на початку періоду.
        </p>
      ) : null}
    </div>
  );

  const refuelRows = refuelBreakdown
    .filter((row) => row.source !== "delivery")
    .map((row) => ({
    title: row.equipmentName,
    subtitle:
      row.source === "overnight"
        ? "заливка вночі в полі"
        : row.source === "correction"
          ? "корекція з радара"
          : row.source === "manual"
          ? "журнал"
          : row.source === "mixed"
            ? "ДУТ + журнал"
            : "заливка вдень",
    liters: row.liters,
  }));

  const displayProgressPct = useFuelLoadProgress({
    loading: fieldFuelLoading || refuelLoading,
    // Довантаження відсутніх днів у фоні не тримає смужку, якщо KPI вже на екрані
    incomplete:
      Boolean(fieldFuelCoverage?.incomplete) &&
      !fieldFuelHasData &&
      fieldFuelLiters == null,
    period: fieldFuelPeriod,
    sharedExpectedMs: kpiExpectedLoadMs,
  });

  const showProgress =
    fieldFuelLoading ||
    refuelLoading ||
    (Boolean(fieldFuelCoverage?.incomplete) &&
      !fieldFuelHasData &&
      fieldFuelLiters == null) ||
    displayProgressPct != null;

  const isMobile = useIsMobile();

  const progressBar =
    showProgress ? (
      <div className="space-y-1.5 px-1">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-500">
          <span>Завантаження…</span>
          <span className="tabular-nums text-zinc-700">
            {displayProgressPct != null ? `${displayProgressPct}%` : "…"}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#E5DFD3]/90">
          <div
            className={cn(
              "h-full rounded-full bg-[#276749] transition-[width] duration-100 ease-linear",
              displayProgressPct == null && "animate-pulse"
            )}
            style={{
              width:
                displayProgressPct != null
                  ? `${Math.max(2, displayProgressPct)}%`
                  : "8%",
            }}
          />
        </div>
      </div>
    ) : null;

  const kpiStrip = (
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-[#E5DFD3]/90",
          "bg-gradient-to-br from-white via-[#F4F1EA]/90 to-emerald-50/50",
          "shadow-[0_1px_0_rgba(255,255,255,0.85)_inset,0_8px_28px_-12px_rgba(39,33,24,0.12)]"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
        />

        <div className="grid grid-cols-1 divide-y divide-[#E5DFD3]/80 md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="flex min-h-[6.5rem] flex-col justify-between gap-2.5 p-4 sm:min-h-[7.25rem] sm:gap-3 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                <Warehouse className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
                Усього на складах
              </p>
              {storageIsLive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-600/15">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  LIVE
                </span>
              ) : (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-zinc-500 ring-1 ring-zinc-200/80">
                  {periodLabel}
                </span>
              )}
            </div>

            {storages.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Немає складів
              </p>
            ) : fieldFuelLoading && periodStorageLiters == null && fieldFuelPeriod !== "today" ? (
              <div className="flex h-10 items-center">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : (
              <div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[1.75rem] font-bold tracking-tight tabular-nums leading-none text-zinc-950 sm:text-[2rem]">
                    {formatLiters(displayStorageLiters)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-400">л</span>
                </p>
                <p className="mt-1.5 text-[13px] font-medium tabular-nums text-zinc-500 sm:mt-2">
                  ≈ {formatMoney(displayStorageValue)}{" "}
                  <span className="text-zinc-400">₴</span>
                  {!storageIsLive ? (
                    <span className="ml-1.5 text-[11px] text-zinc-400">
                      · на кінець періоду
                    </span>
                  ) : null}
                </p>
              </div>
            )}
          </div>

          <div className="flex min-h-[6.5rem] flex-col justify-between gap-2.5 p-4 sm:min-h-[7.25rem] sm:gap-3 sm:p-6">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
              <Tractor className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
              Спалено технікою
            </p>
            <div>
              <KpiValue
                liters={burnedTotal}
                loading={fieldFuelLoading}
                empty={
                  !fieldFuelLoading &&
                  (burnedTotal ?? 0) <= 0 &&
                  !fieldFuelCoverage?.incomplete
                }
                interactive={fieldFuelHasData && !fieldFuelLoading}
                popoverTitle="Хто скільки спалив"
                popoverDescription={`Витрата ДВЗ · ДУТ Wialon · ${periodLabel.toLowerCase()}`}
                breakdownEmpty={`Немає даних за ${fieldFuelPeriodCaption(fieldFuelPeriod)}`}
                breakdownRows={fleetBurnRows}
                popoverFooter={burnPopoverFooter}
                accentClass="text-amber-950"
              />
              <p className="mt-1.5 text-[12px] font-medium text-zinc-400 sm:mt-2">
                {periodLabel}
                {!fieldFuelLoading &&
                fieldFuelLiters != null &&
                burnedTotal != null ? (
                  <span className="ml-1.5 text-zinc-500">
                    · на полях {formatLiters(fieldFuelLiters)} л
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex min-h-[6.5rem] flex-col justify-between gap-2.5 p-4 sm:min-h-[7.25rem] sm:gap-3 sm:p-6">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
              <Fuel className="h-3.5 w-3.5 text-sky-600" strokeWidth={2} />
              Заправлено
            </p>
            <div>
              <KpiValue
                liters={refuelLiters}
                loading={refuelLoading}
                empty={!refuelLoading && (refuelLiters ?? 0) <= 0}
                interactive={refuelHasData && !refuelLoading}
                popoverTitle="Кому заправили"
                popoverDescription={`Заливки в баки тракторів · ${periodLabel.toLowerCase()}`}
                breakdownEmpty={`Немає заправок за ${fieldFuelPeriodCaption(fieldFuelPeriod)}`}
                breakdownRows={refuelRows}
                accentClass="text-sky-950"
              />
              <p className="mt-1.5 text-[12px] font-medium text-zinc-400 sm:mt-2">
                {periodLabel}
              </p>
            </div>
          </div>
        </div>

        {progressBar ? (
          <div className="border-t border-[#E5DFD3]/80 px-4 py-3 sm:px-6">
            {progressBar}
          </div>
        ) : null}
      </div>
  );

  if (isMobile) {
    return (
      <header className="relative mb-3 flex flex-col gap-3 px-4 pt-3">
        <div
          className={cn(
            "inline-flex w-full rounded-2xl border border-[#E5DFD3]/90 bg-white/80 p-1 shadow-sm",
            "backdrop-blur-sm"
          )}
          role="tablist"
          aria-label="Період KPI"
        >
          {FIELD_FUEL_PERIODS.map((option) => {
            const active = fieldFuelPeriod === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onFieldFuelPeriodChange(option.id)}
                className={cn(
                  "min-h-9 flex-1 rounded-xl px-1 text-[11px] font-bold transition-all sm:px-2 sm:text-[12px]",
                  active
                    ? "bg-[#276749] text-white shadow-sm shadow-emerald-900/20"
                    : "text-zinc-500 hover:text-zinc-800"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {kpiStrip}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onPurchase}
            className="flex items-center gap-2.5 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white px-3 py-3 text-left shadow-sm active:scale-[0.98]"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <Plus className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-emerald-950">
                Закупівля
              </span>
              <span className="block truncate text-[10px] font-medium text-emerald-800/70">
                Прихід на базу
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onTransfer}
            className="flex items-center gap-2.5 rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50 to-white px-3 py-3 text-left shadow-sm active:scale-[0.98]"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
              <ArrowRightLeft className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-sky-950">
                Переміщення
              </span>
              <span className="block truncate text-[10px] font-medium text-sky-800/70">
                На бензовоз
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onRefuel}
            className="flex items-center gap-2.5 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-white px-3 py-3 text-left shadow-sm active:scale-[0.98]"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Fuel className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-amber-950">
                Заправка
              </span>
              <span className="block truncate text-[10px] font-medium text-amber-900/70">
                На техніку
              </span>
            </span>
          </button>
          <FuelRefuelRadar
            variant="commandBar"
            className="min-w-0"
            storages={storages}
            onApproved={onRadarApproved}
          />
        </div>
      </header>
    );
  }

  return (
    <header className="relative mb-3 flex flex-col gap-4 px-4 py-5 sm:mb-4 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            Облік Палива
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Управління дизельними активами
          </p>
        </div>
        <PeriodSelect
          period={fieldFuelPeriod}
          onChange={onFieldFuelPeriodChange}
        />
      </div>

      {kpiStrip}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            type="button"
            onClick={onPurchase}
            className={cn(
              "h-auto min-h-14 flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3",
              "border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white",
              "text-left text-emerald-950 shadow-sm",
              "hover:from-emerald-100/80 hover:to-white hover:shadow-md"
            )}
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
              Закупівля
            </span>
            <span className="pl-9 text-[11px] font-medium text-emerald-800/70">
              Прихід на базу
            </span>
          </Button>

          <Button
            type="button"
            onClick={onTransfer}
            className={cn(
              "h-auto min-h-14 flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3",
              "border border-sky-200/70 bg-gradient-to-br from-sky-50 to-white",
              "text-left text-sky-950 shadow-sm",
              "hover:from-sky-100/80 hover:to-white hover:shadow-md"
            )}
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
                <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              Переміщення
            </span>
            <span className="pl-9 text-[11px] font-medium text-sky-800/70">
              Цистерни → бензовоз
            </span>
          </Button>

          <Button
            type="button"
            onClick={onRefuel}
            className={cn(
              "h-auto min-h-14 flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3",
              "border border-amber-200/70 bg-gradient-to-br from-amber-50 to-white",
              "text-left text-amber-950 shadow-sm",
              "hover:from-amber-100/80 hover:to-white hover:shadow-md"
            )}
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
                <Fuel className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              Заправка
            </span>
            <span className="pl-9 text-[11px] font-medium text-amber-900/70">
              Списання на техніку
            </span>
          </Button>
        </div>

        <div className="flex items-stretch sm:min-w-[11rem]">
          <FuelRefuelRadar
            variant="commandBar"
            className="flex w-full flex-1"
            storages={storages}
            onApproved={onRadarApproved}
          />
        </div>
      </div>
    </header>
  );
}

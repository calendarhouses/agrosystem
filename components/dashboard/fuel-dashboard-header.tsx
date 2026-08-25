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
} from "lucide-react";

import type {
  FieldFuelBreakdownRow,
  FieldFuelPeriod,
} from "@/app/fuel/actions";
import { FuelRefuelRadar } from "@/components/dashboard/fuel-refuel-radar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FuelStorage } from "@/lib/fuel-storages";
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
];

function fieldFuelPeriodCaption(period: FieldFuelPeriod): string {
  if (period === "yesterday") return "вчора";
  if (period === "week") return "за 7 днів";
  if (period === "month") return "за місяць";
  return "сьогодні";
}

type RefuelBreakdownRow = {
  equipmentName: string;
  liters: number;
  wialonUnitId: number | null;
};

type FuelDashboardHeaderProps = {
  storages: FuelStorage[];
  totalLiters: number;
  totalValue: number;
  live: boolean;
  fieldFuelLiters: number | null;
  fieldFuelHasData: boolean;
  fieldFuelLoading: boolean;
  fieldFuelPeriod: FieldFuelPeriod;
  fieldFuelBreakdown: FieldFuelBreakdownRow[];
  fieldFuelCoverage?: {
    daysCovered: number;
    daysExpected: number;
    incomplete: boolean;
  } | null;
  refuelLiters: number | null;
  refuelHasData: boolean;
  refuelLoading: boolean;
  refuelBreakdown: RefuelBreakdownRow[];
  onFieldFuelPeriodChange: (period: FieldFuelPeriod) => void;
  onPurchase: () => void;
  onTransfer: () => void;
  onRefuel: () => void;
  onRadarApproved: () => void;
};

function KpiBreakdownList({
  emptyLabel,
  rows,
}: {
  emptyLabel: string;
  rows: Array<{ title: string; subtitle?: string; liters: number }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">{emptyLabel}</p>
    );
  }
  return (
    <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
      {rows.map((row, index) => (
        <li
          key={`${row.title}-${row.subtitle ?? ""}-${index}`}
          className="flex items-start justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-zinc-50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {row.title}
            </p>
            {row.subtitle ? (
              <p className="truncate text-[11px] text-zinc-500">{row.subtitle}</p>
            ) : null}
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
            {formatLiters(row.liters)}{" "}
            <span className="text-[11px] font-semibold text-zinc-400">л</span>
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
          "border border-zinc-200/90 bg-white/80 text-[12px] font-semibold text-zinc-700",
          "shadow-sm outline-none transition",
          "hover:border-zinc-300 hover:bg-white hover:text-zinc-900",
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
              period === option.id && "bg-zinc-100 font-semibold"
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

function KpiValue({
  liters,
  loading,
  empty,
  interactive,
  popoverTitle,
  popoverDescription,
  breakdownEmpty,
  breakdownRows,
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
  accentClass?: string;
}) {
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

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "group inline-flex text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-emerald-500/20 rounded-xl"
        )}
      >
        {value}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[20rem] rounded-2xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl"
      >
        <PopoverHeader className="mb-2 gap-0.5 px-1">
          <PopoverTitle className="text-sm font-bold">{popoverTitle}</PopoverTitle>
          <PopoverDescription className="text-[11px] text-zinc-500">
            {popoverDescription}
          </PopoverDescription>
        </PopoverHeader>
        <KpiBreakdownList emptyLabel={breakdownEmpty} rows={breakdownRows} />
      </PopoverContent>
    </Popover>
  );
}

/** Energy Header + Command Bar для /fuel */
export function FuelDashboardHeader({
  storages,
  totalLiters,
  totalValue,
  live,
  fieldFuelLiters,
  fieldFuelHasData,
  fieldFuelLoading,
  fieldFuelPeriod,
  fieldFuelBreakdown,
  fieldFuelCoverage,
  refuelLiters,
  refuelHasData,
  refuelLoading,
  refuelBreakdown,
  onFieldFuelPeriodChange,
  onPurchase,
  onTransfer,
  onRefuel,
  onRadarApproved,
}: FuelDashboardHeaderProps) {
  const periodLabel =
    FIELD_FUEL_PERIODS.find((p) => p.id === fieldFuelPeriod)?.label ??
    "Сьогодні";

  const burnedRows = fieldFuelBreakdown.map((row) => ({
    title: row.equipmentName,
    subtitle: row.fieldName,
    liters: row.liters,
  }));
  const refuelRows = refuelBreakdown.map((row) => ({
    title: row.equipmentName,
    liters: row.liters,
  }));

  const coverageHint =
    fieldFuelCoverage &&
    fieldFuelCoverage.daysExpected > 1 &&
    fieldFuelCoverage.incomplete
      ? `дані за ${fieldFuelCoverage.daysCovered} з ${fieldFuelCoverage.daysExpected} дн.`
      : null;

  return (
    <header className="mb-3 flex flex-col gap-4 px-6 py-5 sm:mb-4 sm:px-8">
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

      {/* KPI strip */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-zinc-200/80",
          "bg-gradient-to-br from-white via-zinc-50/80 to-emerald-50/40",
          "shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_8px_24px_-12px_rgba(24,24,27,0.12)]"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
        />

        <div className="grid grid-cols-1 divide-y divide-zinc-200/70 md:grid-cols-3 md:divide-x md:divide-y-0">
          {/* Stock */}
          <div className="flex min-h-[7.25rem] flex-col justify-between gap-3 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                <Warehouse className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
                Усього на складах
              </p>
              {live ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-600/15">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  LIVE
                </span>
              ) : null}
            </div>

            {storages.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Немає складів
              </p>
            ) : (
              <div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[1.75rem] font-bold tracking-tight tabular-nums leading-none text-zinc-950 sm:text-[2rem]">
                    {formatLiters(totalLiters)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-400">л</span>
                </p>
                <p className="mt-2 text-[13px] font-medium tabular-nums text-zinc-500">
                  ≈ {formatMoney(totalValue)}{" "}
                  <span className="text-zinc-400">₴</span>
                </p>
              </div>
            )}
          </div>

          {/* Burned */}
          <div className="flex min-h-[7.25rem] flex-col justify-between gap-3 p-5 sm:p-6">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
              <Tractor className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
              Спалено на полях
            </p>
            <div>
              <KpiValue
                liters={fieldFuelLiters}
                loading={fieldFuelLoading}
                empty={!fieldFuelHasData}
                interactive={fieldFuelHasData && !fieldFuelLoading}
                popoverTitle="Хто спалив на полях"
                popoverDescription={`Техніка × поле · ${periodLabel.toLowerCase()}`}
                breakdownEmpty={`Немає даних за ${fieldFuelPeriodCaption(fieldFuelPeriod)}`}
                breakdownRows={burnedRows}
                accentClass="text-amber-950"
              />
              <p className="mt-2 text-[12px] font-medium text-zinc-400">
                {periodLabel}
                {coverageHint ? (
                  <span className="ml-1.5 text-amber-700">· {coverageHint}</span>
                ) : null}
              </p>
            </div>
          </div>

          {/* Refueled */}
          <div className="flex min-h-[7.25rem] flex-col justify-between gap-3 p-5 sm:p-6">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
              <Fuel className="h-3.5 w-3.5 text-sky-600" strokeWidth={2} />
              Заправлено
            </p>
            <div>
              <KpiValue
                liters={refuelLiters}
                loading={refuelLoading}
                empty={!refuelHasData}
                interactive={refuelHasData && !refuelLoading}
                popoverTitle="Кому списали зі складу"
                popoverDescription={`Заправки · ${periodLabel.toLowerCase()}`}
                breakdownEmpty={`Немає заправок за ${fieldFuelPeriodCaption(fieldFuelPeriod)}`}
                breakdownRows={refuelRows}
                accentClass="text-sky-950"
              />
              <p className="mt-2 text-[12px] font-medium text-zinc-400">
                {periodLabel}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Command Bar */}
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

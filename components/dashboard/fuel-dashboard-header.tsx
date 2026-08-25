"use client";

import {
  ArrowRightLeft,
  ChevronDown,
  Fuel,
  Info,
  Loader2,
  Plus,
  Tractor,
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
import { Separator } from "@/components/ui/separator";
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
    <ul className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
      {rows.map((row, index) => (
        <li
          key={`${row.title}-${row.subtitle ?? ""}-${index}`}
          className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-50"
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
            <span className="text-[11px] font-semibold text-zinc-500">л</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Монолітна Energy Header + Command Bar для /fuel */
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

  return (
    <header
      className={cn(
        "mb-3 flex flex-col gap-4 border-b border-zinc-200/70 bg-background/60 px-6 py-5 backdrop-blur-2xl sm:mb-4 sm:px-8"
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            Облік Палива
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Управління дизельними активами
          </p>
        </div>

        <div className="flex flex-wrap items-stretch gap-0">
          <div className="min-w-[8.5rem] pr-5 sm:pr-6">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Усього на складах
              {live ? (
                <span className="ml-1.5 inline-flex items-center gap-1 font-medium normal-case tracking-normal text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  live
                </span>
              ) : null}
            </p>
            {storages.length === 0 ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Немає складів
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                  {formatLiters(totalLiters)}{" "}
                  <span className="text-sm font-semibold text-zinc-500">л</span>
                </p>
                <p className="text-xs font-medium tabular-nums text-muted-foreground">
                  ≈ {formatMoney(totalValue)} ₴
                </p>
              </>
            )}
          </div>

          <Separator
            orientation="vertical"
            className="mx-0 hidden h-auto min-h-14 self-stretch data-[orientation=vertical]:h-auto sm:block"
          />

          <div className="min-w-[9.5rem] pt-3 sm:pt-0 sm:pl-6">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Tractor className="h-3.5 w-3.5" strokeWidth={2} />
              Спалено на полях
            </p>
            {fieldFuelLoading ? (
              <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
            ) : fieldFuelHasData ? (
              <Popover>
                <PopoverTrigger
                  className={cn(
                    "mt-0.5 inline-flex items-baseline gap-1.5 rounded-lg text-left",
                    "outline-none transition hover:bg-zinc-100/80",
                    "focus-visible:ring-2 focus-visible:ring-zinc-900/10"
                  )}
                >
                  <span className="text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                    {formatLiters(fieldFuelLiters ?? 0)}{" "}
                    <span className="text-sm font-semibold text-zinc-500">
                      л
                    </span>
                  </span>
                  <Info
                    className="mb-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400"
                    strokeWidth={2}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[20rem] rounded-2xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl"
                >
                  <PopoverHeader className="mb-2 gap-0.5 px-1">
                    <PopoverTitle className="text-sm font-bold">
                      Хто спалив на полях
                    </PopoverTitle>
                    <PopoverDescription className="text-[11px] text-zinc-500">
                      Техніка × поле · {periodLabel.toLowerCase()}
                    </PopoverDescription>
                  </PopoverHeader>
                  <KpiBreakdownList
                    emptyLabel="Немає розшифровки за період"
                    rows={burnedRows}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <p className="mt-1 max-w-[12rem] text-sm font-medium leading-snug text-zinc-500">
                Немає даних за {fieldFuelPeriodCaption(fieldFuelPeriod)}
              </p>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "mt-1 inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5",
                  "text-[11px] font-semibold text-zinc-500",
                  "outline-none transition hover:bg-zinc-100 hover:text-zinc-800",
                  "focus-visible:ring-2 focus-visible:ring-zinc-900/10"
                )}
              >
                {periodLabel}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-[8.5rem] rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-lg"
              >
                {FIELD_FUEL_PERIODS.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    className={cn(
                      "cursor-pointer rounded-lg px-2.5 py-2 text-sm",
                      fieldFuelPeriod === option.id &&
                        "bg-zinc-100 font-semibold"
                    )}
                    onClick={() => onFieldFuelPeriodChange(option.id)}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Separator
            orientation="vertical"
            className="mx-0 hidden h-auto min-h-14 self-stretch data-[orientation=vertical]:h-auto sm:block"
          />

          <div className="min-w-[9rem] pt-3 sm:pt-0 sm:pl-6">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Fuel className="h-3.5 w-3.5" strokeWidth={2} />
              Заправлено
            </p>
            {refuelLoading ? (
              <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
            ) : refuelHasData ? (
              <Popover>
                <PopoverTrigger
                  className={cn(
                    "mt-0.5 inline-flex items-baseline gap-1.5 rounded-lg text-left",
                    "outline-none transition hover:bg-zinc-100/80",
                    "focus-visible:ring-2 focus-visible:ring-zinc-900/10"
                  )}
                >
                  <span className="text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                    {formatLiters(refuelLiters ?? 0)}{" "}
                    <span className="text-sm font-semibold text-zinc-500">
                      л
                    </span>
                  </span>
                  <Info
                    className="mb-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400"
                    strokeWidth={2}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[18rem] rounded-2xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl"
                >
                  <PopoverHeader className="mb-2 gap-0.5 px-1">
                    <PopoverTitle className="text-sm font-bold">
                      Кому списали зі складу
                    </PopoverTitle>
                    <PopoverDescription className="text-[11px] text-zinc-500">
                      Заправки · {periodLabel.toLowerCase()}
                    </PopoverDescription>
                  </PopoverHeader>
                  <KpiBreakdownList
                    emptyLabel="Немає заправок за період"
                    rows={refuelRows}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <p className="mt-1 max-w-[11rem] text-sm font-medium leading-snug text-zinc-500">
                Немає заправок за {fieldFuelPeriodCaption(fieldFuelPeriod)}
              </p>
            )}
            <p className="mt-1 px-1.5 text-[11px] font-semibold text-zinc-400">
              {periodLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Command Bar — плитки без спільної «коробки» */}
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

"use client";

import {
  ArrowRightLeft,
  Fuel,
  Loader2,
  Plus,
  Tractor,
} from "lucide-react";

import { FuelRefuelRadar } from "@/components/dashboard/fuel-refuel-radar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { FuelStorage } from "@/lib/fuel-storages";
import { cn } from "@/lib/utils";

function formatLiters(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("uk-UA");
}

type FuelDashboardHeaderProps = {
  storages: FuelStorage[];
  totalLiters: number;
  totalValue: number;
  live: boolean;
  /** Літри, якщо hasData; інакше ігнорується */
  fieldFuelToday: number | null;
  /** false = CRON ще не записав дані за сьогодні */
  fieldFuelHasData: boolean;
  fieldFuelLoading: boolean;
  onPurchase: () => void;
  onTransfer: () => void;
  onRefuel: () => void;
  onRadarApproved: () => void;
};

/** Монолітна Energy Header + Command Bar для /fuel */
export function FuelDashboardHeader({
  storages,
  totalLiters,
  totalValue,
  live,
  fieldFuelToday,
  fieldFuelHasData,
  fieldFuelLoading,
  onPurchase,
  onTransfer,
  onRefuel,
  onRadarApproved,
}: FuelDashboardHeaderProps) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-6 border-b border-zinc-200/70 bg-background/60 px-6 py-6 backdrop-blur-2xl sm:px-8"
      )}
    >
      {/* Верхній ряд: заголовок + KPI */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            Облік Палива
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Управління дизельними активами · Command Center
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

          <div className="min-w-[8.5rem] pt-3 sm:pt-0 sm:pl-6">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Tractor className="h-3.5 w-3.5" strokeWidth={2} />
              Спалено на полях
            </p>
            {fieldFuelLoading ? (
              <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
            ) : fieldFuelHasData ? (
              <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                {formatLiters(fieldFuelToday ?? 0)}{" "}
                <span className="text-sm font-semibold text-zinc-500">л</span>
              </p>
            ) : (
              <p className="mt-1 max-w-[11rem] text-sm font-medium leading-snug text-zinc-500">
                Немає даних за сьогодні
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">сьогодні · Wialon</p>
          </div>
        </div>
      </div>

      {/* Нижній ряд: Command Bar */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200/70",
          "bg-card/70 p-1.5 shadow-sm backdrop-blur-sm"
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onPurchase}
            className={cn(
              "h-10 gap-2 rounded-xl px-3.5 text-sm font-semibold",
              "hover:bg-emerald-500/10 hover:text-emerald-800"
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Закупівля
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onTransfer}
            className={cn(
              "h-10 gap-2 rounded-xl px-3.5 text-sm font-semibold",
              "hover:bg-sky-500/10 hover:text-sky-800"
            )}
          >
            <ArrowRightLeft className="h-4 w-4" strokeWidth={1.8} />
            Переміщення
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onRefuel}
            className={cn(
              "h-10 gap-2 rounded-xl px-3.5 text-sm font-semibold",
              "hover:bg-amber-500/10 hover:text-amber-900"
            )}
          >
            <Fuel className="h-4 w-4" strokeWidth={1.8} />
            Заправка
          </Button>
        </div>

        <FuelRefuelRadar
          variant="commandBar"
          className="shrink-0"
          storages={storages}
          onApproved={onRadarApproved}
        />
      </div>
    </header>
  );
}

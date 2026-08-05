"use client";

import { useState } from "react";
import {
  ChevronRight,
  Download,
  Fuel,
  Radar,
  Tractor,
  Wrench,
} from "lucide-react";

import { FuelDetailSheet } from "@/components/dashboard/fuel-detail-sheet";
import { TelegramBotStatusCard } from "@/components/dashboard/telegram-bot-status";
import { PageHeader } from "@/components/layout/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import {
  DASHBOARD_SUMMARY,
  FLEET_STATUS_META,
  FLEET_UNITS,
  type FleetUnit,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

/** Мок логів списання через Telegram-бот */
const FUEL_LOGS = [
  {
    id: "log-1",
    time: "Сьогодні · 07:12",
    tractor: "МТЗ-82",
    field: "Поле 1",
    liters: 50,
    operator: "Іван",
  },
  {
    id: "log-2",
    time: "Вчора · 18:40",
    tractor: "John Deere 8R",
    field: "Поле 2",
    liters: 120,
    operator: "Сергій",
  },
  {
    id: "log-3",
    time: "Вчора · 09:05",
    tractor: "МТЗ-82",
    field: "Поле 3",
    liters: 40,
    operator: "Іван",
  },
  {
    id: "log-4",
    time: "03.05 · 16:20",
    tractor: "John Deere 8R",
    field: "Поле 2",
    liters: 95,
    operator: "Олег",
  },
] as const;

function FleetRow({ unit }: { unit: FleetUnit }) {
  const meta = FLEET_STATUS_META[unit.status];
  const fuelTone =
    unit.fuelPercent == null
      ? "[&_[data-slot=progress-indicator]]:bg-[#C05621]"
      : unit.fuelPercent < 50
        ? "[&_[data-slot=progress-indicator]]:bg-[#D69E2E]"
        : "[&_[data-slot=progress-indicator]]:bg-[#276749]";

  return (
    <li className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5 transition-colors hover:border-[#E5DFD3] hover:bg-[#E5DFD3]/40">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E5DFD3]/40 text-zinc-500">
            {unit.status === "maintenance" ? (
              <Wrench className="h-4 w-4 text-[#C05621]" />
            ) : (
              <Tractor className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{unit.name}</p>
            <p className={cn("mt-0.5 flex items-center gap-1.5 text-xs", meta.textClass)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
              {meta.label}
            </p>
          </div>
        </div>
        {unit.fuelPercent != null ? (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-900">
            {unit.fuelPercent}%
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[#C05621]">
            Немає даних
          </span>
        )}
      </div>

      {unit.fuelPercent != null ? (
        <Progress
          value={unit.fuelPercent}
          className={cn(
            "w-full gap-0",
            "[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[#E5DFD3]/40",
            fuelTone
          )}
        />
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5DFD3]/40">
          <div className="h-full w-full bg-[#C05621]/30" />
        </div>
      )}
    </li>
  );
}

/** Техніка, паливо, логи Telegram */
export function FleetView() {
  const summary = DASHBOARD_SUMMARY;
  const fuelPercent = Math.round(
    (summary.fuelLiters / summary.fuelCapacityLiters) * 100
  );
  const [fuelSheetOpen, setFuelSheetOpen] = useState(false);

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Tractor}
        title="Техніка та Паливо"
        description="Радар техніки, склад дизелю та логи списань"
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-3">
        <GlassCard className="flex flex-col xl:col-span-1">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
              <Radar className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Моніторинг Техніки</p>
              <p className="text-xs text-zinc-500/80">Fleet Radar · 3 одиниці</p>
            </div>
          </div>
          <ul className="flex flex-1 flex-col gap-3">
            {FLEET_UNITS.map((unit) => (
              <FleetRow key={unit.id} unit={unit} />
            ))}
          </ul>
        </GlassCard>

        <button
          type="button"
          onClick={() => setFuelSheetOpen(true)}
          className="group/card text-left"
        >
          <GlassCard className="h-full cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D69E2E]/10 text-[#D69E2E]">
                  <Fuel className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-500">Склад палива</p>
                  <p className="text-xs text-zinc-500/80">Центральна ємність</p>
                </div>
              </div>
              <span className="rounded-full bg-[#D69E2E]/10 px-2.5 py-1 text-xs font-semibold text-[#D69E2E]">
                {fuelPercent}%
              </span>
            </div>

            <div className="flex items-end gap-5">
              <div className="relative flex h-44 w-16 shrink-0 flex-col justify-end overflow-hidden rounded-full border border-[#E5DFD3] bg-zinc-100 p-1.5">
                <div
                  className="relative w-full overflow-hidden rounded-full bg-gradient-to-t from-[#C05621] to-[#D69E2E]"
                  style={{ height: `${fuelPercent}%` }}
                >
                  <div className="absolute inset-x-0 top-0 h-3 bg-white/30" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-4xl font-extrabold tracking-tight text-zinc-900">
                  {summary.fuelLiters.toLocaleString("uk-UA")}{" "}
                  <span className="text-lg font-semibold text-[#D69E2E]">L</span>
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  з {summary.fuelCapacityLiters.toLocaleString("uk-UA")} L
                </p>
                <div className="mt-5 space-y-2 text-sm">
                  <div className="flex justify-between rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3 py-2">
                    <span className="text-zinc-500">Дизель</span>
                    <span className="font-semibold text-zinc-900">
                      {summary.dieselLiters.toLocaleString("uk-UA")} L
                    </span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3 py-2">
                    <span className="text-zinc-500">Бензин</span>
                    <span className="font-semibold text-zinc-900">
                      {summary.gasolineLiters.toLocaleString("uk-UA")} L
                    </span>
                  </div>
                </div>
                <p className="mt-4 flex items-center gap-1 text-xs font-medium text-[#C05621] opacity-70 transition-opacity group-hover/card:opacity-100">
                  Деталі резервуарів
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5" />
                </p>
              </div>
            </div>
          </GlassCard>
        </button>

        <GlassCard>
          <TelegramBotStatusCard />
        </GlassCard>
      </section>

      <GlassCard className="mt-4 hover:scale-100 md:mt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-500">Логи списання палива</p>
            <p className="text-xs text-zinc-500/80">
              Заправки через Telegram-бот
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E5DFD3] bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-900 transition-all hover:border-[#276749]/30 hover:bg-[#276749]/10 hover:text-[#276749]"
          >
            <Download className="h-3.5 w-3.5" />
            Експорт CSV
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#E5DFD3]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[#E5DFD3]/40 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Час</th>
                <th className="px-4 py-3 font-medium">Техніка</th>
                <th className="px-4 py-3 font-medium">Поле</th>
                <th className="px-4 py-3 font-medium">Оператор</th>
                <th className="px-4 py-3 text-right font-medium">Літри</th>
              </tr>
            </thead>
            <tbody>
              {FUEL_LOGS.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-[#E5DFD3] transition-colors hover:bg-zinc-100"
                >
                  <td className="px-4 py-3 text-zinc-500">{log.time}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{log.tractor}</td>
                  <td className="px-4 py-3 text-zinc-500">{log.field}</td>
                  <td className="px-4 py-3 text-zinc-500">{log.operator}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#C05621]">
                    −{log.liters} L
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <FuelDetailSheet open={fuelSheetOpen} onOpenChange={setFuelSheetOpen} />
    </main>
  );
}

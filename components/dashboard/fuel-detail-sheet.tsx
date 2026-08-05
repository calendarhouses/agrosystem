"use client";

import { Droplets, Fuel } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DASHBOARD_SUMMARY } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const RECENT_REFILLS = [
  { id: "1", label: "МТЗ-82 · Поле 1", liters: 50, time: "Сьогодні · 07:12" },
  { id: "2", label: "John Deere 8R · Поле 2", liters: 120, time: "Вчора · 18:40" },
  { id: "3", label: "МТЗ-82 · Поле 3", liters: 40, time: "Вчора · 09:05" },
] as const;

type FuelDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Деталі резервуарів — відкривається з картки палива */
export function FuelDetailSheet({ open, onOpenChange }: FuelDetailSheetProps) {
  const summary = DASHBOARD_SUMMARY;
  const fuelPercent = Math.round(
    (summary.fuelLiters / summary.fuelCapacityLiters) * 100
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm sm:max-w-2xl",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-[#E5DFD3]/40"
        )}
      >
        <SheetHeader className="border-b border-[#E5DFD3] px-6 py-5">
          <SheetTitle className="text-xl font-extrabold tracking-tight text-zinc-900">
            Резервуари палива
          </SheetTitle>
          <SheetDescription className="text-zinc-500">
            Деталізація складу · {fuelPercent}% заповнення
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <div className="flex items-end gap-5">
            <div className="relative flex h-40 w-14 shrink-0 flex-col justify-end overflow-hidden rounded-full border border-[#E5DFD3] bg-zinc-100 p-1.5">
              <div
                className="relative w-full overflow-hidden rounded-full bg-gradient-to-t from-[#C05621] to-[#D69E2E]"
                style={{ height: `${fuelPercent}%` }}
              >
                <div className="absolute inset-x-0 top-0 h-3 bg-white/30" />
              </div>
            </div>
            <div>
              <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-[#D69E2E]/10 text-[#D69E2E]">
                <Fuel className="h-4 w-4" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-zinc-900">
                {summary.fuelLiters.toLocaleString("uk-UA")} L
              </p>
              <p className="text-sm text-zinc-500">
                з {summary.fuelCapacityLiters.toLocaleString("uk-UA")} L
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-4">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Дизель
              </p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-[#D69E2E]">
                {summary.dieselLiters.toLocaleString("uk-UA")} L
              </p>
            </div>
            <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-4">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Бензин
              </p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-zinc-900">
                {summary.gasolineLiters.toLocaleString("uk-UA")} L
              </p>
            </div>
          </div>

          <section>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Останні 3 заправки
            </p>
            <ul className="space-y-2">
              {RECENT_REFILLS.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C05621]/10 text-[#C05621]">
                    <Droplets className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-zinc-500">{item.time}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[#C05621]">
                    −{item.liters} L
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

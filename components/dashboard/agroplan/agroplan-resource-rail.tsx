"use client";

import { motion, AnimatePresence } from "framer-motion";
import { EyeOff, X, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

import { buildMeteoChips } from "@/components/dashboard/calendar/smart-insight-card";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { operationAccent } from "@/lib/agroplan/theme";
import { climateColumnClass } from "@/lib/agroplan/weather-risk";
import type { DayClimateRisk } from "@/lib/agroplan/weather-risk";
import type { AgroForecastHour } from "@/lib/agronomy-engine";
import { formatApproxUah } from "@/lib/agronomy-resources";
import { findCropOperationById } from "@/lib/agronomy-dictionary";
import { Button } from "@/components/ui/button";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

type Props = {
  block: AgroplanBlock | null;
  dayRisks: Map<string, DayClimateRisk>;
  forecastHours: readonly AgroForecastHour[];
  onClose: () => void;
  onPlan: (block: AgroplanBlock) => void;
  onOrder: (block: AgroplanBlock) => void;
  onDismiss: (block: AgroplanBlock) => void;
  onShiftDays?: (block: AgroplanBlock, daysDelta: number) => void;
  onDurationChange?: (block: AgroplanBlock, durationHours: number) => void;
};

export function AgroplanResourceRail({
  block,
  dayRisks,
  forecastHours: _forecastHours,
  onClose,
  onPlan,
  onOrder,
  onDismiss,
  onShiftDays,
  onDurationChange,
}: Props) {
  const open = block != null;
  const accent = block
    ? operationAccent(block.insight.operationType, block.insight.kind)
    : null;

  const blockYmd = block
    ? toKyivDayKey(new Date(block.startMs))
    : null;
  const dayRisk = blockYmd ? dayRisks.get(blockYmd)?.level : undefined;
  const opDef = block
    ? findCropOperationById(block.insight.operationId)
    : null;
  const meteoChips =
    block && opDef
      ? buildMeteoChips(
          opDef.idealConditions,
          null,
          block.insight.status
        )
      : [];

  return (
    <AnimatePresence>
      {open && block && accent ? (
        <>
          <motion.button
            type="button"
            aria-label="Закрити панель"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/[0.08] bg-[#0a0c10]/98 shadow-2xl backdrop-blur-xl"
          >
            <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {block.source === "operation" ? "Наряд" : "Рекомендація"}
                </p>
                <h2 className="mt-1 truncate text-base font-medium text-zinc-100">
                  {block.insight.operationName}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">{blockYmd}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {dayRisk && dayRisk !== "none" ? (
                <div
                  className={cn(
                    "rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200/90",
                    climateColumnClass(dayRisk)
                  )}
                >
                  Кліматичний ризик цього дня:{" "}
                  {dayRisk === "storm"
                    ? "шторм"
                    : dayRisk === "rain"
                      ? "дощ"
                      : "заморозки"}
                </div>
              ) : null}

              <section>
                <p className="text-xs text-zinc-500">Поле</p>
                <p className="mt-1 text-sm text-zinc-200">{block.fieldName}</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  {block.insight.explanation}
                </p>
              </section>

              {meteoChips.length > 0 ? (
                <section className="flex flex-wrap gap-1.5">
                  {meteoChips.map((chip) => (
                    <span
                      key={chip.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        chip.ok
                          ? "border-emerald-400/25 text-emerald-200/90"
                          : "border-amber-400/25 text-amber-200/90"
                      )}
                    >
                      {chip.label}
                    </span>
                  ))}
                </section>
              ) : null}

              {block.source === "operation" ? (
                <section className="rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Статус наряду
                  </p>
                  <p className="mt-2 text-sm text-cyan-100">
                    {block.operationStatus === "in_progress"
                      ? "У роботі · телематика"
                      : block.operationStatus === "completed"
                        ? "Виконано"
                        : "Заплановано"}
                  </p>
                </section>
              ) : null}

              <section
                className={cn(
                  "rounded-xl border bg-black/20 p-4",
                  accent.border
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                  ТМЦ / склад
                </p>
                {block.insight.resourceStatus.status === "DEFICIT" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    <p className="text-sm text-rose-200">
                      Дефіцит:{" "}
                      {block.insight.resourceStatus.item ?? "перевірте склад"}{" "}
                      ({block.insight.resourceStatus.deficitQty}{" "}
                      {block.insight.resourceStatus.unit})
                    </p>
                  </div>
                ) : block.source === "insight" ? (
                  <p className="mt-2 text-sm text-emerald-200/90">
                    Запасів достатньо
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500">
                    Ресурси в наряді поля
                  </p>
                )}
                {block.source === "insight" ? (
                  <p className="mt-3 text-xs text-zinc-500">
                    Орієнтовно{" "}
                    {formatApproxUah(block.insight.estimatedCost.totalUah)}
                  </p>
                ) : null}
              </section>

              <section className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Таймлайн
                </p>
                {onShiftDays ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-white/10 text-xs"
                      onClick={() => onShiftDays(block, -1)}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                      −1 день
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-white/10 text-xs"
                      onClick={() => onShiftDays(block, 1)}
                    >
                      +1 день
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-white/10 text-xs"
                      onClick={() => onShiftDays(block, 7)}
                    >
                      +7 днів
                    </Button>
                  </div>
                ) : null}
                {onDurationChange ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Тривалість</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-white/10"
                      disabled={block.durationHours <= 1}
                      onClick={() =>
                        onDurationChange(
                          block,
                          Math.max(1, block.durationHours - 0.5)
                        )
                      }
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="min-w-[3rem] text-center text-sm text-zinc-200">
                      {block.durationHours} год
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-white/10"
                      onClick={() =>
                        onDurationChange(block, block.durationHours + 0.5)
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Техніка
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  {block.insight.fleetStatus.status === "AVAILABLE"
                    ? `${block.insight.fleetStatus.availableCount} ${block.insight.fleetStatus.unitLabel} доступно`
                    : `Зайнято · потрібно ${block.insight.fleetStatus.requiredCount} ${block.insight.fleetStatus.unitLabel}`}
                </p>
              </section>
            </div>

            <footer className="flex flex-wrap gap-2 border-t border-white/[0.06] p-4">
              {block.source === "insight" ? (
                <Button
                  type="button"
                  className="flex-1 bg-emerald-600/90 hover:bg-emerald-600"
                  onClick={() => onPlan(block)}
                >
                  Планувати
                </Button>
              ) : null}
              {block.insight.resourceStatus.status === "DEFICIT" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-rose-400/40 text-rose-200 hover:bg-rose-950/40"
                  onClick={() => onOrder(block)}
                >
                  Замовити ТМЦ
                </Button>
              ) : null}
              {block.source === "insight" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-zinc-500"
                  onClick={() => onDismiss(block)}
                >
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                  Приховати
                </Button>
              ) : null}
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

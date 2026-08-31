"use client";

import { ChevronLeft, ChevronRight, EyeOff, Minus, Plus } from "lucide-react";

import { buildMeteoChips } from "@/components/dashboard/calendar/smart-insight-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { operationAccent } from "@/lib/agroplan/theme";
import { climateColumnClass, type DayClimateRisk } from "@/lib/agroplan/weather-risk";
import type { AgroForecastHour } from "@/lib/agronomy-engine";
import { formatApproxUah } from "@/lib/agronomy-resources";
import { findCropOperationById } from "@/lib/agronomy-dictionary";
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
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg"
      >
        {block && accent ? (
          <>
            <SheetHeader className="border-b border-border/60 px-5 py-4">
              <SheetTitle>{block.insight.operationName}</SheetTitle>
              <SheetDescription>
                {block.source === "operation" ? "Наряд" : "Рекомендація"} ·{" "}
                {block.fieldName} · {blockYmd}
              </SheetDescription>
            </SheetHeader>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {dayRisk && dayRisk !== "none" ? (
                <Alert
                  variant="destructive"
                  className={cn("border-destructive/25", climateColumnClass(dayRisk))}
                >
                  <AlertTitle>Кліматичний ризик</AlertTitle>
                  <AlertDescription>
                    {dayRisk === "storm"
                      ? "Шторм у цей день"
                      : dayRisk === "rain"
                        ? "Дощ у прогнозі"
                        : "Ризик заморозків"}
                  </AlertDescription>
                </Alert>
              ) : null}

              <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Поле</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {block.fieldName}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {block.insight.explanation}
                </p>
              </section>

              {meteoChips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {meteoChips.map((chip) => (
                    <span
                      key={chip.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        chip.ok
                          ? "border-primary/25 bg-primary/5 text-primary"
                          : "border-[#D69E2E]/30 bg-[#D69E2E]/10 text-[#9C4221]"
                      )}
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {block.source === "operation" ? (
                <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Статус наряду
                  </p>
                  <p className="mt-2 text-sm text-foreground">
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
                  "rounded-xl border bg-card/60 p-4",
                  accent.border
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  ТМЦ / склад
                </p>
                {block.insight.resourceStatus.status === "DEFICIT" ? (
                  <p className="mt-2 text-sm text-destructive">
                    Дефіцит:{" "}
                    {block.insight.resourceStatus.item ?? "перевірте склад"}{" "}
                    ({block.insight.resourceStatus.deficitQty}{" "}
                    {block.insight.resourceStatus.unit})
                  </p>
                ) : block.source === "insight" ? (
                  <p className="mt-2 text-sm text-primary">
                    Запасів достатньо
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ресурси в наряді поля
                  </p>
                )}
                {block.source === "insight" ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Орієнтовно{" "}
                    {formatApproxUah(block.insight.estimatedCost.totalUah)}
                  </p>
                ) : null}
              </section>

              <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Таймлайн
                </p>
                {onShiftDays ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => onShiftDays(block, -1)}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                      −1 день
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => onShiftDays(block, 1)}
                    >
                      +1 день
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => onShiftDays(block, 7)}
                    >
                      +7 днів
                    </Button>
                  </div>
                ) : null}
                {onDurationChange ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Тривалість
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
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
                    <span className="min-w-[3rem] text-center text-sm">
                      {block.durationHours} год
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() =>
                        onDurationChange(block, block.durationHours + 0.5)
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Техніка
                </p>
                <p className="mt-2 text-sm text-foreground">
                  {block.insight.fleetStatus.status === "AVAILABLE"
                    ? `${block.insight.fleetStatus.availableCount} ${block.insight.fleetStatus.unitLabel} доступно`
                    : `Зайнято · потрібно ${block.insight.fleetStatus.requiredCount} ${block.insight.fleetStatus.unitLabel}`}
                </p>
              </section>
            </div>

            <SheetFooter className="flex-row flex-wrap gap-2 border-t border-border/60 px-5 py-4">
              {block.source === "insight" ? (
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => onPlan(block)}
                >
                  Планувати
                </Button>
              ) : null}
              {block.insight.resourceStatus.status === "DEFICIT" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive"
                  onClick={() => onOrder(block)}
                >
                  Замовити ТМЦ
                </Button>
              ) : null}
              {block.source === "insight" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => onDismiss(block)}
                >
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                  Приховати
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

"use client";

import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Minus,
  Play,
  Plus,
  Package,
  Undo2,
} from "lucide-react";

import { buildMeteoChips } from "@/components/dashboard/calendar/smart-insight-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { operationAccent } from "@/lib/agroplan/theme";
import { climateColumnClass, type DayClimateRisk } from "@/lib/agroplan/weather-risk";
import { findCropOperationById } from "@/lib/agronomy-dictionary";
import { formatApproxUah } from "@/lib/agronomy-resources";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

type Props = {
  block: AgroplanBlock | null;
  dayRisks: Map<string, DayClimateRisk>;
  onClose: () => void;
  onPlan: (block: AgroplanBlock) => void;
  onOrder: (block: AgroplanBlock) => void;
  onDismiss: (block: AgroplanBlock) => void;
  onShiftDays?: (block: AgroplanBlock, daysDelta: number) => void;
  onDurationChange?: (block: AgroplanBlock, durationHours: number) => void;
  onUndo?: () => void;
};

export function AgroplanMobileDetail({
  block,
  dayRisks,
  onClose,
  onPlan,
  onOrder,
  onDismiss,
  onShiftDays,
  onDurationChange,
  onUndo,
}: Props) {
  const open = block != null;
  const accent = block
    ? operationAccent(block.insight.operationType, block.insight.kind)
    : null;
  const ymd = block ? toKyivDayKey(new Date(block.startMs)) : null;
  const dayRisk = ymd ? dayRisks.get(ymd)?.level : undefined;
  const opDef = block ? findCropOperationById(block.insight.operationId) : null;
  const meteoChips =
    block && opDef
      ? buildMeteoChips(opDef.idealConditions, null, block.insight.status)
      : [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[var(--app-sheet-max)] flex-col gap-0 overflow-hidden p-0"
      >
        {block && accent ? (
          <>
            <SheetHeader className="border-b border-border/60 px-5 py-4 text-left">
              <SheetTitle>{block.insight.operationName}</SheetTitle>
              <SheetDescription>
                {block.fieldName} · {ymd}
                {block.durationHours > 1
                  ? ` · ${block.durationHours} год`
                  : ""}
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
                      ? "Шторм"
                      : dayRisk === "rain"
                        ? "Дощ"
                        : "Заморозки"}
                  </AlertDescription>
                </Alert>
              ) : null}

              {onShiftDays ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 text-xs"
                    onClick={() => onShiftDays(block, -1)}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    −1 день
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 text-xs"
                    onClick={() => onShiftDays(block, 1)}
                  >
                    +1 день
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={() => onShiftDays(block, 7)}
                  >
                    +7 днів
                  </Button>
                </div>
              ) : null}

              {onDurationChange ? (
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">Тривалість</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={block.durationHours <= 1}
                      onClick={() =>
                        onDurationChange(
                          block,
                          Math.max(1, block.durationHours - 0.5)
                        )
                      }
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-[3.5rem] text-center text-sm">
                      {block.durationHours} год
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      onClick={() =>
                        onDurationChange(block, block.durationHours + 0.5)
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : null}

              <p className="text-sm leading-relaxed text-muted-foreground">
                {block.insight.explanation}
              </p>

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

              {block.insight.resourceStatus.status === "DEFICIT" ? (
                <p className="text-sm text-destructive">
                  Дефіцит: {block.insight.resourceStatus.item ?? "ТМЦ"}
                </p>
              ) : null}

              {block.source === "insight" ? (
                <p className="text-xs text-muted-foreground">
                  ~{formatApproxUah(block.insight.estimatedCost.totalUah)}
                </p>
              ) : null}
            </div>

            <SheetFooter className="flex-row flex-wrap gap-2 border-t border-border/60 px-5 py-4">
              {block.source === "insight" ||
              block.operationStatus === "planned" ? (
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => onPlan(block)}
                >
                  <Play className="mr-1.5 h-4 w-4" />
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
                  <Package className="mr-1.5 h-4 w-4" />
                  ТМЦ
                </Button>
              ) : null}
              {onUndo ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={onUndo}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Скасувати
                </Button>
              ) : null}
              {block.source === "insight" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => onDismiss(block)}
                >
                  <EyeOff className="mr-1.5 h-4 w-4" />
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

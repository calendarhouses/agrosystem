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
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { operationAccent } from "@/lib/agroplan/theme";
import { climateColumnClass, type DayClimateRisk } from "@/lib/agroplan/weather-risk";
import { findCropOperationById } from "@/lib/agronomy-dictionary";
import { formatApproxUah } from "@/lib/agronomy-resources";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
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
        className="max-h-[85vh] rounded-t-2xl border-white/10 bg-[#0a0c10] text-zinc-100"
      >
        {block && accent ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-base text-zinc-100">
                {block.insight.operationName}
              </SheetTitle>
              <p className="text-xs text-zinc-500">
                {block.fieldName} · {ymd}
                {block.durationHours > 1
                  ? ` · ${block.durationHours} год`
                  : ""}
              </p>
            </SheetHeader>

            <div className="mt-4 space-y-4 overflow-y-auto pb-4">
              {dayRisk && dayRisk !== "none" ? (
                <div
                  className={cn(
                    "rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200/90",
                    climateColumnClass(dayRisk)
                  )}
                >
                  Кліматичний ризик:{" "}
                  {dayRisk === "storm"
                    ? "шторм"
                    : dayRisk === "rain"
                      ? "дощ"
                      : "заморозки"}
                </div>
              ) : null}

              {onShiftDays ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 border-white/10 text-xs"
                    onClick={() => onShiftDays(block, -1)}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    −1 день
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 border-white/10 text-xs"
                    onClick={() => onShiftDays(block, 1)}
                  >
                    +1 день
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 border-white/10 text-xs"
                    onClick={() => onShiftDays(block, 7)}
                  >
                    +7 днів
                  </Button>
                </div>
              ) : null}

              {onDurationChange ? (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                  <span className="text-xs text-zinc-500">Тривалість</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 border-white/10"
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
                    <span className="min-w-[3.5rem] text-center text-sm text-zinc-200">
                      {block.durationHours} год
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 border-white/10"
                      onClick={() =>
                        onDurationChange(block, block.durationHours + 0.5)
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : null}

              <p className="text-sm leading-relaxed text-zinc-400">
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
                          ? "border-emerald-400/25 text-emerald-200"
                          : "border-amber-400/25 text-amber-200"
                      )}
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {block.insight.resourceStatus.status === "DEFICIT" ? (
                <p className="text-sm text-rose-200">
                  Дефіцит: {block.insight.resourceStatus.item ?? "ТМЦ"}
                </p>
              ) : null}

              {block.source === "insight" ? (
                <p className="text-xs text-zinc-500">
                  ~{formatApproxUah(block.insight.estimatedCost.totalUah)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {block.source === "insight" ||
              block.operationStatus === "planned" ? (
                <Button
                  type="button"
                  className="flex-1 bg-emerald-600"
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
                  className="border-rose-400/40 text-rose-200"
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
                  className="text-zinc-500"
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
                  className="text-zinc-500"
                  onClick={() => onDismiss(block)}
                >
                  <EyeOff className="mr-1.5 h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

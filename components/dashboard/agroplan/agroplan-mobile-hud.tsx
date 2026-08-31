"use client";

import { useMemo, useState, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Orbit,
  Package,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import type { AgroplanData } from "@/components/dashboard/agroplan/use-agroplan-data";
import { AgroplanMobileDetail } from "@/components/dashboard/agroplan/agroplan-mobile-detail";
import { blocksOnFields } from "@/lib/agroplan/block-overrides";
import { buildNdviFieldFlags } from "@/lib/agroplan/ndvi-layer";
import { operationAccent } from "@/lib/agroplan/theme";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import type { InsightCardData } from "@/lib/agronomy-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shiftKyivYmd, todayKyivYmd, toKyivDayKey } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

function hapticLight() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(12);
  }
}

type Props = {
  data: AgroplanData;
  onPlan: (insight: InsightCardData) => void;
  onOrder: (insight: InsightCardData) => void;
};

export function AgroplanMobileHud({ data, onPlan, onOrder }: Props) {
  const today = todayKyivYmd(data.now);
  const [selectedYmd, setSelectedYmd] = useState(today);
  const [refreshing, setRefreshing] = useState(false);
  const [detailBlock, setDetailBlock] = useState<AgroplanBlock | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    () => new Set()
  );

  const ndviFlags = useMemo(
    () => buildNdviFieldFlags(data.ndviAlerts),
    [data.ndviAlerts]
  );

  const dateStrip = useMemo(() => {
    const items: { ymd: string; label: string; dow: string }[] = [];
    for (let i = -3; i <= 7; i++) {
      const ymd = shiftKyivYmd(today, i);
      const d = new Date(`${ymd}T12:00:00`);
      items.push({
        ymd,
        label: String(d.getDate()),
        dow: d.toLocaleDateString("uk-UA", { weekday: "short" }),
      });
    }
    return items;
  }, [today]);

  const fieldOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const block of data.filteredBlocks) ids.add(block.fieldId);
    return data.fields.filter((f) => ids.has(f.id));
  }, [data.fields, data.filteredBlocks]);

  const dayBlocks = useMemo(() => {
    return data.filteredBlocks
      .filter((b) => {
        if (toKyivDayKey(new Date(b.startMs)) !== selectedYmd) return false;
        if (selectedFieldIds.size === 0) return true;
        return selectedFieldIds.has(b.fieldId);
      })
      .sort((a, b) => {
        const rank = (block: AgroplanBlock) => {
          if (block.operationStatus === "in_progress") return -1;
          if (block.insight.status === "PERFECT_CONDITIONS") return 0;
          if (block.insight.status === "WAITING_WEATHER") return 1;
          return 2;
        };
        return rank(a) - rank(b);
      });
  }, [data.filteredBlocks, selectedYmd, selectedFieldIds]);

  const activeFieldIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of data.activeOps) {
      if (op.fieldId) set.add(op.fieldId);
    }
    return set;
  }, [data.activeOps]);

  const topNdviAlerts = useMemo(
    () =>
      data.filters.showAnomalies
        ? data.ndviAlerts.slice(0, 3)
        : [],
    [data.filters.showAnomalies, data.ndviAlerts]
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    hapticLight();
    data.refreshSeasonOps();
    data.refreshStock();
    window.setTimeout(() => setRefreshing(false), 600);
  }, [data]);

  function toggleField(fieldId: string) {
    hapticLight();
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  function handleBulkShift(daysDelta: number) {
    hapticLight();
    const blockIds = blocksOnFields(data.blocks, selectedFieldIds);
    data.bulkShiftBlocks(blockIds, daysDelta);
  }

  return (
    <div className="flex h-full flex-col bg-[#07080b] text-zinc-100">
      <header className="border-b border-white/[0.06] px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300">
              <Orbit className="h-4 w-4" strokeWidth={1.6} />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide">Агроплан</h1>
              <p className="text-[11px] text-zinc-500">
                Польовий режим · {dayBlocks.length} задач
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant={selectMode ? "default" : "ghost"}
              className={cn(
                "h-9 w-9",
                selectMode && "bg-violet-600/80 hover:bg-violet-600"
              )}
              onClick={() => {
                hapticLight();
                setSelectMode((v) => !v);
                if (selectMode) setSelectedFieldIds(new Set());
              }}
            >
              {selectMode ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4 text-zinc-400" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-zinc-400"
              onClick={refresh}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
          </div>
        </div>
        {data.liveWeather ? (
          <p className="mt-2 text-[11px] text-zinc-500">
            {Math.round(data.liveWeather.tempC)}°C · вітер{" "}
            {Math.round(data.liveWeather.windMs)} м/с
          </p>
        ) : null}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={data.filters.query}
            onChange={(e) =>
              data.setFilters({ ...data.filters, query: e.target.value })
            }
            placeholder="Поле або операція…"
            className="h-9 border-white/10 bg-black/30 pl-8 text-xs text-zinc-200"
          />
        </div>
      </header>

      {topNdviAlerts.length > 0 ? (
        <div className="space-y-1.5 border-b border-violet-400/15 bg-violet-950/20 px-4 py-2.5">
          {topNdviAlerts.map((alert) => (
            <p
              key={alert.id}
              className="flex items-center gap-1.5 text-[11px] text-violet-200/90"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              {alert.fieldName}: NDVI −{alert.dropPercent}%
            </p>
          ))}
        </div>
      ) : null}

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
        {dateStrip.map((d) => {
          const active = d.ymd === selectedYmd;
          const risk = data.dayRisks.get(d.ymd)?.level;
          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => {
                setSelectedYmd(d.ymd);
                hapticLight();
              }}
              className={cn(
                "flex min-w-[52px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 transition-colors",
                active
                  ? "border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-100"
                  : "border-white/[0.06] bg-white/[0.02] text-zinc-400",
                risk === "rain" || risk === "storm"
                  ? "shadow-[inset_0_-8px_16px_rgba(244,63,94,0.08)]"
                  : null
              )}
            >
              <span className="text-[10px] uppercase">{d.dow}</span>
              <span className="text-lg font-medium leading-none">{d.label}</span>
            </button>
          );
        })}
      </div>

      {selectMode && fieldOptions.length > 0 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-white/[0.06] px-4 pb-3">
          {fieldOptions.map((field) => {
            const selected = selectedFieldIds.has(field.id);
            const ndvi = ndviFlags.get(field.id);
            return (
              <button
                key={field.id}
                type="button"
                onClick={() => toggleField(field.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                  selected
                    ? "border-violet-400/40 bg-violet-500/15 text-violet-100"
                    : "border-white/[0.08] bg-white/[0.02] text-zinc-400"
                )}
              >
                {field.name}
                {ndvi ? ` · NDVI` : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-28 pt-1">
        {dayBlocks.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-600">
            На цей день операцій немає
          </p>
        ) : (
          dayBlocks.map((block) => (
            <MobileTaskCard
              key={block.id}
              block={block}
              pulsing={
                selectedYmd === today && activeFieldIds.has(block.fieldId)
              }
              onOpen={() => {
                hapticLight();
                setDetailBlock(block);
              }}
              onPlan={() => {
                hapticLight();
                onPlan(block.insight);
              }}
              onOrder={() => {
                hapticLight();
                onOrder(block.insight);
              }}
            />
          ))
        )}
      </div>

      {selectMode && selectedFieldIds.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-4 flex items-center gap-2 rounded-2xl border border-violet-400/25 bg-[#0c0e13]/95 p-2 shadow-2xl backdrop-blur-md">
          <span className="shrink-0 px-2 text-[11px] text-violet-200">
            {selectedFieldIds.size} пол.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 flex-1 border-violet-400/25 text-xs"
            onClick={() => handleBulkShift(-1)}
          >
            −1д
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 flex-1 border-violet-400/25 text-xs"
            onClick={() => handleBulkShift(1)}
          >
            +1д
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 flex-1 bg-violet-600/90 text-xs hover:bg-violet-600"
            onClick={() => handleBulkShift(7)}
          >
            +7д
          </Button>
        </div>
      ) : null}

      <AgroplanMobileDetail
        block={detailBlock}
        dayRisks={data.dayRisks}
        onClose={() => setDetailBlock(null)}
        onPlan={(block) => {
          setDetailBlock(null);
          onPlan(block.insight);
        }}
        onOrder={(block) => {
          setDetailBlock(null);
          onOrder(block.insight);
        }}
        onDismiss={(block) => {
          data.dismissBlock(block.id);
          setDetailBlock(null);
        }}
        onShiftDays={(block, days) => {
          data.shiftBlockByDays(block, days);
          setDetailBlock(null);
        }}
        onDurationChange={(block, hours) =>
          data.setBlockDurationHours(block, hours)
        }
        onUndo={data.undoLastChange}
      />
    </div>
  );
}

function MobileTaskCard({
  block,
  pulsing,
  onOpen,
  onPlan,
  onOrder,
}: {
  block: AgroplanBlock;
  pulsing: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onOrder: () => void;
}) {
  const accent = operationAccent(
    block.insight.operationType,
    block.insight.kind
  );
  const deficit = block.insight.resourceStatus.status === "DEFICIT";
  const isOp = block.source === "operation";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className={cn(
        "rounded-2xl border bg-[#0c0e13]/90 p-4 backdrop-blur-sm",
        accent.border,
        accent.glow,
        isOp && "border-solid",
        !isOp && "border-dashed",
        pulsing && "animate-pulse",
        block.operationStatus === "in_progress" &&
          "ring-1 ring-emerald-400/35"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-sm font-medium", accent.text)}>
            {block.insight.operationName}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{block.fieldName}</p>
          {isOp ? (
            <p className="mt-1 text-[10px] uppercase tracking-wider text-cyan-400/80">
              {block.operationStatus === "in_progress"
                ? "У роботі"
                : block.operationStatus === "completed"
                  ? "Виконано"
                  : "Наряд"}
            </p>
          ) : null}
        </div>
        {deficit ? (
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]" />
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {block.insight.explanation}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {!isOp || block.operationStatus === "planned" ? (
          <Button
            type="button"
            size="sm"
            className="h-9 flex-1 bg-emerald-600/90 text-xs hover:bg-emerald-600"
            onClick={(e) => {
              e.stopPropagation();
              onPlan();
            }}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {isOp ? "Відкрити" : "Планувати"}
          </Button>
        ) : null}
        {deficit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 border-rose-400/35 text-xs text-rose-200"
            onClick={(e) => {
              e.stopPropagation();
              onOrder();
            }}
          >
            <Package className="mr-1.5 h-3.5 w-3.5" />
            ТМЦ
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 border-white/10 text-xs text-zinc-300"
            disabled
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Склад OK
          </Button>
        )}
      </div>

      {block.insight.isCriticalPriority ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <AlertTriangle className="h-3.5 w-3.5" />
          Критичний пріоритет
        </p>
      ) : null}
    </article>
  );
}

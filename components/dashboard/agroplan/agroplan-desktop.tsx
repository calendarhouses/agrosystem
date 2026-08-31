"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Orbit } from "lucide-react";

import {
  AgroplanCanvas,
  type AgroplanCanvasHandle,
} from "@/components/dashboard/agroplan/agroplan-canvas";
import {
  AgroplanFieldRail,
  useExpandedFields,
} from "@/components/dashboard/agroplan/agroplan-field-rail";
import { AgroplanResourceRail } from "@/components/dashboard/agroplan/agroplan-resource-rail";
import { AgroplanToolbar } from "@/components/dashboard/agroplan/agroplan-toolbar";
import type { AgroplanData } from "@/components/dashboard/agroplan/use-agroplan-data";
import { groupBlocksByField } from "@/lib/agroplan/blocks";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { blocksOnFields } from "@/lib/agroplan/block-overrides";
import type { InsightCardData } from "@/lib/agronomy-engine";
import { cn } from "@/lib/utils";

type Props = {
  data: AgroplanData;
  onPlan: (insight: InsightCardData) => void;
  onOrder: (insight: InsightCardData) => void;
};

export function AgroplanDesktop({ data, onPlan, onOrder }: Props) {
  const { expandedIds, toggle, setExpandedIds } = useExpandedFields(data.fields);
  const [selectedBlock, setSelectedBlock] = useState<AgroplanBlock | null>(null);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    () => new Set()
  );
  const [zoomIndex, setZoomIndex] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const canvasRef = useRef<AgroplanCanvasHandle | null>(null);

  const blocksByField = useMemo(
    () => groupBlocksByField(data.filteredBlocks),
    [data.filteredBlocks]
  );

  const activeFieldIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of data.activeOps) {
      if (op.fieldId) set.add(op.fieldId);
    }
    return set;
  }, [data.activeOps]);

  function handleFieldToggle(fieldId: string, opts?: { multi?: boolean }) {
    if (opts?.multi) {
      setSelectedFieldIds((prev) => {
        const next = new Set(prev);
        if (next.has(fieldId)) next.delete(fieldId);
        else next.add(fieldId);
        return next;
      });
      return;
    }
    toggle(fieldId);
  }

  function handleBulkShift(daysDelta: number) {
    const blockIds = blocksOnFields(data.blocks, selectedFieldIds);
    data.bulkShiftBlocks(blockIds, daysDelta);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "t" || e.key === "T" || e.key === "е" || e.key === "Е") {
        canvasRef.current?.scrollToToday();
      }
      if (e.key === "+" || e.key === "=") {
        setZoomIndex((i) => Math.min(3, i + 1));
      }
      if (e.key === "-") {
        setZoomIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === " ") {
        e.preventDefault();
        setPanMode(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        data.undoLastChange();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") setPanMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [data]);

  return (
    <div className="flex h-full flex-col bg-[#07080b] text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300">
          <Orbit className="h-5 w-5" strokeWidth={1.6} />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-[0.04em] text-zinc-100">
            Агроплан
          </h1>
          <p className="truncate text-xs text-zinc-500">
            Сезон {data.seasonId} · {data.filteredBlocks.length} операцій
            {data.fieldsLoading ? " · завантаження…" : ` · ${data.fields.length} полів`}
            {data.realtimePulse ? " · live" : ""}
          </p>
        </div>
        {data.liveWeather ? (
          <div
            className={cn(
              "ml-auto hidden text-right text-xs md:block",
              data.realtimePulse && "text-emerald-400/90"
            )}
          >
            <span className="text-zinc-300">
              {Math.round(data.liveWeather.tempC)}°C
            </span>
            {" · "}
            вітер {Math.round(data.liveWeather.windMs)} м/с
            {data.liveWeather.soilTempC != null
              ? ` · ґрунт ${Math.round(data.liveWeather.soilTempC)}°C`
              : ""}
          </div>
        ) : null}
      </header>

      <AgroplanToolbar
        zoomIndex={zoomIndex}
        onZoomIndexChange={setZoomIndex}
        onGoToday={() => canvasRef.current?.scrollToToday()}
        panMode={panMode}
        onPanModeChange={setPanMode}
        filters={data.filters}
        onFiltersChange={data.setFilters}
        onExpandAll={() =>
          setExpandedIds(new Set(data.fields.map((f) => f.id)))
        }
        onCollapseAll={() => setExpandedIds(new Set())}
        selectedFieldCount={selectedFieldIds.size}
        onBulkShift={handleBulkShift}
        onClearSelection={() => setSelectedFieldIds(new Set())}
      />

      <div className="flex min-h-0 flex-1">
        <AgroplanFieldRail
          fields={data.fields}
          blocksByField={blocksByField}
          expandedIds={expandedIds}
          selectedFieldIds={selectedFieldIds}
          activeFieldIds={activeFieldIds}
          ndviAlerts={data.ndviAlerts}
          onToggle={handleFieldToggle}
          searchQuery={data.filters.query}
        />
        <AgroplanCanvas
          canvasRef={canvasRef}
          fields={data.fields}
          blocks={data.filteredBlocks}
          filters={data.filters}
          expandedFieldIds={expandedIds}
          selectedFieldIds={selectedFieldIds}
          selectedBlockId={selectedBlock?.id ?? null}
          ndviAlerts={data.ndviAlerts}
          season={data.season}
          dayRisks={data.dayRisks}
          forecastHours={data.forecastHours}
          activeOps={data.activeOps}
          zoomIndex={zoomIndex}
          onZoomIndexChange={setZoomIndex}
          panMode={panMode}
          onSelectBlock={setSelectedBlock}
          onMoveBlock={data.setBlockStartMs}
          onResizeBlock={data.setBlockDurationHours}
          onExpandAll={() =>
            setExpandedIds(new Set(data.fields.map((f) => f.id)))
          }
        />
      </div>

      <AgroplanResourceRail
        block={selectedBlock}
        dayRisks={data.dayRisks}
        forecastHours={data.forecastHours}
        onClose={() => setSelectedBlock(null)}
        onPlan={(block) => {
          onPlan(block.insight);
          setSelectedBlock(null);
        }}
        onOrder={(block) => {
          onOrder(block.insight);
          setSelectedBlock(null);
        }}
        onDismiss={(block) => {
          data.dismissBlock(block.id);
          setSelectedBlock(null);
        }}
        onShiftDays={(block, days) => data.shiftBlockByDays(block, days)}
        onDurationChange={(block, hours) =>
          data.setBlockDurationHours(block, hours)
        }
      />
    </div>
  );
}

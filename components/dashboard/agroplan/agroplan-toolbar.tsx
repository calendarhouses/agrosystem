"use client";

import {
  ChevronLeft,
  ChevronRight,
  Hand,
  Minus,
  Plus,
  Target,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AGROPLAN_ZOOM_LEVELS,
  type AgroplanZoomLevel,
} from "@/lib/agroplan/timeline";
import type { AgroInsightStatus } from "@/lib/agronomy-engine";
import type { AgroplanFilters } from "@/lib/agroplan/filters";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AgroInsightStatus, string> = {
  PERFECT_CONDITIONS: "Зараз",
  WAITING_WEATHER: "Очікування",
  PLANNING: "План",
};

type Props = {
  zoomIndex: number;
  onZoomIndexChange: (index: number) => void;
  onGoToday: () => void;
  panMode: boolean;
  onPanModeChange: (v: boolean) => void;
  filters: AgroplanFilters;
  onFiltersChange: (next: AgroplanFilters) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  selectedFieldCount?: number;
  onBulkShift?: (daysDelta: number) => void;
  onClearSelection?: () => void;
};

export function AgroplanToolbar({
  zoomIndex,
  onZoomIndexChange,
  onGoToday,
  panMode,
  onPanModeChange,
  filters,
  onFiltersChange,
  onExpandAll,
  onCollapseAll,
  selectedFieldCount = 0,
  onBulkShift,
  onClearSelection,
}: Props) {
  function toggleStatus(status: AgroInsightStatus) {
    const next = new Set(filters.statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onFiltersChange({ ...filters, statuses: next });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#080a0e]/90 px-3 py-2">
      <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-black/30 p-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
          onClick={() => onZoomIndexChange(Math.max(0, zoomIndex - 1))}
          disabled={zoomIndex === 0}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        {AGROPLAN_ZOOM_LEVELS.map((level: AgroplanZoomLevel, i) => (
          <button
            key={level.id}
            type="button"
            onClick={() => onZoomIndexChange(i)}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] uppercase tracking-wider transition-colors",
              i === zoomIndex
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {level.label}
          </button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
          onClick={() =>
            onZoomIndexChange(
              Math.min(AGROPLAN_ZOOM_LEVELS.length - 1, zoomIndex + 1)
            )
          }
          disabled={zoomIndex === AGROPLAN_ZOOM_LEVELS.length - 1}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 border-white/10 bg-transparent text-xs text-zinc-300"
        onClick={onGoToday}
      >
        <Target className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
        Сьогодні
      </Button>

      <Button
        type="button"
        size="sm"
        variant={panMode ? "default" : "outline"}
        className={cn(
          "h-8 text-xs",
          panMode
            ? "bg-cyan-600/80 hover:bg-cyan-600"
            : "border-white/10 bg-transparent text-zinc-300"
        )}
        onClick={() => onPanModeChange(!panMode)}
      >
        <Hand className="mr-1.5 h-3.5 w-3.5" />
        Pan
      </Button>

      <Input
        value={filters.query}
        onChange={(e) =>
          onFiltersChange({ ...filters, query: e.target.value })
        }
        placeholder="Пошук поля / операції…"
        className="h-8 w-40 border-white/10 bg-black/30 text-xs text-zinc-200 placeholder:text-zinc-600 lg:w-52"
      />

      <div className="hidden items-center gap-2 lg:flex">
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
          <span className="h-2 w-4 rounded border border-dashed border-emerald-400/50" />
          Рекомендація
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
          <span className="h-2 w-4 rounded border border-cyan-400/50 bg-cyan-950/30" />
          Наряд
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          Дефіцит
        </span>
      </div>

      <div className="hidden items-center gap-1 md:flex">
        {(Object.keys(STATUS_LABELS) as AgroInsightStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => toggleStatus(status)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              filters.statuses.has(status)
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-white/[0.06] text-zinc-600 line-through"
            )}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <div className="hidden items-center gap-1.5 sm:flex">
        <FilterChip
          active={filters.showInsights}
          label="AI"
          onClick={() =>
            onFiltersChange({ ...filters, showInsights: !filters.showInsights })
          }
        />
        <FilterChip
          active={filters.showOperations}
          label="Наряди"
          onClick={() =>
            onFiltersChange({
              ...filters,
              showOperations: !filters.showOperations,
            })
          }
        />
        <FilterChip
          active={filters.showAnomalies}
          label="NDVI"
          onClick={() =>
            onFiltersChange({
              ...filters,
              showAnomalies: !filters.showAnomalies,
            })
          }
        />
      </div>

      {selectedFieldCount > 0 && onBulkShift ? (
        <div className="flex items-center gap-1 rounded-lg border border-violet-400/20 bg-violet-500/[0.06] px-1.5 py-0.5">
          <span className="text-[10px] text-violet-200">
            {selectedFieldCount} пол.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-violet-200 hover:bg-violet-400/10"
            onClick={() => onBulkShift(-1)}
          >
            −1д
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-violet-200 hover:bg-violet-400/10"
            onClick={() => onBulkShift(1)}
          >
            +1д
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-violet-200 hover:bg-violet-400/10"
            onClick={() => onBulkShift(7)}
          >
            +7д
          </Button>
          {onClearSelection ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px] text-zinc-500"
              onClick={onClearSelection}
            >
              ✕
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="ml-auto hidden items-center gap-1 sm:flex">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-[10px] text-zinc-500"
          onClick={onExpandAll}
        >
          <ChevronRight className="mr-0.5 h-3 w-3" />
          Усі
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-[10px] text-zinc-500"
          onClick={onCollapseAll}
        >
          <ChevronLeft className="mr-0.5 h-3 w-3" />
          Згорнути
        </Button>
      </div>

      <span className="hidden text-[10px] text-zinc-600 lg:inline">
        T — сьогодні · +/- — зум · ⌘Z — скасувати · ⌘+клік — вибір полів
      </span>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
          : "border-white/[0.06] text-zinc-600 line-through"
      )}
    >
      {label}
    </button>
  );
}

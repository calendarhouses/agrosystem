"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import { buildNdviFieldFlags } from "@/lib/agroplan/ndvi-layer";
import type { FarmField } from "@/lib/farm-fields";
import { todayKyivYmd, toKyivDayKey } from "@/lib/kyiv-date";
import { cn } from "@/lib/utils";

type Props = {
  fields: FarmField[];
  blocksByField: Map<string, AgroplanBlock[]>;
  expandedIds: Set<string>;
  selectedFieldIds?: Set<string>;
  activeFieldIds: Set<string>;
  ndviAlerts?: readonly import("@/lib/agronomy-engine").AgroNdviAlert[];
  onToggle: (fieldId: string, opts?: { multi?: boolean }) => void;
  searchQuery?: string;
};

export function AgroplanFieldRail({
  fields,
  blocksByField,
  expandedIds,
  selectedFieldIds,
  activeFieldIds,
  ndviAlerts = [],
  onToggle,
  searchQuery = "",
}: Props) {
  const q = searchQuery.trim().toLowerCase();
  const today = todayKyivYmd();
  const ndviFlags = buildNdviFieldFlags(ndviAlerts);
  const visibleFields = q
    ? fields.filter((f) => {
        const hay = `${f.name} ${f.crop ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
    : fields;

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#080a0e]/95">
      <div className="border-b border-white/[0.06] px-3 py-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          Поля · {visibleFields.length}
        </p>
      </div>
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {visibleFields.length === 0 ? (
          <p className="px-3 py-6 text-xs text-zinc-600">Немає полів</p>
        ) : (
          visibleFields.map((field) => (
            <FieldAccordionRow
              key={field.id}
              field={field}
              blocks={blocksByField.get(field.id) ?? []}
              expanded={expandedIds.has(field.id)}
              selected={selectedFieldIds?.has(field.id) ?? false}
              isLive={activeFieldIds.has(field.id)}
              ndviDrop={ndviFlags.get(field.id)?.dropPercent}
              todayPerfectCount={countTodayPerfect(
                blocksByField.get(field.id) ?? [],
                today
              )}
              onToggle={(multi) => onToggle(field.id, { multi })}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function countTodayPerfect(blocks: AgroplanBlock[], today: string): number {
  return blocks.filter((b) => {
    if (toKyivDayKey(new Date(b.startMs)) !== today) return false;
    return (
      b.insight.status === "PERFECT_CONDITIONS" ||
      b.operationStatus === "in_progress"
    );
  }).length;
}

function FieldAccordionRow({
  field,
  blocks,
  expanded,
  selected,
  isLive,
  ndviDrop,
  todayPerfectCount,
  onToggle,
}: {
  field: FarmField;
  blocks: AgroplanBlock[];
  expanded: boolean;
  selected: boolean;
  isLive: boolean;
  ndviDrop?: number;
  todayPerfectCount: number;
  onToggle: (multi: boolean) => void;
}) {
  return (
    <div className="border-b border-white/[0.04]">
      <button
        type="button"
        onClick={(e) => onToggle(e.metaKey || e.ctrlKey)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]",
          expanded && "bg-white/[0.02]",
          selected && "bg-violet-500/[0.08] ring-1 ring-inset ring-violet-400/25",
          isLive && !selected && "bg-emerald-400/[0.04]"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform",
            !expanded && "-rotate-90"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium text-zinc-200">
              {field.name}
            </p>
            {isLive ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            ) : null}
            {ndviDrop != null ? (
              <span
                className="shrink-0 rounded bg-violet-500/15 px-1 py-0.5 text-[9px] font-medium text-violet-300"
                title={`NDVI −${ndviDrop}%`}
              >
                NDVI
              </span>
            ) : null}
          </div>
          <p className="truncate text-[10px] text-zinc-600">
            {field.crop || "—"} · {blocks.length} оп.
          </p>
        </div>
        {todayPerfectCount > 0 ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            {todayPerfectCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** Хук для керування розгорнутими полями */
export function useExpandedFields(fields: FarmField[]) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (fields.length === 0) return;
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev;
      const initial = new Set<string>();
      for (const f of fields.slice(0, 4)) initial.add(f.id);
      return initial;
    });
  }, [fields]);

  function toggle(fieldId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  return { expandedIds, toggle, setExpandedIds };
}

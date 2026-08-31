"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Droplets, Sprout, Tractor, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { planningDragData } from "@/lib/planning/dnd-ids";
import type { PlanningTask } from "@/lib/planning/types";
import {
  inferTaskAccent,
  taskPillBorderClass,
  taskPillGradientClass,
  type PlanningTaskAccent,
} from "@/lib/planning/task-visual";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { cn } from "@/lib/utils";

export type TaskPillProps = {
  task: PlanningTask;
  width: number;
  left: number;
  top: number;
  selected?: boolean;
  resourceDeficit?: boolean;
  completionPct?: number;
};

const ICON_BY_ACCENT: Record<PlanningTaskAccent, LucideIcon> = {
  sowing: Sprout,
  harvest: Wheat,
  default: Tractor,
};

function pillIcon(accent: PlanningTaskAccent, operationType?: string): LucideIcon {
  if (accent !== "default") return ICON_BY_ACCENT[accent];
  if (operationType?.toLowerCase() === "тмц") return Droplets;
  return Tractor;
}

export function TaskPill({
  task,
  width,
  left,
  top,
  selected = false,
  resourceDeficit = false,
  completionPct = 0,
}: TaskPillProps) {
  const selectTaskById = usePlanningStore((s) => s.selectTaskById);
  const accent = inferTaskAccent(task);
  const Icon = pillIcon(accent, task.operationType);
  const progress = Math.max(0, Math.min(100, completionPct));

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: planningDragData(task.id),
    });

  const dragStyle = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={task.operationName}
      style={{
        left,
        top,
        width: Math.max(width, 28),
        ...dragStyle,
      }}
      {...listeners}
      {...attributes}
      onClick={() => selectTaskById(task.id)}
      className={cn(
        "absolute z-[2] flex h-5 cursor-grab items-center justify-center rounded-full border",
        "transition-shadow active:cursor-grabbing",
        taskPillGradientClass(accent),
        taskPillBorderClass(accent),
        selected && "ring-2 ring-emerald-400/55 ring-offset-1 ring-offset-zinc-950",
        isDragging && "opacity-40"
      )}
    >
      <Icon
        className="size-3 shrink-0 text-zinc-100/90"
        strokeWidth={2}
        aria-hidden
      />

      {resourceDeficit ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-red-500 ring-2 ring-zinc-950"
          aria-label="Дефіцит ресурсів"
        />
      ) : null}

      {progress > 0 ? (
        <span
          className="pointer-events-none absolute inset-x-1 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-zinc-950/40"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-emerald-400"
            style={{ width: `${progress}%` }}
          />
        </span>
      ) : null}
    </button>
  );
}

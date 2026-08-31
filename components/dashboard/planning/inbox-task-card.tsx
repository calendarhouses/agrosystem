"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { PlanningTask } from "@/lib/planning/types";
import {
  formatDurationDays,
  inferTaskAccent,
  taskAccentClass,
} from "@/lib/planning/task-visual";
import { planningDragData } from "@/lib/planning/dnd-ids";
import { cn } from "@/lib/utils";

type InboxTaskCardProps = {
  task: PlanningTask;
  selected?: boolean;
  onSelect?: () => void;
  /** Overlay clone — always shown lifted */
  overlay?: boolean;
};

export function InboxTaskCard({
  task,
  selected = false,
  onSelect,
  overlay = false,
}: InboxTaskCardProps) {
  const accent = inferTaskAccent(task);
  const lifted = overlay;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: planningDragData(task.id),
      disabled: overlay,
    });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const dragging = isDragging || overlay;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      role="button"
      tabIndex={overlay ? -1 : 0}
      onClick={overlay ? undefined : onSelect}
      onKeyDown={
        overlay
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") onSelect?.();
            }
      }
      className={cn(
        "relative flex w-full cursor-grab overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 text-left transition-[box-shadow,transform,opacity] duration-200 ease-out active:cursor-grabbing",
        "hover:border-zinc-700",
        selected && !dragging && "border-zinc-700 ring-1 ring-emerald-500/25",
        dragging &&
          "z-50 scale-[1.03] border-zinc-700 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)]",
        isDragging && !overlay && "opacity-40"
      )}
    >
      <span
        className={cn("w-0.5 shrink-0 self-stretch", taskAccentClass(accent))}
        aria-hidden
      />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <p className="truncate text-[13px] font-medium leading-snug text-zinc-100">
          {task.operationName}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-zinc-400">{task.fieldName}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {formatDurationDays(task.durationDays)}
          </span>
        </div>
      </div>
    </div>
  );
}

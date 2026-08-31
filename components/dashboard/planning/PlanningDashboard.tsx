"use client";

import { useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { InboxTaskCard } from "@/components/dashboard/planning/inbox-task-card";
import { InboxQueue } from "@/components/dashboard/planning/InboxQueue";
import { InspectorPanel } from "@/components/dashboard/planning/InspectorPanel";
import { MatrixCanvas } from "@/components/dashboard/planning/MatrixCanvas";
import { usePlanningBootstrap } from "@/components/dashboard/planning/use-planning-bootstrap";
import { parseMatrixCellDropId } from "@/lib/planning/dnd-ids";
import { persistTaskSchedule } from "@/lib/planning/persist-schedule";
import type { PlanningTask } from "@/lib/planning/types";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { toast } from "sonner";

/** Premium B2B Agro OS — 3-zone planning dashboard (Tech-Noir) */
export function PlanningDashboard() {
  usePlanningBootstrap();

  const draftTasks = usePlanningStore((s) => s.draftTasks);
  const scheduledTasks = usePlanningStore((s) => s.scheduledTasks);
  const activeDragItem = usePlanningStore((s) => s.activeDragItem);
  const setActiveDragItem = usePlanningStore((s) => s.setActiveDragItem);
  const scheduleTask = usePlanningStore((s) => s.scheduleTask);
  const moveScheduledTask = usePlanningStore((s) => s.moveScheduledTask);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const taskById = useMemo(() => {
    const map = new Map<string, PlanningTask>();
    for (const t of draftTasks) map.set(t.id, t);
    for (const t of scheduledTasks) map.set(t.id, t);
    return map;
  }, [draftTasks, scheduledTasks]);

  const resolveTask = useCallback(
    (id: string | number) => taskById.get(String(id)) ?? null,
    [taskById]
  );

  function handleDragStart(event: DragStartEvent) {
    const task = resolveTask(event.active.id);
    if (task) setActiveDragItem(task);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    const task = resolveTask(event.active.id);
    const cell = parseMatrixCellDropId(event.over?.id);
    if (!task || !cell) return;

    const isScheduled = scheduledTasks.some((t) => t.id === task.id);
    if (isScheduled) {
      moveScheduledTask(task.id, cell.fieldId, cell.dateYmd);
    } else {
      scheduleTask(task.id, cell.fieldId, cell.dateYmd);
    }

    const updated: PlanningTask = {
      ...task,
      fieldId: cell.fieldId,
      scheduledYmd: cell.dateYmd,
    };
    const field = usePlanningStore
      .getState()
      .fields.find((f) => f.id === cell.fieldId);
    if (field) {
      updated.fieldName = field.name;
      updated.crop = field.crop ?? task.crop;
    }

    const result = await persistTaskSchedule(updated, cell.dateYmd);
    if (!result.ok) {
      toast.error(result.error ?? "Не вдалося зберегти на сервері");
    }
  }

  function handleDragCancel() {
    setActiveDragItem(null);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="relative flex h-full min-h-0 bg-zinc-950 text-zinc-100">
        <InboxQueue className="hidden md:flex" />
        <MatrixCanvas />
        <InspectorPanel />
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeDragItem ? (
          <InboxTaskCard task={activeDragItem} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

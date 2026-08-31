"use client";

import { create } from "zustand";

import type { PlanningField, PlanningTask } from "@/lib/planning/types";

type PlanningState = {
  fields: PlanningField[];
  draftTasks: PlanningTask[];
  scheduledTasks: PlanningTask[];
  selectedTask: PlanningTask | null;
  activeDragItem: PlanningTask | null;
  loading: boolean;

  setFields: (fields: PlanningField[]) => void;
  setLoading: (loading: boolean) => void;
  hydrateTasks: (draft: PlanningTask[], scheduled: PlanningTask[]) => void;
  selectTask: (task: PlanningTask | null) => void;
  selectTaskById: (taskId: string | null) => void;
  setActiveDragItem: (task: PlanningTask | null) => void;
  scheduleTask: (taskId: string, fieldId: string, ymd: string) => void;
  moveScheduledTask: (taskId: string, fieldId: string, ymd: string) => void;
  unscheduleTask: (taskId: string) => void;
};

function findTask(state: PlanningState, taskId: string): PlanningTask | undefined {
  return (
    state.draftTasks.find((t) => t.id === taskId) ??
    state.scheduledTasks.find((t) => t.id === taskId)
  );
}

export const usePlanningStore = create<PlanningState>((set, get) => ({
  fields: [],
  draftTasks: [],
  scheduledTasks: [],
  selectedTask: null,
  activeDragItem: null,
  loading: true,

  setFields: (fields) => set({ fields }),

  setLoading: (loading) => set({ loading }),

  hydrateTasks: (draft, scheduled) =>
    set({
      draftTasks: draft,
      scheduledTasks: scheduled,
      selectedTask: null,
      activeDragItem: null,
    }),

  selectTask: (task) => set({ selectedTask: task }),

  selectTaskById: (taskId) => {
    if (!taskId) {
      set({ selectedTask: null });
      return;
    }
    const task = findTask(get(), taskId);
    if (task) set({ selectedTask: task });
  },

  setActiveDragItem: (task) => set({ activeDragItem: task }),

  scheduleTask: (taskId, fieldId, ymd) => {
    const state = get();
    const task = findTask(state, taskId);
    if (!task) return;

    const field =
      state.fields.find((f) => f.id === fieldId) ??
      ({ id: fieldId, name: task.fieldName, crop: task.crop } satisfies PlanningField);

    const next: PlanningTask = {
      ...task,
      fieldId: field.id,
      fieldName: field.name,
      crop: field.crop ?? task.crop,
      scheduledYmd: ymd,
    };

    set({
      draftTasks: state.draftTasks.filter((t) => t.id !== taskId),
      scheduledTasks: [
        ...state.scheduledTasks.filter((t) => t.id !== taskId),
        next,
      ],
      selectedTask: next,
      activeDragItem: null,
    });
  },

  moveScheduledTask: (taskId, fieldId, ymd) => {
    get().scheduleTask(taskId, fieldId, ymd);
  },

  unscheduleTask: (taskId) => {
    const state = get();
    const task = state.scheduledTasks.find((t) => t.id === taskId);
    if (!task) return;

    const { scheduledYmd: _drop, ...draftBase } = task;
    const draft: PlanningTask = { ...draftBase };

    set({
      scheduledTasks: state.scheduledTasks.filter((t) => t.id !== taskId),
      draftTasks: [draft, ...state.draftTasks.filter((t) => t.id !== taskId)],
      selectedTask: null,
    });
  },
}));

"use client";

import { Inbox } from "lucide-react";

import { InboxTaskCard } from "@/components/dashboard/planning/inbox-task-card";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export function InboxQueue({ className }: Props) {
  const draftTasks = usePlanningStore((s) => s.draftTasks);
  const selectTask = usePlanningStore((s) => s.selectTask);
  const selectedTask = usePlanningStore((s) => s.selectedTask);

  return (
    <aside
      className={cn(
        "flex w-[300px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950",
        className
      )}
    >
      <header className="border-b border-zinc-800 px-4 py-4">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold tracking-wide text-zinc-100">
            Черга
          </h2>
          <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">
            {draftTasks.length}
          </span>
        </div>
      </header>

      <div className="custom-scrollbar desktop-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
        {draftTasks.length === 0 ? (
          <p className="px-1 py-8 text-center text-xs text-zinc-500">
            Черга порожня
          </p>
        ) : (
          draftTasks.map((task) => (
            <InboxTaskCard
              key={task.id}
              task={task}
              selected={selectedTask?.id === task.id}
              onSelect={() => selectTask(task)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

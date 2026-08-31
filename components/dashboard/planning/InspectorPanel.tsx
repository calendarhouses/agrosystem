"use client";

import { useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Tractor,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { submitAgroPurchaseRequest } from "@/app/calendar/actions";
import { useInspectorData } from "@/components/dashboard/planning/use-inspector-data";
import { Button } from "@/components/ui/button";
import type { FieldOperationStatus } from "@/lib/field-operations";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { currentAgroSeason } from "@/lib/season";
import { cn } from "@/lib/utils";

const PANEL_W = 400;

export function InspectorPanel() {
  const selectedTask = usePlanningStore((s) => s.selectedTask);
  const selectTask = usePlanningStore((s) => s.selectTask);
  const data = useInspectorData(selectedTask);

  return (
    <AnimatePresence>
      {selectedTask ? (
        <motion.aside
          key="planning-inspector"
          initial={{ x: PANEL_W }}
          animate={{ x: 0 }}
          exit={{ x: PANEL_W }}
          transition={{ type: "spring", damping: 30, stiffness: 340 }}
          className={cn(
            "absolute inset-y-0 right-0 z-40 flex flex-col",
            "border-l border-zinc-800/80 bg-zinc-900/90 shadow-2xl backdrop-blur-md"
          )}
          style={{ width: PANEL_W }}
        >
          <InspectorContent
            task={selectedTask}
            data={data}
            onClose={() => selectTask(null)}
          />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function InspectorContent({
  task,
  data,
  onClose,
}: {
  task: NonNullable<ReturnType<typeof usePlanningStore.getState>["selectedTask"]>;
  data: ReturnType<typeof useInspectorData>;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { resource, fleet, operation, loading, areaHa } = data;

  const needsTmc = resource.requiredQty > 0;
  const isDeficit = resource.status === "DEFICIT";
  const fleetBusy = fleet.status === "BUSY";

  function handleWarehouseRequest() {
    if (!resource.itemRefKey && !resource.item) {
      toast.error("Немає позиції складу для заявки");
      return;
    }

    const qty =
      resource.deficitQty > 0
        ? resource.deficitQty
        : Math.max(resource.requiredQty, 1);

    startTransition(async () => {
      const res = await submitAgroPurchaseRequest({
        itemRefKey: resource.itemRefKey,
        itemName: resource.item ?? "ТМЦ",
        qty,
        unit: resource.unit || "од.",
        unitPriceUah: resource.unitPriceUah,
        reason: `Операція ${task.operationName} (${task.fieldName})`,
        operationName: task.operationName,
        fieldNames: [task.fieldName],
        seasonYear: Number(currentAgroSeason()),
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(
        res.id
          ? "Заявку створено — чернетка на складі"
          : "Заявку записано в журнал бухгалтера"
      );
    });
  }

  return (
    <>
      <header className="flex items-start justify-between border-b border-zinc-800/80 px-5 py-4">
        <div className="min-w-0 pr-3">
          <h2 className="truncate text-base font-semibold tracking-tight text-zinc-100">
            {task.operationName}
          </h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{task.fieldName}</p>
          {areaHa > 0 ? (
            <p className="mt-0.5 text-[11px] text-zinc-600">
              {Math.round(areaHa * 10) / 10} га
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            "text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100",
            "hover:ring-1 hover:ring-emerald-500/40"
          )}
          aria-label="Закрити"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <SectionTitle>Ресурси (ТМЦ)</SectionTitle>
          {loading ? (
            <LoadingBlock />
          ) : needsTmc ? (
            isDeficit ? (
              <div className="space-y-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-rose-200">
                      Дефіцит: {resource.deficitQty} {resource.unit}
                    </p>
                    <p className="mt-0.5 text-xs text-rose-300/70">
                      Потрібно {resource.requiredQty} {resource.unit}
                      {resource.item ? ` · «${resource.item}»` : ""}
                      {" · "}на складі {resource.availableQty} {resource.unit}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={handleWarehouseRequest}
                  className={cn(
                    "h-9 w-full bg-rose-600/90 text-white hover:bg-rose-600",
                    "hover:ring-2 hover:ring-emerald-500/50 hover:ring-offset-0"
                  )}
                >
                  {pending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Створити заявку на склад
                </Button>
              </div>
            ) : (
              <StatusOk
                label={`${resource.item ?? "ТМЦ"} · ${resource.availableQty} ${resource.unit} на складі`}
              />
            )
          ) : (
            <StatusOk label="ТМЦ для цієї операції не потрібні" />
          )}
        </section>

        <section>
          <SectionTitle>Техніка</SectionTitle>
          {loading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-3">
              {operation ? (
                <AssignedMachinery operation={operation} />
              ) : null}

              {fleetBusy ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
                  <Tractor className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="text-sm text-amber-100">
                      Недостатньо вільної техніки
                    </p>
                    <p className="mt-0.5 text-xs text-amber-200/70">
                      Потрібно {fleet.requiredCount} · вільно{" "}
                      {fleet.availableCount} {fleet.unitLabel}
                    </p>
                  </div>
                </div>
              ) : (
                <StatusOk
                  label={`Доступно ${fleet.availableCount} ${fleet.unitLabel}`}
                />
              )}

              {data.matchingFleet.length > 0 ? (
                <ul className="space-y-1.5">
                  {data.matchingFleet.map((unit) => (
                    <FleetUnitRow key={unit.id} unit={unit} />
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}

function StatusOk({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2.5">
      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
      <span className="text-sm text-emerald-100">{label}</span>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" />
      Завантаження…
    </div>
  );
}

function AssignedMachinery({
  operation,
}: {
  operation: {
    machinery: string;
    implement: string;
    status: FieldOperationStatus;
  };
}) {
  const status = operationStatusLabel(operation.status);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">
        Призначено
      </p>
      <p className="mt-1 text-sm font-medium text-zinc-100">
        {operation.machinery !== "—" ? operation.machinery : "Не призначено"}
      </p>
      {operation.implement && operation.implement !== "—" ? (
        <p className="mt-0.5 text-xs text-zinc-500">
          Знаряддя: {operation.implement}
        </p>
      ) : null}
      <span
        className={cn(
          "mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
          status.tone
        )}
      >
        {status.label}
      </span>
    </div>
  );
}

function FleetUnitRow({ unit }: { unit: { id: string; name: string; isActive: boolean; isBusy: boolean } }) {
  const status = !unit.isActive
    ? { label: "Ремонт", className: "text-rose-400 bg-rose-500/10" }
    : unit.isBusy
      ? { label: "Зайнята", className: "text-amber-300 bg-amber-500/10" }
      : { label: "Вільна", className: "text-emerald-300 bg-emerald-500/10" };

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {unit.isActive ? (
          <Tractor className="size-3.5 shrink-0 text-zinc-500" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-zinc-500" />
        )}
        <span className="truncate text-xs text-zinc-300">{unit.name}</span>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          status.className
        )}
      >
        {status.label}
      </span>
    </li>
  );
}

function operationStatusLabel(status: FieldOperationStatus): {
  label: string;
  tone: string;
} {
  if (status === "in_progress") {
    return {
      label: "В роботі",
      tone: "bg-cyan-500/15 text-cyan-300",
    };
  }
  if (status === "completed") {
    return {
      label: "Виконано",
      tone: "bg-zinc-700/40 text-zinc-400",
    };
  }
  if (status === "cancelled") {
    return {
      label: "Скасовано",
      tone: "bg-rose-500/10 text-rose-400",
    };
  }
  return {
    label: "Заплановано",
    tone: "bg-emerald-500/10 text-emerald-300",
  };
}

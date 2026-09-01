"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Loader2, PackageMinus, Pencil, Trash2, Tractor } from "lucide-react";
import { toast } from "sonner";

import { deleteLocalMove, listLocalMoves } from "@/app/admin/inventory/actions";
import type { LocalMoveRow } from "@/app/admin/inventory/actions";
import { EditLocalMoveInline } from "@/components/dashboard/local-moves-history-sheet";
import {
  loadFieldOperationByClientKey,
  OperationsOperationForm,
} from "@/components/dashboard/operations-operation-form-sheet";
import {
  OperationsPanelShell,
  OperationsSheetHeader,
  opsSheetBodyClass,
} from "@/components/dashboard/operations-sheet-chrome";
import { Button } from "@/components/ui/button";
import { deleteFieldOperation, type FieldOperation } from "@/lib/field-operations";
import type { FieldTimelineField, UnifiedTimelineEvent } from "@/lib/field-timeline";
import {
  fieldOperationsKeyFromFarmId,
  parseTimelineEventId,
} from "@/lib/field-timeline-ids";
import { cn } from "@/lib/utils";

type OperationsEventDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: UnifiedTimelineEvent | null;
  field: FieldTimelineField | null;
  season: string;
  onChanged: () => void;
};

type DetailView = "detail" | "edit-equipment" | "edit-inventory";

function formatDetailDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMMM yyyy", { locale: uk });
}

export function OperationsEventDetailSheet({
  open,
  onOpenChange,
  event,
  field,
  season,
  onChanged,
}: OperationsEventDetailSheetProps) {
  const [view, setView] = useState<DetailView>("detail");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operation, setOperation] = useState<FieldOperation | null>(null);
  const [inventoryMove, setInventoryMove] = useState<LocalMoveRow | null>(null);

  const eventId = event?.id ?? null;
  const fieldId = field?.id ?? null;
  const isEquipment = event?.type === "equipment";

  useEffect(() => {
    if (!open) {
      setView("detail");
      setOperation(null);
      setInventoryMove(null);
      setLoading(false);
      return;
    }
    if (!eventId || !fieldId) return;

    const parsed = parseTimelineEventId(eventId);
    if (!parsed) return;

    let cancelled = false;
    setLoading(true);

    async function load() {
      if (parsed!.kind === "equipment") {
        const op = await loadFieldOperationByClientKey(fieldId!, parsed!.clientKey);
        if (!cancelled) {
          setOperation(op);
          setInventoryMove(null);
          setLoading(false);
        }
        return;
      }

      const res = await listLocalMoves({ season });
      if (cancelled) return;
      if (!res.ok) {
        toast.error(res.error);
        setLoading(false);
        return;
      }
      const move = res.moves.find((m) => m.id === parsed!.moveId) ?? null;
      setInventoryMove(move);
      setOperation(null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [eventId, fieldId, open, season]);

  async function handleDelete() {
    if (!eventId || !fieldId) return;
    const parsed = parseTimelineEventId(eventId);
    if (!parsed) return;

    const confirmed = window.confirm("Видалити цю позицію з хронології?");
    if (!confirmed) return;

    setDeleting(true);
    try {
      if (parsed.kind === "equipment") {
        await deleteFieldOperation(
          fieldOperationsKeyFromFarmId(fieldId),
          parsed.clientKey
        );
        toast.success("Наряд видалено");
      } else {
        const res = await deleteLocalMove(parsed.moveId);
        if (!res.ok) throw new Error(res.error);
        toast.success("Списання видалено");
      }
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося видалити");
    } finally {
      setDeleting(false);
    }
  }

  const shellTitle =
    view === "edit-equipment"
      ? "Редагувати наряд"
      : view === "edit-inventory"
        ? "Редагувати списання"
        : (event?.title ?? "Деталі");

  return (
    <OperationsPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={shellTitle}
    >
      {view === "edit-equipment" && field && operation ? (
        <OperationsOperationForm
          field={field}
          seasonYear={Number(season) || new Date().getFullYear()}
          initial={operation}
          onBack={() => setView("detail")}
          onSaved={() => {
            onChanged();
            onOpenChange(false);
          }}
        />
      ) : view === "edit-inventory" && inventoryMove ? (
        <>
          <OperationsSheetHeader
            icon={PackageMinus}
            accent="emerald"
            title="Редагувати списання"
            description={field?.name}
            onBack={() => setView("detail")}
          />
          <div className={cn(opsSheetBodyClass, "pt-0")}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <EditLocalMoveInline
                move={inventoryMove}
                onCancel={() => setView("detail")}
                onSaved={() => {
                  onChanged();
                  onOpenChange(false);
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <OperationsSheetHeader
            icon={isEquipment ? Tractor : PackageMinus}
            accent={isEquipment ? "orange" : "emerald"}
            title={event?.title ?? "Деталі"}
            description={
              <>
                {field?.name ?? "Поле"} ·{" "}
                {event ? formatDetailDate(event.date) : ""}
              </>
            }
          />

          <div className={opsSheetBodyClass}>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-zinc-400">
                <Loader2 className="mr-2 size-5 animate-spin" />
                Завантаження…
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-transparent p-5">
                  <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    {isEquipment ? "Техніка" : "ТМЦ"}
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-50">
                    {event?.metric}
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">{event?.subtitle}</p>
                  {operation?.machinery ? (
                    <p className="mt-3 text-sm text-zinc-400">
                      {operation.machinery}
                      {operation.implement ? ` · ${operation.implement}` : ""}
                    </p>
                  ) : null}
                  {operation?.agronomistComment ? (
                    <p className="mt-3 rounded-2xl bg-black/25 px-3 py-2 text-sm text-zinc-300">
                      {operation.agronomistComment}
                    </p>
                  ) : null}
                  {inventoryMove?.note ? (
                    <p className="mt-3 rounded-2xl bg-black/25 px-3 py-2 text-sm text-zinc-300">
                      {inventoryMove.note}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
                    onClick={() => {
                      const parsed = eventId
                        ? parseTimelineEventId(eventId)
                        : null;
                      if (parsed?.kind === "equipment") {
                        if (operation) setView("edit-equipment");
                        else toast.error("Наряд не знайдено");
                      } else if (inventoryMove) {
                        setView("edit-inventory");
                      } else {
                        toast.error("Списання не знайдено");
                      }
                    }}
                  >
                    <Pencil className="mr-2 size-4" />
                    Редагувати
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 size-4" />
                    )}
                    Видалити
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </OperationsPanelShell>
  );
}

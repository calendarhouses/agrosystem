"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Loader2, PackageMinus, Pencil, Trash2, Tractor } from "lucide-react";
import { toast } from "sonner";

import { deleteLocalMove, listLocalMoves } from "@/app/admin/inventory/actions";
import { EditLocalMoveInline } from "@/components/dashboard/local-moves-history-sheet";
import {
  loadFieldOperationByClientKey,
  OperationsOperationFormSheet,
} from "@/components/dashboard/operations-operation-form-sheet";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { deleteFieldOperation, type FieldOperation } from "@/lib/field-operations";
import type { FieldTimelineField, UnifiedTimelineEvent } from "@/lib/field-timeline";
import {
  fieldOperationsKeyFromFarmId,
  parseTimelineEventId,
} from "@/lib/field-timeline-ids";
import type { LocalMoveRow } from "@/app/admin/inventory/actions";

type OperationsEventDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: UnifiedTimelineEvent | null;
  field: FieldTimelineField | null;
  season: string;
  onChanged: () => void;
};

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
  const [editingEquipment, setEditingEquipment] = useState(false);
  const [editingInventory, setEditingInventory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operation, setOperation] = useState<FieldOperation | null>(null);
  const [inventoryMove, setInventoryMove] = useState<LocalMoveRow | null>(null);

  const parsed = event ? parseTimelineEventId(event.id) : null;
  const isEquipment = event?.type === "equipment";
  const detailOpen = open && !editingEquipment && !editingInventory;

  useEffect(() => {
    if (!open) {
      setEditingEquipment(false);
      setEditingInventory(false);
      setOperation(null);
      setInventoryMove(null);
      return;
    }
    if (!event || !field || !parsed) return;

    let cancelled = false;
    setLoading(true);

    async function load() {
      if (parsed!.kind === "equipment") {
        const op = await loadFieldOperationByClientKey(field!.id, parsed!.clientKey);
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
  }, [event, field, open, parsed, season]);

  async function handleDelete() {
    if (!event || !field || !parsed) return;
    const confirmed = window.confirm("Видалити цю позицію з хронології?");
    if (!confirmed) return;

    setDeleting(true);
    try {
      if (parsed.kind === "equipment") {
        await deleteFieldOperation(
          fieldOperationsKeyFromFarmId(field.id),
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

  return (
    <>
      <Drawer open={detailOpen} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92dvh] border-white/10 bg-zinc-950 text-zinc-50">
          <DrawerHeader className="border-b border-white/5 text-left">
            <DrawerTitle className="flex items-center gap-2 text-zinc-50">
              {isEquipment ? (
                <Tractor className="size-5 text-orange-400" />
              ) : (
                <PackageMinus className="size-5 text-emerald-400" />
              )}
              {event?.title ?? "Деталі"}
            </DrawerTitle>
            <DrawerDescription className="text-zinc-400">
              {field?.name ?? "Поле"} · {event ? formatDetailDate(event.date) : ""}
            </DrawerDescription>
          </DrawerHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-zinc-400">
                <Loader2 className="mr-2 size-5 animate-spin" />
                Завантаження…
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    {isEquipment ? "Техніка" : "ТМЦ"}
                  </p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-50">
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
                    <p className="mt-3 rounded-xl bg-black/20 px-3 py-2 text-sm text-zinc-300">
                      {operation.agronomistComment}
                    </p>
                  ) : null}
                  {inventoryMove?.note ? (
                    <p className="mt-3 rounded-xl bg-black/20 px-3 py-2 text-sm text-zinc-300">
                      {inventoryMove.note}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
                    onClick={() => {
                      if (parsed?.kind === "equipment") {
                        if (operation) setEditingEquipment(true);
                        else toast.error("Наряд не знайдено");
                      } else if (inventoryMove) {
                        setEditingInventory(true);
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
                    className="h-11 border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
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
        </DrawerContent>
      </Drawer>

      <OperationsOperationFormSheet
        open={Boolean(open && editingEquipment && operation && field)}
        onOpenChange={(next) => {
          if (!next) setEditingEquipment(false);
        }}
        field={field}
        seasonYear={Number(season) || new Date().getFullYear()}
        initial={operation}
        onSaved={() => {
          setEditingEquipment(false);
          onChanged();
          onOpenChange(false);
        }}
      />

      <Drawer
        open={open && editingInventory && Boolean(inventoryMove)}
        onOpenChange={(next) => {
          if (!next) setEditingInventory(false);
        }}
      >
        <DrawerContent className="max-h-[92dvh] border-white/10 bg-zinc-950 text-zinc-50">
          <DrawerHeader className="border-b border-white/5 text-left">
            <DrawerTitle className="text-zinc-50">Редагувати списання</DrawerTitle>
            <DrawerDescription className="text-zinc-400">
              {field?.name}
            </DrawerDescription>
          </DrawerHeader>
          {inventoryMove ? (
            <div className="overflow-y-auto px-4 py-4">
              <EditLocalMoveInline
                move={inventoryMove}
                onCancel={() => setEditingInventory(false)}
                onSaved={() => {
                  setEditingInventory(false);
                  onChanged();
                  onOpenChange(false);
                }}
              />
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </>
  );
}

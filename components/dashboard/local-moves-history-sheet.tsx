"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  History,
  Loader2,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteLocalMove,
  getQuickIssueOptions,
  listLocalMoves,
  updateLocalMove,
  type LocalMoveRow,
  type QuickIssueFieldOption,
} from "@/app/admin/inventory/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function LocalMovesHistoryButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={onClick}
      className={cn(
        "h-10 flex-1 gap-2 rounded-xl border-zinc-200 bg-[#FDFBF7] px-3 text-xs font-semibold text-zinc-700 shadow-sm",
        "hover:bg-zinc-50 sm:h-11 sm:flex-none sm:px-4 sm:text-sm",
        className
      )}
    >
      <History className="h-4 w-4" />
      <span className="truncate">Історія операцій</span>
    </Button>
  );
}

export function LocalMovesHistorySheet({
  open,
  onOpenChange,
  onChanged,
  refreshToken = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Змінюється після нового списання — оновити список, якщо sheet відкритий */
  refreshToken?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<LocalMoveRow[]>([]);
  const [editMove, setEditMove] = useState<LocalMoveRow | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listLocalMoves();
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setMoves([]);
      return;
    }
    setMoves(res.moves);
  }

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, refreshToken]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className={cn(
            "flex w-full flex-col gap-0 border-l border-[#E5DFD3] bg-[#FAF8F4] p-0 text-zinc-900 sm:max-w-lg",
            "[&_[data-slot=sheet-close]]:text-zinc-500"
          )}
        >
          <SheetHeader className="shrink-0 border-b border-[#E5DFD3] bg-white px-6 py-5 pr-14 text-left">
            <SheetTitle className="text-xl font-bold tracking-tight">
              Історія операцій
            </SheetTitle>
            <SheetDescription className="text-sm text-zinc-500">
              Локальні списання з тіньового складу
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Завантаження…
              </div>
            ) : error ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {error}
              </div>
            ) : moves.length === 0 ? (
              <p className="py-16 text-center text-sm text-zinc-500">
                Поки немає локальних списань
              </p>
            ) : (
              <ul className="space-y-2">
                {moves.map((move) => (
                  <LocalMoveListItem
                    key={move.id}
                    move={move}
                    onEdit={() => setEditMove(move)}
                    onDeleted={() => {
                      void load();
                      onChanged?.();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <EditLocalMoveDialog
        move={editMove}
        open={editMove != null}
        onOpenChange={(next) => {
          if (!next) setEditMove(null);
        }}
        onSaved={() => {
          setEditMove(null);
          void load();
          onChanged?.();
        }}
      />
    </>
  );
}

function LocalMoveListItem({
  move,
  onEdit,
  onDeleted,
}: {
  move: LocalMoveRow;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const isDraft = move.status === "draft";
  const dateLabel = (() => {
    try {
      return format(new Date(move.date), "d MMM yyyy, HH:mm", { locale: uk });
    } catch {
      return move.date;
    }
  })();

  function handleDelete() {
    if (!isDraft) return;
    startTransition(async () => {
      const res = await deleteLocalMove(move.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Списання видалено");
      onDeleted();
    });
  }

  return (
    <li className="rounded-2xl border border-[#E5DFD3] bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {move.itemName}
            </p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                isDraft
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-zinc-200 bg-zinc-50 text-zinc-500"
              )}
            >
              {isDraft ? "Чернетка" : "В 1С"}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">{dateLabel}</p>
          <p className="mt-2 text-sm font-bold tabular-nums text-zinc-900">
            {new Intl.NumberFormat("uk-UA", {
              maximumFractionDigits: 2,
            }).format(move.qty)}
            {move.itemUnit ? ` ${move.itemUnit}` : ""}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            → {move.fieldName || "Поле не вказано"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isDraft ? (
            <>
              <button
                type="button"
                onClick={onEdit}
                disabled={pending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                title="Редагувати"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                title="Видалити"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </>
          ) : (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300"
              title="Заблоковано — вже в 1С"
            >
              <Lock className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function EditLocalMoveDialog({
  move,
  open,
  onOpenChange,
  onSaved,
}: {
  move: LocalMoveRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState("");
  const [fieldId, setFieldId] = useState<string>("");
  const [fields, setFields] = useState<QuickIssueFieldOption[]>([]);
  const [fieldQuery, setFieldQuery] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !move) return;
    setQty(String(move.qty));
    setFieldId(move.fieldId ?? "");
    setFieldQuery("");
    void getQuickIssueOptions().then((res) => {
      if (res.ok) setFields(res.fields);
    });
  }, [open, move?.id]);

  const filteredFields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return fields
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          f.crop.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [fields, fieldQuery]);

  function handleSave() {
    if (!move) return;
    const qtyNum = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("Вкажіть кількість > 0");
      return;
    }
    if (!fieldId) {
      toast.error("Оберіть поле");
      return;
    }
    startTransition(async () => {
      const res = await updateLocalMove({
        id: move.id,
        qty: qtyNum,
        fieldId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Списання оновлено");
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редагувати списання</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {move?.itemName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">
              Кількість{move?.itemUnit ? ` (${move.itemUnit})` : ""}
            </label>
            <Input
              value={qty}
              inputMode="decimal"
              onChange={(e) => setQty(e.target.value)}
              className="h-11 text-base font-semibold tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">Поле</label>
            <Input
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Пошук поля…"
              className="h-9"
            />
            <div className="max-h-40 overflow-y-auto rounded-xl border border-zinc-200 bg-white">
              {filteredFields.map((f) => {
                const active = f.id === fieldId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFieldId(f.id)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-[#276749]/10 font-semibold text-[#276749]"
                        : "text-zinc-700 hover:bg-zinc-50"
                    )}
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-[11px] text-zinc-400">
                      {f.areaHa} га
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Скасувати
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="bg-[#276749] text-white hover:bg-[#1f5339]"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Зберегти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  History,
  Loader2,
  Lock,
  PackageMinus,
  PackagePlus,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AttachmentViewerButton } from "@/components/dashboard/attachment-viewer";

export function LocalMovesHistorySheet({
  open,
  onOpenChange,
  onChanged,
  refreshToken = 0,
  season = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Змінюється після нового списання — оновити список, якщо sheet відкритий */
  refreshToken?: number;
  /** Фільтр по агросезону; null — усі */
  season?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<LocalMoveRow[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [seasonOnly, setSeasonOnly] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listLocalMoves({
      season: seasonOnly && season ? season : null,
    });
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
  }, [open, refreshToken, season, seasonOnly]);

  useEffect(() => {
    if (!open) setEditId(null);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 border-l border-border/50 bg-background p-0 sm:max-w-md",
          "[&_[data-slot=sheet-close]]:text-muted-foreground"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border/50 bg-card/40 px-6 py-5 pr-14 text-left backdrop-blur-md">
          <SheetTitle className="text-xl font-semibold tracking-tight">
            Історія операцій
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Локальні приходи й списання · залишок на хабі — за всі сезони
          </SheetDescription>
          {season ? (
            <button
              type="button"
              onClick={() => setSeasonOnly((v) => !v)}
              className="mt-2 w-fit rounded-full border border-border/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted/60"
            >
              {seasonOnly
                ? `Сезон ${season} · показати всі`
                : "Усі сезони · лише активний"}
            </button>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Завантаження…
            </div>
          ) : error ? (
            <div className="my-4 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          ) : moves.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Поки немає локальних операцій
              {seasonOnly && season ? ` за сезон ${season}` : ""}
            </p>
          ) : (
            <ul>
              {moves.map((move) => (
                <LocalMoveListItem
                  key={move.id}
                  move={move}
                  editing={editId === move.id}
                  onEdit={() => setEditId(move.id)}
                  onCancelEdit={() => setEditId(null)}
                  onSaved={() => {
                    setEditId(null);
                    void load();
                    onChanged?.();
                  }}
                  onDeleted={() => {
                    if (editId === move.id) setEditId(null);
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
  );
}

function LocalMoveListItem({
  move,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
}: {
  move: LocalMoveRow;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const isDraft = move.status === "draft";
  const isInbound = move.type === "inbound";
  const isSale = move.type === "sale";
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
      const { suppressLocalInventoryMovesRealtimeToast } = await import(
        "@/lib/realtime-toast-guard"
      );
      suppressLocalInventoryMovesRealtimeToast();
      const res = await deleteLocalMove(move.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        isInbound
          ? "Прихід видалено"
          : isSale
            ? "Продаж видалено"
            : "Списання видалено"
      );
      onDeleted();
    });
  }

  const qtyLabel = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 2,
  }).format(move.qty);

  if (editing) {
    return (
      <li className="border-b border-border/40 py-3 last:border-0">
        <EditLocalMoveInline
          move={move}
          onCancel={onCancelEdit}
          onSaved={onSaved}
        />
      </li>
    );
  }

  return (
    <li className="group flex items-center justify-between gap-3 border-b border-border/40 py-4 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            isInbound
              ? "bg-sky-50 text-sky-700"
              : "bg-muted/70 text-muted-foreground"
          )}
        >
          {isInbound ? (
            <PackagePlus className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <PackageMinus className="h-4 w-4" strokeWidth={1.8} />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {move.itemName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {isDraft ? (
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                title="Чернетка"
              />
            ) : (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            )}
            <span className="truncate">
              {isSale ? "Продаж" : isInbound ? "Прихід" : "Списання"}
              {" · "}
              {dateLabel}
              {isSale && move.buyerName ? ` · ${move.buyerName}` : ""}
              {isInbound && move.buyerName ? ` · ${move.buyerName}` : ""}
              {move.fieldName ? ` · ${move.fieldName}` : ""}
              {move.note ? ` · ${move.note}` : ""}
              {move.unitPriceUah != null
                ? ` · ${(move.qty * move.unitPriceUah).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`
                : ""}
            </span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {move.attachmentCount > 0 ? (
          <AttachmentViewerButton
            entityType="inventory_move"
            entityId={move.id}
            count={move.attachmentCount}
          />
        ) : null}
        <div className="text-right">
          <p
            className={cn(
              "text-sm tabular-nums",
              isInbound
                ? "font-medium text-emerald-700"
                : isSale
                  ? "font-medium text-amber-800"
                  : "text-foreground"
            )}
          >
            {isInbound ? "+" : isSale ? "→" : "−"}
            {qtyLabel}
            {move.itemUnit ? ` ${move.itemUnit}` : ""}
          </p>
          {isSale && move.unitPriceUah != null ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {(move.qty * move.unitPriceUah).toLocaleString("uk-UA", {
                maximumFractionDigits: 0,
              })}{" "}
              ₴
            </p>
          ) : !isDraft ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              передано бухгалтеру
            </p>
          ) : null}
        </div>
        {isDraft ? (
          <div className="flex items-center">
            <button
              type="button"
              onClick={onEdit}
              disabled={pending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Редагувати"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
              title="Видалити"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Inline-редактор (без центральної модалки) — історія й деталі картки. */
export function EditLocalMoveInline({
  move,
  onCancel,
  onSaved,
  className,
}: {
  move: LocalMoveRow;
  onCancel: () => void;
  onSaved: () => void;
  className?: string;
}) {
  const [qty, setQty] = useState("");
  const [fieldId, setFieldId] = useState<string>("");
  const [buyerName, setBuyerName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fields, setFields] = useState<QuickIssueFieldOption[]>([]);
  const [fieldQuery, setFieldQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const isInbound = move.type === "inbound";
  const isSale = move.type === "sale";
  const fieldRequired =
    !isInbound &&
    !isSale &&
    (move.itemCategory === "zzr" ||
      move.itemCategory === "fertilizer" ||
      move.itemCategory === "seed");

  useEffect(() => {
    setQty(String(move.qty));
    setFieldId(move.fieldId ?? "");
    setBuyerName(move.buyerName ?? "");
    setUnitPrice(move.unitPriceUah != null ? String(move.unitPriceUah) : "");
    setFieldQuery("");
    void getQuickIssueOptions().then((res) => {
      if (res.ok) setFields(res.fields);
    });
  }, [move.id]);

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
    const qtyNum = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("Вкажіть кількість > 0");
      return;
    }
    if (fieldRequired && !fieldId) {
      toast.error("Оберіть поле");
      return;
    }
    let buyer: string | null | undefined;
    let price: number | null | undefined;
    if (isSale || isInbound) {
      if (isSale) {
        buyer = buyerName.trim();
        if (!buyer) {
          toast.error("Вкажіть покупця");
          return;
        }
      } else {
        buyer = buyerName.trim() || null;
      }
      const priceNum = Number(String(unitPrice).replace(",", "."));
      if (!Number.isFinite(priceNum) || priceNum < 0 || !unitPrice.trim()) {
        toast.error("Вкажіть коректну ціну");
        return;
      }
      price = priceNum;
    }
    startTransition(async () => {
      const { suppressLocalInventoryMovesRealtimeToast } = await import(
        "@/lib/realtime-toast-guard"
      );
      suppressLocalInventoryMovesRealtimeToast();
      const res = await updateLocalMove({
        id: move.id,
        qty: qtyNum,
        fieldId: isSale ? undefined : fieldId ? fieldId : null,
        ...(isSale
          ? { buyerName: buyer, unitPriceUah: price }
          : isInbound
            ? { buyerName: buyer ?? null, unitPriceUah: price }
            : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        isInbound
          ? "Прихід оновлено"
          : isSale
            ? "Продаж оновлено"
            : "Списання оновлено"
      );
      onSaved();
    });
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3.5",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
            {isInbound
              ? "Редагування приходу"
              : isSale
                ? "Редагування продажу"
                : "Редагування списання"}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-zinc-900">
            {move.itemName}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-700"
        >
          Скасувати
        </button>
      </div>

      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-500">
            Кількість{move.itemUnit ? ` (${move.itemUnit})` : ""}
          </label>
          <Input
            value={qty}
            inputMode="decimal"
            onChange={(e) => setQty(e.target.value)}
            className="h-10 bg-white text-base font-semibold tabular-nums"
            autoFocus
          />
        </div>

        {isSale ? (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-500">
                Покупець
              </label>
              <Input
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="h-10 bg-white"
                placeholder="Назва контрагента"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-500">
                Ціна ₴ / од.
              </label>
              <Input
                value={unitPrice}
                inputMode="decimal"
                onChange={(e) => setUnitPrice(e.target.value)}
                className="h-10 bg-white text-base font-semibold tabular-nums"
              />
            </div>
          </>
        ) : isInbound ? (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-500">
                Постачальник
              </label>
              <Input
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="h-10 bg-white"
                placeholder="Контрагент"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-500">
                Ціна ₴ / од.
              </label>
              <Input
                value={unitPrice}
                inputMode="decimal"
                onChange={(e) => setUnitPrice(e.target.value)}
                className="h-10 bg-white text-base font-semibold tabular-nums"
              />
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-zinc-500">
                {fieldRequired ? "Поле" : "Поле (опційно)"}
              </label>
              {fieldId ? (
                <button
                  type="button"
                  onClick={() => setFieldId("")}
                  className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-700"
                >
                  Зняти
                </button>
              ) : null}
            </div>
            <Input
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Пошук поля…"
              className="h-9 bg-white"
            />
            <div className="max-h-36 overflow-y-auto rounded-xl border border-zinc-200 bg-white">
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
        )}
      </div>

      <div className="flex justify-end gap-2 pt-0.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
          className="h-9"
        >
          Скасувати
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending}
          className="h-9 bg-[#276749] text-white hover:bg-[#1f5339]"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Зберегти
        </Button>
      </div>
    </div>
  );
}

/** @deprecated — використовуй EditLocalMoveInline */
export function EditLocalMoveDialog({
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
  if (!open || !move) return null;
  return (
    <EditLocalMoveInline
      move={move}
      onCancel={() => onOpenChange(false)}
      onSaved={onSaved}
    />
  );
}

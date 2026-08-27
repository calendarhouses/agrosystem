"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import {
  listDraftMovesForExport,
  markMovesSentTo1c,
  type DraftExportMove,
} from "@/app/export/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { downloadDraftMovesExcel } from "@/lib/inventory-excel-export";
import { cn } from "@/lib/utils";

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatMoveDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM", { locale: uk });
}

export function AccountantExportSheet({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<DraftExportMove[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listDraftMovesForExport();
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setMoves([]);
      setSelected(new Set());
      return;
    }
    setMoves(res.data);
    setSelected(new Set(res.data.map((m) => m.id)));
  }

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);

  const selectedMoves = useMemo(
    () => moves.filter((m) => selected.has(m.id)),
    [moves, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === moves.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(moves.map((m) => m.id)));
    }
  }

  function handleDownload() {
    const rows = selectedMoves.length > 0 ? selectedMoves : moves;
    if (rows.length === 0) return;
    try {
      const filename = downloadDraftMovesExcel(rows);
      toast.success("Excel збережено", {
        description: filename,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося сформувати Excel"
      );
    }
  }

  function confirmMarkSent() {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.error("Оберіть хоча б одну операцію");
      return;
    }
    startTransition(async () => {
      const res = await markMovesSentTo1c(ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Позначено ${res.data.updated} операцій як передані бухгалтеру`
      );
      setConfirmOpen(false);
      await load();
      onChanged?.();
    });
  }

  const count = moves.length;
  const selectedCount = selected.size;
  const empty = !loading && !error && count === 0;

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
              Експорт для бухгалтерії
            </SheetTitle>
            <SheetDescription className="text-sm text-zinc-500">
              Excel для бухгалтера · у BAS нічого не пишемо. «Передано» ≠
              проведено в 1С.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Завантаження чернеток…
              </div>
            ) : error ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {error}
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-[#E5DFD3] bg-white px-5 py-6 text-center shadow-sm">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                    Обрано до передачі
                  </p>
                  <p className="mt-1 text-5xl font-extrabold tracking-tight tabular-nums text-zinc-900">
                    {selectedCount}
                    <span className="text-2xl font-bold text-zinc-400">
                      /{count}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-500">
                    операцій
                  </p>
                </div>

                <p className="mt-4 text-[12px] leading-relaxed text-zinc-500">
                  1) Завантажте Excel і передайте бухгалтеру.
                  2) Коли файл забрано — позначте обрані як передані (не
                  проводиться в 1С автоматично).
                </p>

                <div className="mt-5 space-y-2.5">
                  <Button
                    type="button"
                    disabled={empty || pending || selectedCount === 0}
                    onClick={handleDownload}
                    className="h-12 w-full rounded-xl bg-[#276749] text-sm font-bold text-white shadow-sm hover:bg-[#1f5239]"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Завантажити Excel ({selectedCount || "—"})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={empty || pending || selectedCount === 0}
                    onClick={() => setConfirmOpen(true)}
                    className="h-11 w-full rounded-xl border-[#E5DFD3] bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    {pending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4 text-[#276749]" />
                    )}
                    Позначити як передані бухгалтеру
                  </Button>
                </div>

                {empty ? (
                  <p className="mt-8 text-center text-sm text-zinc-500">
                    Немає чернеток. Усі операції вже позначені як передані.
                  </p>
                ) : (
                  <div className="mt-6 space-y-2">
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800"
                    >
                      {selected.size === moves.length
                        ? "Зняти всі"
                        : "Обрати всі"}
                    </button>
                    <ul className="space-y-2">
                      {moves.map((move) => {
                        const checked = selected.has(move.id);
                        return (
                          <li key={move.id}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition",
                                checked
                                  ? "border-[#276749]/30 bg-white"
                                  : "border-[#E5DFD3]/80 bg-white/60 opacity-70"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(move.id)}
                                className="mt-1 h-4 w-4 rounded border-zinc-300"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-zinc-900">
                                  {move.itemName}
                                  {move.isLocalItem ? (
                                    <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                                      нова
                                    </span>
                                  ) : null}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                                  {move.type === "inbound"
                                    ? "Прихід"
                                    : move.type === "sale"
                                      ? "Продаж"
                                      : "Списання"}
                                  {move.type === "sale" && move.buyerName
                                    ? ` · ${move.buyerName}`
                                    : ""}
                                  {move.season ? ` · ${move.season}` : ""}
                                  {" · "}
                                  {move.type === "sale"
                                    ? formatMoveDate(move.date)
                                    : `${move.fieldName ?? "Без поля"} · ${formatMoveDate(move.date)}`}
                                  {move.hasAttachment ? " · накл." : ""}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p
                                  className={cn(
                                    "text-sm font-bold tabular-nums",
                                    move.type === "inbound"
                                      ? "text-emerald-700"
                                      : "text-zinc-800"
                                  )}
                                >
                                  {move.type === "inbound"
                                    ? "+"
                                    : move.type === "sale"
                                      ? "→"
                                      : "−"}
                                  {formatQty(move.qty, move.unit)}
                                </p>
                                {move.type === "sale" &&
                                move.unitPriceUah != null ? (
                                  <p className="text-[10px] font-medium text-zinc-400 tabular-nums">
                                    {(
                                      move.qty * move.unitPriceUah
                                    ).toLocaleString("uk-UA", {
                                      maximumFractionDigits: 2,
                                    })}{" "}
                                    ₴
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl border border-[#E5DFD3] bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Позначити як передані бухгалтеру?</DialogTitle>
            <DialogDescription>
              {selectedCount} обраних чернеток отримають статус «передано». Це
              не проведення в 1С — лише підтвердження, що Excel забрано.
              Редагувати їх уже не можна.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className="rounded-xl"
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirmMarkSent}
              className="rounded-xl bg-[#276749] text-white hover:bg-[#1f5239]"
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Так, позначити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

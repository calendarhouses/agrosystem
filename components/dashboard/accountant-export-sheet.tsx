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
  listAccountantQueue,
  markAccountantQueuePrepared,
  type AccountantQueueItem,
} from "@/app/export/actions";
import {
  FuelPanelShell,
  FuelSheetHeader,
  fuelSheetBodyClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSeasonRange, toIsoRange } from "@/lib/finance-period";
import { downloadAccountantPackageExcel } from "@/lib/inventory-excel-export";
import { useSeasonStore } from "@/lib/season-store";
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

function kindLabel(kind: AccountantQueueItem["kind"]): string {
  if (kind === "inbound") return "Прихід";
  if (kind === "sale") return "Продаж";
  if (kind === "fuel_inbound") return "Закупівля ДП";
  if (kind === "fuel_transfer") return "Переміщення";
  return "Списання";
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
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const seasonYear = Number(activeSeason) || 2026;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AccountantQueueItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    const range = toIsoRange(getSeasonRange(seasonYear));
    const res = await listAccountantQueue({
      season: String(seasonYear),
      startIso: range.startIso,
      endIso: range.endIso,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setItems([]);
      setSelected(new Set());
      return;
    }
    setItems(res.data.items);
    setSelected(new Set(res.data.items.map((m) => m.id)));
  }

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seasonYear]);

  const selectedItems = useMemo(
    () => items.filter((m) => selected.has(m.id)),
    [items, selected]
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
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((m) => m.id)));
    }
  }

  function handleDownload() {
    const rows = selectedItems.length > 0 ? selectedItems : items;
    if (rows.length === 0) return;
    try {
      const filename = downloadAccountantPackageExcel(rows);
      toast.success("Excel збережено", { description: filename });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося сформувати Excel"
      );
    }
  }

  function confirmMark() {
    const rows = selectedItems.length > 0 ? selectedItems : items;
    if (rows.length === 0) return;
    startTransition(async () => {
      const res = await markAccountantQueuePrepared(
        rows.map((r) => ({ id: r.id, source: r.source }))
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Позначено ${res.data.inventory + res.data.fuel} операцій`
      );
      setConfirmOpen(false);
      onChanged?.();
      await load();
    });
  }

  const count = items.length;
  const selectedCount = selectedItems.length;
  const empty = !loading && count === 0;

  return (
    <>
      <FuelPanelShell
        open={open}
        onOpenChange={onOpenChange}
        title="Експорт для бухгалтерії"
      >
        <FuelSheetHeader
          icon={FileSpreadsheet}
          accent="zinc"
          title="Експорт для бухгалтерії"
          description="Завантаження Excel і позначення переданих операцій"
        />

        <div
          className={fuelSheetBodyClass}
          data-vaul-no-drag=""
          data-allow-pan="true"
        >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Завантаження черги…
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

                <p className="text-[12px] leading-relaxed text-zinc-500">
                  1) Завантажте Excel і передайте бухгалтеру.
                  2) Коли файл забрано — позначте обрані як передані.
                </p>

                <div className="space-y-2.5">
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
                    Позначити як передані
                  </Button>
                </div>

                {empty ? (
                  <p className="mt-4 text-center text-sm text-zinc-500">
                    Немає операцій у черзі за сезон
                  </p>
                ) : (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                        Черга
                      </p>
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="text-[11px] font-semibold text-[#276749] hover:underline"
                      >
                        {selected.size === items.length
                          ? "Зняти всі"
                          : "Обрати всі"}
                      </button>
                    </div>
                    <ul className="space-y-2">
                      {items.map((move) => {
                        const checked = selected.has(move.id);
                        return (
                          <li key={`${move.source}-${move.id}`}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition",
                                checked
                                  ? "border-[#276749]/30 bg-white"
                                  : "border-[#E5DFD3] bg-white/60 opacity-70"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(move.id)}
                                className="mt-1 h-4 w-4 rounded border-zinc-300 text-[#276749]"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-zinc-900">
                                  {move.title}
                                </p>
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  {kindLabel(move.kind)} ·{" "}
                                  {formatMoveDate(move.date)}
                                  {move.party ? ` · ${move.party}` : ""}
                                </p>
                              </div>
                              <p className="shrink-0 font-mono text-xs font-semibold tabular-nums text-zinc-800">
                                {formatQty(move.qty, move.unit)}
                              </p>
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
      </FuelPanelShell>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          presentation="center"
          className="rounded-2xl border border-[#E5DFD3] bg-white sm:max-w-md"
        >          <DialogHeader>
            <DialogTitle>Позначити як передані?</DialogTitle>
            <DialogDescription>
              {selectedCount} обраних операцій зникнуть з черги. Редагувати їх
              уже не можна.
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
              onClick={confirmMark}
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

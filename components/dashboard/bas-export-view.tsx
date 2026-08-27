"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  RefreshCw,
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
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadDraftMovesExcel } from "@/lib/inventory-excel-export";
import { cn } from "@/lib/utils";

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: uk });
}

export function BasExportView() {
  const [moves, setMoves] = useState<DraftExportMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listDraftMovesForExport();
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setMoves([]);
      return;
    }
    setMoves(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleDownload() {
    if (moves.length === 0) return;
    try {
      downloadDraftMovesExcel(moves);
      setPendingIds(moves.map((m) => m.id));
      setConfirmOpen(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося сформувати Excel"
      );
    }
  }

  function confirmMarkSent() {
    const ids = pendingIds;
    startTransition(async () => {
      const res = await markMovesSentTo1c(ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Позначено ${res.data.updated} рухів як передані бухгалтеру`
      );
      setConfirmOpen(false);
      setPendingIds([]);
      await load();
    });
  }

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-10 sm:px-6 lg:px-8">
      <PageHeader
        icon={FileSpreadsheet}
        title="Експорт для бухгалтерії"
        description="Чернетки для бухгалтера · Excel без запису в BAS · «передано» ≠ проведено в 1С"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading || pending}
              className="h-9 border-[#E5DFD3] bg-white"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
              Оновити
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading || pending || moves.length === 0}
              onClick={handleDownload}
              className="h-9 bg-[#276749] px-4 font-bold text-white hover:bg-[#1f5239]"
            >
              <Download className="h-4 w-4" />
              Завантажити Excel для 1С
            </Button>
          </div>
        }
      />

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <GlassCard className="p-4 hover:translate-y-0">
          <p className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            Чернеток
          </p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-zinc-900">
            {loading ? "—" : moves.length}
          </p>
        </GlassCard>
        <GlassCard className="p-4 hover:translate-y-0">
          <p className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            Статус
          </p>
          <p className="mt-1 text-sm font-semibold text-amber-800">
            draft · ще не в 1С
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Після Excel можна позначити sent_to_1c
          </p>
        </GlassCard>
        <GlassCard className="p-4 hover:translate-y-0">
          <p className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            BAS
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-800">
            Read-only міст
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            У 1С нічого не пишемо через API
          </p>
        </GlassCard>
      </section>

      <GlassCard className="overflow-hidden p-0 hover:translate-y-0 hover:shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-[#E5DFD3] px-5 py-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-[#276749]" />
            <div>
              <h2 className="text-sm font-bold text-zinc-900">
                Непередані списання
              </h2>
              <p className="text-xs text-zinc-500">
                Що списано · кількість · поле · дата
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-amber-950">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline"
            >
              Спробувати знову
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-2 px-5 py-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : moves.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <FileSpreadsheet className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-semibold text-zinc-800">
              Немає чернеток
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Усі списання вже позначені як передані, або журнал порожній.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Тип</TableHead>
                  <TableHead>Що</TableHead>
                  <TableHead>Кількість</TableHead>
                  <TableHead>Поле</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="pr-5 text-right">bas_ref_key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moves.map((move) => (
                  <TableRow key={move.id}>
                    <TableCell className="pl-5 text-xs font-semibold text-zinc-500">
                      {move.type === "inbound" ? "Прихід" : "Списання"}
                    </TableCell>
                    <TableCell className="max-w-[240px] font-medium text-zinc-900">
                      <span className="line-clamp-2">{move.itemName}</span>
                      {move.isLocalItem ? (
                        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-sky-700">
                          нова позиція
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular-nums",
                        move.type === "inbound"
                          ? "font-semibold text-emerald-700"
                          : "text-zinc-800"
                      )}
                    >
                      {move.type === "inbound" ? "+" : "−"}
                      {formatQty(move.qty, move.unit)}
                    </TableCell>
                    <TableCell className="text-zinc-700">
                      {move.fieldName ?? (
                        <span className="text-zinc-400">Без поля</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-zinc-600">
                      {formatDate(move.date)}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-[11px] text-zinc-400">
                      {move.basRefKey.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>

      <div className="mt-6 flex justify-center">
        <Button
          type="button"
          disabled={loading || pending || moves.length === 0}
          onClick={handleDownload}
          className={cn(
            "h-14 min-w-[280px] rounded-2xl px-8 text-base font-bold text-white",
            "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
            "shadow-[0_12px_32px_-10px_rgba(39,103,73,0.55)]",
            "hover:brightness-105 disabled:opacity-50"
          )}
        >
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Download className="h-5 w-5" />
          )}
          Завантажити Excel для 1С
          {moves.length > 0 ? (
            <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
              {moves.length}
            </span>
          ) : null}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md rounded-2xl border-[#E5DFD3] bg-[#FDFBF7]">
          <DialogHeader>
            <DialogTitle>Позначити як передані в 1С?</DialogTitle>
            <DialogDescription>
              Excel уже завантажено ({pendingIds.length} рядків). Якщо
              позначити рухи як{" "}
              <span className="font-semibold text-zinc-700">sent_to_1c</span>,
              вони зникнуть з цього екрану і не потраплять у наступний експорт.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-stretch">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
              className="flex-1"
            >
              Ні, лишити draft
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirmMarkSent}
              className="flex-1 bg-[#276749] font-bold text-white hover:bg-[#1f5239]"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Так, позначити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getWarehouseReceiptDetailAction,
  patchWarehouseReceiptAccountantMetaAction,
  type WarehouseReceiptBasRow,
  type WarehouseReceiptDetailLine,
} from "@/app/admin/inventory/actions";
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
  INVENTORY_VAT_RATES,
  isInventoryVatRateId,
  type InventoryVatRateId,
} from "@/lib/inventory-vat";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: WarehouseReceiptBasRow | null;
  /** Якщо відкрито з картки без повного row — лише id */
  receiptId: string | null;
  onDone: () => void;
};

export function AccountantReceiptBasFillDialog({
  open,
  onOpenChange,
  receipt,
  receiptId,
  onDone,
}: Props) {
  const id = receipt?.id ?? receiptId;
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [edrpou, setEdrpou] = useState("");
  const [basCode, setBasCode] = useState("");
  const [lines, setLines] = useState<WarehouseReceiptDetailLine[]>([]);
  const [vatByMove, setVatByMove] = useState<Record<string, InventoryVatRateId>>(
    {}
  );
  const [supplierName, setSupplierName] = useState("");
  const [errorHint, setErrorHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    setLoading(true);
    setEdrpou(receipt?.supplierEdrpou ?? "");
    setBasCode("");
    setSupplierName(receipt?.supplierName ?? "");
    setErrorHint(receipt?.basDraftError ?? null);
    setLines([]);
    setVatByMove({});
    void getWarehouseReceiptDetailAction(id).then((res) => {
      setLoading(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSupplierName(res.receipt.supplierName || "");
      setEdrpou(res.receipt.supplierEdrpou ?? "");
      setErrorHint(res.receipt.basDraftError);
      setLines(res.lines);
      const next: Record<string, InventoryVatRateId> = {};
      for (const line of res.lines) {
        next[line.moveId] = isInventoryVatRateId(line.vatRate)
          ? line.vatRate
          : "20";
      }
      setVatByMove(next);
    });
  }, [open, id, receipt]);

  function save(sendToBas: boolean) {
    if (!id) return;
    startTransition(() => {
      void patchWarehouseReceiptAccountantMetaAction({
        receiptId: id,
        supplierEdrpou: edrpou,
        basCounterpartyCode: basCode || null,
        lineVatRates: lines.map((line) => ({
          moveId: line.moveId,
          vatRate: vatByMove[line.moveId] ?? "20",
        })),
        sendToBas,
      }).then((res) => {
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(res.message);
        onOpenChange(false);
        onDone();
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Реквізити для BAS</DialogTitle>
          <DialogDescription>
            {supplierName || "Накладна"} — ЄДРПОУ / код контрагента та ставка ПДВ
            по позиціях перед відправкою чернетки.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Завантаження…
          </div>
        ) : (
          <div className="space-y-4">
            {errorHint ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">
                {errorHint}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500">
                  ЄДРПОУ постачальника
                </label>
                <Input
                  value={edrpou}
                  onChange={(e) =>
                    setEdrpou(e.target.value.replace(/[^\d]/g, "").slice(0, 10))
                  }
                  inputMode="numeric"
                  placeholder="12345678"
                  className="h-10 font-semibold tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500">
                  Код BAS (опційно)
                </label>
                <Input
                  value={basCode}
                  onChange={(e) => setBasCode(e.target.value)}
                  placeholder="Code з Catalog_Контрагенты"
                  className="h-10 font-semibold"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                ПДВ по позиціях
              </p>
              {lines.length === 0 ? (
                <p className="text-sm text-zinc-500">Рядків немає</p>
              ) : (
                <ul className="space-y-2">
                  {lines.map((line) => (
                    <li
                      key={line.moveId}
                      className="rounded-xl border border-[#E5DFD3]/80 bg-[#FBF9F5] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900">
                            {line.name}
                          </p>
                          <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
                            {line.qty}
                            {line.unit ? ` ${line.unit}` : ""}
                            {line.amount != null
                              ? ` · ${line.amount.toLocaleString("uk-UA")} ₴`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {INVENTORY_VAT_RATES.map((rate) => {
                          const active =
                            (vatByMove[line.moveId] ?? "20") === rate.id;
                          return (
                            <button
                              key={rate.id}
                              type="button"
                              onClick={() =>
                                setVatByMove((prev) => ({
                                  ...prev,
                                  [line.moveId]: rate.id,
                                }))
                              }
                              className={cn(
                                "rounded-lg px-2 py-1 text-[11px] font-semibold transition",
                                active
                                  ? "bg-sky-700 text-white"
                                  : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-sky-300"
                              )}
                            >
                              {rate.label}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || loading}
            onClick={() => save(false)}
            className="rounded-xl"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Зберегти
          </Button>
          <Button
            type="button"
            disabled={pending || loading || !id}
            onClick={() => save(true)}
            className="rounded-xl bg-sky-700 font-semibold text-white hover:bg-sky-800"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Зберегти й надіслати
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

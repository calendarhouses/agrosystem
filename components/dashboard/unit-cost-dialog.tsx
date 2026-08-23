"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getInventoryItemUnitCost,
  updateInventoryItemUnitCost,
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
import { formatInventoryMoney } from "@/lib/inventory-bas";

type UnitCostItem = {
  id: string;
  name: string;
  unit: string;
};

function priceUnitHint(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (!u) return "грн/од.";
  if (u === "л" || u.startsWith("л ")) return "грн/л";
  if (u === "кг" || u.startsWith("кг")) return "грн/кг";
  if (u === "т" || u.startsWith("т ")) return "грн/т";
  if (u.includes("шт")) return "грн/шт";
  return `грн/${unit.trim()}`;
}

export function UnitCostDialog({
  item,
  open,
  onOpenChange,
}: {
  item: UnitCostItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !item) {
      setValue("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getInventoryItemUnitCost(item.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.unitCost != null && res.unitCost > 0) {
        setValue(String(res.unitCost));
      } else {
        setValue("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id]);

  function handleSave() {
    if (!item) return;
    const num = Number(String(value).replace(",", "."));
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Вкажіть коректну ціну");
      return;
    }
    startTransition(async () => {
      const res = await updateInventoryItemUnitCost({
        basRefKey: item.id,
        unitCost: num,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Планову ціну збережено", {
        description: `${item.name} · ${formatInventoryMoney(num)} / ${item.unit || "од."}`,
      });
      onOpenChange(false);
    });
  }

  const hint = item ? priceUnitHint(item.unit) : "грн/од.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Планова ціна</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {item?.name ?? "Ціна за одиницю для економіки полів"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500">
            Ціна за одиницю ({hint})
          </label>
          <Input
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            disabled={loading || pending}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            className="h-11 text-base font-semibold tabular-nums"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
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
            disabled={loading || pending}
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

"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getInventoryCacheMetaMap,
  updateInventoryItemCard,
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

export type EditableInventoryItem = {
  id: string;
  name: string;
  unit: string;
  category: string;
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

export function InventoryItemEditDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: EditableInventoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [customName, setCustomName] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !item) {
      setCustomName("");
      setPrice("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getInventoryCacheMetaMap().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setCustomName("");
        setPrice("");
        return;
      }
      const meta = res.byRef[item.id.toLowerCase()];
      setCustomName(meta?.customName ?? "");
      setPrice(
        meta && meta.plannedPriceUah > 0 ? String(meta.plannedPriceUah) : ""
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id]);

  function handleSave() {
    if (!item) return;
    const num = Number(String(price).replace(",", "."));
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Вкажіть коректну ціну");
      return;
    }
    startTransition(async () => {
      const res = await updateInventoryItemCard({
        basRefKey: item.id,
        customName: customName.trim() || null,
        plannedPriceUah: num,
        seed: {
          name: item.name,
          category: item.category,
          unit: item.unit,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Картку збережено", {
        description: `${customName.trim() || item.name} · ${formatInventoryMoney(num)} / ${item.unit || "од."}`,
      });
      onSaved?.();
      onOpenChange(false);
    });
  }

  const hint = item ? priceUnitHint(item.unit) : "грн/од.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Редагувати картку</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {item?.name ?? "Локальна назва та планова ціна"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">
              Локальна назва
            </label>
            <Input
              value={customName}
              disabled={loading || pending}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={item?.name ?? "Зрозуміла назва"}
              className="h-10"
            />
            <p className="text-[11px] text-zinc-400">
              Якщо порожньо — показується основна назва
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">
              Планова ціна ({hint})
            </label>
            <Input
              type="text"
              inputMode="decimal"
              value={price}
              disabled={loading || pending}
              onChange={(e) => setPrice(e.target.value)}
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
            {pending ? "Збереження…" : "Зберегти"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, ShoppingCart, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { submitAgroPurchaseRequest } from "@/app/calendar/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { InsightCardData } from "@/lib/agronomy-engine";

type OrderTmcSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insight: InsightCardData | null;
  onSaved?: () => void;
};

/** Заявка на закупівлю ТМЦ (дефіцит з Агро-Радара) */
export function OrderTmcSheet({
  open,
  onOpenChange,
  insight,
  onSaved,
}: OrderTmcSheetProps) {
  const [qty, setQty] = useState("");
  const [pending, startTransition] = useTransition();

  const resource = insight?.resourceStatus;
  const deficit = resource?.deficitQty ?? 0;
  const itemName = resource?.item ?? "ТМЦ";
  const unit = resource?.unit || "л";

  useEffect(() => {
    if (!open || !insight) return;
    const d = insight.resourceStatus.deficitQty;
    setQty(d > 0 ? String(Math.ceil(d * 100) / 100) : "");
  }, [open, insight]);

  const fieldNames = insight?.fields.map((f) => f.name) ?? [];
  const reason = insight
    ? `Операція ${insight.operationName} (${fieldNames.join(", ") || "поля"})`
    : "";

  function handleSave() {
    if (!insight || !resource) return;
    const amount = Number(qty.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Вкажіть кількість");
      return;
    }

    startTransition(async () => {
      const res = await submitAgroPurchaseRequest({
        itemRefKey: resource.itemRefKey,
        itemName: resource.item || itemName,
        qty: amount,
        unit: resource.unit || unit,
        unitPriceUah: resource.unitPriceUah,
        reason,
        operationName: insight.operationName,
        fieldNames,
        seasonYear: insight.targetYear,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(
        res.id
          ? "Заявку створено — чернетка в Складі / Бухгалтерії"
          : "Заявку записано в журнал бухгалтера"
      );
      onOpenChange(false);
      onSaved?.();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Заявка на закупівлю
          </SheetTitle>
          <SheetDescription>
            Автозаповнено з дефіциту Агро-Радара → черга бухгалтера
          </SheetDescription>
        </SheetHeader>

        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Alert className="border-rose-500/25 bg-rose-500/10">
            <Sparkles className="text-rose-600" />
            <AlertTitle className="text-rose-900 dark:text-rose-200">
              Дефіцит ТМЦ
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Без закупівлі планувати цю операцію ризиковано. Заявка зʼявиться
              у журналі Бухгалтерії та як чернетка приходу на Складі.
            </AlertDescription>
          </Alert>

          {!insight ? (
            <p className="text-sm text-muted-foreground">Немає даних картки</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Товар</Label>
                <Input value={itemName} disabled className="bg-muted/40" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="order-qty">
                  Кількість ({unit})
                </Label>
                <Input
                  id="order-qty"
                  type="number"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Бракує ≈ {deficit} {unit} · потрібно{" "}
                  {resource?.requiredQty ?? 0} {unit} · на складі{" "}
                  {resource?.availableQty ?? 0} {unit}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Причина</Label>
                <Input value={reason} disabled className="bg-muted/40" />
              </div>
            </>
          )}
        </div>

        <SheetFooter className="border-t border-border/60 px-5 py-4">
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
            disabled={pending || !insight}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" />
                Збереження…
              </>
            ) : (
              "Надіслати заявку"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

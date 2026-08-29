"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Warehouse } from "lucide-react";

import {
  FuelSheetFooter,
  FuelSheetHeader,
  FuelSheetHint,
  fuelFieldLabelClass,
  fuelHeroAmountClass,
  fuelInputClass,
  fuelPrimaryBtnClass,
  fuelSelectItemClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
  FuelPanelShell,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FuelStorage } from "@/lib/fuel-storages";
import { cn } from "@/lib/utils";

type FuelStorageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage?: FuelStorage | null;
  onSuccess: () => void | Promise<void>;
};

function parsePositive(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseNonNegative(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Створення / редагування паспорта складу — права Sheet як інші панелі /fuel */
export function FuelStorageDialog({
  open,
  onOpenChange,
  storage = null,
  onSuccess,
}: FuelStorageDialogProps) {
  const isEdit = Boolean(storage?.id);
  const [name, setName] = useState("");
  const [type, setType] = useState<"stationary" | "mobile">("stationary");
  const [capacity, setCapacity] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (storage) {
      setName(storage.name);
      setType(storage.type === "mobile" ? "mobile" : "stationary");
      setCapacity(String(storage.capacity));
      setPricePerLiter(String(storage.pricePerLiter));
      return;
    }
    setName("");
    setType("stationary");
    setCapacity("");
    setPricePerLiter("");
  }, [open, storage]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Вкажіть назву складу");
      const cap = parsePositive(capacity);
      if (cap == null) throw new Error("Місткість має бути більше 0");
      const price = parseNonNegative(pricePerLiter);
      if (price == null) throw new Error("Вкажіть ціну за літр");
      if (isEdit && storage && cap < storage.currentVolume) {
        throw new Error(
          `Місткість не може бути меншою за залишок (${Math.round(storage.currentVolume).toLocaleString("uk-UA")} л)`
        );
      }

      const payload = {
        name: trimmed,
        type,
        capacity: cap,
        pricePerLiter: price,
      };

      const response = await fetch(
        isEdit && storage
          ? `/api/fuel/storages/${storage.id}`
          : "/api/fuel/storages",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не вдалося зберегти склад");
      }

      onOpenChange(false);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FuelPanelShell open={open} onOpenChange={onOpenChange} title="Склад палива">
        <FuelSheetHeader
          icon={Warehouse}
          accent="fuel"
          title={isEdit ? "Редагувати склад" : "Новий склад"}
          description={
            isEdit
              ? "Паспорт ємності · залишок змінюється лише через операції"
              : "Цистерна або бензовоз · одразу в обліку палива"
          }
        />

        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={handleSubmit}
        >
          <div className={fuelSheetBodyClass}>
            <div className="space-y-1.5">
              <Label htmlFor="storage-name" className={fuelFieldLabelClass}>
                Назва складу
              </Label>
              <input
                id="storage-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Паливо в цистернах"
                className={fuelInputClass}
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label className={fuelFieldLabelClass}>Тип</Label>
              <Select
                items={[
                  { value: "stationary", label: "Стаціонарний" },
                  { value: "mobile", label: "Мобільний (бензовоз)" },
                ]}
                value={type}
                onValueChange={(v) => {
                  if (v == null) return;
                  setType(v === "mobile" ? "mobile" : "stationary");
                }}
              >
                <SelectTrigger className={fuelSelectTriggerClass}>
                  <SelectValue>
                    {type === "mobile"
                      ? "Мобільний (бензовоз)"
                      : "Стаціонарний"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-lg">
                  <SelectItem
                    value="stationary"
                    className={fuelSelectItemClass}
                  >
                    Стаціонарний
                  </SelectItem>
                  <SelectItem value="mobile" className={fuelSelectItemClass}>
                    Мобільний (бензовоз)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="storage-capacity" className={fuelFieldLabelClass}>
                Місткість
              </Label>
              <div className={fuelHeroAmountClass}>
                <input
                  id="storage-capacity"
                  inputMode="decimal"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="51 000"
                  className={cn(
                    "h-14 w-full bg-transparent text-center text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl",
                    "border-none outline-none focus:ring-0",
                    "tabular-nums placeholder:font-semibold placeholder:text-zinc-300"
                  )}
                />
                <span className="pointer-events-none absolute right-4 bottom-3.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                  літрів
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="storage-price" className={fuelFieldLabelClass}>
                Ціна за літр
              </Label>
              <div className={fuelHeroAmountClass}>
                <input
                  id="storage-price"
                  inputMode="decimal"
                  value={pricePerLiter}
                  onChange={(e) => setPricePerLiter(e.target.value)}
                  placeholder="52.50"
                  className={cn(
                    "h-14 w-full bg-transparent text-center text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl",
                    "border-none outline-none focus:ring-0",
                    "tabular-nums placeholder:font-semibold placeholder:text-zinc-300"
                  )}
                />
                <span className="pointer-events-none absolute right-4 bottom-3.5 text-[10px] font-semibold tracking-wide text-zinc-400">
                  ₴/л
                </span>
              </div>
            </div>

            {isEdit && storage ? (
              <FuelSheetHint>
                Поточний залишок:{" "}
                <span className="font-semibold tabular-nums text-zinc-800">
                  {Math.round(storage.currentVolume).toLocaleString("uk-UA")} л
                </span>
                {" · "}
                змінюється лише через закупівлю / переміщення / заправку
              </FuelSheetHint>
            ) : (
              <FuelSheetHint tone="amber">
                Новий склад стартує з нульовим залишком. Першу партію додайте
                через «Закупівля».
              </FuelSheetHint>
            )}

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/90 p-3.5 text-rose-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p className="text-sm font-medium leading-snug">{error}</p>
              </div>
            ) : null}
          </div>

          <FuelSheetFooter>
            <Button
              type="submit"
              disabled={submitting || !name.trim() || !capacity}
              className={fuelPrimaryBtnClass}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                "Зберегти зміни"
              ) : (
                "Створити склад"
              )}
            </Button>
          </FuelSheetFooter>
        </form>
    </FuelPanelShell>
  );
}

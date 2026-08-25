"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** Створення / редагування паспорта складу палива */
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-md",
          "[&_[data-slot=dialog-close]]:text-zinc-500"
        )}
      >
        <DialogHeader className="border-b border-zinc-100 px-6 py-5 pr-12">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm">
              <Warehouse className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold tracking-tight">
                {isEdit ? "Редагувати склад" : "Новий склад"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-zinc-500">
                {isEdit
                  ? "Змініть паспорт ємності · залишок через операції"
                  : "Додайте цистерну або бензовоз до обліку"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="flex flex-col gap-5 px-6 py-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label
              htmlFor="storage-name"
              className="text-xs font-semibold tracking-wide text-zinc-500 uppercase"
            >
              Назва складу
            </Label>
            <input
              id="storage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Паливо в цистернах"
              className={cn(
                "h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4",
                "text-base font-medium text-zinc-900 outline-none transition-all",
                "placeholder:text-zinc-400",
                "focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
              )}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Тип
            </Label>
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
              <SelectTrigger
                className={cn(
                  "h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4",
                  "text-base font-medium text-zinc-900",
                  "outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
                )}
              >
                <SelectValue>
                  {type === "mobile"
                    ? "Мобільний (бензовоз)"
                    : "Стаціонарний"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-lg">
                <SelectItem value="stationary" className="rounded-xl px-3 py-2.5">
                  Стаціонарний
                </SelectItem>
                <SelectItem value="mobile" className="rounded-xl px-3 py-2.5">
                  Мобільний (бензовоз)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="storage-capacity"
              className="text-xs font-semibold tracking-wide text-zinc-500 uppercase"
            >
              Місткість
            </Label>
            <div className="relative flex items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3">
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
              <span className="pointer-events-none absolute right-4 bottom-3.5 text-xs font-semibold text-zinc-400 uppercase">
                літрів
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="storage-price"
              className="text-xs font-semibold tracking-wide text-zinc-500 uppercase"
            >
              Ціна за літр
            </Label>
            <div className="relative flex items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3">
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
              <span className="pointer-events-none absolute right-4 bottom-3.5 text-xs font-semibold text-zinc-400">
                ₴/л
              </span>
            </div>
          </div>

          {isEdit && storage ? (
            <p className="rounded-xl border border-zinc-100 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-500">
              Поточний залишок:{" "}
              <span className="font-semibold tabular-nums text-zinc-800">
                {Math.round(storage.currentVolume).toLocaleString("uk-UA")} л
              </span>
              {" · "}
              змінюється лише через закупівлю / переміщення / заправку
            </p>
          ) : null}

          {error ? (
            <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4 text-rose-600">
              <AlertCircle size={18} className="shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          ) : null}

          <DialogFooter className="mt-1 gap-2 border-0 bg-transparent p-0 sm:justify-stretch">
            <Button
              type="submit"
              disabled={submitting || !name.trim() || !capacity}
              className={cn(
                "h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white",
                "transition-transform hover:bg-zinc-800 active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                "Зберегти зміни"
              ) : (
                "Створити склад"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

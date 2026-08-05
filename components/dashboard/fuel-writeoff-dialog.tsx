"use client";

import { useState, type FormEvent } from "react";
import { Droplets } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FUEL_WRITEOFF_FIELDS,
  FUEL_WRITEOFF_TRACTORS,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const fieldClass = cn(
  "w-full rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3 py-2.5 text-sm text-zinc-900 outline-none",
  "transition-colors placeholder:text-zinc-500/70",
  "focus:border-[#276749] focus:ring-2 focus:ring-[#276749]/20"
);

type FuelWriteoffDialogProps = {
  triggerClassName?: string;
  /** Сховати власний тригер (керування ззовні) */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Мокап швидкого списання палива (без бекенду) */
export function FuelWriteoffDialog({
  triggerClassName,
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: FuelWriteoffDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  const [tractor, setTractor] = useState<string>(FUEL_WRITEOFF_TRACTORS[0]);
  const [field, setField] = useState<string>(FUEL_WRITEOFF_FIELDS[0]);
  const [liters, setLiters] = useState("50");
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setConfirmed(true);
    window.setTimeout(() => {
      setOpen(false);
      setConfirmed(false);
      setLiters("50");
    }, 900);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger ? (
        <DialogTrigger
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border border-[#C05621]/30 bg-[#C05621]/10 px-4 py-2.5",
            "text-sm font-semibold text-[#C05621] shadow-sm",
            "transition-all duration-200 hover:border-[#C05621]/50 hover:bg-[#C05621]/15",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C05621]/30",
            triggerClassName
          )}
        >
          <Droplets className="h-4 w-4" />
          Списати паливо
        </DialogTrigger>
      ) : null}

      <DialogContent
        className={cn(
          "gap-0 overflow-hidden rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm ring-0 sm:max-w-md",
          "[&_[data-slot=dialog-close]]:text-zinc-500 [&_[data-slot=dialog-close]]:hover:bg-[#E5DFD3]/40"
        )}
      >
        <DialogHeader className="border-b border-[#E5DFD3] px-6 py-5 pr-12">
          <DialogTitle className="text-lg font-extrabold tracking-tight text-zinc-900">
            Списати паливо
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Швидка операція для бригадира
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="flex flex-col gap-4 px-6 py-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Трактор
            </span>
            <select
              className={fieldClass}
              value={tractor}
              onChange={(e) => setTractor(e.target.value)}
            >
              {FUEL_WRITEOFF_TRACTORS.map((item) => (
                <option key={item} value={item} className="bg-[#F4F1EA] text-zinc-900">
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Поле
            </span>
            <select
              className={fieldClass}
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              {FUEL_WRITEOFF_FIELDS.map((item) => (
                <option key={item} value={item} className="bg-[#F4F1EA] text-zinc-900">
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Кількість літрів
            </span>
            <input
              type="number"
              min={1}
              max={2000}
              required
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              className={fieldClass}
              placeholder="50"
            />
          </label>

          <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0 pt-2 sm:justify-stretch">
            <Button
              type="submit"
              disabled={confirmed}
              className={cn(
                "h-11 w-full rounded-xl border-0 bg-[#276749] text-sm font-bold text-white shadow-sm",
                "transition-colors hover:bg-[#276749]/90",
                confirmed && "bg-[#276749]/80"
              )}
            >
              {confirmed ? "Списано ✓" : "Підтвердити списання"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

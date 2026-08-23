"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  date?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  /** Якщо true — показує «Сезон YYYY» замість повної дати */
  seasonLabel?: boolean;
};

/** DatePicker на базі Popover + Calendar (Premium Clay palette) */
export function DatePicker({
  date,
  onChange,
  placeholder = "Оберіть дату",
  className,
  seasonLabel = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const label = date
    ? seasonLabel
      ? `Сезон ${date.getFullYear()}`
      : format(date, "d MMMM yyyy", { locale: uk })
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex h-11 w-full min-w-0 items-center justify-start gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3",
          "text-sm font-semibold text-zinc-900 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]",
          "transition-colors outline-none",
          "hover:border-[#276749]/35 focus-visible:border-[#276749]/45 focus-visible:ring-2 focus-visible:ring-[#276749]/15",
          !date && "font-medium text-zinc-400",
          className
        )}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-[#276749]" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[130] w-auto overflow-hidden rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-2 text-zinc-900 shadow-lg"
      >
        <Calendar
          mode="single"
          selected={date}
          onSelect={(next) => {
            onChange?.(next);
            if (next) setOpen(false);
          }}
          locale={uk}
          className="rounded-xl bg-transparent text-zinc-900"
        />
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";

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
  const label = date
    ? seasonLabel
      ? `Сезон ${date.getFullYear()}`
      : format(date, "d MMMM yyyy", { locale: uk })
    : placeholder;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-9 items-center justify-start gap-2 rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3 text-sm font-medium text-zinc-900 outline-none transition-colors shadow-sm",
          "hover:border-[#E5DFD3] hover:bg-[#E5DFD3]/40 focus-visible:ring-2 focus-visible:ring-[#276749]/30",
          !date && "text-zinc-500",
          className
        )}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-[#276749]" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto rounded-xl border-[#E5DFD3] bg-[#F4F1EA] p-2 text-zinc-900 shadow-sm"
      >
        <Calendar
          mode="single"
          selected={date}
          onSelect={onChange}
          className="rounded-xl bg-transparent text-zinc-900"
        />
      </PopoverContent>
    </Popover>
  );
}

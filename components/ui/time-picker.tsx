"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

function parseTime(value: string): { h: string; m: string } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { h: "08", m: "00" };
  const h = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(
    2,
    "0"
  );
  const m = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(
    2,
    "0"
  );
  return { h, m };
}

/** Преміальний вибір часу (Premium Clay) */
export function TimePicker({
  value,
  onChange,
  className,
  placeholder = "—:—",
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const { h, m } = parseTime(value || "08:00");

  const minuteOptions = useMemo(() => {
    if (MINUTES.includes(m)) return MINUTES;
    return [...MINUTES, m].sort((a, b) => Number(a) - Number(b));
  }, [m]);

  function pick(nextH: string, nextM: string) {
    onChange(`${nextH}:${nextM}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3",
          "text-base font-semibold tabular-nums text-zinc-900 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] md:text-sm",
          "transition-colors outline-none",
          "hover:border-[#276749]/35 focus-visible:border-[#276749]/45 focus-visible:ring-2 focus-visible:ring-[#276749]/15",
          !value && "font-medium text-zinc-400",
          className
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-[#276749]" />
          <span className="truncate">{value || placeholder}</span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-full overflow-hidden rounded-2xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-lg md:w-[11.5rem]"
      >
        <div className="border-b border-[#E5DFD3]/80 bg-white/60 px-3 py-2">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
            Час · {h}:{m}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-0 divide-x divide-[#E5DFD3]">
          <div
            className="desktop-scrollbar max-h-64 overflow-y-auto overscroll-contain p-1.5 md:max-h-48"
            data-desktop-scroll="true"
          >
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              Год
            </p>
            {HOURS.map((hour) => {
              const active = hour === h;
              return (
                <button
                  key={hour}
                  type="button"
                  onClick={() => pick(hour, m)}
                  className={cn(
                    "flex h-11 w-full items-center justify-center rounded-lg text-base font-semibold tabular-nums transition-colors md:h-8 md:text-sm",
                    active
                      ? "bg-[#276749] text-white shadow-sm"
                      : "text-zinc-700 hover:bg-white"
                  )}
                >
                  {hour}
                </button>
              );
            })}
          </div>
          <div
            className="desktop-scrollbar max-h-64 overflow-y-auto overscroll-contain p-1.5 md:max-h-48"
            data-desktop-scroll="true"
          >
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              Хв
            </p>
            {minuteOptions.map((minute) => {
              const active = minute === m;
              return (
                <button
                  key={minute}
                  type="button"
                  onClick={() => {
                    pick(h, minute);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-11 w-full items-center justify-center rounded-lg text-base font-semibold tabular-nums transition-colors md:h-8 md:text-sm",
                    active
                      ? "bg-[#276749] text-white shadow-sm"
                      : "text-zinc-700 hover:bg-white"
                  )}
                >
                  {minute}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

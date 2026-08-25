"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Акценти панелей палива */
export type FuelSheetAccent =
  | "zinc"
  | "emerald"
  | "sky"
  | "amber"
  | "rose"
  | "fuel";

const accentWell: Record<FuelSheetAccent, string> = {
  zinc: "bg-zinc-900 text-white shadow-zinc-900/25",
  emerald: "bg-emerald-600 text-white shadow-emerald-600/30",
  sky: "bg-sky-600 text-white shadow-sky-600/30",
  amber: "bg-amber-500 text-white shadow-amber-500/30",
  rose: "bg-rose-600 text-white shadow-rose-600/30",
  fuel: "bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-600/35",
};

const accentGlow: Record<FuelSheetAccent, string> = {
  zinc: "from-zinc-900/[0.04]",
  emerald: "from-emerald-500/[0.07]",
  sky: "from-sky-500/[0.07]",
  amber: "from-amber-400/[0.09]",
  rose: "from-rose-500/[0.07]",
  fuel: "from-amber-400/[0.1]",
};

/** Оболонка SheetContent — єдиний «пуш» стиль для /fuel */
export const fuelSheetContentClass = cn(
  "w-full gap-0 overflow-hidden border-l border-zinc-200/70",
  "bg-[linear-gradient(180deg,#ffffff_0%,#fafaf9_48%,#f5f5f4_100%)]",
  "p-0 text-zinc-900",
  "shadow-[-12px_0_40px_-12px_rgba(24,24,27,0.18)]",
  "sm:max-w-[26rem]",
  "[&_[data-slot=sheet-close]]:right-4 [&_[data-slot=sheet-close]]:top-4",
  "[&_[data-slot=sheet-close]]:rounded-full [&_[data-slot=sheet-close]]:bg-white/80",
  "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:shadow-sm",
  "[&_[data-slot=sheet-close]]:ring-1 [&_[data-slot=sheet-close]]:ring-zinc-200/80",
  "[&_[data-slot=sheet-close]]:hover:bg-white [&_[data-slot=sheet-close]]:hover:text-zinc-800"
);

export const fuelSheetBodyClass =
  "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-6";

export const fuelSheetStickyFooterClass = cn(
  "mt-auto shrink-0 border-t border-zinc-200/70",
  "bg-white/90 p-4 backdrop-blur-xl",
  "supports-[backdrop-filter]:bg-white/80",
  "shadow-[0_-8px_24px_-12px_rgba(24,24,27,0.08)]"
);

export const fuelFieldLabelClass =
  "text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase";

export const fuelInputClass = cn(
  "h-12 w-full rounded-2xl border border-zinc-200/90 bg-white px-4",
  "text-sm font-medium text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
  "outline-none transition-all placeholder:text-zinc-400",
  "focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/8"
);

export const fuelSelectTriggerClass = cn(
  "h-12 w-full min-w-0 max-w-full data-[size=default]:h-12 rounded-2xl",
  "border border-zinc-200/90 bg-white px-4 text-sm font-medium text-zinc-900",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
  "overflow-hidden outline-none transition-all",
  "focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/8",
  "data-placeholder:text-zinc-400"
);

export const fuelSelectItemClass =
  "cursor-pointer rounded-xl px-3 py-2.5 text-sm focus:bg-zinc-100";

export const fuelHeroAmountClass = cn(
  "relative flex items-center justify-center rounded-2xl",
  "border border-zinc-200/90 bg-white p-3",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.04)]"
);

export const fuelPrimaryBtnClass = cn(
  "h-12 w-full rounded-2xl text-sm font-semibold text-white",
  "bg-zinc-900 shadow-[0_8px_20px_-8px_rgba(24,24,27,0.45)]",
  "transition-[transform,background-color,box-shadow] hover:bg-zinc-800",
  "active:scale-[0.99]",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
);

type FuelSheetHeaderProps = {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  accent?: FuelSheetAccent;
  /** Додатковий рядок під описом (бейджі, метрики) */
  meta?: ReactNode;
  className?: string;
};

/** Єдиний заголовок правих панелей /fuel */
export function FuelSheetHeader({
  icon: Icon,
  title,
  description,
  accent = "zinc",
  meta,
  className,
}: FuelSheetHeaderProps) {
  return (
    <SheetHeader
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-zinc-200/70 px-5 py-5 pr-14 sm:px-6",
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent",
          accentGlow[accent]
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-white/50 blur-3xl"
      />

      <div className="relative flex items-start gap-3.5">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg",
            accentWell[accent]
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <SheetTitle className="text-[1.05rem] font-bold tracking-tight text-zinc-900 sm:text-lg">
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription className="mt-1 text-[13px] leading-snug text-zinc-500">
              {description}
            </SheetDescription>
          ) : null}
          {meta ? <div className="mt-2.5">{meta}</div> : null}
        </div>
      </div>
    </SheetHeader>
  );
}

export function FuelSheetFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SheetFooter className={cn(fuelSheetStickyFooterClass, className)}>
      {children}
    </SheetFooter>
  );
}

/** Картка-підказка всередині панелі */
export function FuelSheetHint({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "emerald" | "amber" | "rose";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl px-3.5 py-3 text-sm leading-snug",
        tone === "neutral" &&
          "border border-zinc-200/80 bg-zinc-50/90 text-zinc-600",
        tone === "emerald" &&
          "border border-emerald-200/70 bg-emerald-50/80 text-emerald-900",
        tone === "amber" &&
          "border border-amber-200/70 bg-amber-50/80 text-amber-950",
        tone === "rose" &&
          "border border-rose-200/70 bg-rose-50/80 text-rose-800",
        className
      )}
    >
      {children}
    </div>
  );
}

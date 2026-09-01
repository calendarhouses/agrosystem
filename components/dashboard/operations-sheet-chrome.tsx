"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

export type OperationsSheetAccent = "emerald" | "orange" | "zinc" | "sky";

const accentWell: Record<OperationsSheetAccent, string> = {
  emerald: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30",
  orange: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/30",
  zinc: "bg-white/10 text-zinc-200 ring-1 ring-white/10",
  sky: "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/30",
};

const accentGlow: Record<OperationsSheetAccent, string> = {
  emerald: "from-emerald-500/10",
  orange: "from-orange-500/10",
  zinc: "from-white/[0.04]",
  sky: "from-sky-500/10",
};

export const OPS_MOBILE_DRAWER_SIZE =
  "h-[calc(88dvh-var(--app-bottom-inset))] max-h-[calc(88dvh-var(--app-bottom-inset))]";

export const opsSheetBodyClass = cn(
  "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain touch-pan-y",
  "px-4 py-4 pb-[max(2.5rem,calc(1.25rem+var(--safe-bottom)))] md:px-5"
);

export const opsFieldLabelClass =
  "text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase";

export const opsInputClass = cn(
  "h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4",
  "text-base font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:text-sm",
  "outline-none transition-all placeholder:text-zinc-500",
  "focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/15"
);

export const opsSelectTriggerClass = cn(
  "h-12 w-full min-w-0 max-w-full data-[size=default]:h-12 rounded-2xl",
  "border border-white/10 bg-white/[0.06] px-4 text-base font-medium text-zinc-50 md:text-sm",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
  "overflow-hidden outline-none transition-all",
  "focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/15",
  "data-placeholder:text-zinc-500"
);

export const opsPrimaryBtnClass = cn(
  "h-12 w-full rounded-2xl text-sm font-semibold text-white",
  "bg-emerald-600 shadow-[0_8px_24px_-10px_rgba(16,185,129,0.55)]",
  "transition-[transform,background-color,box-shadow] hover:bg-emerald-500",
  "active:scale-[0.99]",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
);

export const opsSelectItemClass =
  "rounded-xl text-zinc-100 focus:bg-white/10 focus:text-zinc-50 data-[selected=true]:bg-white/10";

export const opsSelectContentClass = cn(
  "border-white/10 bg-zinc-900 text-zinc-50 shadow-2xl ring-white/10",
  "[&_[data-slot=select-scroll-up-button]]:bg-zinc-900 [&_[data-slot=select-scroll-down-button]]:bg-zinc-900"
);

export const opsPopoverContentClass =
  "w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-white/10 bg-zinc-900 p-0 text-zinc-50 shadow-2xl";

export const opsCommandInputClass =
  "h-11 border-0 border-b border-white/10 bg-transparent text-sm text-zinc-50 placeholder:text-zinc-500";

export const opsCommandListClass = "max-h-64 bg-zinc-900";

export const opsCommandItemClass =
  "cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-zinc-100 data-[selected=true]:bg-white/10 data-[selected=true]:text-zinc-50";

export const opsSheetFooterClass = cn(
  "mt-auto shrink-0 border-t border-white/10",
  "bg-zinc-950/95 p-4 backdrop-blur-xl",
  "supports-[backdrop-filter]:bg-zinc-950/85",
  "shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)]"
);

export function OperationsDatePicker({
  value,
  onChange,
  placeholder = "Оберіть дату",
  className,
}: {
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(`${value.slice(0, 10)}T12:00:00`) : undefined;
  const label =
    parsed && !Number.isNaN(parsed.getTime())
      ? format(parsed, "d MMMM yyyy", { locale: uk })
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(opsInputClass, "inline-flex items-center gap-2", className)}
      >
        <CalendarIcon className="size-4 shrink-0 text-emerald-400" />
        <span className={cn("truncate text-left", !value && "text-zinc-500")}>
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sheetOnMobile={false}
        className="w-auto overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-3 text-zinc-50 shadow-2xl"
      >
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={(next) => {
            if (!next) return;
            onChange(format(next, "yyyy-MM-dd"));
            setOpen(false);
          }}
          locale={uk}
          className="rounded-xl bg-transparent text-zinc-50 [--cell-size:2.5rem]"
          classNames={{
            caption_label: "text-sm font-semibold text-zinc-100",
            weekday: "text-zinc-500",
            button_previous:
              "text-zinc-300 hover:bg-white/10 hover:text-zinc-50",
            button_next: "text-zinc-300 hover:bg-white/10 hover:text-zinc-50",
            today: "bg-white/10 text-emerald-300",
            outside: "text-zinc-600",
            disabled: "text-zinc-600 opacity-40",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function OperationsPanelShell({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  if (!isMobile) {
    const dim =
      open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden
              className="fixed inset-0 z-[149] bg-black/75 supports-backdrop-filter:backdrop-blur-[4px]"
              onClick={() => onOpenChange(false)}
            />,
            document.body
          )
        : null;

    return (
      <>
        {dim}
        {open ? (
          <div
            className={cn(
              "fixed inset-y-0 right-0 z-[150] flex w-full max-w-md flex-col overflow-hidden",
              "border-l border-white/10 bg-zinc-950 text-zinc-50",
              "shadow-[-16px_0_48px_-12px_rgba(0,0,0,0.65)]",
              className
            )}
          >
            {children}
          </div>
        ) : null}
      </>
    );
  }

  const dim =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-hidden
            className="fixed top-0 right-0 bottom-[var(--app-bottom-inset)] left-0 z-[149] bg-black/75 supports-backdrop-filter:backdrop-blur-[4px]"
            onClick={() => onOpenChange(false)}
          />,
          document.body
        )
      : null;

  return (
    <>
      {dim}
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        dismissible
        modal={false}
        shouldScaleBackground={false}
        noBodyStyles
      >
        <DrawerContent
          className={cn(
            OPS_MOBILE_DRAWER_SIZE,
            "flex flex-col overflow-hidden border-white/10 bg-zinc-950 pb-0 text-zinc-50",
            "[&_[data-slot=drawer-close]]:bg-white/10 [&_[data-slot=drawer-close]]:text-zinc-300 [&_[data-slot=drawer-close]]:ring-white/10",
            "[&_[data-slot=drawer-close]]:hover:bg-white/15 [&_[data-slot=drawer-close]]:hover:text-zinc-50",
            className
          )}
          showCloseButton
        >
          <DrawerHandle className="mb-0 bg-zinc-950 before:bg-white/25" />
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export function OperationsSheetHeader({
  icon: Icon,
  title,
  description,
  accent = "emerald",
  onBack,
  meta,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  accent?: OperationsSheetAccent;
  onBack?: () => void;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-white/10 px-4 py-4 pr-14 md:px-5",
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
        className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl"
      />

      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="relative mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <ChevronLeft className="size-4" />
          Назад
        </button>
      ) : null}

      <div className="relative flex items-start gap-3.5">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-lg",
            accentWell[accent]
          )}
        >
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-[1.15rem] font-bold tracking-tight text-zinc-50 sm:text-lg">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[13px] leading-snug text-zinc-400">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-2.5">{meta}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function OperationsSheetFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(opsSheetFooterClass, "flex flex-col gap-2", className)}>
      {children}
    </div>
  );
}

export function OperationsConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Видалити",
  cancelLabel = "Скасувати",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        presentation="center"
        showCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden rounded-[1.35rem] border border-red-500/20",
          "bg-zinc-900 p-0 text-zinc-50",
          "shadow-[0_24px_60px_-18px_rgba(0,0,0,0.75)]",
          "ring-0 sm:max-w-[22rem]"
        )}
      >
        <div className="relative overflow-hidden px-5 pt-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent"
          />
          <DialogHeader className="relative gap-0 space-y-0 text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-300 ring-1 ring-red-500/25">
                <Trash2 className="size-[18px]" strokeWidth={1.9} />
              </div>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="text-[1.05rem] leading-snug font-bold tracking-tight text-zinc-50">
                  {title}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-[13px] leading-snug text-zinc-400">
                  {description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="flex gap-2.5 px-5 pt-4 pb-5">
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className={cn(
              "h-11 flex-1 rounded-2xl border border-white/10 bg-white/5",
              "text-sm font-semibold text-zinc-200 transition hover:bg-white/10",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center rounded-2xl",
              "text-sm font-bold text-white",
              "bg-red-600 shadow-[0_8px_18px_-8px_rgba(220,38,38,0.55)]",
              "transition hover:bg-red-500",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

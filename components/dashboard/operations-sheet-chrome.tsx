"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";

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

export const opsSheetFooterClass = cn(
  "mt-auto shrink-0 border-t border-white/10",
  "bg-zinc-950/95 p-4 backdrop-blur-xl",
  "supports-[backdrop-filter]:bg-zinc-950/85",
  "shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)]"
);

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
            className
          )}
          showCloseButton
        >
          <DrawerHandle />
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

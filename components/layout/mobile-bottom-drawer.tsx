"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { SwipeableSheet } from "@/components/ui/swipe-sheet";
import { cn } from "@/lib/utils";

type MobileBottomDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** Залишити нижнє меню видимим під шторкою */
  preserveNav?: boolean;
  showCloseButton?: boolean;
};

/** Нативна мобільна шторка знизу (поверх контенту, над bottom nav). */
export function MobileBottomDrawer({
  open,
  onOpenChange,
  children,
  className,
  preserveNav = true,
  showCloseButton = true,
}: MobileBottomDrawerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;

  const navOffset = preserveNav ? "var(--app-bottom-inset)" : "0px";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Закрити меню"
            className="fixed inset-x-0 top-0 z-[105] bg-black/55 backdrop-blur-[2px]"
            style={{ bottom: navOffset }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              "fixed inset-x-0 z-[110] flex max-h-[min(88dvh,calc(100dvh-var(--app-bottom-inset)))] flex-col overflow-hidden rounded-t-3xl border border-b-0 border-zinc-800 bg-zinc-950 shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.65)]",
              className
            )}
            style={{ bottom: navOffset }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 440, damping: 40 }}
          >
            {showCloseButton ? (
              <button
                type="button"
                aria-label="Закрити"
                onClick={() => onOpenChange(false)}
                className="absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700 hover:text-white touch-manipulation"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <SwipeableSheet
              className="min-h-0 flex-1"
              handleClassName="pt-2.5 pb-1"
              onSwipeDown={() => onOpenChange(false)}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
                {children}
              </div>
            </SwipeableSheet>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

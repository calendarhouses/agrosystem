"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { SheetDragHandle } from "@/components/ui/swipe-sheet";
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

const SHEET_SPRING = { type: "spring" as const, stiffness: 440, damping: 40 };
const SHEET_CLOSE_EASE = { duration: 0.24, ease: [0.4, 0, 1, 1] as const };

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
  const dragControls = useDragControls();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function requestClose() {
    onOpenChange(false);
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    dragControls.start(event);
  }

  function handleDragEnd(_event: unknown, info: PanInfo) {
    const shouldClose = info.offset.y > 72 || info.velocity.y > 450;
    if (shouldClose) {
      onOpenChange(false);
    }
  }

  if (!mounted) return null;

  const navOffset = preserveNav ? "var(--app-bottom-inset)" : "0px";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            key="mobile-bottom-drawer-overlay"
            type="button"
            aria-label="Закрити меню"
            className="fixed inset-x-0 top-0 z-[259] bg-black/70 backdrop-blur-[3px]"
            style={{ bottom: navOffset }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={requestClose}
          />
          <div
            key="mobile-bottom-drawer-clip"
            className="pointer-events-none fixed inset-x-0 top-0 z-[260] overflow-hidden"
            style={{ bottom: navOffset }}
          >
            <motion.div
              key="mobile-bottom-drawer-sheet"
              role="dialog"
              aria-modal="true"
              initial={{ y: "100%" }}
              animate={{ y: 0, transition: SHEET_SPRING }}
              exit={{ y: "100%", transition: SHEET_CLOSE_EASE }}
              className={cn(
                "pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,calc(100dvh-var(--app-bottom-inset)))] flex-col overflow-hidden rounded-t-3xl border border-b-0 border-zinc-800 bg-zinc-950 shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.65)]",
                className
              )}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.35 }}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
            >
              {showCloseButton ? (
                <button
                  type="button"
                  aria-label="Закрити"
                  onClick={requestClose}
                  className="absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 touch-manipulation items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}

              <div className="relative z-10 shrink-0">
                <SheetDragHandle
                  className="min-h-11 cursor-grab pt-3 pb-2 active:cursor-grabbing"
                  onPointerDown={startDrag}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

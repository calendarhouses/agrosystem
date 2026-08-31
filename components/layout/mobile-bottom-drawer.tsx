"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import {
  useEffect,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
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
  const [show, setShow] = useState(open);
  const dragControls = useDragControls();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setShow(true);
  }, [open]);

  const isExiting = show && !open;

  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  function requestClose() {
    onOpenChange(false);
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    dragControls.start(event);
  }

  function handleDragEnd(_event: unknown, info: PanInfo) {
    const close = info.offset.y > 72 || info.velocity.y > 450;
    if (close) requestClose();
  }

  if (!mounted) return null;

  const navOffset = preserveNav ? "var(--app-bottom-inset)" : "0px";
  const sheetZ = isExiting && preserveNav ? "z-[90]" : "z-[260]";
  const overlayZ = isExiting && preserveNav ? "z-[89]" : "z-[259]";

  return createPortal(
    <AnimatePresence onExitComplete={() => setShow(false)}>
      {show ? (
        <>
          <motion.button
            type="button"
            aria-label="Закрити меню"
            className={cn(
              "fixed inset-x-0 top-0 bg-black/70 backdrop-blur-[3px]",
              overlayZ
            )}
            style={{ bottom: navOffset }}
            initial={{ opacity: 0 }}
            animate={{ opacity: isExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: isExiting ? 0.16 : 0.18 }}
            onClick={requestClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              "fixed inset-x-0 flex max-h-[min(88dvh,calc(100dvh-var(--app-bottom-inset)))] flex-col overflow-hidden rounded-t-3xl border border-b-0 border-zinc-800 bg-zinc-950 shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.65)]",
              sheetZ,
              className
            )}
            style={{ bottom: navOffset }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={
              isExiting
                ? { duration: 0.22, ease: [0.4, 0, 0.2, 1] }
                : { type: "spring", stiffness: 440, damping: 40 }
            }
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.55 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
          >
            {showCloseButton ? (
              <button
                type="button"
                aria-label="Закрити"
                onClick={requestClose}
                className="absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700 hover:text-white touch-manipulation"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}

            {/* Велика зона свайпу: хендл + верхня смуга */}
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
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

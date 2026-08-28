"use client";

import { type PointerEvent, type ReactNode } from "react";
import { motion, useDragControls, type PanInfo } from "framer-motion";

import { cn } from "@/lib/utils";

export function SheetDragHandle({
  className,
  onPointerDown,
}: {
  className?: string;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 touch-none items-center justify-center pt-2.5 pb-1",
        className
      )}
      onPointerDown={onPointerDown}
    >
      <span
        className="h-1.5 w-12 rounded-full bg-zinc-400/75 shadow-inner"
        aria-hidden
      />
      <span className="sr-only">Потягніть вниз, щоб закрити</span>
    </div>
  );
}

type SwipeableSheetProps = {
  children: ReactNode;
  className?: string;
  /** Свайп вниз — згорнути або закрити */
  onSwipeDown: () => void;
  /** Свайп вгору — розгорнути */
  onSwipeUp?: () => void;
  disabled?: boolean;
  showHandle?: boolean;
};

/** Нижня шторка зі свайпом. Drag лише з хендла — скрол контенту не закриває. */
export function SwipeableSheet({
  children,
  className,
  onSwipeDown,
  onSwipeUp,
  disabled = false,
  showHandle = true,
}: SwipeableSheetProps) {
  const dragControls = useDragControls();

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (disabled) return;
    const close =
      info.offset.y > 88 || info.velocity.y > 620;
    const open = info.offset.y < -48 || info.velocity.y < -480;
    if (close) {
      onSwipeDown();
      return;
    }
    if (open) onSwipeUp?.();
  }

  return (
    <motion.div
      className={cn("flex h-full min-h-0 flex-col", className)}
      drag={disabled ? false : "y"}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.45 }}
      dragMomentum={false}
      dragPropagation={false}
      onDragEnd={handleDragEnd}
      transition={{ type: "spring", stiffness: 420, damping: 40 }}
    >
      {showHandle && !disabled ? (
        <SheetDragHandle
          onPointerDown={(event) => {
            dragControls.start(event);
          }}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none">
        {children}
      </div>
    </motion.div>
  );
}

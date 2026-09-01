"use client";

import {
  createContext,
  useContext,
  useRef,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { motion, useDragControls, type PanInfo } from "framer-motion";

import { cn } from "@/lib/utils";

type SwipeSheetDragStart = (event: PointerEvent<HTMLElement>) => void;

const SwipeSheetDragContext = createContext<SwipeSheetDragStart | null>(null);

export function useSwipeSheetDrag() {
  return useContext(SwipeSheetDragContext);
}

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
        "flex shrink-0 touch-none items-center justify-center pt-2 pb-1",
        className
      )}
      onPointerDown={onPointerDown}
    >
      <span
        className="h-1 w-10 rounded-full bg-zinc-400/80 shadow-inner"
        aria-hidden
      />
      <span className="sr-only">Потягніть, щоб змінити розмір</span>
    </div>
  );
}

type SwipeableSheetProps = {
  children: ReactNode;
  className?: string;
  handleClassName?: string;
  /** Зона заголовка також запускає drag (peek / header) */
  dragHandle?: ReactNode;
  /** Свайп вниз — згорнути або закрити */
  onSwipeDown: () => void;
  /** Свайп вгору — розгорнути */
  onSwipeUp?: () => void;
  disabled?: boolean;
  showHandle?: boolean;
  /** Не тягнути, якщо скрол контенту не на початку */
  lockDragWhenScrolled?: boolean;
};

/** Нижня шторка зі свайпом. Drag з хендла та заголовка. */
export function SwipeableSheet({
  children,
  className,
  handleClassName,
  dragHandle,
  onSwipeDown,
  onSwipeUp,
  disabled = false,
  showHandle = true,
  lockDragWhenScrolled = false,
}: SwipeableSheetProps) {
  const dragControls = useDragControls();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragEnabledRef = useRef(true);

  function canStartDrag() {
    if (disabled) return false;
    if (!lockDragWhenScrolled) return true;
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollTop <= 2;
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!canStartDrag()) return;
    dragControls.start(event);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    dragEnabledRef.current = canStartDrag();
  }

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (disabled) return;
    const close = info.offset.y > 56 || info.velocity.y > 420;
    const open = info.offset.y < -36 || info.velocity.y < -320;
    if (close) {
      onSwipeDown();
      return;
    }
    if (open) onSwipeUp?.();
  }

  return (
    <SwipeSheetDragContext.Provider value={startDrag}>
      <motion.div
        className={cn("flex h-full min-h-0 flex-col", className)}
        drag={disabled ? false : "y"}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.18, bottom: 0.35 }}
        dragMomentum={false}
        dragPropagation={false}
        onDragEnd={handleDragEnd}
      >
        {showHandle && !disabled ? (
          <SheetDragHandle
            className={handleClassName}
            onPointerDown={startDrag}
          />
        ) : null}
        {dragHandle ? (
          <div className="shrink-0 touch-none" onPointerDown={startDrag}>
            {dragHandle}
          </div>
        ) : null}
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none"
          onTouchStart={lockDragWhenScrolled ? handleTouchStart : undefined}
        >
          {children}
        </div>
      </motion.div>
    </SwipeSheetDragContext.Provider>
  );
}

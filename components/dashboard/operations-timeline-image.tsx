"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, RotateCcw, Wheat, X, ZoomIn } from "lucide-react";

import { cn } from "@/lib/utils";

type OperationsTimelineImageProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  frameClassName?: string;
  variant?: "dark" | "light";
  aspectClassName?: string;
  expandable?: boolean;
  onBeforeExpand?: (event: React.MouseEvent | React.KeyboardEvent) => void;
};

const LIGHTBOX_MIN_SCALE = 1;
const LIGHTBOX_MAX_SCALE = 4;

function clampScale(value: number) {
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, value));
}

function OperationsImageLightbox({
  src,
  alt = "",
  open,
  onOpenChange,
}: {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
  } | null>(null);
  const lastTapRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    dragRef.current = null;
    pinchRef.current = null;
    setIsDragging(false);
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    resetView();
  }, [open, src, resetView]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const setScaleClamped = useCallback((next: number | ((current: number) => number)) => {
    setScale((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      const clamped = clampScale(Number(resolved.toFixed(2)));
      if (clamped <= 1) {
        setOffset({ x: 0, y: 0 });
      }
      return clamped;
    });
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.15 : -0.15;
      setScaleClamped((current) => current + delta);
    },
    [setScaleClamped]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (scale <= 1) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      };
    },
    [offset.x, offset.y, scale]
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }, []);

  const endPointer = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      pinchRef.current = {
        startDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startScale: scale,
      };
    },
    [scale]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const pinch = pinchRef.current;
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setScaleClamped((pinch.startScale * distance) / pinch.startDistance);
    },
    [setScaleClamped]
  );

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const onImageClick = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      event.stopPropagation();
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setScaleClamped((current) => (current > 1 ? 1 : 2));
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
    },
    [setScaleClamped]
  );

  if (!open || !mounted) return null;

  const isZoomed = scale > 1.01 || Math.abs(offset.x) > 1 || Math.abs(offset.y) > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[320] isolate"
      role="dialog"
      aria-modal="true"
      aria-label="Перегляд фото"
    >
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/94 backdrop-blur-md"
        aria-label="Закрити перегляд"
        onClick={close}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-50 pt-[max(0.75rem,var(--safe-top))]">
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-md">
            <p className="truncate text-sm font-medium text-zinc-100">
              {alt || "Фото скаутингу"}
            </p>
            <p className="text-[11px] text-zinc-400">
              Подвійний дотик · pinch · коліщатко
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isZoomed ? (
              <button
                type="button"
                onClick={resetView}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 text-xs font-semibold text-zinc-100 backdrop-blur-md transition hover:bg-black/65"
              >
                <RotateCcw className="size-3.5" />
                Скинути
              </button>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/50 text-zinc-100 backdrop-blur-md transition hover:bg-black/65"
              aria-label="Закрити"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div
        className="absolute inset-0 z-10 flex items-center justify-center px-4 pt-20 pb-24"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={close}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn(
            "max-h-[min(72dvh,720px)] max-w-[min(100vw-2rem,920px)] select-none rounded-2xl object-contain shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)]",
            scale > 1 ? "cursor-grab" : "cursor-zoom-in",
            isDragging && "cursor-grabbing"
          )}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: isDragging || pinchRef.current ? "none" : "transform 180ms ease-out",
          }}
          onClick={onImageClick}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setScaleClamped((current) => (current > 1 ? 1 : 2));
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
      </div>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-50 pb-[max(1rem,var(--safe-bottom))]">
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-center justify-center gap-2 px-4">
          <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/50 p-1 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setScaleClamped((current) => current - 0.25)}
              disabled={scale <= LIGHTBOX_MIN_SCALE}
              className="inline-flex size-10 items-center justify-center rounded-full text-lg font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-35"
              aria-label="Зменшити"
            >
              −
            </button>
            <span className="min-w-14 px-1 text-center text-xs font-bold text-zinc-300 tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScaleClamped((current) => current + 0.25)}
              disabled={scale >= LIGHTBOX_MAX_SCALE}
              className="inline-flex size-10 items-center justify-center rounded-full text-lg font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-35"
              aria-label="Збільшити"
            >
              +
            </button>
          </div>
        </div>
      </footer>
    </div>,
    document.body
  );
}

export function OperationsTimelineImagePlaceholder({
  variant = "dark",
  className,
  aspectClassName = "aspect-[4/3]",
}: {
  variant?: "dark" | "light";
  className?: string;
  aspectClassName?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        aspectClassName,
        variant === "light"
          ? "border-zinc-200/90 bg-gradient-to-br from-[#F4F1EA] via-white to-emerald-50/80"
          : "border-white/10 bg-gradient-to-br from-sky-500/10 via-white/[0.04] to-emerald-500/10",
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 opacity-40",
          variant === "light"
            ? "bg-[radial-gradient(circle_at_30%_20%,rgba(39,103,73,0.12),transparent_55%)]"
            : "bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,248,0.16),transparent_55%)]"
        )}
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-2xl ring-1 backdrop-blur-sm",
            variant === "light"
              ? "bg-white/80 text-emerald-700 ring-emerald-200/80"
              : "bg-white/10 text-sky-200 ring-white/15"
          )}
        >
          <Camera className="size-5" aria-hidden />
        </span>
        <p
          className={cn(
            "text-[11px] font-medium tracking-wide",
            variant === "light" ? "text-zinc-500" : "text-zinc-400"
          )}
        >
          Фото недоступне
        </p>
      </div>
    </div>
  );
}

export function OperationsTimelineImage({
  src,
  alt = "",
  className,
  frameClassName,
  variant = "dark",
  aspectClassName = "aspect-[4/3]",
  expandable = false,
  onBeforeExpand,
}: OperationsTimelineImageProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const trimmed = src?.trim();

  const openLightbox = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent) => {
      onBeforeExpand?.(event);
      event.stopPropagation();
      event.preventDefault();
      if (!trimmed || failed) return;
      setLightboxOpen(true);
    },
    [failed, onBeforeExpand, trimmed]
  );

  if (!trimmed || failed) {
    return (
      <OperationsTimelineImagePlaceholder
        variant={variant}
        className={cn(frameClassName, className)}
        aspectClassName={aspectClassName}
      />
    );
  }

  const frame = (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        aspectClassName,
        variant === "light" ? "border-zinc-200/80" : "border-white/10",
        frameClassName,
        expandable && "group"
      )}
    >
      <img
        src={trimmed}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", className)}
        onError={() => setFailed(true)}
        draggable={false}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/25 to-transparent"
      />
      {expandable ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20 group-active:bg-black/25"
        >
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-black/45 text-white opacity-0 ring-1 ring-white/20 backdrop-blur-sm transition group-hover:opacity-100 group-active:opacity-100">
            <ZoomIn className="size-4" />
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {expandable ? (
        <button
          type="button"
          onClick={openLightbox}
          className="block w-full cursor-zoom-in text-left touch-manipulation"
          aria-label="Відкрити фото в повному розмірі"
        >
          {frame}
        </button>
      ) : (
        frame
      )}
      <OperationsImageLightbox
        src={trimmed}
        alt={alt}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
    </>
  );
}

export function OperationsTimelineImageThumb({
  src,
  variant = "dark",
  className,
  expandable = true,
  compact = false,
  onBeforeExpand,
}: {
  src: string | null | undefined;
  variant?: "dark" | "light";
  className?: string;
  expandable?: boolean;
  compact?: boolean;
  onBeforeExpand?: (event: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  return (
    <OperationsTimelineImage
      src={src}
      variant={variant}
      aspectClassName={compact ? "h-20 w-full" : "h-24 w-full"}
      className={cn(compact ? "mt-1.5" : "mt-2", className)}
      expandable={expandable}
      onBeforeExpand={onBeforeExpand}
      alt="Фото скаутингу"
    />
  );
}

export function OperationsTimelineImageEmptyNotes({
  variant = "dark",
}: {
  variant?: "dark" | "light";
}) {
  return (
    <div
      className={cn(
        "mt-2 flex h-24 w-full items-center justify-center rounded-xl border border-dashed",
        variant === "light"
          ? "border-zinc-200 bg-zinc-50 text-zinc-400"
          : "border-white/10 bg-white/[0.02] text-zinc-500"
      )}
    >
      <Wheat className="size-6 opacity-40" aria-hidden />
    </div>
  );
}

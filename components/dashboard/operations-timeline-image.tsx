"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Minus, Plus, Wheat, X, ZoomIn } from "lucide-react";

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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    dragRef.current = null;
    pinchRef.current = null;
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const zoomBy = useCallback((delta: number) => {
    setScale((current) => clampScale(Number((current + delta).toFixed(2))));
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    setScale((current) => clampScale(Number((current + delta).toFixed(2))));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scale <= 1) return;
      event.currentTarget.setPointerCapture(event.pointerId);
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

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      pinchRef.current = {
        startDistance: Math.hypot(dx, dy),
        startScale: scale,
      };
    },
    [scale]
  );

  const onTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    const distance = Math.hypot(dx, dy);
    const next = clampScale(
      Number(((pinch.startScale * distance) / pinch.startDistance).toFixed(2))
    );
    setScale(next);
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex flex-col bg-zinc-950/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Перегляд фото"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="truncate text-sm font-medium text-zinc-200">{alt || "Фото"}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => zoomBy(-0.25)}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/10 text-zinc-100 transition hover:bg-white/20"
            aria-label="Зменшити"
          >
            <Minus className="size-4" />
          </button>
          <span className="min-w-12 text-center text-xs font-semibold text-zinc-400 tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(0.25)}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/10 text-zinc-100 transition hover:bg-white/20"
            aria-label="Збільшити"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/10 text-zinc-100 transition hover:bg-white/20"
            aria-label="Закрити"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-4"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "flex max-h-full max-w-full items-center justify-center",
            scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          )}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragRef.current || pinchRef.current ? "none" : "transform 120ms ease-out",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => {
            setScale((current) => (current > 1 ? 1 : 2));
            setOffset({ x: 0, y: 0 });
          }}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[calc(100dvh-7rem)] max-w-full select-none rounded-xl object-contain shadow-2xl"
            draggable={false}
          />
        </div>
      </div>
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
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20"
        >
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-black/45 text-white opacity-0 ring-1 ring-white/20 backdrop-blur-sm transition group-hover:opacity-100">
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
          className="block w-full cursor-zoom-in text-left"
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
  onBeforeExpand,
}: {
  src: string | null | undefined;
  variant?: "dark" | "light";
  className?: string;
  expandable?: boolean;
  onBeforeExpand?: (event: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  return (
    <OperationsTimelineImage
      src={src}
      variant={variant}
      aspectClassName="h-24 w-full"
      className={cn("mt-2", className)}
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

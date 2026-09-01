"use client";

import { useState } from "react";
import { Camera, Wheat } from "lucide-react";

import { cn } from "@/lib/utils";

type OperationsTimelineImageProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  frameClassName?: string;
  variant?: "dark" | "light";
  aspectClassName?: string;
};

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
}: OperationsTimelineImageProps) {
  const [failed, setFailed] = useState(false);
  const trimmed = src?.trim();

  if (!trimmed || failed) {
    return (
      <OperationsTimelineImagePlaceholder
        variant={variant}
        className={cn(frameClassName, className)}
        aspectClassName={aspectClassName}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        aspectClassName,
        variant === "light" ? "border-zinc-200/80" : "border-white/10",
        frameClassName
      )}
    >
      <img
        src={trimmed}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", className)}
        onError={() => setFailed(true)}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/25 to-transparent"
      />
    </div>
  );
}

export function OperationsTimelineImageThumb({
  src,
  variant = "dark",
  className,
}: {
  src: string | null | undefined;
  variant?: "dark" | "light";
  className?: string;
}) {
  return (
    <OperationsTimelineImage
      src={src}
      variant={variant}
      aspectClassName="h-24 w-full"
      className={cn("mt-2", className)}
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

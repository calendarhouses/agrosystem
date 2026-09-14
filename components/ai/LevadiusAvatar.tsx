"use client";

import { cn } from "@/lib/utils";

type LevadiusAvatarProps = {
  size?: number;
  className?: string;
  /** Пульс «онлайн» + орбітальне кільце */
  live?: boolean;
};

/**
 * Аватар LEVADIUS з орбітальним кільцем і цяткою online поза overflow.
 */
export function LevadiusAvatar({
  size = 36,
  className,
  live = true,
}: LevadiusAvatarProps) {
  const ringPad = 6;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className
      )}
      style={{ width: size + ringPad * 2, height: size + ringPad * 2 }}
      aria-hidden
    >
      {live ? (
        <>
          <span
            className="pointer-events-none absolute inset-0 rounded-full border border-emerald-400/25"
            style={{ animation: "levadius-orbit-pulse 2.8s ease-out infinite" }}
          />
          <span
            className="pointer-events-none absolute inset-[3px] rounded-full border border-emerald-400/40"
            style={{
              animation: "levadius-orbit-pulse 2.8s ease-out infinite 0.45s",
            }}
          />
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(52,211,153,0.55) 50deg, transparent 95deg)",
              animation: "levadius-orbit-spin 4.5s linear infinite",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
            }}
          />
        </>
      ) : null}

      <span
        className="relative overflow-hidden rounded-full ring-2 ring-emerald-500/35 ring-offset-2 ring-offset-zinc-900"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/levadius-avatar.jpg?v=8"
          alt=""
          className="size-full object-cover"
        />
      </span>

      {live ? (
        <span className="absolute top-1 right-1 z-10 flex size-2.5 items-center justify-center">
          <span className="absolute size-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative size-2 rounded-full border-2 border-zinc-950 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        </span>
      ) : null}
    </span>
  );
}

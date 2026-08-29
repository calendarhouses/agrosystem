"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatTrackClock,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "@/lib/equipment-track-playback";
import { cn } from "@/lib/utils";

type Props = {
  visible: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  progress: number;
  onProgressChange: (value: number) => void;
  maxProgress: number;
  playbackSpeed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  startUnix: number | null;
  endUnix: number | null;
  currentUnix: number | null;
  /** Миттєвий unix для scrub (під час тягнення пальцем) */
  unixAtProgress?: (progress: number) => number | null;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
};

export function EquipmentTrackPlaybackPanel({
  visible,
  isPlaying,
  onTogglePlay,
  progress,
  onProgressChange,
  maxProgress,
  playbackSpeed,
  onSpeedChange,
  startUnix,
  endUnix,
  currentUnix,
  unixAtProgress,
  disabled,
  loading,
  className,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(progress);

  useEffect(() => {
    if (!scrubbing) setScrubProgress(progress);
  }, [progress, scrubbing]);

  if (!visible) return null;

  const safeMax = Math.max(maxProgress, 0);
  const scrubDisabled = disabled || loading || safeMax <= 0;
  const displayProgress = scrubbing ? scrubProgress : progress;
  const ratio =
    safeMax > 0 ? Math.min(1, Math.max(0, displayProgress / safeMax)) : 0;

  const displayUnix =
    (unixAtProgress ? unixAtProgress(displayProgress) : null) ??
    currentUnix ??
    startUnix;

  function progressFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el || safeMax <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return (x / rect.width) * safeMax;
  }

  function commitProgress(next: number) {
    const clamped = Math.min(safeMax, Math.max(0, next));
    setScrubProgress(clamped);
    onProgressChange(clamped);
  }

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[min(100%,28rem)] max-w-full items-center gap-2.5 rounded-2xl border border-white/40 bg-background/90 px-3 py-2.5 shadow-lg backdrop-blur-md sm:gap-3 sm:px-4",
        className
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="h-10 w-10 shrink-0 rounded-full"
        disabled={scrubDisabled}
        onClick={onTogglePlay}
        aria-label={isPlaying ? "Пауза" : "Відтворити"}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          className={cn(
            "relative h-11 touch-none select-none pt-5",
            scrubDisabled && "pointer-events-none opacity-40"
          )}
          onPointerDown={(e) => {
            if (scrubDisabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(true);
            commitProgress(progressFromClientX(e.clientX));
          }}
          onPointerMove={(e) => {
            if (!scrubbing || scrubDisabled) return;
            commitProgress(progressFromClientX(e.clientX));
          }}
          onPointerUp={(e) => {
            if (!scrubbing) return;
            commitProgress(progressFromClientX(e.clientX));
            setScrubbing(false);
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={() => setScrubbing(false)}
        >
          <div className="absolute inset-x-0 bottom-2.5 h-1.5 rounded-full bg-muted" />
          <div
            className="absolute bottom-2.5 left-0 h-1.5 rounded-full bg-emerald-600"
            style={{ width: `${ratio * 100}%` }}
          />
          <div
            className="absolute bottom-1 z-10 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${ratio * 100}%` }}
          >
            <span
              className={cn(
                "mb-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-[12px] font-extrabold tabular-nums tracking-tight shadow-md",
                scrubbing
                  ? "bg-emerald-700 text-white scale-105"
                  : "bg-zinc-900/90 text-white"
              )}
            >
              {formatTrackClock(displayUnix)}
            </span>
            <span
              className={cn(
                "block h-4 w-4 rounded-full border-2 border-white bg-emerald-600 shadow-md ring-2 ring-emerald-500/35",
                scrubbing && "h-[1.15rem] w-[1.15rem]"
              )}
            />
          </div>
        </div>
        <div className="mt-0.5 flex justify-between px-0.5 text-[10px] font-semibold tabular-nums text-zinc-500">
          <span>{formatTrackClock(startUnix)}</span>
          <span>{formatTrackClock(endUnix)}</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-0.5 rounded-xl border border-border/60 bg-muted/40 p-0.5">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            disabled={scrubDisabled}
            onClick={() => onSpeedChange(speed)}
            className={cn(
              "rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums transition-colors",
              playbackSpeed === speed
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              scrubDisabled && "pointer-events-none opacity-40"
            )}
          >
            {speed}x
          </button>
        ))}
      </div>
    </div>
  );
}

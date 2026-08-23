"use client";

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
  disabled,
  loading,
  className,
}: Props) {
  if (!visible) return null;

  const safeMax = Math.max(maxProgress, 0);
  const scrubDisabled = disabled || loading || safeMax <= 0;

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-full border border-white/40 bg-background/90 px-4 py-2.5 shadow-lg backdrop-blur-md sm:gap-4 sm:px-6 sm:py-3",
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

      <div className="hidden min-w-[3.5rem] text-center text-xs font-semibold tabular-nums text-muted-foreground sm:block">
        {formatTrackClock(currentUnix ?? startUnix)}
      </div>

      <input
        type="range"
        min={0}
        max={safeMax || 0}
        step={0.01}
        value={Math.min(progress, safeMax)}
        disabled={scrubDisabled}
        onChange={(e) => {
          onProgressChange(Number(e.target.value));
        }}
        className={cn(
          "h-1.5 w-[min(42vw,320px)] cursor-pointer appearance-none rounded-full bg-muted accent-emerald-600",
          scrubDisabled && "opacity-40"
        )}
      />

      <div className="hidden min-w-[3.5rem] text-center text-xs font-semibold tabular-nums text-muted-foreground sm:block">
        {formatTrackClock(endUnix)}
      </div>

      <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-0.5">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            disabled={scrubDisabled}
            onClick={() => onSpeedChange(speed)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-bold tabular-nums transition-colors",
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

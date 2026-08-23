"use client";

import { useEffect, useMemo, useState } from "react";

import {
  PLAYBACK_STEP_PER_FRAME,
  progressUnixTime,
  trackMaxProgress,
  type PlaybackSpeed,
} from "@/lib/equipment-track-playback";
import type { WialonTrackLineFeature } from "@/lib/wialon";

export function useEquipmentTrackPlayback(
  track: WialonTrackLineFeature | null,
  enabled: boolean
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);

  const maxProgress = useMemo(() => trackMaxProgress(track), [track]);
  const times = track?.properties.times ?? [];
  const startUnix = times[0] ?? null;
  const endUnix = times[times.length - 1] ?? null;
  const currentUnix = progressUnixTime(track, progress);

  useEffect(() => {
    setProgress(0);
    setIsPlaying(false);
    setPlaybackSpeed(1);
  }, [track]);

  useEffect(() => {
    if (enabled) return;
    setIsPlaying(false);
    setProgress(0);
    setPlaybackSpeed(1);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isPlaying || maxProgress <= 0) return;

    let rafId = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      setProgress((prev) => {
        if (prev >= maxProgress) {
          queueMicrotask(() => setIsPlaying(false));
          return maxProgress;
        }
        const next = Math.min(
          prev + PLAYBACK_STEP_PER_FRAME * playbackSpeed,
          maxProgress
        );
        if (next >= maxProgress) {
          queueMicrotask(() => setIsPlaying(false));
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, isPlaying, maxProgress, playbackSpeed]);

  const togglePlay = () => {
    if (maxProgress <= 0) return;
    setIsPlaying((prev) => {
      if (prev) return false;
      if (progress >= maxProgress) setProgress(0);
      return true;
    });
  };

  return {
    isPlaying,
    setIsPlaying,
    progress,
    setProgress,
    playbackSpeed,
    setPlaybackSpeed,
    maxProgress,
    startUnix,
    endUnix,
    currentUnix,
    togglePlay,
    disabled: maxProgress <= 0,
  };
}

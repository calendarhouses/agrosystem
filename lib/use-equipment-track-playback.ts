"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PLAYBACK_STEP_PER_FRAME,
  progressUnixTime,
  trackMaxProgress,
  type PlaybackSpeed,
} from "@/lib/equipment-track-playback";
import type { WialonTrackLineFeature } from "@/lib/wialon";

/** Стабільний ключ треку — новий object identity з тим самим вмістом не ресетить плеєр. */
function trackIdentityKey(track: WialonTrackLineFeature | null): string {
  if (!track) return "null";
  const coords = track.geometry?.coordinates ?? [];
  const times = track.properties?.times ?? [];
  return `${coords.length}:${times[0] ?? 0}:${times[times.length - 1] ?? 0}`;
}

export function useEquipmentTrackPlayback(
  track: WialonTrackLineFeature | null,
  enabled: boolean
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);

  const maxProgress = useMemo(() => trackMaxProgress(track), [track]);
  const trackKey = useMemo(() => trackIdentityKey(track), [track]);

  const times = track?.properties.times;
  const startUnix = times?.[0] ?? null;
  const endUnix = times && times.length > 0 ? times[times.length - 1]! : null;
  const currentUnix = progressUnixTime(track, progress);

  const progressRef = useRef(progress);
  const speedRef = useRef(playbackSpeed);
  const maxRef = useRef(maxProgress);
  progressRef.current = progress;
  speedRef.current = playbackSpeed;
  maxRef.current = maxProgress;

  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    setIsPlaying(false);
    setPlaybackSpeed(1);
  }, [trackKey]);

  useEffect(() => {
    if (enabled) return;
    progressRef.current = 0;
    setIsPlaying(false);
    setProgress(0);
    setPlaybackSpeed(1);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isPlaying || maxProgress <= 0) return;

    let rafId = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;

      const max = maxRef.current;
      const prev = progressRef.current;

      // Вже на кінці — стоп без зайвого setState (байл-аут / каскад оновлень)
      if (prev >= max) {
        alive = false;
        setIsPlaying(false);
        return;
      }

      const next = Math.min(
        prev + PLAYBACK_STEP_PER_FRAME * speedRef.current,
        max
      );
      progressRef.current = next;
      setProgress(next);

      if (next >= max) {
        alive = false;
        setIsPlaying(false);
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
    // speed через ref — зміна 1x/5x/10x не перезапускає цикл
  }, [enabled, isPlaying, maxProgress]);

  const togglePlay = useCallback(() => {
    if (maxRef.current <= 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (progressRef.current >= maxRef.current) {
      progressRef.current = 0;
      setProgress(0);
    }
    setIsPlaying(true);
  }, [isPlaying]);

  const setProgressSafe = useCallback((value: number | ((p: number) => number)) => {
    setProgress((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      const clamped = Math.min(Math.max(next, 0), maxRef.current || 0);
      progressRef.current = clamped;
      return clamped;
    });
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    progress,
    setProgress: setProgressSafe,
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

"use client";

import { useEffect } from "react";

/**
 * Блокує iOS/Android edge-swipe «назад» (від лівого краю вправо),
 * щоб PWA не гортала історію браузера під час жестів у застосунку.
 */
export function PreventEdgeSwipeBack() {
  useEffect(() => {
    const EDGE_PX = 28;
    let edgeStart = false;

    const onTouchStart = (event: TouchEvent) => {
      const x = event.touches[0]?.clientX ?? -1;
      edgeStart = x >= 0 && x < EDGE_PX;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!edgeStart) return;
      const x = event.touches[0]?.clientX ?? 0;
      // Свайп від лівого краю вправо — типовий «назад»
      if (x > EDGE_PX) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      edgeStart = false;
    };

    document.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchcancel", onTouchEnd, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
    };
  }, []);

  return null;
}

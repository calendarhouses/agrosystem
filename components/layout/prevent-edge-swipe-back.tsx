"use client";

import { useEffect } from "react";

import { useIsMobile } from "@/lib/use-mobile";

/**
 * Блокує iOS/Android edge-swipe «назад» (від лівого краю вправо).
 * Не чіпаємо вертикальний скрол і жести всередині екрана.
 */
export function PreventEdgeSwipeBack() {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isMobile) return;

    const EDGE_PX = 36;
    const MIN_DX = 8;
    const SWIPE_GUARD_MS = 500;

    let startX = -1;
    let startY = -1;
    let tracking = false;
    let lastEdgeSwipeAt = 0;

    const anchorHistory = () => {
      try {
        history.pushState({ agroEdgeGuard: true }, "", window.location.href);
      } catch {
        /* ignore */
      }
    };

    anchorHistory();

    const onPopState = () => {
      if (Date.now() - lastEdgeSwipeAt < SWIPE_GUARD_MS) {
        anchorHistory();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = startX >= 0 && startX < EDGE_PX;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || startX < 0) return;
      const t = event.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > MIN_DX && dx > dy * 1.2) {
        lastEdgeSwipeAt = Date.now();
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onTouchEnd = () => {
      tracking = false;
      startX = -1;
      startY = -1;
    };

    window.addEventListener("popstate", onPopState);
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
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
    };
  }, [isMobile]);

  return null;
}

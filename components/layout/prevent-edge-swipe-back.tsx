"use client";

import { useEffect } from "react";

/**
 * Блокує iOS/Android edge-swipe «назад» (від лівого краю вправо).
 * Не чіпаємо вертикальний скрол і жести всередині екрана.
 */
export function PreventEdgeSwipeBack() {
  useEffect(() => {
    const EDGE_PX = 24;
    const MIN_DX = 10;
    let startX = -1;
    let startY = -1;
    let tracking = false;

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
      // Лише явний горизонтальний «назад», не скрол і не діагональ
      if (dx > MIN_DX && dx > dy * 1.5) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      tracking = false;
      startX = -1;
      startY = -1;
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

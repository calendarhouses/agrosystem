"use client";

import { useEffect } from "react";

import { useIsMobile } from "@/lib/use-mobile";

let allowHistoryBackUntil = 0;

/** Дозволити один програмний крок назад (кнопка «Назад» в UI). */
export function allowHistoryBack(ms = 2000) {
  allowHistoryBackUntil = Date.now() + ms;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[data-allow-select='true']")) return true;
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

/**
 * Блокує виділення/копіювання та iOS/Android edge-swipe «назад».
 */
export function PreventEdgeSwipeBack() {
  const isMobile = useIsMobile();

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    const onCut = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    const onContextMenu = (event: Event) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    const onSelectStart = (event: Event) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    const onDragStart = (event: DragEvent) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectstart", onSelectStart);
    document.addEventListener("dragstart", onDragStart);

    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("selectstart", onSelectStart);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    const EDGE_PX = 56;
    const MIN_DX = 6;

    let startX = -1;
    let startY = -1;
    let tracking = false;

    const anchorHistory = () => {
      try {
        history.pushState({ agroEdgeGuard: true }, "", window.location.href);
      } catch {
        /* ignore */
      }
    };

    anchorHistory();

    const onPopState = () => {
      if (Date.now() < allowHistoryBackUntil) return;
      anchorHistory();
    };

    const onTouchStart = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = startX < EDGE_PX;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || startX < 0) return;
      const t = event.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > MIN_DX && dx > dy) {
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

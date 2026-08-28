/** Фіксує висоту PWA під visualViewport і глушить гумовий скрол iOS/Android. */

const PAN_SURFACE =
  "canvas, .mapboxgl-map, .mapboxgl-canvas-container, [data-allow-pan], input, textarea, select, [contenteditable='true']";

function isPanSurface(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(PAN_SURFACE));
}

function closestScrollable(start: EventTarget | null): HTMLElement | null {
  let el: Element | null = start instanceof Element ? start : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      if (el.dataset.allowPan === "true") return el;
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      const ox = style.overflowX;
      const yScroll =
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        el.scrollHeight > el.clientHeight + 1;
      const xScroll =
        (ox === "auto" || ox === "scroll" || ox === "overlay") &&
        el.scrollWidth > el.clientWidth + 1;
      if (yScroll || xScroll) return el;
    }
    el = el.parentElement;
  }
  return null;
}

function measureSafeArea() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;inset:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);pointer-events:none;visibility:hidden";
  document.documentElement.appendChild(probe);
  const cs = getComputedStyle(probe);
  let top = Number.parseFloat(cs.paddingTop) || 0;
  let bottom = Number.parseFloat(cs.paddingBottom) || 0;
  probe.remove();

  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const hasHomeIndicator =
    ios && Math.max(window.screen.width, window.screen.height) >= 812;
  if (hasHomeIndicator && top < 20) {
    const long = Math.max(window.screen.width, window.screen.height);
    top = long >= 852 ? 59 : 47;
  }
  if (hasHomeIndicator && bottom < 8) bottom = 34;

  const root = document.documentElement;
  root.style.setProperty("--safe-top", `${Math.round(top)}px`);
  root.style.setProperty("--safe-bottom", `${Math.round(bottom)}px`);
}

function syncAppHeight() {
  const vv = window.visualViewport;
  const inner = window.innerHeight;
  const vvH = Math.round(vv?.height ?? inner);
  const offsetTop = Math.round(vv?.offsetTop ?? 0);
  const keyboardOpen = inner - vvH > 80;
  const root = document.documentElement;
  root.style.setProperty("--app-height", `${inner}px`);
  root.style.setProperty("--vv-height", `${vvH}px`);
  root.style.setProperty("--app-vv-offset-top", `${offsetTop}px`);
  root.classList.toggle("keyboard-open", keyboardOpen);
  measureSafeArea();
}

export function lockAppViewport(): () => void {
  syncAppHeight();

  const vv = window.visualViewport;
  vv?.addEventListener("resize", syncAppHeight);
  vv?.addEventListener("scroll", syncAppHeight);
  window.addEventListener("resize", syncAppHeight);
  window.addEventListener("orientationchange", syncAppHeight);

  let startX = 0;
  let startY = 0;

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    if (isPanSurface(event.target)) return;

    const scrollable = closestScrollable(event.target);
    if (!scrollable) {
      event.preventDefault();
      return;
    }

    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    const canY = scrollable.scrollHeight > scrollable.clientHeight + 1;
    const canX = scrollable.scrollWidth > scrollable.clientWidth + 1;

    if (Math.abs(dx) > Math.abs(dy) + 2 && !canX) {
      event.preventDefault();
      return;
    }

    if (Math.abs(dy) >= Math.abs(dx) && canY) {
      const atTop = scrollable.scrollTop <= 0;
      const atBottom =
        scrollable.scrollTop + scrollable.clientHeight >=
        scrollable.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        event.preventDefault();
      }
    } else if (!canY && !canX) {
      event.preventDefault();
    }
  }

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  return () => {
    vv?.removeEventListener("resize", syncAppHeight);
    vv?.removeEventListener("scroll", syncAppHeight);
    window.removeEventListener("resize", syncAppHeight);
    window.removeEventListener("orientationchange", syncAppHeight);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
  };
}

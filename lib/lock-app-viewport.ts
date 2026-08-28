/** PWA viewport: safe-area для iOS/Android. Без innerHeight — він ламає низ екрана в standalone. */

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

/** Safe-area + 100dvh. Без touch-lock — він блокує Mapbox/vaul і вешає UI. */
export function initAppViewport(): () => void {
  measureSafeArea();

  const onOrientation = () => {
    window.setTimeout(measureSafeArea, 120);
  };

  window.addEventListener("orientationchange", onOrientation);

  return () => {
    window.removeEventListener("orientationchange", onOrientation);
  };
}

/** @deprecated alias — те саме, без агресивного touch-lock */
export function lockAppViewport(): () => void {
  return initAppViewport();
}

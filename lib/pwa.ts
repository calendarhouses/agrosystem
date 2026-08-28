/** Ключі localStorage для PWA / onboarding */
export const PWA_INSTALL_DISMISSED_KEY = "levada-pwa-install-dismissed";
export const PWA_INSTALL_COMPLETED_KEY = "levada-pwa-install-completed";

export const APP_BRAND_NAME = "LEVADA SYSTEM";
export const APP_BRAND_SHORT = "LEVADA";

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  const iosStandalone =
    "standalone" in window.navigator &&
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return mq.matches || iosStandalone;
}

export function isMobileUserAgent(userAgent?: string): boolean {
  const ua = (userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")).toLowerCase();
  return /iphone|ipad|ipod|android|mobile/i.test(ua);
}

export function shouldShowInstallPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (!isMobileUserAgent()) return false;
  if (isStandaloneDisplayMode()) return false;
  try {
    if (localStorage.getItem(PWA_INSTALL_COMPLETED_KEY) === "1") return false;
    if (localStorage.getItem(PWA_INSTALL_DISMISSED_KEY) === "1") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function markInstallPromptDismissed(): void {
  try {
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function markInstallPromptCompleted(): void {
  try {
    localStorage.setItem(PWA_INSTALL_COMPLETED_KEY, "1");
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export type InstallPlatform = "ios" | "android" | "desktop";

export type AndroidBrowserKind = "chrome" | "samsung" | "other";

export function detectInstallPlatform(): InstallPlatform {
  if (typeof window === "undefined") return "desktop";
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function detectAndroidBrowser(userAgent?: string): AndroidBrowserKind {
  const ua = (userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")).toLowerCase();
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/chrome|crios|crmo/i.test(ua) && !/edg/i.test(ua)) return "chrome";
  return "other";
}

/** Слухачі для автопереходу кроків, коли відкривається системне меню (iOS Share). */
export function onSystemSheetOpened(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  function handleHidden() {
    if (document.visibilityState === "hidden") listener();
  }
  window.addEventListener("visibilitychange", handleHidden);
  window.addEventListener("pagehide", handleHidden);
  return () => {
    window.removeEventListener("visibilitychange", handleHidden);
    window.removeEventListener("pagehide", handleHidden);
  };
}

export function onSystemSheetClosed(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  function handleVisible() {
    if (document.visibilityState === "visible") listener();
  }
  window.addEventListener("visibilitychange", handleVisible);
  window.addEventListener("pageshow", handleVisible);
  window.addEventListener("focus", handleVisible);
  return () => {
    window.removeEventListener("visibilitychange", handleVisible);
    window.removeEventListener("pageshow", handleVisible);
    window.removeEventListener("focus", handleVisible);
  };
}

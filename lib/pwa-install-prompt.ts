export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const PWA_INSTALL_READY_EVENT = "levada-pwa-install-ready";
const SW_RESET_KEY = "levada-sw-reset-v5";

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function readWindowPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __levadaDeferredInstall?: BeforeInstallPromptEvent })
    .__levadaDeferredInstall ?? null;
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt ?? readWindowPrompt();
}

export function captureInstallPrompt(event: Event) {
  event.preventDefault();
  const promptEvent = event as BeforeInstallPromptEvent;
  deferredPrompt = promptEvent;
  (window as Window & { __levadaDeferredInstall?: BeforeInstallPromptEvent }).__levadaDeferredInstall =
    promptEvent;
  window.dispatchEvent(new Event(PWA_INSTALL_READY_EVENT));
}

export function clearDeferredInstallPrompt() {
  deferredPrompt = null;
  delete (window as Window & { __levadaDeferredInstall?: BeforeInstallPromptEvent })
    .__levadaDeferredInstall;
}

export function onInstallPromptReady(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PWA_INSTALL_READY_EVENT, listener);
  return () => window.removeEventListener(PWA_INSTALL_READY_EVENT, listener);
}

export async function triggerInstallPrompt(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const prompt = getDeferredInstallPrompt();
  if (!prompt) return "unavailable";
  await prompt.prompt();
  const choice = await prompt.userChoice;
  clearDeferredInstallPrompt();
  return choice.outcome;
}

async function resetPoisonedServiceWorkers(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(SW_RESET_KEY) === "1") return;
  } catch {
    /* ignore */
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    try {
      sessionStorage.setItem(SW_RESET_KEY, "1");
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn("[pwa] failed to reset service workers", err);
  }
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker
    .register("/sw.js?v=5", { scope: "/" })
    .catch((err) => {
      console.warn("[pwa] service worker registration failed", err);
      return null;
    });
}

export function bootstrapPwaInstallCapture() {
  if (typeof window === "undefined") return;
  if (!(window as Window & { __levadaPwaCapture?: boolean }).__levadaPwaCapture) {
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    (window as Window & { __levadaPwaCapture?: boolean }).__levadaPwaCapture = true;
  }
  void (async () => {
    await resetPoisonedServiceWorkers();
    await registerServiceWorker();
  })();
}

/** Чекаємо на beforeinstallprompt (Chrome Android) і одразу показуємо діалог. */
export async function tryInstallWithWait(
  timeoutMs = 4000
): Promise<"accepted" | "dismissed" | "unavailable"> {
  bootstrapPwaInstallCapture();
  await registerServiceWorker();

  const existing = getDeferredInstallPrompt();
  if (existing) {
    return triggerInstallPrompt();
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve("unavailable");
    }, timeoutMs);

    function onReady() {
      cleanup();
      void triggerInstallPrompt().then(resolve);
    }

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener(PWA_INSTALL_READY_EVENT, onReady);
    }

    window.addEventListener(PWA_INSTALL_READY_EVENT, onReady);
  });
}

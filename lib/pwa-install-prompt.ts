export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const PWA_INSTALL_READY_EVENT = "levada-pwa-install-ready";

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

export async function triggerInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = getDeferredInstallPrompt();
  if (!prompt) return "unavailable";
  await prompt.prompt();
  const choice = await prompt.userChoice;
  clearDeferredInstallPrompt();
  return choice.outcome;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .catch((err) => {
      console.warn("[pwa] service worker registration failed", err);
      return null;
    });
}

export function bootstrapPwaInstallCapture() {
  if (typeof window === "undefined") return;
  void registerServiceWorker();
  if (!(window as Window & { __levadaPwaCapture?: boolean }).__levadaPwaCapture) {
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    (window as Window & { __levadaPwaCapture?: boolean }).__levadaPwaCapture = true;
  }
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

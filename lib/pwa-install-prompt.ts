export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const PROMPT_READY_EVENT = "levada-pwa-install-ready";

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
  window.dispatchEvent(new Event(PROMPT_READY_EVENT));
}

export function clearDeferredInstallPrompt() {
  deferredPrompt = null;
  delete (window as Window & { __levadaDeferredInstall?: BeforeInstallPromptEvent })
    .__levadaDeferredInstall;
}

export function onInstallPromptReady(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROMPT_READY_EVENT, listener);
  return () => window.removeEventListener(PROMPT_READY_EVENT, listener);
}

export async function triggerInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = getDeferredInstallPrompt();
  if (!prompt) return "unavailable";
  await prompt.prompt();
  const choice = await prompt.userChoice;
  clearDeferredInstallPrompt();
  return choice.outcome;
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[pwa] service worker registration failed", err);
  });
}

export function bootstrapPwaInstallCapture() {
  if (typeof window === "undefined") return;
  registerServiceWorker();
  window.addEventListener("beforeinstallprompt", captureInstallPrompt);
}

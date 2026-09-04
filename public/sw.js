const CACHE = "levada-pwa-v6";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/**
 * Fetch listener потрібен Chrome для installability.
 * НЕ викликаємо respondWith для /api/* і non-GET — інакше iOS standalone PWA
 * рве streaming (LEVADIUS /api/agent) і клієнт бачить фейкову «модель перевантажена».
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let pathname = "/";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return;
  }

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/sw.js"
  ) {
    return;
  }
});

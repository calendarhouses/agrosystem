"use client";

import { useEffect } from "react";

import { bootstrapPwaInstallCapture } from "@/lib/pwa-install-prompt";

/** Рання реєстрація SW (idle). Viewport/safe-area — тільки CSS env(). */
export function PwaBootstrap() {
  useEffect(() => {
    const run = () => bootstrapPwaInstallCapture();
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(run, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}

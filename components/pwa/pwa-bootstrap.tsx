"use client";

import { useEffect, useLayoutEffect } from "react";

import { bootstrapPwaInstallCapture } from "@/lib/pwa-install-prompt";
import { initAppViewport } from "@/lib/lock-app-viewport";

/** Рання реєстрація SW і safe-area для PWA. */
export function PwaBootstrap() {
  useLayoutEffect(() => initAppViewport(), []);

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

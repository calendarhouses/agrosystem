"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

import { bootstrapPwaInstallCapture } from "@/lib/pwa-install-prompt";
import { initAppViewport, lockAppViewport } from "@/lib/lock-app-viewport";

const AUTH_PATHS = new Set(["/login", "/install"]);

/** Рання реєстрація SW і фіксація viewport (без гумового скролу). */
export function PwaBootstrap() {
  const pathname = usePathname();
  const isAuthScreen = AUTH_PATHS.has(pathname);

  useLayoutEffect(() => {
    if (isAuthScreen) {
      return initAppViewport();
    }
    return lockAppViewport();
  }, [isAuthScreen]);

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

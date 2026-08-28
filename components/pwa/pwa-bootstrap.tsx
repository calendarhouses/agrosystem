"use client";

import { useEffect } from "react";

import { bootstrapPwaInstallCapture } from "@/lib/pwa-install-prompt";

/** Рання реєстрація SW і перехоплення beforeinstallprompt (потрібно для Android). */
export function PwaBootstrap() {
  useEffect(() => {
    bootstrapPwaInstallCapture();
  }, []);

  return null;
}

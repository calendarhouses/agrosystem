"use client";

import { useEffect, useLayoutEffect } from "react";

import { bootstrapPwaInstallCapture } from "@/lib/pwa-install-prompt";
import { lockAppViewport } from "@/lib/lock-app-viewport";

/** Рання реєстрація SW і фіксація viewport (без гумового скролу). */
export function PwaBootstrap() {
  useLayoutEffect(() => lockAppViewport(), []);
  useEffect(() => {
    bootstrapPwaInstallCapture();
  }, []);

  return null;
}

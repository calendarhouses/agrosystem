"use client";

import { useLayoutEffect, useEffect } from "react";

type PreloaderProps = {
  isLoading: boolean;
};

/**
 * Boot-екран LEVADA.
 * Без AnimatePresence/exit: Framer exit під час soft-nav рве дерево і валить global-error.
 * #boot-splash лишаємо в DOM — лише CSS (data-booting). `.remove()` на React-вузлі
 * → NotFoundError «The object can not be found here» на кожному оновленні Toaster/body.
 */
export function Preloader({ isLoading }: PreloaderProps) {
  useLayoutEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
      return;
    }
    delete document.documentElement.dataset.booting;
    document.documentElement.dataset.appReady = "1";
  }, [isLoading]);

  if (!isLoading) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-zinc-950"
      style={{
        bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
        minHeight: "calc(100dvh + env(safe-area-inset-bottom, 0px))",
      }}
      aria-hidden
    >
      <div className="relative z-10 flex flex-col items-center px-6">
        <div className="relative overflow-hidden">
          <h1
            className="text-[1.65rem] font-thin tracking-[0.3em] text-white sm:text-3xl"
            style={{ fontWeight: 200 }}
          >
            L E V A D A
          </h1>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 animate-[shimmer_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/45 to-transparent"
            style={{ animationDelay: "0.4s" }}
          />
        </div>
        <p className="mt-3 text-xs tracking-widest text-zinc-500">
          AGRO OPERATING SYSTEM
        </p>
      </div>
    </div>
  );
}

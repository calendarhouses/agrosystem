"use client";

import { useLayoutEffect, useEffect } from "react";
import { motion } from "framer-motion";

type PreloaderProps = {
  isLoading: boolean;
};

/**
 * Boot-екран LEVADA.
 * Без AnimatePresence/exit (рве soft-nav) — але shimmer лишається як раніше (motion x).
 * #boot-splash у DOM лише ховаємо CSS (data-boot-ui), без .remove().
 */
export function Preloader({ isLoading }: PreloaderProps) {
  useLayoutEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
      document.documentElement.dataset.bootUi = "1";
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
      document.documentElement.dataset.bootUi = "1";
      return;
    }
    delete document.documentElement.dataset.booting;
    delete document.documentElement.dataset.bootUi;
    document.documentElement.dataset.appReady = "1";
  }, [isLoading]);

  if (!isLoading) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
        minHeight: "calc(100dvh + env(safe-area-inset-bottom, 0px))",
      }}
      aria-hidden
    >
      <div className="absolute inset-0 bg-zinc-950" aria-hidden />

      <motion.div
        className="relative z-10 flex flex-col items-center px-6"
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{
          opacity: 1,
          filter: "blur(0px)",
          transition: { duration: 1, ease: "easeOut" },
        }}
      >
        <div className="relative overflow-hidden">
          <h1
            className="text-[1.65rem] font-thin tracking-[0.3em] text-white sm:text-3xl"
            style={{ fontWeight: 200 }}
          >
            L E V A D A
          </h1>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
            initial={{ x: "-120%", opacity: 0 }}
            animate={{
              x: ["-120%", "220%", "-120%", "220%"],
              opacity: [0, 1, 0, 1, 0],
            }}
            transition={{
              duration: 2.4,
              times: [0, 0.35, 0.5, 0.85, 1],
              ease: "easeInOut",
              delay: 0.55,
            }}
          />
        </div>
        <p className="mt-3 text-xs tracking-widest text-zinc-500">
          AGRO OPERATING SYSTEM
        </p>
      </motion.div>
    </div>
  );
}

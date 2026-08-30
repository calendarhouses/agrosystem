"use client";

import { useLayoutEffect, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

type PreloaderProps = {
  isLoading: boolean;
};

function removeStaticBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el) el.remove();
}

/**
 * Кінематографічний boot-екран LEVADA.
 * Єдине місце з текстом бренду на старті (HTML-splash лише чорний фон).
 * Вихід тексту — лише blur + opacity (без scale/zoom).
 */
export function Preloader({ isLoading }: PreloaderProps) {
  // До paint: React-прелоадер уже в DOM → знімаємо чорний HTML-шар без сірого кадру
  useLayoutEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
      removeStaticBootSplash();
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.booting = "1";
      return;
    }
    // Dissolve стартував — дозволяємо chrome анімуватись (не тримаємо opacity:0 !important)
    delete document.documentElement.dataset.booting;
    document.documentElement.dataset.appReady = "1";
  }, [isLoading]);

  return (
    <AnimatePresence>
      {isLoading ? (
        <motion.div
          key="levada-preloader"
          className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-zinc-950"
          style={{
            bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
            minHeight: "calc(100dvh + env(safe-area-inset-bottom, 0px))",
          }}
          initial={false}
          exit={{
            opacity: 0,
            transition: { duration: 1.2, ease: "easeInOut" },
          }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-zinc-950"
            initial={false}
            exit={{
              backgroundColor: "rgba(9, 9, 11, 0.15)",
              transition: { duration: 1.2, ease: "easeInOut" },
            }}
          />

          <motion.div
            className="relative z-10 flex flex-col items-center px-6"
            initial={false}
            exit={{
              opacity: 0,
              filter: "blur(10px)",
              transition: { duration: 0.8, ease: "easeInOut" },
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
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

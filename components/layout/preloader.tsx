"use client";

import { AnimatePresence, motion } from "framer-motion";

type PreloaderProps = {
  isLoading: boolean;
};

/**
 * Кінематографічний boot-екран LEVADA.
 * Вихід тексту — лише blur + opacity (без scale/zoom).
 */
export function Preloader({ isLoading }: PreloaderProps) {
  return (
    <AnimatePresence>
      {isLoading ? (
        <motion.div
          key="levada-preloader"
          className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          initial={false}
        >
          {/* Фон → скло → прозорість (мапа проступає знизу) */}
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-zinc-950 backdrop-blur-3xl"
            initial={{ opacity: 1, backgroundColor: "rgb(9 9 11)" }}
            animate={{ opacity: 1, backgroundColor: "rgb(9 9 11)" }}
            exit={{
              backgroundColor: "rgba(9, 9, 11, 0.2)",
              opacity: 0,
              transition: { duration: 1.2, ease: "easeInOut" },
            }}
          />

          <motion.div
            className="relative z-10 flex flex-col items-center px-6"
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{
              opacity: 1,
              filter: "blur(0px)",
              transition: { duration: 1, ease: "easeOut" },
            }}
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
              {/* Shimmer — 2 проходи блиску по літерах */}
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

            <p className="text-muted-foreground mt-3 text-xs tracking-widest text-zinc-500">
              AGRO OPERATING SYSTEM
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

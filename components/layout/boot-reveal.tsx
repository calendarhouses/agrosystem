"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

import { useAppBoot } from "@/lib/app-boot";
import { cn } from "@/lib/utils";

type BootRevealProps = {
  children: ReactNode;
  className?: string;
} & Omit<
  HTMLMotionProps<"div">,
  "children" | "initial" | "animate" | "transition"
>;

/**
 * Нижнє меню / верхні віджети: з’являються після старту dissolve прелоадера.
 * delay 0.5 — синхронно з «розчиненням» у карту.
 */
export function BootReveal({ children, className, ...rest }: BootRevealProps) {
  const { revealChrome } = useAppBoot();

  return (
    <motion.div
      className={cn(className)}
      initial={{ y: 20, opacity: 0 }}
      animate={
        revealChrome ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }
      }
      transition={{ duration: 0.7, delay: 0.5, ease: "easeOut" }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

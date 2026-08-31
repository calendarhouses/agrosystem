"use client";

import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { motion } from "framer-motion";

import { useAppBoot } from "@/lib/app-boot";
import { isCommandCenterPath } from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

type RouteRevealProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Плавна поява розділу при soft-nav (як шторка/погода на Полях).
 * Після LEVADA-boot: opacity + легкий підйом.
 * На картах (Поля / Техніка) — лише opacity, щоб не ламати position:fixed.
 */
export function RouteReveal({ children, className }: RouteRevealProps) {
  const pathname = usePathname();
  const { isAppLoading } = useAppBoot();
  const bootedRef = useRef(false);

  if (!isAppLoading) {
    bootedRef.current = true;
  }

  const animateEnter = bootedRef.current && !isAppLoading;
  const isMapSurface = isCommandCenterPath(pathname);

  return (
    <motion.div
      key={pathname}
      className={cn("relative h-full min-h-0", className)}
      initial={
        !animateEnter
          ? false
          : isMapSurface
            ? { opacity: 0 }
            : { opacity: 0, y: 20 }
      }
      animate={
        isMapSurface ? { opacity: 1 } : { opacity: 1, y: 0 }
      }
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

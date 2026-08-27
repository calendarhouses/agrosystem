"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

/**
 * Плавно переганяє число від попереднього значення до target (~1.5 с).
 * При зміні фільтра — «перекручування», без стрибка з нуля.
 */
export function useAnimatedNumber(
  target: number,
  options?: { duration?: number; enabled?: boolean }
): number {
  const duration = options?.duration ?? 1.5;
  const enabled = options?.enabled ?? true;
  const [value, setValue] = useState(() =>
    enabled && Number.isFinite(target) ? target : 0
  );
  const currentRef = useRef(enabled && Number.isFinite(target) ? target : 0);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!enabled || !Number.isFinite(target)) return;

    // Перший mount: уже показали target — без анімації з 0 (менше «двоїння» тексту)
    if (!hasMounted.current) {
      hasMounted.current = true;
      currentRef.current = target;
      setValue(target);
      return;
    }

    const from = currentRef.current;
    if (from === target) return;

    const controls = animate(from, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        currentRef.current = latest;
        setValue(latest);
      },
    });

    return () => controls.stop();
  }, [target, duration, enabled]);

  return value;
}

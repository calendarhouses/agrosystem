"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const TIP_DELAY_MS = 420;

type SidebarNavTooltipProps = {
  title: string;
  hint?: string;
  disabled?: boolean;
  children: (handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }) => ReactNode;
};

/** Тултип сайдбару (портал, як у azhunebi-platform) */
export function SidebarNavTooltip({
  title,
  hint,
  disabled,
  children,
}: SidebarNavTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const hideTip = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setTip(null);
  }, []);

  const showTip = useCallback(() => {
    if (disabled) return;
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTip({ top: rect.top + rect.height / 2, left: rect.right + 14 });
    }, TIP_DELAY_MS);
  }, [disabled]);

  useEffect(() => () => hideTip(), [hideTip]);

  return (
    <>
      <span ref={anchorRef} className="block w-full">
        {children({
          onMouseEnter: showTip,
          onMouseLeave: hideTip,
          onFocus: showTip,
          onBlur: hideTip,
        })}
      </span>
      {tip
        ? createPortal(
            <div
              className="sidebar-nav-tip"
              style={{ top: tip.top, left: tip.left }}
              role="tooltip"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap text-stone-900">
                  {title}
                </span>
                {hint ? (
                  <span className="text-[11px] font-medium whitespace-nowrap text-stone-500">
                    {hint}
                  </span>
                ) : null}
              </span>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

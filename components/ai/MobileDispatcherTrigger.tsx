"use client";

import { ChevronRight } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import { getMyProfileAction } from "@/app/team/actions";
import { LevadiusAvatar } from "@/components/ai/LevadiusAvatar";
import { canAccessLevadius } from "@/lib/levadius-access";
import {
  ensureLevadiusRadarFetched,
  getLevadiusLiveCache,
  levadiusRadarStatusLabel,
  subscribeLevadiusLiveCache,
} from "@/lib/levadius-live-cache";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Повноекранний верхній бар LEVADIUS на мобілці (у потоці верстки).
 * Статус стабільний по radarN — без підміни на наратив «про один трактор».
 */
export function MobileDispatcherTrigger(): ReactNode {
  const isMobile = useIsMobile();
  const [allowed, setAllowed] = useState(false);
  const [radarCount, setRadarCount] = useState(
    () => getLevadiusLiveCache().radarN
  );

  useEffect(() => {
    let cancelled = false;
    void getMyProfileAction().then((me) => {
      if (cancelled) return;
      setAllowed(canAccessLevadius(me));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeLevadiusLiveCache(() => {
      setRadarCount(getLevadiusLiveCache().radarN);
    });
  }, []);

  useEffect(() => {
    if (!allowed || !isMobile) return;
    void ensureLevadiusRadarFetched();
  }, [allowed, isMobile]);

  const showBar = allowed && isMobile;

  useLayoutEffect(() => {
    const metas = Array.from(
      document.querySelectorAll('meta[name="theme-color"]')
    );
    const prev = metas.map((el) => el.getAttribute("content"));

    if (!showBar) {
      delete document.documentElement.dataset.levadiusBar;
      return;
    }

    document.documentElement.dataset.levadiusBar = "1";
    // iOS status bar підтягує theme-color — має збігатися з баром (#09090b = zinc-950)
    for (const el of metas) {
      el.setAttribute("content", "#09090b");
    }

    return () => {
      delete document.documentElement.dataset.levadiusBar;
      metas.forEach((el, i) => {
        if (prev[i] != null) el.setAttribute("content", prev[i]!);
      });
    };
  }, [showBar]);

  if (!showBar) return null;

  const statusLabel = levadiusRadarStatusLabel(radarCount);

  return (
    <div
      data-levadius-mobile-bar
      className={cn(
        "relative z-40 shrink-0 border-b border-zinc-800/80 md:hidden",
        /* Той самий #09090b, що theme-color / html під Dynamic Island */
        "bg-[#09090b]",
        "pt-[env(safe-area-inset-top,0px)]"
      )}
    >
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("levadius:open", { detail: { prompt: "" } })
          );
        }}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition",
          "active:bg-zinc-900/80",
          radarCount > 0 && "bg-amber-500/[0.06]"
        )}
        aria-label="Відкрити LEVADIUS"
      >
        <LevadiusAvatar size={32} live />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-wide text-zinc-50">
              LEVADIUS
            </span>
            {radarCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                {radarCount}
              </span>
            ) : (
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
            )}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-[11px] leading-snug",
              radarCount > 0 ? "font-medium text-amber-200" : "text-zinc-400"
            )}
          >
            {statusLabel}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-zinc-500" />
      </button>
    </div>
  );
}

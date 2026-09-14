"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import { getMyProfileAction } from "@/app/team/actions";
import { LevadiusAvatar } from "@/components/ai/LevadiusAvatar";
import { pathnameToSection } from "@/lib/agent-section-briefing-shared";
import { canAccessLevadius } from "@/lib/levadius-access";
import {
  getLevadiusLiveCache,
  setLevadiusRadarN,
  setLevadiusSectionBrief,
  subscribeLevadiusLiveCache,
} from "@/lib/levadius-live-cache";
import { ukPlural } from "@/lib/uk-plural";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

function radarTeaser(count: number): string {
  if (count <= 0) return "Диспетчер онлайн";
  const noun = ukPlural(count, "аномалія", "аномалії", "аномалій");
  return `${count} ${noun} на радарі — глянь`;
}

/**
 * Повноекранний верхній бар LEVADIUS на мобілці (у потоці верстки).
 * Посуває кнопки хронології / сповіщень / табів під себе через --app-top-inset.
 */
export function MobileDispatcherTrigger(): ReactNode {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const [radarCount, setRadarCount] = useState(
    () => getLevadiusLiveCache().radarN
  );
  const [sectionText, setSectionText] = useState(
    () => getLevadiusLiveCache().sectionText
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
      const snap = getLevadiusLiveCache();
      setRadarCount(snap.radarN);
      setSectionText(snap.sectionText);
    });
  }, []);

  useEffect(() => {
    if (!allowed || !isMobile) return;
    const section = pathnameToSection(pathname || "/");
    if (!section) return;

    let cancelled = false;
    const ac = new AbortController();

    void (async () => {
      try {
        const res = await fetch(
          `/api/agent/section-briefing?section=${encodeURIComponent(section)}`,
          { signal: ac.signal, cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          skip?: boolean;
          text?: string;
          followUpPrompt?: string;
          facts?: { radarN?: number };
        };
        if (cancelled || !data?.ok) return;
        const n = Number(data.facts?.radarN);
        if (Number.isFinite(n) && n > 0) setLevadiusRadarN(n);
        if (!data.skip && data.text?.trim()) {
          setLevadiusSectionBrief({
            text: data.text,
            followUpPrompt: data.followUpPrompt,
            radarN: Number.isFinite(n) ? n : undefined,
          });
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [allowed, isMobile, pathname]);

  const showBar = allowed && isMobile;

  useLayoutEffect(() => {
    if (!showBar) {
      delete document.documentElement.dataset.levadiusBar;
      return;
    }
    document.documentElement.dataset.levadiusBar = "1";
    return () => {
      delete document.documentElement.dataset.levadiusBar;
    };
  }, [showBar]);

  if (!showBar) return null;

  const statusLabel = sectionText.trim() || radarTeaser(radarCount);

  return (
    <div
      data-levadius-mobile-bar
      className={cn(
        "relative z-40 shrink-0 border-b border-zinc-800/80 bg-zinc-950 md:hidden",
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
              radarCount > 0 || sectionText
                ? "font-medium text-amber-200"
                : "text-zinc-400"
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

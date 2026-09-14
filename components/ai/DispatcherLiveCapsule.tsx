"use client";

import { Radio, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  pathnameToSection,
  type SectionId,
} from "@/lib/agent-section-briefing-shared";
import { cn } from "@/lib/utils";

const MUTE_KEY = "levadius_dispatcher_capsule_muted";
const DISMISS_KEY = "levadius_dispatcher_capsule_dismissed_section";
/** Автоматично зникає через 6 с */
const AUTO_DISMISS_MS = 6000;

type SectionBriefPayload = {
  ok: true;
  section: SectionId;
  skip?: boolean;
  text: string;
  followUpPrompt: string;
  cached?: boolean;
};

function readFlag(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

/**
 * Плаваюча капсула сповіщень диспетчера — top-center.
 * Без FAB/аватара: вхід у чат — сайдбар (desktop) або MobileDispatcherTrigger.
 */
export function DispatcherLiveCapsule(): ReactNode {
  const pathname = usePathname();
  const [muted, setMuted] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<SectionBriefPayload | null>(null);
  const [fadeIn, setFadeIn] = useState(false);
  const lastSectionRef = useRef<SectionId | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMuted(readFlag(MUTE_KEY, false));
  }, []);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current != null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      setHidden(true);
      setFadeIn(false);
    }, AUTO_DISMISS_MS);
  }, [clearDismissTimer]);

  const openLevadius = useCallback((prompt?: string) => {
    window.dispatchEvent(
      new CustomEvent("levadius:open", {
        detail: { prompt: prompt?.trim() || "" },
      })
    );
  }, []);

  const dismissTip = useCallback(() => {
    clearDismissTimer();
    setHidden(true);
    setFadeIn(false);
    try {
      if (brief?.section) {
        sessionStorage.setItem(DISMISS_KEY, brief.section);
      }
    } catch {
      /* ignore */
    }
  }, [brief?.section, clearDismissTimer]);

  useEffect(() => {
    if (muted) {
      setHidden(true);
      return;
    }

    const section = pathnameToSection(pathname || "/");
    if (!section) {
      setHidden(true);
      setBrief(null);
      return;
    }

    if (lastSectionRef.current === section && brief?.section === section) {
      setHidden(Boolean(brief.skip) || !brief.text);
      return;
    }

    try {
      if (sessionStorage.getItem(DISMISS_KEY) === section) {
        setHidden(true);
        return;
      }
    } catch {
      /* ignore */
    }

    lastSectionRef.current = section;
    setFadeIn(false);
    setLoading(true);
    setHidden(true);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      try {
        const res = await fetch(
          `/api/agent/section-briefing?section=${encodeURIComponent(section)}`,
          { signal: ac.signal, cache: "no-store" }
        );
        if (!res.ok) {
          setBrief(null);
          setHidden(true);
          return;
        }
        const data = (await res.json()) as SectionBriefPayload & {
          error?: string;
        };
        if (ac.signal.aborted) return;
        if (!data?.ok || data.skip || !data.text?.trim()) {
          setBrief(data?.ok ? data : null);
          setHidden(true);
          return;
        }
        setBrief(data);
        setHidden(false);
        requestAnimationFrame(() => setFadeIn(true));
        scheduleDismiss();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBrief(null);
        setHidden(true);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ac.abort();
      clearDismissTimer();
    };
    // brief навмисно не в deps — інакше цикл на кожному setBrief
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, muted, scheduleDismiss, clearDismissTimer]);

  if (muted || hidden || (!loading && !brief?.text)) {
    return null;
  }

  const label =
    loading && !brief?.text
      ? "Дивлюсь, що по зміні…"
      : brief?.text || "…";

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-4 left-1/2 z-50 -translate-x-1/2",
        "pt-[env(safe-area-inset-top,0px)]",
        "w-[min(26rem,calc(100vw-5.5rem))]"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-full border border-emerald-500/30",
          "bg-zinc-950/90 px-4 py-2 shadow-2xl backdrop-blur-md",
          "transition-opacity duration-300",
          fadeIn || loading ? "opacity-100" : "opacity-0"
        )}
      >
        <span
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"
          aria-hidden
        >
          <Radio className="size-3.5" strokeWidth={2.2} />
        </span>

        <button
          type="button"
          onClick={() => {
            dismissTip();
            if (!brief?.text) {
              openLevadius();
              return;
            }
            openLevadius(brief.followUpPrompt || brief.text);
          }}
          className="min-w-0 flex-1 text-left text-xs leading-snug font-medium text-zinc-100 transition hover:text-emerald-50"
          title="Відкрити LEVADIUS"
        >
          <span className="line-clamp-2">{label}</span>
        </button>

        <button
          type="button"
          onClick={dismissTip}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          title="Закрити"
          aria-label="Закрити підказку"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

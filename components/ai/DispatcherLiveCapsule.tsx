"use client";

import { X } from "lucide-react";
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
const AUTO_COLLAPSE_MS = 10000;

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

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Окремий док: не top-center overlay.
 * Моб — над bottom-nav / peek, зліва (zoom карти справа).
 * ПК — правий низ, вище NavigationControl, осторонь лівих панелей.
 */
const DOCK_SHELL = cn(
  "pointer-events-none fixed z-[35] flex flex-col gap-2",
  "left-[max(0.75rem,env(safe-area-inset-left,0px))]",
  "bottom-[calc(var(--app-bottom-inset)+5.5rem)]",
  "items-start",
  "md:left-auto md:items-end",
  "md:right-[max(1rem,env(safe-area-inset-right,0px))]",
  "md:bottom-[max(6.75rem,calc(env(safe-area-inset-bottom,0px)+5.75rem))]",
  "max-w-[min(22rem,calc(100vw-1.5rem))]"
);

function AvatarButton({
  onClick,
  title,
  ring,
  pulse,
}: {
  onClick: () => void;
  title: string;
  ring?: boolean;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pointer-events-auto relative inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "border bg-zinc-950/90 shadow-lg backdrop-blur-md transition",
        ring
          ? "border-emerald-400/45 ring-2 ring-emerald-500/20 hover:ring-emerald-400/35"
          : "border-white/15 hover:border-emerald-400/40"
      )}
      title={title}
      aria-label={title}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/levadius-avatar.jpg?v=8"
        alt=""
        className="size-full object-cover"
      />
      {pulse ? (
        <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-zinc-950 bg-emerald-400" />
      ) : null}
    </button>
  );
}

export function DispatcherLiveCapsule(): ReactNode {
  const pathname = usePathname();
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<SectionBriefPayload | null>(null);
  const [fadeIn, setFadeIn] = useState(false);
  const lastSectionRef = useRef<SectionId | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMuted(readFlag(MUTE_KEY, false));
  }, []);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      setCollapsed(true);
    }, AUTO_COLLAPSE_MS);
  }, [clearCollapseTimer]);

  const openLevadius = useCallback((prompt?: string) => {
    window.dispatchEvent(
      new CustomEvent("levadius:open", {
        detail: { prompt: prompt?.trim() || "" },
      })
    );
  }, []);

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
        setCollapsed(true);
        return;
      }
    } catch {
      /* ignore */
    }

    lastSectionRef.current = section;
    setCollapsed(false);
    setFadeIn(false);
    setLoading(true);
    setHidden(false);

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
        scheduleCollapse();
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
      clearCollapseTimer();
    };
    // brief навмисно не в deps — інакше цикл на кожному setBrief
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, muted, scheduleCollapse, clearCollapseTimer]);

  const hideTip = useCallback(() => {
    setMuted(true);
    writeFlag(MUTE_KEY, true);
    try {
      if (brief?.section) {
        sessionStorage.setItem(DISMISS_KEY, brief.section);
      }
    } catch {
      /* ignore */
    }
  }, [brief?.section]);

  // М'ют / тихий розділ — лише компактний вхід у чат у док-зоні
  if (muted || (hidden && !loading)) {
    return (
      <div className={DOCK_SHELL}>
        <AvatarButton
          onClick={() => openLevadius()}
          title="Відкрити LEVADIUS"
        />
      </div>
    );
  }

  const showBubble =
    !collapsed && (loading || (Boolean(brief?.text) && !brief?.skip));

  return (
    <div className={DOCK_SHELL}>
      {showBubble ? (
        <div
          className={cn(
            "pointer-events-auto w-full rounded-2xl border border-emerald-500/30",
            "bg-zinc-950/92 px-3 py-2.5 shadow-2xl shadow-emerald-950/30 backdrop-blur-md",
            "transition-opacity duration-300",
            fadeIn || loading ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-bold tracking-[0.14em] text-emerald-300 uppercase">
                LIVE
              </span>
            </div>
            <button
              type="button"
              onClick={hideTip}
              className="inline-flex size-7 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              title="Сховати підказку"
              aria-label="Сховати підказку"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!brief?.text) {
                openLevadius();
                return;
              }
              openLevadius(brief.followUpPrompt || brief.text);
            }}
            className="w-full text-left text-xs leading-snug text-zinc-100 transition hover:text-emerald-50"
          >
            {loading && !brief?.text
              ? "Дивлюсь, що по зміні…"
              : brief?.text || "…"}
          </button>
        </div>
      ) : null}

      <div className="pointer-events-auto flex flex-row items-center gap-2 md:flex-row-reverse">
        <AvatarButton
          onClick={() => openLevadius(brief?.followUpPrompt || brief?.text)}
          title="Відкрити LEVADIUS"
          ring
          pulse={Boolean(brief?.text && !brief.skip)}
        />

        {collapsed && brief && !brief.skip ? (
          <button
            type="button"
            onClick={() => {
              setCollapsed(false);
              setFadeIn(true);
              scheduleCollapse();
            }}
            className={cn(
              "inline-flex max-w-[min(14rem,calc(100vw-5rem))] items-center gap-2 rounded-full",
              "border border-emerald-500/30 bg-zinc-950/85 px-3 py-2",
              "shadow-lg backdrop-blur-md transition hover:border-emerald-400/45"
            )}
            title={brief.text}
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            <span className="truncate text-xs text-zinc-200">{brief.text}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

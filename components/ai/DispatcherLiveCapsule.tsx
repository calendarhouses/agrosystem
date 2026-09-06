"use client";

import { MessageCircle, X } from "lucide-react";
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

/** Спільна позиція стрічки: під notch / Dynamic Island, не перекриває контент. */
const STRIP_POS =
  "fixed left-1/2 z-[45] -translate-x-1/2 top-[max(0.5rem,env(safe-area-inset-top,0px))]";

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
    setLoading(true);
    setFadeIn(false);
    clearCollapseTimer();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void fetch(`/api/agent/section-briefing?section=${section}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as SectionBriefPayload & {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || data.ok !== true) {
          setBrief(null);
          setHidden(true);
          return;
        }
        if (data.skip || !data.text?.trim()) {
          setBrief({
            ok: true,
            section: data.section,
            skip: true,
            text: "",
            followUpPrompt: "",
          });
          setHidden(true);
          return;
        }
        setBrief({
          ok: true,
          section: data.section,
          skip: false,
          text: data.text,
          followUpPrompt: data.followUpPrompt,
          cached: data.cached,
        });
        setHidden(false);
        requestAnimationFrame(() => setFadeIn(true));
        scheduleCollapse();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBrief(null);
        setHidden(true);
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
      clearCollapseTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- brief.section навмисно не в deps
  }, [pathname, muted, clearCollapseTimer, scheduleCollapse]);

  // М'ют: лише компактний вхід у чат
  if (muted) {
    return (
      <div
        className={cn(
          "pointer-events-none fixed z-[45]",
          "top-[max(0.5rem,env(safe-area-inset-top,0px))]",
          "right-[max(0.75rem,env(safe-area-inset-right,0px))]"
        )}
      >
        <button
          type="button"
          onClick={() => openLevadius()}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2 rounded-full",
            "border border-emerald-500/30 bg-zinc-950/85 px-2.5 py-1.5",
            "shadow-lg shadow-emerald-950/30 backdrop-blur-md transition hover:border-emerald-400/45"
          )}
          title="Відкрити LEVADIUS"
          aria-label="Відкрити LEVADIUS"
        >
          <span className="relative size-7 overflow-hidden rounded-full ring-1 ring-white/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/levadius-avatar.jpg"
              alt=""
              className="size-full object-cover"
            />
          </span>
          <span className="pr-0.5 text-[10px] font-bold tracking-wide text-emerald-300 uppercase">
            Чат
          </span>
        </button>
      </div>
    );
  }

  if (hidden && !loading) {
    // Тихий розділ — лише компактний вхід в агента
    return (
      <div
        className={cn(
          "pointer-events-none fixed z-[45]",
          "top-[max(0.5rem,env(safe-area-inset-top,0px))]",
          "right-[max(0.75rem,env(safe-area-inset-right,0px))]"
        )}
      >
        <button
          type="button"
          onClick={() => openLevadius()}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2 rounded-full",
            "border border-white/12 bg-zinc-950/80 px-2.5 py-1.5",
            "shadow-lg backdrop-blur-md transition hover:border-emerald-400/35"
          )}
          title="Відкрити LEVADIUS"
          aria-label="Відкрити LEVADIUS"
        >
          <span className="relative size-7 overflow-hidden rounded-full ring-1 ring-white/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/levadius-avatar.jpg"
              alt=""
              className="size-full object-cover"
            />
          </span>
          <MessageCircle className="size-3.5 text-emerald-300" />
        </button>
      </div>
    );
  }

  if (collapsed && brief && !brief.skip) {
    return (
      <div className={cn(STRIP_POS, "pointer-events-none w-[min(96vw,520px)]")}>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCollapsed(false);
              setFadeIn(true);
              scheduleCollapse();
            }}
            className={cn(
              "inline-flex min-w-0 flex-1 items-center gap-2 rounded-full",
              "border border-emerald-500/30 bg-zinc-950/85 px-3 py-1.5",
              "shadow-xl shadow-emerald-950/30 backdrop-blur-md transition hover:border-emerald-400/45"
            )}
            title={brief.text}
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            <span className="truncate text-xs text-zinc-200">{brief.text}</span>
          </button>
          <button
            type="button"
            onClick={() => openLevadius(brief.followUpPrompt || brief.text)}
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
              "border border-emerald-500/35 bg-zinc-950/90 shadow-lg backdrop-blur-md",
              "transition hover:border-emerald-400/50"
            )}
            title="Відкрити LEVADIUS"
            aria-label="Відкрити LEVADIUS"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/levadius-avatar.jpg"
              alt=""
              className="size-full object-cover"
            />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(STRIP_POS, "pointer-events-none w-[min(96vw,720px)]")}>
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-2xl border border-emerald-500/30",
          "bg-zinc-950/88 px-2.5 py-2 shadow-2xl shadow-emerald-950/35 backdrop-blur-md",
          "sm:rounded-full sm:px-3"
        )}
      >
        <div className="hidden shrink-0 items-center gap-1.5 pl-1 sm:flex">
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
          onClick={() => {
            if (!brief?.text) {
              openLevadius();
              return;
            }
            openLevadius(brief.followUpPrompt || brief.text);
          }}
          className={cn(
            "min-w-0 flex-1 text-left text-xs leading-snug text-zinc-100 transition",
            "hover:text-emerald-50",
            fadeIn || loading ? "opacity-100" : "opacity-0",
            "duration-400"
          )}
        >
          {loading && !brief?.text
            ? "Дивлюсь, що по зміні…"
            : brief?.text || "…"}
        </button>

        <button
          type="button"
          onClick={() => openLevadius(brief?.followUpPrompt || brief?.text)}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
            "border border-emerald-400/40 ring-2 ring-emerald-500/15",
            "transition hover:ring-emerald-400/30"
          )}
          title="Відкрити LEVADIUS"
          aria-label="Відкрити LEVADIUS"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/levadius-avatar.jpg"
            alt=""
            className="size-full object-cover"
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setMuted(true);
            writeFlag(MUTE_KEY, true);
            try {
              if (brief?.section) {
                sessionStorage.setItem(DISMISS_KEY, brief.section);
              }
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          title="Сховати підказку"
          aria-label="Сховати підказку"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

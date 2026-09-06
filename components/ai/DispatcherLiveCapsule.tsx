"use client";

import { Volume2, VolumeX, X } from "lucide-react";
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
const VOICE_KEY = "levadius_dispatcher_capsule_voice";
const DISMISS_KEY = "levadius_dispatcher_capsule_dismissed_section";
const AUTO_COLLAPSE_MS = 8000;

type SectionBriefPayload = {
  ok: true;
  section: SectionId;
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

function speakText(text: string) {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "uk-UA";
    utter.rate = 1;
    utter.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const uk = voices.find((v) => /uk/i.test(v.lang));
    if (uk) utter.voice = uk;
    window.speechSynthesis.speak(utter);
  } catch {
    /* ignore */
  }
}

function SoundBars({ active }: { active: boolean }) {
  return (
    <span className="inline-flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] rounded-full bg-emerald-400/90",
            active ? "animate-pulse" : "opacity-40"
          )}
          style={{
            height: active ? `${6 + i * 3}px` : "4px",
            animationDelay: `${i * 120}ms`,
            animationDuration: `${700 + i * 140}ms`,
          }}
        />
      ))}
    </span>
  );
}

export function DispatcherLiveCapsule(): ReactNode {
  const pathname = usePathname();
  const [muted, setMuted] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<SectionBriefPayload | null>(null);
  const [visibleText, setVisibleText] = useState("");
  const [fadeIn, setFadeIn] = useState(false);
  const lastSectionRef = useRef<SectionId | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMuted(readFlag(MUTE_KEY, false));
    setVoiceEnabled(readFlag(VOICE_KEY, false));
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

  const openLevadius = useCallback((prompt: string) => {
    window.dispatchEvent(
      new CustomEvent("levadius:open", {
        detail: { prompt },
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
      return;
    }

    // Не спамити той самий розділ повторно в одній сесії без зміни route
    if (lastSectionRef.current === section && brief?.section === section) {
      setHidden(false);
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
    setHidden(false);
    setCollapsed(false);
    setLoading(true);
    setFadeIn(false);
    clearCollapseTimer();
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }

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
        if (!res.ok || data.ok !== true || !data.text) {
          setBrief(null);
          setVisibleText("");
          setHidden(true);
          return;
        }
        setBrief({
          ok: true,
          section: data.section,
          text: data.text,
          followUpPrompt: data.followUpPrompt,
          cached: data.cached,
        });
        setVisibleText(data.text);
        requestAnimationFrame(() => setFadeIn(true));
        if (voiceEnabled) speakText(data.text);
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
  }, [
    pathname,
    muted,
    voiceEnabled,
    clearCollapseTimer,
    scheduleCollapse,
  ]);

  if (muted) {
    return (
      <button
        type="button"
        onClick={() => {
          setMuted(false);
          writeFlag(MUTE_KEY, false);
          setHidden(false);
          setCollapsed(false);
          lastSectionRef.current = null;
        }}
        className={cn(
          "fixed top-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full",
          "border border-emerald-500/25 bg-zinc-950/80 px-2.5 py-1.5 text-[10px] font-bold tracking-wide text-emerald-300/90 uppercase",
          "shadow-lg shadow-emerald-950/30 backdrop-blur-md transition hover:border-emerald-400/40"
        )}
        title="Увімкнути диспетчерський ефір"
        aria-label="Увімкнути диспетчерський ефір"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        LIVE
      </button>
    );
  }

  if (hidden && !loading) return null;

  if (collapsed && brief) {
    return (
      <button
        type="button"
        onClick={() => {
          setCollapsed(false);
          setFadeIn(true);
          scheduleCollapse();
        }}
        className={cn(
          "fixed top-4 left-1/2 z-40 -translate-x-1/2",
          "inline-flex max-w-[min(92vw,420px)] items-center gap-2 rounded-full",
          "border border-emerald-500/30 bg-zinc-950/85 px-3 py-1.5",
          "shadow-2xl shadow-emerald-950/40 backdrop-blur-md transition hover:border-emerald-400/45"
        )}
        title={brief.text}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        <span className="text-[10px] font-bold tracking-[0.14em] text-emerald-300 uppercase">
          LIVE
        </span>
        <span className="truncate text-xs text-zinc-300">{brief.text}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-4 left-1/2 z-40 w-[min(94vw,720px)] -translate-x-1/2"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-full border border-emerald-500/30",
          "bg-zinc-950/85 px-4 py-2 shadow-2xl shadow-emerald-950/40 backdrop-blur-md"
        )}
      >
        <div className="flex shrink-0 items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[10px] font-bold tracking-[0.16em] text-emerald-300 uppercase">
            LIVE
          </span>
          <SoundBars active={loading || Boolean(brief)} />
        </div>

        <button
          type="button"
          onClick={() => {
            if (!brief) return;
            openLevadius(brief.followUpPrompt || brief.text);
          }}
          className={cn(
            "min-w-0 flex-1 text-left text-xs leading-snug text-zinc-100 transition",
            "hover:text-emerald-100",
            fadeIn ? "opacity-100" : "opacity-0",
            "duration-500"
          )}
        >
          {loading && !visibleText
            ? "Диспетчер на лінії…"
            : visibleText || "Немає оперативних даних по розділу."}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              writeFlag(VOICE_KEY, next);
              if (next && brief?.text) speakText(brief.text);
              else if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
            }}
            className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            title={voiceEnabled ? "Вимкнути озвучення" : "Увімкнути озвучення"}
            aria-label={voiceEnabled ? "Вимкнути озвучення" : "Увімкнути озвучення"}
          >
            {voiceEnabled ? (
              <Volume2 className="size-3.5" />
            ) : (
              <VolumeX className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setMuted(true);
              writeFlag(MUTE_KEY, true);
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
              try {
                if (brief?.section) {
                  sessionStorage.setItem(DISMISS_KEY, brief.section);
                }
              } catch {
                /* ignore */
              }
            }}
            className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            title="Вимкнути ефір"
            aria-label="Вимкнути ефір"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

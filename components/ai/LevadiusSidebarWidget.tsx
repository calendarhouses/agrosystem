"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getMyProfileAction } from "@/app/team/actions";
import { LevadiusAvatar } from "@/components/ai/LevadiusAvatar";
import { SidebarNavTooltip } from "@/components/layout/sidebar-nav-tooltip";
import { canAccessLevadius } from "@/lib/levadius-access";
import {
  getLevadiusLiveCache,
  setLevadiusRadarN,
  subscribeLevadiusLiveCache,
} from "@/lib/levadius-live-cache";
import { ukPlural } from "@/lib/uk-plural";
import { cn } from "@/lib/utils";

type LevadiusSidebarWidgetProps = {
  collapsed: boolean;
};

function openLevadius(prompt = "") {
  window.dispatchEvent(
    new CustomEvent("levadius:open", { detail: { prompt } })
  );
}

function radarTeaser(count: number): string {
  if (count <= 0) return "Диспетчер онлайн";
  const noun = ukPlural(count, "аномалія", "аномалії", "аномалій");
  if (count === 1) return "1 аномалія на радарі — глянь";
  return `${count} ${noun} на радарі — глянь`;
}

/** Інтерактивний віджет LEVADIUS у лівому сайдбарі (над профілем). */
export function LevadiusSidebarWidget({
  collapsed,
}: LevadiusSidebarWidgetProps): ReactNode {
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
    if (!allowed) return;
    let cancelled = false;
    const ac = new AbortController();

    void (async () => {
      try {
        const res = await fetch(
          "/api/agent/section-briefing?section=fuel",
          { signal: ac.signal, cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          facts?: { radarN?: number };
          text?: string;
          followUpPrompt?: string;
        };
        if (cancelled || !data?.ok) return;
        const n = Number(data.facts?.radarN);
        if (Number.isFinite(n) && n > 0) setLevadiusRadarN(n);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [allowed]);

  if (!allowed) return null;

  const statusLabel = radarTeaser(radarCount);

  if (collapsed) {
    return (
      <SidebarNavTooltip title="LEVADIUS" hint={statusLabel}>
        <button
          type="button"
          onClick={() => openLevadius()}
          aria-label="Відкрити LEVADIUS"
          className={cn(
            "mb-2 flex w-full items-center justify-center rounded-2xl border border-zinc-800",
            "bg-zinc-900/60 p-1.5 transition-all hover:bg-zinc-800/80"
          )}
        >
          <LevadiusAvatar size={32} live />
        </button>
      </SidebarNavTooltip>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openLevadius()}
      aria-label="Відкрити LEVADIUS"
      className={cn(
        "mb-2 flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-zinc-800",
        "bg-zinc-900/60 p-2 text-left transition-all hover:bg-zinc-800/80",
        radarCount > 0 && "border-amber-500/30 hover:border-amber-400/45"
      )}
    >
      <LevadiusAvatar size={36} live />
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-zinc-100">
          LEVADIUS
        </span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] leading-snug",
            radarCount > 0 ? "font-medium text-amber-200/95" : "text-emerald-400/90"
          )}
        >
          {statusLabel}
        </span>
      </span>
    </button>
  );
}

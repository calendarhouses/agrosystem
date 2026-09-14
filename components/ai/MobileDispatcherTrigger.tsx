"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getMyProfileAction } from "@/app/team/actions";
import { canAccessLevadius } from "@/lib/levadius-access";
import { cn } from "@/lib/utils";

/**
 * Мобільний виклик LEVADIUS: мікро-капсула в правому верхньому кутку
 * під status bar — не перекриває «Заправка», zoom карти чи bottom-nav.
 */
export function MobileDispatcherTrigger(): ReactNode {
  const [allowed, setAllowed] = useState(false);
  const [radarCount, setRadarCount] = useState(0);

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
        };
        if (cancelled || !data?.ok) return;
        const n = Number(data.facts?.radarN);
        if (Number.isFinite(n) && n > 0) setRadarCount(Math.floor(n));
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

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[45] md:hidden",
        "top-[max(0.5rem,env(safe-area-inset-top,0px))]",
        "right-[max(0.75rem,env(safe-area-inset-right,0px))]"
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
          "pointer-events-auto inline-flex items-center gap-2 rounded-full",
          "border border-zinc-700/80 bg-zinc-950/85 py-1.5 pr-3 pl-1.5",
          "shadow-lg backdrop-blur-md transition",
          "hover:border-emerald-500/40 hover:bg-zinc-900/95 active:scale-[0.98]"
        )}
        aria-label="Відкрити LEVADIUS"
        title="LEVADIUS · диспетчер"
      >
        <span className="relative size-7 shrink-0 overflow-hidden rounded-full ring-2 ring-emerald-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/levadius-avatar.jpg?v=8"
            alt=""
            className="size-full object-cover"
          />
          <span className="absolute top-0 right-0 size-1.5 rounded-full border border-zinc-950 bg-emerald-400" />
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-zinc-100">
          LEVADIUS
        </span>
        {radarCount > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-zinc-950">
            {radarCount > 9 ? "9+" : radarCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

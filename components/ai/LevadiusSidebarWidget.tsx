"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getMyProfileAction } from "@/app/team/actions";
import { SidebarNavTooltip } from "@/components/layout/sidebar-nav-tooltip";
import { canAccessLevadius } from "@/lib/levadius-access";
import { cn } from "@/lib/utils";

type LevadiusSidebarWidgetProps = {
  collapsed: boolean;
};

function openLevadius() {
  window.dispatchEvent(
    new CustomEvent("levadius:open", { detail: { prompt: "" } })
  );
}

function AvatarBadge({ size = 36 }: { size?: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-full ring-2 ring-emerald-500/30"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/levadius-avatar.jpg?v=8"
        alt=""
        className="size-full object-cover"
      />
      <span className="absolute top-0.5 right-0.5 size-2 rounded-full border-2 border-zinc-950 bg-emerald-400">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
      </span>
    </span>
  );
}

/** Інтерактивний віджет LEVADIUS у лівому сайдбарі (над профілем). */
export function LevadiusSidebarWidget({
  collapsed,
}: LevadiusSidebarWidgetProps): ReactNode {
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

  const statusLabel =
    radarCount > 0
      ? `Радар · ${radarCount}`
      : "Диспетчер онлайн";

  if (collapsed) {
    return (
      <SidebarNavTooltip title="LEVADIUS" hint={statusLabel}>
        <button
          type="button"
          onClick={openLevadius}
          aria-label="Відкрити LEVADIUS"
          className={cn(
            "mb-2 flex w-full items-center justify-center rounded-2xl border border-zinc-800",
            "bg-zinc-900/60 p-2 transition-all hover:bg-zinc-800/80"
          )}
        >
          <AvatarBadge size={36} />
        </button>
      </SidebarNavTooltip>
    );
  }

  return (
    <button
      type="button"
      onClick={openLevadius}
      aria-label="Відкрити LEVADIUS"
      className={cn(
        "mb-2 flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border border-zinc-800",
        "bg-zinc-900/60 p-2.5 text-left transition-all hover:bg-zinc-800/80"
      )}
    >
      <AvatarBadge size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-zinc-100">
          LEVADIUS
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {radarCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
              {radarCount} аномал.
            </span>
          ) : (
            <span className="truncate text-[10px] text-emerald-400/90">
              {statusLabel}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

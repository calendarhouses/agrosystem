"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { History, Loader2 } from "lucide-react";

import {
  listRecentActivityAction,
} from "@/app/team/actions";
import type { ActivityLogRow } from "@/lib/activity-log";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM, HH:mm", { locale: uk });
}

export function ActivityJournalPanel({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void listRecentActivityAction({ limit: 80 }).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-3xl",
        compact
          ? "px-3 py-3 pb-[calc(var(--app-bottom-inset)+1rem)]"
          : "px-4 py-6 sm:px-6",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3",
          compact ? "mb-3" : "mb-5"
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-2xl bg-zinc-900/5 text-zinc-700",
            compact ? "h-9 w-9" : "h-11 w-11"
          )}
        >
          <History className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </span>
        <div className="min-w-0">
          <h2
            className={cn(
              "font-bold tracking-tight text-zinc-900",
              compact ? "text-sm" : "text-lg"
            )}
          >
            Журнал дій
          </h2>
          {!compact ? (
            <p className="text-sm text-zinc-500">
              Хто що зробив у системі — створення, зміни, видалення
            </p>
          ) : (
            <p className="truncate text-[11px] text-zinc-500">
              Останні дії в системі
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Завантаження…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#E5DFD3] bg-white/60 px-4 py-12 text-center text-sm text-zinc-500">
          Поки немає записів. Після дій користувачів вони зʼявляться тут.
        </p>
      ) : (
        <ul className="divide-y divide-[#E5DFD3]/70 overflow-hidden rounded-2xl border border-[#E5DFD3]/80 bg-white/80">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4",
                compact ? "px-3 py-2.5" : "px-4 py-3"
              )}
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-medium text-zinc-900",
                    compact ? "text-[13px] leading-snug" : "text-sm"
                  )}
                >
                  {row.summary}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                  {row.actorName}
                </p>
              </div>
              <time className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                {formatWhen(row.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

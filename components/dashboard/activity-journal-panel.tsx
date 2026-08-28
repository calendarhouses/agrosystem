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

export function ActivityJournalPanel({ className }: { className?: string }) {
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
    <div className={cn("mx-auto w-full max-w-3xl px-4 py-6 sm:px-6", className)}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-900/5 text-zinc-700">
          <History className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-900">
            Журнал дій
          </h2>
          <p className="text-sm text-zinc-500">
            Хто що зробив у системі — створення, зміни, видалення
          </p>
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
              className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900">{row.summary}</p>
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

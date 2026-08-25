"use client";

import { usePathname } from "next/navigation";
import { Sprout } from "lucide-react";

import { CommandMenu } from "@/components/dashboard/command-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isCommandCenterPath } from "@/lib/equipment-command-center-layout";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

/**
 * Верхня панель: Command Menu + глобальний перемикач агросезону.
 * На Command Center (/ та /equipment) — прозора плаваюча шапка без пошуку та сезону.
 * На /fuel — той самий мінімалізм (без пошуку/сезону), sticky bar лишається.
 */
export function TopBar() {
  const pathname = usePathname();
  const isCommandCenter = isCommandCenterPath(pathname);
  const hideSearchAndSeason =
    isCommandCenter || pathname === "/fuel" || pathname?.startsWith("/fuel/");
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);

  return (
    <header
      className={cn(
        isCommandCenter
          ? "pointer-events-none absolute top-0 left-0 z-50 w-full border-none bg-transparent"
          : hideSearchAndSeason
            ? "hidden"
            : "sticky top-0 z-30 border-b border-zinc-200/80 bg-zinc-100/90 backdrop-blur-sm"
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8",
          isCommandCenter && "pointer-events-auto justify-end"
        )}
      >
        {!hideSearchAndSeason ? (
          <>
            <CommandMenu className="min-w-[180px] max-w-xl flex-1" />

            <Select
              value={String(activeSeason)}
              onValueChange={(v) => {
                if (typeof v === "string" && v) setActiveSeason(v);
              }}
            >
              <SelectTrigger
                className={cn(
                  "h-10 min-h-10 min-w-[158px] shrink-0 gap-2 rounded-xl border-[#E5DFD3]",
                  "bg-[#F4F1EA] px-3 text-sm font-semibold text-zinc-800 shadow-sm",
                  "hover:border-[#276749]/35 hover:bg-[#E5DFD3]/40",
                  "focus-visible:ring-2 focus-visible:ring-[#276749]/30",
                  "data-[size=default]:h-10 data-[size=default]:min-h-10"
                )}
                aria-label="Агросезон"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#276749]/12 text-[#276749]">
                  <Sprout className="h-3.5 w-3.5" />
                </span>
                <SelectValue>{seasonLabel(String(activeSeason))}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="min-w-[200px] rounded-xl">
                <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                  Агросезон (бер–лют)
                </div>
                {availableSeasons.map((year) => (
                  <SelectItem key={year} value={year} className="rounded-lg">
                    {seasonLabel(year)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>
    </header>
  );
}

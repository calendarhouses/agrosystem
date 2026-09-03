"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown, Loader2, Sprout } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { nextDateRangeSelection } from "@/lib/date-range-select";
import {
  FINANCE_QUICK_PERIODS,
} from "@/lib/finance-period";
import type { FinancePeriodFilter } from "@/lib/use-finance-period-filter";
import { useRangePopoverDraft } from "@/lib/use-range-popover-draft";
import { cn } from "@/lib/utils";

const SEASON_OPTIONS = [2024, 2025, 2026, 2027];

type FinancePeriodToolbarProps = FinancePeriodFilter & {
  variant?: "mobile" | "desktop";
  theme?: "light" | "dark";
  seasonHint?: string;
  loading?: boolean;
  trailing?: ReactNode;
  className?: string;
};

export function FinancePeriodToolbar({
  period,
  setPeriod,
  customRange,
  setCustomRange,
  seasonOpen,
  setSeasonOpen,
  rangeOpen,
  setRangeOpen,
  seasonYear,
  availableSeasons,
  selectSeason,
  applyPeriod,
  variant = "mobile",
  theme = "light",
  seasonHint = "Фільтр за агросезоном (березень–лютий).",
  loading = false,
  trailing,
  className,
}: FinancePeriodToolbarProps) {
  const desktop = variant === "desktop";
  const dark = theme === "dark";
  const seasonYears =
    availableSeasons.length > 0
      ? availableSeasons.map(Number)
      : SEASON_OPTIONS;

  const rangeDraft = useRangePopoverDraft({
    period,
    setPeriod,
    customRange,
    setCustomRange,
    rangeOpen,
    setRangeOpen,
    rangePeriod: "Діапазон",
    fallbackPeriod: "Сезон",
    onPopoverOpen: () => setSeasonOpen(false),
  });

  return (
    <div
      className={cn(
        desktop ? "flex w-full flex-row items-center gap-2 max-w-xl lg:w-auto" : "space-y-2.5",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Popover
          open={seasonOpen}
          onOpenChange={(next) => {
            setSeasonOpen(next);
            if (next) {
              setRangeOpen(false);
              setPeriod("Сезон");
            }
          }}
        >
          <PopoverTrigger
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-2.5 text-left font-semibold transition-all",
              desktop
                ? "h-11 min-w-32 flex-none px-4 text-sm"
                : "h-11 min-w-0 flex-1 text-sm md:h-9 md:flex-none md:text-xs",
              period === "Сезон"
                ? dark
                  ? "border-orange-500/60 bg-orange-500/15 text-orange-50 shadow-[0_6px_20px_-8px_rgba(249,115,22,0.55)]"
                  : "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                : dark
                  ? "border-white/10 bg-white/5 text-zinc-200 hover:border-white/20"
                  : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
            )}
            aria-label="Обрати агросезон"
          >
            <span
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                period === "Сезон"
                  ? dark
                    ? "bg-orange-500/20 text-orange-300"
                    : "bg-white/15 text-white"
                  : dark
                    ? "bg-white/10 text-orange-400"
                    : "bg-[#276749]/12 text-[#276749]"
              )}
            >
              <Sprout className="h-3.5 w-3.5" />
            </span>
            <span className="truncate tabular-nums">Сезон {seasonYear}</span>
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 shrink-0",
                period === "Сезон"
                  ? dark
                    ? "text-orange-200/80"
                    : "text-white/80"
                  : "text-zinc-400"
              )}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            sheetOnMobile={false}
            className={cn(
              "rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl",
              desktop ? "z-[260] w-56" : "w-[min(100vw-2rem,22rem)]"
            )}
          >
            {!desktop ? (
              <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-snug text-zinc-500">
                {seasonHint}
              </p>
            ) : null}
            <div className="space-y-1">
              {seasonYears.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => selectSeason(year)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 text-left transition-colors",
                    desktop ? "py-2 text-sm" : "py-2.5",
                    seasonYear === year
                      ? "bg-[#276749] text-white"
                      : "text-zinc-800 hover:bg-zinc-50"
                  )}
                >
                  <span className="font-semibold">Сезон {year}</span>
                  <span
                    className={cn(
                      "text-[11px]",
                      seasonYear === year ? "text-white/75" : "text-zinc-400"
                    )}
                  >
                    {desktop ? "бер–лют" : `бер ${year} – лют ${year + 1}`}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover
          open={rangeOpen}
          onOpenChange={rangeDraft.handleOpenChange}
        >
          <PopoverTrigger
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-semibold transition-all",
              desktop ? "h-11 px-4 text-sm" : "h-11 px-3 text-sm md:h-9 md:text-xs",
              period === "Діапазон" || rangeOpen
                ? dark
                  ? "border-orange-500/60 bg-orange-500/15 text-orange-50 shadow-[0_6px_20px_-8px_rgba(249,115,22,0.55)]"
                  : "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                : dark
                  ? "border-white/10 bg-white/5 text-zinc-200 hover:border-white/20"
                  : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
            )}
          >
            <CalendarIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                period === "Діапазон" || rangeOpen
                  ? dark
                    ? "text-orange-200/90"
                    : "text-white/90"
                  : desktop
                    ? "text-zinc-500"
                    : "opacity-70"
              )}
              aria-hidden
            />
            {period === "Діапазон" && customRange?.from
              ? `${format(customRange.from, "d MMM", { locale: uk })}${
                  customRange.to
                    ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                    : " → …"
                }`
              : "Діапазон"}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            sheetOnMobile={false}
            className={cn(
              "rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl",
              desktop
                ? "z-[260] w-auto"
                : "w-[min(100vw-1.5rem,22.5rem)]"
            )}
          >
            <p className="mb-2 px-1 text-[11px] text-zinc-500">
              {rangeDraft.draft?.from && rangeDraft.draft?.to
                ? "Натисніть дату, щоб обрати новий початок"
                : rangeDraft.draft?.from
                  ? "Тепер оберіть кінець періоду"
                  : "Оберіть початок, потім кінець періоду"}
            </p>
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={rangeDraft.calendarSelected}
              defaultMonth={rangeDraft.draft?.from ?? customRange?.from ?? new Date()}
              onSelect={(range, triggerDate) => {
                rangeDraft.setDraft(
                  nextDateRangeSelection(rangeDraft.draft, range, triggerDate)
                );
              }}
              locale={uk}
              className={cn(!desktop && "w-full rounded-xl [--cell-size:2.5rem]")}
            />
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
              <button
                type="button"
                onClick={rangeDraft.resetDraft}
                className={cn(
                  "flex-1 rounded-xl border border-zinc-200 bg-white font-semibold text-zinc-600 hover:bg-zinc-50",
                  desktop ? "h-9 text-xs" : "h-11 text-sm"
                )}
              >
                Скинути
              </button>
              <button
                type="button"
                disabled={!rangeDraft.draft?.from}
                onClick={rangeDraft.applyDraft}
                className={cn(
                  "flex-[1.4] rounded-xl bg-[#276749] font-bold text-white hover:bg-[#22543d] disabled:opacity-50",
                  desktop ? "h-9 text-xs" : "h-11 text-sm"
                )}
              >
                Застосувати
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
        ) : null}
      </div>

      <div className={cn("flex items-center", desktop ? "" : trailing ? "gap-2" : "gap-1.5")}>
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-xl p-0.5",
            desktop ? "h-11 w-auto px-0.5" : "min-w-0 flex-1",
            dark ? "bg-white/5" : "bg-[#EDE8DF]"
          )}
        >
          {FINANCE_QUICK_PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => applyPeriod(option)}
              className={cn(
                "rounded-[10px] font-semibold transition-all",
                desktop
                  ? "h-10 px-4 text-sm"
                  : "min-w-0 flex-1 h-10 px-1 text-[11px] sm:px-2 sm:text-xs",
                period === option
                  ? dark
                    ? "bg-orange-500/90 text-white shadow-[0_4px_14px_-4px_rgba(249,115,22,0.65)]"
                    : "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                  : dark
                    ? "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {trailing}
      </div>
    </div>
  );
}

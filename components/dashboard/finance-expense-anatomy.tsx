"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";
import { Sparkles } from "lucide-react";

import type {
  CompanyFieldBurnRow,
  FinanceExpenseSlice,
} from "@/lib/company-finance";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** Компактна сума для центру доната — не вилазить на кільце. */
function formatDonutCenter(value: number): { main: string; unit: string } {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return {
      main: new Intl.NumberFormat("uk-UA", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }).format(value / 1_000_000),
      unit: "млн ₴",
    };
  }
  if (abs >= 100_000) {
    return {
      main: new Intl.NumberFormat("uk-UA", {
        maximumFractionDigits: 0,
      }).format(Math.round(value / 1000)),
      unit: "тис ₴",
    };
  }
  return { main: formatUah(value), unit: "₴" };
}

const glassCardClass = cn(
  "rounded-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA]/70 shadow-sm",
  "backdrop-blur-2xl"
);

export function FinanceExpenseAnatomy({
  slices,
  className,
}: {
  slices: FinanceExpenseSlice[];
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const total = useMemo(
    () => slices.reduce((s, r) => s + r.amountUah, 0),
    [slices]
  );

  const selectedIndex = pinnedIndex ?? activeIndex;
  const selected =
    selectedIndex != null && slices[selectedIndex]
      ? slices[selectedIndex]
      : null;

  const centerAmount = selected ? selected.amountUah : total;
  const centerLabel = selected ? selected.label : "Витрати на поля";
  const centerFmt = formatDonutCenter(centerAmount);
  const breakdown = selected?.breakdown ?? [];

  if (slices.length === 0 || total <= 0) {
    return null;
  }

  function selectSlice(index: number) {
    setPinnedIndex((prev) => (prev === index ? null : index));
    setActiveIndex(index);
  }

  return (
    <div className={cn(glassCardClass, "p-5 sm:p-6", className)}>
      <div className="mb-4">
        <h3 className="text-sm font-bold tracking-tight text-zinc-900">
          Анатомія витрат
        </h3>
      </div>

      <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
        <div className="relative mx-auto aspect-square h-[min(52vw,200px)] w-[min(52vw,200px)] shrink-0 select-none sm:h-[240px] sm:w-[240px] [&_svg]:outline-none [&_path]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={slices}
                dataKey="amountUah"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="68%"
                outerRadius="92%"
                paddingAngle={3}
                strokeWidth={0}
                isAnimationActive
                animationDuration={700}
                shape={(props) => {
                  const index = Number(props.index ?? -1);
                  const isActive = selectedIndex === index;
                  return (
                    <Sector
                      {...props}
                      outerRadius={
                        Number(props.outerRadius ?? 0) + (isActive ? 4 : 0)
                      }
                      stroke="transparent"
                      tabIndex={-1}
                      focusable={false}
                      style={{ cursor: "pointer", outline: "none" }}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseLeave={() => setActiveIndex(null)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSlice(index)}
                    />
                  );
                }}
              >
                {slices.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-[58%] w-[58%] flex-col items-center justify-center overflow-hidden px-1.5 text-center">
              <p className="max-w-full truncate text-[9px] font-semibold tracking-[0.12em] text-zinc-400 uppercase sm:text-[10px]">
                {centerLabel}
              </p>
              <p
                className={cn(
                  "mt-0.5 max-w-full font-semibold tracking-tight tabular-nums text-zinc-900",
                  centerFmt.main.length > 5
                    ? "text-lg sm:text-xl"
                    : "text-xl sm:text-2xl"
                )}
                title={`${formatUah(centerAmount)} ₴`}
              >
                {centerFmt.main}
              </p>
              <p className="text-[10px] font-medium text-zinc-400 sm:text-xs">
                {centerFmt.unit}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full min-w-0 flex-1">
          <ul className="space-y-1">
            {slices.map((slice, index) => (
              <li key={slice.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={() => selectSlice(index)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                    selectedIndex === index
                      ? "bg-zinc-900/5 ring-1 ring-zinc-900/10"
                      : "hover:bg-zinc-900/[0.03]"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="truncate text-sm font-medium text-zinc-800">
                      {slice.label}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                    <span className="text-xs font-semibold text-zinc-400">
                      {slice.pct}%
                    </span>
                    <span className="min-w-[5.5rem] text-right font-mono text-sm font-medium text-zinc-900">
                      {formatUah(slice.amountUah)} ₴
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {selected && pinnedIndex != null ? (
            <div className="relative mt-4 rounded-2xl shadow-[0_12px_40px_rgb(39,33,24,0.08)]">
              <div className="overflow-hidden rounded-2xl border border-white/60">
                <div
                  className={cn(
                    "relative isolate bg-gradient-to-br from-white/90 via-[#F4F1EA]/95 to-white/70 p-4",
                    "backdrop-blur-xl"
                  )}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-35 blur-2xl"
                    style={{ backgroundColor: selected.color }}
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
                  />

                  <div className="relative mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white/70"
                        style={{ backgroundColor: selected.color }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold tracking-tight text-zinc-900">
                          {selected.label}
                        </p>
                        <p className="text-[11px] font-medium text-zinc-500">
                          {selected.pct}% витрат · деталізація
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPinnedIndex(null)}
                      className={cn(
                        "shrink-0 rounded-full border border-[#E5DFD3]/80 bg-white/70 px-2.5 py-1",
                        "text-[11px] font-semibold text-zinc-500 transition",
                        "hover:border-zinc-300 hover:bg-white hover:text-zinc-800"
                      )}
                    >
                      Закрити
                    </button>
                  </div>

                  {breakdown.length > 0 ? (
                    <ul className="desktop-scrollbar relative max-h-52 space-y-1 overflow-y-auto pr-1" data-desktop-scroll="true">
                      {breakdown.map((row) => (
                        <li
                          key={row.label}
                          className={cn(
                            "flex items-baseline justify-between gap-3 rounded-xl px-2.5 py-2",
                            "bg-white/45 ring-1 ring-[#E5DFD3]/50"
                          )}
                        >
                          <span className="min-w-0 truncate text-xs font-medium text-zinc-700">
                            {row.label}
                          </span>
                          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-zinc-900">
                            {formatUah(row.amountUah)} ₴
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="relative rounded-xl bg-white/40 px-3 py-2.5 text-xs text-zinc-500 ring-1 ring-[#E5DFD3]/50">
                      Немає деталізації по позиціях для цього сегмента
                    </p>
                  )}

                  <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-[#E5DFD3]/70 pt-3">
                    <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                      Разом
                    </span>
                    <span className="font-mono text-sm font-bold tabular-nums text-zinc-900">
                      {formatUah(selected.amountUah)} ₴
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type SmartInsight = {
  id: string;
  tone: "danger" | "warning" | "info" | "success";
  body: ReactNode;
};

export function buildSmartInsights(input: {
  fields: CompanyFieldBurnRow[];
  expenseAnatomy: FinanceExpenseSlice[];
  globalBurnRate: number | null;
  globalFactUah: number;
}): SmartInsight[] {
  const insights: SmartInsight[] = [];
  const over = input.fields
    .filter((f) => f.burnRate != null && f.burnRate > 100)
    .sort((a, b) => (b.burnRate ?? 0) - (a.burnRate ?? 0));

  if (over[0] && over[0].burnRate != null) {
    const overPct = Math.round(over[0].burnRate - 100);
    insights.push({
      id: "burn-over",
      tone: "danger",
      body: (
        <>
          <span className="font-semibold text-rose-600">{over[0].name}</span>{" "}
          перевищило бюджет на {overPct}%.
        </>
      ),
    });
  } else if (input.globalBurnRate != null && input.globalBurnRate >= 85) {
    insights.push({
      id: "burn-high",
      tone: "warning",
      body: (
        <>
          Компанія вже на{" "}
          <span className="font-semibold text-amber-700">
            {Math.round(input.globalBurnRate)}%
          </span>{" "}
          сезонного плану — варто тримати витрати під контролем.
        </>
      ),
    });
  }

  const total = input.expenseAnatomy.reduce((s, r) => s + r.amountUah, 0);
  if (total > 0) {
    const chem = input.expenseAnatomy.find((s) => s.key === "chemicals");
    const fuel = input.expenseAnatomy.find((s) => s.key === "fuel");
    const tmcShare =
      ((chem?.amountUah ?? 0) +
        (input.expenseAnatomy.find((s) => s.key === "seed")?.amountUah ?? 0)) /
      total;
    if (chem && chem.pct >= 70) {
      insights.push({
        id: "chem-heavy",
        tone: "info",
        body: (
          <>
            Основна стаття витрат —{" "}
            <span className="font-semibold text-emerald-700">
              ЗЗР та Добрива
            </span>{" "}
            ({chem.pct}%).
          </>
        ),
      });
    } else if (tmcShare >= 0.7) {
      insights.push({
        id: "tmc-heavy",
        tone: "info",
        body: (
          <>
            Основна стаття витрат у цьому періоді —{" "}
            <span className="font-semibold text-emerald-700">
              ЗЗР, добрива та насіння
            </span>{" "}
            ({Math.round(tmcShare * 100)}%).
          </>
        ),
      });
    } else if (fuel && fuel.pct >= 45) {
      insights.push({
        id: "fuel-heavy",
        tone: "info",
        body: (
          <>
            Паливо тягне{" "}
            <span className="font-semibold text-orange-600">{fuel.pct}%</span>{" "}
            операційних витрат — перевірте ДУТ і холості пробіги.
          </>
        ),
      });
    }
  }

  if (insights.length === 0 && input.globalFactUah > 0) {
    insights.push({
      id: "ok",
      tone: "success",
      body: (
        <>
          Витрати розподілені рівномірно · критичних перевитрат бюджету не
          виявлено.
        </>
      ),
    });
  }

  return insights.slice(0, 2);
}

export function FinanceSmartInsights({
  insights,
  className,
}: {
  insights: SmartInsight[];
  className?: string;
}) {
  if (insights.length === 0) return null;

  return (
    <div className={cn(glassCardClass, "flex h-full flex-col p-5 sm:p-6", className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-700">
          <Sparkles className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div>
          <h3 className="text-sm font-bold tracking-tight text-zinc-900">
            Smart Insights
          </h3>
          <p className="text-[11px] text-zinc-500">Підказки для власника</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-2.5">
        {insights.map((insight) => (
          <li
            key={insight.id}
            className={cn(
              "rounded-2xl border px-3.5 py-3 text-sm leading-snug text-zinc-700",
              insight.tone === "danger" &&
                "border-rose-500/20 bg-rose-500/5",
              insight.tone === "warning" &&
                "border-amber-500/20 bg-amber-500/5",
              insight.tone === "info" && "border-sky-500/20 bg-sky-500/5",
              insight.tone === "success" &&
                "border-emerald-500/20 bg-emerald-500/5"
            )}
          >
            {insight.body}
          </li>
        ))}
      </ul>
    </div>
  );
}

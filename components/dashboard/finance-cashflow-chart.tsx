"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DocRow, MonthBucket } from "@/lib/inventory-bas";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

export type CashflowPoint = {
  key: string;
  label: string;
  income: number;
  expense: number;
  cumulative: number;
};

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function daysBetween(startIso: string, endIso: string): number {
  const a = parseISO(startIso.slice(0, 10));
  const b = parseISO(endIso.slice(0, 10));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 999;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Дні, якщо період ≤ 45 діб; інакше місяці з BAS monthly. */
export function buildCashflowSeries(input: {
  docs: DocRow[];
  monthly: MonthBucket[];
  startIso: string;
  endIso: string;
}): CashflowPoint[] {
  const span = daysBetween(input.startIso, input.endIso);
  const useDaily = span <= 45;

  if (useDaily) {
    const byDay = new Map<string, { income: number; expense: number }>();
    for (const d of input.docs) {
      const day = d.date.slice(0, 10);
      if (!day) continue;
      if (day < input.startIso || day > input.endIso) continue;
      const cur = byDay.get(day) ?? { income: 0, expense: 0 };
      if (d.type === "sale") cur.income += d.amount;
      else cur.expense += d.amount;
      byDay.set(day, cur);
    }
    const keys = [...byDay.keys()].sort();
    let cumulative = 0;
    return keys.map((key) => {
      const row = byDay.get(key)!;
      cumulative += row.income - row.expense;
      let label = key.slice(5);
      try {
        label = format(parseISO(key), "d MMM", { locale: uk });
      } catch {
        /* keep */
      }
      return {
        key,
        label,
        income: Math.round(row.income),
        expense: Math.round(row.expense),
        cumulative: Math.round(cumulative),
      };
    });
  }

  let cumulative = 0;
  return [...input.monthly]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      cumulative += m.sales - m.receipts;
      return {
        key: m.month,
        label: m.label,
        income: Math.round(m.sales),
        expense: Math.round(m.receipts),
        cumulative: Math.round(cumulative),
      };
    });
}

function CashflowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number; name?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const income = payload.find((p) => p.dataKey === "income")?.value ?? 0;
  const expense = payload.find((p) => p.dataKey === "expense")?.value ?? 0;
  const cumulative =
    payload.find((p) => p.dataKey === "cumulative")?.value ?? 0;

  return (
    <div
      className={cn(
        "rounded-2xl border border-[#E5DFD3]/80 px-3.5 py-2.5 shadow-xl",
        "bg-[#1a2e22]/92 text-white backdrop-blur-xl"
      )}
    >
      <p className="text-[11px] font-medium tracking-wide text-white/55">
        {label}
      </p>
      <div className="mt-1.5 space-y-1 text-xs tabular-nums">
        <p>
          <span className="text-emerald-300">Реалізації BAS</span>
          <span className="ml-2 font-semibold">{formatUah(income)} ₴</span>
        </p>
        <p>
          <span className="text-orange-300">Надходження BAS</span>
          <span className="ml-2 font-semibold">{formatUah(expense)} ₴</span>
        </p>
        <p className="border-t border-white/10 pt-1">
          <span className="text-white/50">Кумулятив</span>
          <span
            className={cn(
              "ml-2 font-semibold",
              cumulative >= 0 ? "text-emerald-200" : "text-rose-300"
            )}
          >
            {formatUah(cumulative)} ₴
          </span>
        </p>
      </div>
    </div>
  );
}

const glassChartClass = cn(
  "rounded-3xl border border-white/50 bg-white/40 p-6",
  "backdrop-blur-2xl dark:border-white/10 dark:bg-black/20"
);

export function FinanceCashflowChart({
  docs,
  monthly,
  startIso,
  endIso,
  className,
  onPeriodClick,
}: {
  docs: DocRow[];
  monthly: MonthBucket[];
  startIso: string;
  endIso: string;
  className?: string;
  onPeriodClick?: (point: CashflowPoint) => void;
}) {
  const data = useMemo(
    () => buildCashflowSeries({ docs, monthly, startIso, endIso }),
    [docs, monthly, startIso, endIso]
  );

  const isMobile = useIsMobile();
  const granularity = daysBetween(startIso, endIso) <= 45 ? "дні" : "місяці";

  if (data.length === 0) {
    return (
      <div
        className={cn(
          glassChartClass,
          "flex items-center justify-center py-10 text-sm text-zinc-500",
          className
        )}
      >
        Немає документів за вибраний період
      </div>
    );
  }

  return (
    <div className={cn(glassChartClass, "p-4 sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 sm:mb-5">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-zinc-900">
            {isMobile ? "Динаміка BAS" : "Динаміка BAS (реалізації / надходження)"}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">{granularity}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] font-medium text-zinc-500 sm:gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
            Реалізації
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-400" />
            Надходження
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-[#276749] shadow-[0_0_8px_rgba(39,103,73,0.45)]" />
            Кумулятив
          </span>
        </div>
      </div>

      <div className="h-[240px] w-full touch-pan-y sm:h-[300px] md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{
              top: 12,
              right: isMobile ? 4 : 12,
              left: 0,
              bottom: 4,
            }}
            barGap={isMobile ? 2 : 4}
            barCategoryGap={isMobile ? "18%" : "24%"}
            onClick={(state) => {
              const raw = state as {
                activePayload?: Array<{ payload?: CashflowPoint }>;
              };
              const payload = raw?.activePayload?.[0]?.payload;
              if (payload?.key) onPeriodClick?.(payload);
            }}
            style={{ cursor: onPeriodClick ? "pointer" : undefined }}
          >
            <defs>
              <linearGradient id="cf-income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0.75} />
              </linearGradient>
              <linearGradient id="cf-expense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fb923c" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#ea580c" stopOpacity={0.75} />
              </linearGradient>
              <linearGradient id="cf-cumul-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#276749" stopOpacity={0.28} />
                <stop offset="55%" stopColor="#276749" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#276749" stopOpacity={0} />
              </linearGradient>
              <filter
                id="cf-line-glow"
                x="-40%"
                y="-40%"
                width="180%"
                height="180%"
              >
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="3"
                  floodColor="#276749"
                  floodOpacity="0.45"
                />
                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="1.5"
                  floodColor="#000000"
                  floodOpacity="0.12"
                />
              </filter>
            </defs>

            <CartesianGrid
              vertical={false}
              stroke="#E5DFD3"
              strokeOpacity={0.55}
              strokeDasharray="3 8"
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: isMobile ? 10 : 11, fill: "#8a8478" }}
              dy={8}
              interval="preserveStartEnd"
              minTickGap={isMobile ? 48 : 32}
            />
            <YAxis
              yAxisId="bars"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: isMobile ? 10 : 11, fill: "#8a8478" }}
              width={isMobile ? 36 : 52}
              tickFormatter={(v) =>
                Math.abs(v) >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}м`
                  : Math.abs(v) >= 1000
                    ? `${Math.round(v / 1000)}к`
                    : String(v)
              }
            />
            {!isMobile ? (
              <YAxis
                yAxisId="cumul"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#27674999" }}
                width={48}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1_000_000
                    ? `${Math.round(v / 1_000_000)}м`
                    : Math.abs(v) >= 1000
                      ? `${Math.round(v / 1000)}к`
                      : String(v)
                }
              />
            ) : (
              <YAxis yAxisId="cumul" orientation="right" hide width={0} />
            )}
            <Tooltip
              content={<CashflowTooltip />}
              cursor={{ fill: "rgba(39, 103, 73, 0.07)", radius: 8 }}
            />
            <Bar
              yAxisId="bars"
              dataKey="income"
              name="Реалізації BAS"
              fill="url(#cf-income)"
              radius={[6, 6, 0, 0]}
              maxBarSize={isMobile ? 18 : 26}
            />
            <Bar
              yAxisId="bars"
              dataKey="expense"
              name="Надходження BAS"
              fill="url(#cf-expense)"
              radius={[6, 6, 0, 0]}
              maxBarSize={isMobile ? 18 : 26}
            />
            <Area
              yAxisId="cumul"
              type="monotone"
              dataKey="cumulative"
              fill="url(#cf-cumul-fill)"
              stroke="none"
              legendType="none"
              isAnimationActive={false}
            />
            <Line
              yAxisId="cumul"
              type="monotone"
              dataKey="cumulative"
              name="Кумулятив"
              stroke="#276749"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{
                r: 6,
                fill: "#276749",
                stroke: "#F4F1EA",
                strokeWidth: 3,
              }}
              filter="url(#cf-line-glow)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

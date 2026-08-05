"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  FINANCIAL_CHART_2026,
  FINANCIAL_MONTH_FULL,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const chartConfig = {
  income: {
    label: "Дохід",
    color: "#276749",
  },
  expense: {
    label: "Витрати",
    color: "#C05621",
  },
} satisfies ChartConfig;

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** AreaChart доходів і витрат */
export function FinancialAnalyticsChart({ className }: { className?: string }) {
  const totalIncome = FINANCIAL_CHART_2026.reduce((sum, row) => sum + row.income, 0);
  const totalExpense = FINANCIAL_CHART_2026.reduce(
    (sum, row) => sum + row.expense,
    0
  );

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              Фінансова Аналітика 2026
            </p>
            <p className="text-xs text-zinc-500/80">Доходи vs витрати · YTD</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <div>
            <p className="text-zinc-500">Дохід</p>
            <p className="font-semibold tabular-nums text-[#276749]">
              {formatUsd(totalIncome)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Витрати</p>
            <p className="font-semibold tabular-nums text-[#C05621]">
              {formatUsd(totalExpense)}
            </p>
          </div>
        </div>
      </div>

      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[280px] w-full min-h-[240px] sm:h-[360px]"
      >
        <AreaChart
          data={[...FINANCIAL_CHART_2026]}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="fillIncome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-income)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-income)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillExpense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-expense)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--color-expense)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#E5DFD3"
            strokeOpacity={0.8}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            tick={{ fill: "#71717a", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickMargin={8}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(value: number) => `$${Math.round(value / 1000)}k`}
          />
          <ChartTooltip
            cursor={{ stroke: "#E5DFD3", strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                className="min-w-[200px] border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900 shadow-sm"
                indicator="dot"
                labelFormatter={(value) => {
                  const key = String(value);
                  return FINANCIAL_MONTH_FULL[key] ?? key;
                }}
                formatter={(value, name) => {
                  const label = name === "income" || name === "Дохід" ? "Дохід" : "Витрати";
                  const tone =
                    label === "Дохід" ? "text-[#276749]" : "text-[#C05621]";
                  return (
                    <div className="flex w-full items-center justify-between gap-6">
                      <span className="text-zinc-500">{label}</span>
                      <span className={cn("font-semibold tabular-nums", tone)}>
                        {formatUsd(Number(value))}
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          <Area
            dataKey="income"
            type="monotone"
            fill="url(#fillIncome)"
            stroke="var(--color-income)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 0, fill: "#276749" }}
          />
          <Area
            dataKey="expense"
            type="monotone"
            fill="url(#fillExpense)"
            stroke="var(--color-expense)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#C05621" }}
          />
        </AreaChart>
      </ChartContainer>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#276749]" />
          Дохід
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#C05621]" />
          Витрати
        </span>
      </div>
    </div>
  );
}

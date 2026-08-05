"use client";

import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  PieChart,
  Receipt,
} from "lucide-react";

import { FinancialAnalyticsChart } from "@/components/dashboard/financial-analytics-chart";
import { PageHeader } from "@/components/layout/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import {
  FINANCE_BY_PERIOD,
  FINANCE_PERIOD_OPTIONS,
  type FinancePeriod,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

/** Фінанси: каса, витрати, період, аналітика */
export function FinanceView() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const stats = FINANCE_BY_PERIOD[period];

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={PieChart}
        title="Фінанси"
        description="Каса, витрати та аналітика доходів"
        actions={
          <div className="inline-flex rounded-lg border border-[#E5DFD3] bg-zinc-100 p-1">
            {FINANCE_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
                  period === option.id
                    ? "bg-[#276749] text-white shadow-sm"
                    : "text-zinc-500 hover:bg-[#F4F1EA] hover:text-zinc-900"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <section className="mb-4 grid grid-cols-1 gap-4 md:mb-5 md:grid-cols-2 md:gap-5">
        <GlassCard>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500">Каса / Прибуток</p>
              <p className="mt-3 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">
                ₴ {stats.cashUah.toLocaleString("uk-UA")}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
              <Banknote className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#276749]/10 px-2.5 py-1 text-xs font-semibold text-[#276749]">
              <ArrowUpRight className="h-3.5 w-3.5" />+
              {stats.cashTrendPercent}%
            </span>
            <span className="text-xs text-zinc-500">{stats.hint}</span>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500">Витрати</p>
              <p className="mt-3 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">
                ₴ {stats.expensesUah.toLocaleString("uk-UA")}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C05621]/10 text-[#C05621]">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#C05621]/10 px-2.5 py-1 text-xs font-semibold text-[#C05621]">
              <ArrowDownRight className="h-3.5 w-3.5" />+
              {stats.expensesTrendPercent}%
            </span>
            <span className="text-xs text-zinc-500">до попереднього періоду</span>
          </div>
        </GlassCard>
      </section>

      <GlassCard className="hover:scale-100">
        <FinancialAnalyticsChart className="min-h-[360px]" />
      </GlassCard>

      <section className="mt-4 grid grid-cols-1 gap-4 md:mt-5 md:grid-cols-3 md:gap-5">
        {[
          {
            label: "Маржа YTD",
            value: "62%",
            hint: "Дохід мінус витрати",
            tone: "text-[#276749]",
          },
          {
            label: "Середні витрати / га",
            value: "$118",
            hint: "По всіх полях",
            tone: "text-[#C05621]",
          },
          {
            label: "Прогноз сезону",
            value: "$312k",
            hint: "Очікуваний валовий дохід",
            tone: "text-zinc-900",
          },
        ].map((card) => (
          <GlassCard key={card.label}>
            <p className="text-sm text-zinc-500">{card.label}</p>
            <p className={`mt-2 text-3xl font-extrabold tracking-tight ${card.tone}`}>
              {card.value}
            </p>
            <p className="mt-1 text-xs text-zinc-500/80">{card.hint}</p>
          </GlassCard>
        ))}
      </section>
    </main>
  );
}

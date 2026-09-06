/**
 * LEVADIUS: зведена фінкартина господарства (/finance).
 * Обгортка над fetchCompanyFinancialOverview + accounting_acts (послуги/ремонт).
 */

import {
  fetchCompanyFinancialOverview,
  type FinanceDateRange,
} from "@/lib/company-finance";
import { getSeasonRange, kyivYmd } from "@/lib/finance-period";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgentFinancePeriod =
  | "year_to_date"
  | "current_month"
  | "last_month"
  | "full_season";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

function minIso(a: string, b: string): string {
  return compareIso(a, b) <= 0 ? a : b;
}

function maxIso(a: string, b: string): string {
  return compareIso(a, b) >= 0 ? a : b;
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Календарний зріз у межах агросезону. */
export function resolveAgentFinanceRange(
  seasonYear: number,
  period: AgentFinancePeriod,
  now = new Date()
): FinanceDateRange & { periodLabel: string } {
  const season = getSeasonRange(seasonYear, now);
  const today = kyivYmd(now);
  const todayIso = ymdIso(today.year, today.month, today.day);

  if (period === "full_season" || period === "year_to_date") {
    return {
      startIso: season.startIso,
      endIso: season.endIso,
      periodLabel:
        period === "full_season" ? "Повний сезон (до сьогодні)" : "З початку сезону",
    };
  }

  if (period === "current_month") {
    const monthStart = ymdIso(today.year, today.month, 1);
    return {
      startIso: maxIso(monthStart, season.startIso),
      endIso: minIso(todayIso, season.endIso),
      periodLabel: "Поточний місяць",
    };
  }

  // last_month
  let y = today.year;
  let m = today.month - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  const startIso = ymdIso(y, m, 1);
  const endIso = ymdIso(y, m, lastDayOfMonth(y, m));
  return {
    startIso: maxIso(startIso, season.startIso),
    endIso: minIso(endIso, season.endIso),
    periodLabel: "Минулий місяць",
  };
}

async function sumAccountingActsUah(
  range: FinanceDateRange
): Promise<{ amountUah: number; warning?: string }> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("accounting_acts")
      .select("total_amount, act_date, status")
      .gte("act_date", range.startIso)
      .lte("act_date", range.endIso)
      .neq("status", "cancelled");

    if (error) {
      return {
        amountUah: 0,
        warning: `Акти послуг: ${error.message}`,
      };
    }

    let amountUah = 0;
    for (const row of data ?? []) {
      const n = Number(row.total_amount);
      if (Number.isFinite(n) && n > 0) amountUah += n;
    }
    return { amountUah: Math.round(amountUah) };
  } catch (err) {
    return {
      amountUah: 0,
      warning:
        err instanceof Error
          ? `Акти послуг: ${err.message}`
          : "Акти послуг недоступні",
    };
  }
}

export async function getAgentCompanyFinancialOverview(input: {
  season?: number;
  period?: AgentFinancePeriod;
}): Promise<{
  success: true;
  season: number;
  period: AgentFinancePeriod;
  periodLabel: string;
  periodStartIso: string;
  periodEndIso: string;
  revenueUah: number;
  expensesBreakdown: {
    inventory: number;
    fuel: number;
    payroll: number;
    maintenance: number;
  };
  totalExpensesUah: number;
  netMarginUah: number;
  grossMarginPct: number | null;
  costPerHectareUah: number | null;
  totalAreaHa: number;
  warnings: string[];
  navigatePath: "/finance";
  message: string;
}> {
  const seasonYear = Math.round(Number(input.season) || 2026);
  const period = input.period ?? "full_season";
  const range = resolveAgentFinanceRange(seasonYear, period);

  const [overview, acts] = await Promise.all([
    fetchCompanyFinancialOverview(String(seasonYear), {
      startIso: range.startIso,
      endIso: range.endIso,
    }),
    sumAccountingActsUah(range),
  ]);

  const inventory = Math.round(overview.inventorySpentUah);
  const fuel = Math.round(overview.fuelCostUah);
  const payroll = Math.round(overview.salaryUah);
  const maintenance = acts.amountUah;
  const totalExpensesUah = Math.round(
    inventory + fuel + payroll + maintenance
  );
  const revenueUah = Math.round(overview.localSalesUah);
  const netMarginUah = Math.round(revenueUah - totalExpensesUah);
  const grossMarginPct =
    revenueUah > 0
      ? Math.round((netMarginUah / revenueUah) * 1000) / 10
      : null;
  const areaHa = overview.totalAreaHa;
  const costPerHectareUah =
    areaHa > 0 ? Math.round((totalExpensesUah / areaHa) * 100) / 100 : null;

  const warnings = [
    ...overview.dataWarnings,
    ...(acts.warning ? [acts.warning] : []),
  ];

  const fmt = (n: number) => n.toLocaleString("uk-UA");
  const message = [
    `Сезон ${seasonYear} · ${range.periodLabel} (${range.startIso}…${range.endIso}).`,
    `Дохід (локальні продажі): ${fmt(revenueUah)} ₴.`,
    `Витрати: ${fmt(totalExpensesUah)} ₴ (ТМЦ ${fmt(inventory)}, паливо ${fmt(fuel)}, ЗП ${fmt(payroll)}, послуги/ремонт ${fmt(maintenance)}).`,
    `Маржа: ${fmt(netMarginUah)} ₴${
      grossMarginPct != null ? ` (${grossMarginPct}%)` : ""
    }.`,
    costPerHectareUah != null
      ? `Собівартість земельного банку: ${fmt(costPerHectareUah)} ₴/га (${areaHa} га).`
      : "Площа земельного банку = 0 — ₴/га не пораховано.",
  ].join(" ");

  return {
    success: true as const,
    season: seasonYear,
    period,
    periodLabel: range.periodLabel,
    periodStartIso: range.startIso,
    periodEndIso: range.endIso,
    revenueUah,
    expensesBreakdown: {
      inventory,
      fuel,
      payroll,
      maintenance,
    },
    totalExpensesUah,
    netMarginUah,
    grossMarginPct,
    costPerHectareUah,
    totalAreaHa: Math.round(areaHa * 100) / 100,
    warnings,
    navigatePath: "/finance",
    message,
  };
}

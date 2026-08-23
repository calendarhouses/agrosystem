"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Landmark,
  Loader2,
  MapPinned,
  Sprout,
  TrendingUp,
  Wheat,
} from "lucide-react";

import { getCompanyFinancialOverview } from "@/app/finance/actions";
import {
  MonthlyChart,
  RankList,
} from "@/components/dashboard/inventory-finance-panels";
import { PageHeader } from "@/components/layout/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import type { CompanyFinancialOverview } from "@/lib/company-finance";
import {
  formatInventoryMoney,
  type InventoryFullDashboard,
} from "@/lib/inventory-bas";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function burnCardTone(burnRate: number | null): {
  bg: string;
  border: string;
  pct: string;
  badge: string;
} {
  if (burnRate == null) {
    return {
      bg: "bg-zinc-50",
      border: "border-zinc-200/80",
      pct: "text-zinc-400",
      badge: "bg-zinc-100 text-zinc-500",
    };
  }
  if (burnRate > 100) {
    return {
      bg: "bg-red-50",
      border: "border-red-200/90",
      pct: "text-red-700",
      badge: "bg-red-100/80 text-red-800",
    };
  }
  if (burnRate >= 75) {
    return {
      bg: "bg-amber-50",
      border: "border-amber-200/90",
      pct: "text-amber-800",
      badge: "bg-amber-100/80 text-amber-900",
    };
  }
  return {
    bg: "bg-emerald-50/90",
    border: "border-emerald-200/80",
    pct: "text-emerald-800",
    badge: "bg-emerald-100/70 text-emerald-900",
  };
}

function globalBarTone(pct: number | null): {
  bar: string;
  track: string;
  label: string;
} {
  if (pct == null) {
    return { bar: "bg-zinc-300", track: "bg-zinc-100", label: "text-zinc-500" };
  }
  if (pct > 100) {
    return { bar: "bg-red-500", track: "bg-red-100", label: "text-red-700" };
  }
  if (pct >= 75) {
    return {
      bar: "bg-amber-500",
      track: "bg-amber-100",
      label: "text-amber-800",
    };
  }
  return {
    bar: "bg-[#276749]",
    track: "bg-[#276749]/15",
    label: "text-[#276749]",
  };
}

/** CEO-дашборд: burn rate полів + cashflow з 1С */
export function FinanceView({
  overview: initialOverview,
  overviewError: initialOverviewError,
  bas,
  basError,
}: {
  overview: CompanyFinancialOverview | null;
  overviewError: string | null;
  bas: InventoryFullDashboard | null;
  basError: string | null;
}) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const [overview, setOverview] = useState(initialOverview);
  const [overviewError, setOverviewError] = useState(initialOverviewError);
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    void getCompanyFinancialOverview(activeSeason).then((res) => {
      if (cancelled) return;
      setOverviewLoading(false);
      if (!res.ok) {
        setOverview(null);
        setOverviewError(res.error);
        return;
      }
      setOverview(res.data);
      setOverviewError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSeason]);

  const burn = overview?.globalBurnRate ?? null;
  const tone = globalBarTone(burn);
  const barWidth =
    burn != null ? Math.min(100, Math.max(0, burn)) : 0;

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-10 sm:px-6 lg:px-8">
      <PageHeader
        icon={Landmark}
        title="Фінанси"
        description={`Стратегічний огляд · ${seasonLabel(activeSeason)} · cashflow з 1С`}
      />

      {/* Company Burn Rate */}
      {overviewError ? (
        <GlassCard className="mb-6 border-amber-200 bg-amber-50 hover:translate-y-0 hover:shadow-sm">
          <p className="text-sm font-semibold text-amber-950">
            Не вдалося завантажити витрати по полях
          </p>
          <p className="mt-1 text-xs text-amber-900/80">{overviewError}</p>
        </GlassCard>
      ) : overviewLoading || !overview ? (
        <GlassCard className="mb-6 flex items-center gap-2 text-sm text-zinc-500 hover:translate-y-0">
          <Loader2 className="h-4 w-4 animate-spin" />
          Рахуємо burn rate ({seasonLabel(activeSeason)})…
        </GlassCard>
      ) : (
        <section className="mb-6 overflow-hidden rounded-2xl border border-[#E5DFD3] bg-gradient-to-br from-white via-[#FDFBF7] to-[#EFE8DC] p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
                Company Burn Rate
              </p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-800 sm:text-xl">
                Загальні витрати по полях
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {overview.fieldsCount} полів · {formatUah(overview.totalAreaHa)}{" "}
                га · ТМЦ, паливо, ЗП
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/70 px-3.5 py-2 text-right shadow-sm backdrop-blur-sm">
              <p className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
                Від плану
              </p>
              <p
                className={cn(
                  "text-2xl font-extrabold tabular-nums tracking-tight",
                  tone.label
                )}
              >
                {burn != null ? `${burn}%` : "—"}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className="text-4xl font-extrabold tracking-tight tabular-nums text-zinc-900 sm:text-5xl">
              {formatUah(overview.globalFactUah)}
              <span className="ml-2 text-xl font-bold text-zinc-400">₴</span>
            </p>
            <p className="pb-1 text-sm text-zinc-500">
              з{" "}
              <span className="font-semibold tabular-nums text-zinc-700">
                {overview.globalPlanUah > 0
                  ? `${formatUah(overview.globalPlanUah)} ₴`
                  : "бюджет не задано"}
              </span>
              {overview.fieldsWithBudget > 0 ? (
                <span className="text-zinc-400">
                  {" "}
                  · план на {overview.fieldsWithBudget} полях
                </span>
              ) : null}
            </p>
          </div>

          <div
            className={cn("mt-5 h-3 w-full overflow-hidden rounded-full", tone.track)}
            role="progressbar"
            aria-valuenow={Math.round(barWidth)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700 ease-out",
                tone.bar
              )}
              style={{
                width: overview.globalPlanUah > 0 ? `${barWidth}%` : "0%",
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#E5DFD3]/80 pt-4">
            <div>
              <p className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
                ТМЦ
              </p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-800">
                {formatUah(overview.inventorySpentUah)} ₴
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
                Паливо
              </p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-800">
                {formatUah(overview.fuelCostUah)} ₴
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
                Зарплата
              </p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-800">
                {formatUah(overview.salaryUah)} ₴
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Heatmap */}
      {overview && overview.fields.length > 0 ? (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-zinc-900">
                Теплова матриця полів
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Відсоток використання бюджету · проблемні зверху
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-[10px] font-medium text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />
                &lt;75%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-200" />
                75–100%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-200" />
                &gt;100%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {overview.fields.map((field) => {
              const card = burnCardTone(field.burnRate);
              return (
                <div
                  key={field.fieldId}
                  className={cn(
                    "rounded-xl border px-3 py-3 transition-shadow hover:shadow-sm",
                    card.bg,
                    card.border
                  )}
                  title={
                    field.budgetUah != null
                      ? `${formatUah(field.spentUah)} ₴ / ${formatUah(field.budgetUah)} ₴`
                      : `${formatUah(field.spentUah)} ₴ · бюджет не задано`
                  }
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="line-clamp-2 text-[12px] leading-snug font-semibold text-zinc-800">
                      {field.name}
                    </p>
                    <MapPinned className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400/80" />
                  </div>
                  <p
                    className={cn(
                      "mt-2 text-xl font-extrabold tracking-tight tabular-nums",
                      card.pct
                    )}
                  >
                    {field.burnRate != null ? `${Math.round(field.burnRate)}%` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] tabular-nums text-zinc-500">
                    {field.areaHa > 0 ? `${field.areaHa} га` : "—"}
                    {field.crop && field.crop !== "—" ? ` · ${field.crop}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* BAS Cashflow */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-zinc-500" />
          <div>
            <h3 className="text-sm font-bold tracking-tight text-zinc-900">
              Cashflow з 1С
            </h3>
            <p className="text-xs text-zinc-500">
              Закупки · Продажі · Врожай · контрагенти BAS AGRO
            </p>
          </div>
        </div>

        {basError ? (
          <GlassCard className="border-amber-200 bg-amber-50 hover:translate-y-0 hover:shadow-sm">
            <p className="text-sm font-semibold text-amber-950">
              Не вдалося завантажити дані 1С
            </p>
            <p className="mt-1 text-xs text-amber-900/80">{basError}</p>
          </GlassCard>
        ) : !bas ? (
          <GlassCard className="flex items-center gap-2 text-sm text-zinc-500 hover:translate-y-0">
            <Loader2 className="h-4 w-4 animate-spin" />
            Тягнемо OData…
          </GlassCard>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <GlassCard className="p-4 hover:translate-y-0">
                <div className="flex items-center gap-2 text-zinc-500">
                  <TrendingUp className="h-4 w-4 text-[#2563EB]" />
                  <p className="text-xs font-medium">Закупки</p>
                </div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-zinc-900">
                  {formatInventoryMoney(bas.totalReceipts)}
                </p>
              </GlassCard>
              <GlassCard className="p-4 hover:translate-y-0">
                <div className="flex items-center gap-2 text-zinc-500">
                  <Sprout className="h-4 w-4 text-[#16A34A]" />
                  <p className="text-xs font-medium">Продажі</p>
                </div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-zinc-900">
                  {formatInventoryMoney(bas.totalSales)}
                </p>
              </GlassCard>
              <GlassCard className="p-4 hover:translate-y-0">
                <div className="flex items-center gap-2 text-zinc-500">
                  <Wheat className="h-4 w-4 text-[#D97706]" />
                  <p className="text-xs font-medium">Врожай</p>
                </div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-zinc-900">
                  {formatInventoryMoney(bas.totalHarvest)}
                </p>
              </GlassCard>
            </div>

            <GlassCard className="p-5 hover:translate-y-0 hover:shadow-sm">
              <h4 className="mb-4 text-sm font-bold text-zinc-900">
                Помісячна динаміка
              </h4>
              <MonthlyChart monthly={bas.monthly} />
            </GlassCard>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <GlassCard className="p-5 hover:translate-y-0 hover:shadow-sm">
                <h4 className="mb-3 text-sm font-bold text-zinc-900">
                  Топ покупці
                </h4>
                <RankList items={bas.topBuyers} accent="#16A34A" />
              </GlassCard>
              <GlassCard className="p-5 hover:translate-y-0 hover:shadow-sm">
                <h4 className="mb-3 text-sm font-bold text-zinc-900">
                  Топ постачальники
                </h4>
                <RankList items={bas.topSuppliers} accent="#2563EB" />
              </GlassCard>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

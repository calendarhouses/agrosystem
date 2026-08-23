"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cell, Pie, PieChart } from "recharts";
import {
  Landmark,
  Loader2,
  MapPinned,
  RefreshCw,
  Sprout,
} from "lucide-react";

import { getFieldEconomicsDashboard } from "@/app/admin/inventory/actions";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import type {
  FieldEconomicsCard,
  FieldEconomicsCategoryKey,
  FieldEconomicsDashboardData,
} from "@/lib/field-economics";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

const CAT_COLORS: Record<FieldEconomicsCategoryKey, string> = {
  zzr: "#276749",
  fertilizer: "#C05621",
  seed: "#B7791F",
};

const donutConfig = {
  zzr: { label: "ЗЗР", color: CAT_COLORS.zzr },
  fertilizer: { label: "Добрива", color: CAT_COLORS.fertilizer },
  seed: { label: "Насіння", color: CAT_COLORS.seed },
} satisfies ChartConfig;

function formatQty(qty: number, unit: string): string {
  if (!qty) return "—";
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Компактна сума в центрі бублика: 124K ₴ */
function formatCompactUah(amount: number): string {
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    const text =
      m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "");
    return `${text}M ₴`;
  }
  if (amount >= 1000) {
    return `${Math.round(amount / 1000)}K ₴`;
  }
  return `${Math.round(amount)} ₴`;
}

export function FieldEconomicsDashboard({
  refreshToken = 0,
}: {
  refreshToken?: number;
}) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FieldEconomicsDashboardData | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getFieldEconomicsDashboard(activeSeason);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }

  useEffect(() => {
    void load();
  }, [refreshToken, activeSeason]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Рахуємо економіку полів…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">Не вдалося завантажити</p>
        <p className="mt-1 text-amber-800/90">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Спробувати знову
        </button>
      </div>
    );
  }

  if (!data || data.cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E5DFD3] bg-white/70 px-6 py-16 text-center">
        <MapPinned className="mx-auto h-10 w-10 text-zinc-300" />
        <p className="mt-4 text-sm font-semibold text-zinc-800">
          Поки немає списань на поля
        </p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-zinc-500">
          Зроби «Швидке списання на поле» — тут з’являться картки з витратами
          ЗЗР, добрив і насіння по кожному полю та вкладенням ₴/га.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-900">Економіка полів</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Оперативні списання · {data.totals.fieldsWithMoves}{" "}
            {data.totals.fieldsWithMoves === 1 ? "поле" : "полів"} ·{" "}
            {data.totals.moveCount} рухів
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.totals.totalCostUah != null ? (
            <Badge
              variant="outline"
              className="border-[#276749]/25 bg-[#276749]/8 px-3 py-1.5 text-[12px] font-semibold text-[#276749]"
            >
              У землі ≈ {formatMoney(data.totals.totalCostUah)}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-[#E5DFD3] bg-white px-3 py-1.5 text-[11px] text-zinc-500"
            >
              Задайте планові ціни на картках ТМЦ
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Оновити
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card, index) => (
          <motion.div
            key={card.fieldId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.35,
              delay: index * 0.06,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <FieldEconomicsCardView card={card} />
          </motion.div>
        ))}
      </section>
    </div>
  );
}

function FieldEconomicsCardView({ card }: { card: FieldEconomicsCard }) {
  const spentUah = card.totalCostUah ?? 0;
  const budgetUah = card.budgetUah;
  const budgetPct =
    budgetUah != null && budgetUah > 0
      ? Math.min(100, Math.round((spentUah / budgetUah) * 100))
      : null;
  const overBudget = budgetPct != null && budgetPct > 100;
  const nearLimit =
    budgetPct != null && budgetPct >= 75 && budgetPct <= 100;

  const donutData = card.donut.map((d) => ({
    key: d.key,
    name: d.label,
    value: d.value,
    fill: CAT_COLORS[d.key],
  }));

  const activeCategories = card.categories.filter((c) => c.qty > 0);

  return (
    <GlassCard className="overflow-hidden border-[#E5DFD3] bg-white p-0 shadow-sm hover:translate-y-0 hover:shadow-sm">
      {/* Header + Activity Ring */}
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-tight text-zinc-900">
            {card.fieldName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-zinc-200/80 bg-zinc-50 text-[10px] font-medium text-zinc-600"
            >
              <Sprout className="mr-1 h-3 w-3 text-[#276749]" />
              {card.crop}
            </Badge>
            <Badge
              variant="outline"
              className="border-zinc-200/80 bg-zinc-50 text-[10px] font-medium text-zinc-600"
            >
              <Landmark className="mr-1 h-3 w-3 text-zinc-400" />
              {card.areaHa > 0 ? `${card.areaHa} га` : "площа —"}
            </Badge>
          </div>
          <p className="mt-3 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
            Вкладено у гектар
          </p>
          <p
            className={cn(
              "mt-0.5 text-xl font-extrabold tracking-tight tabular-nums",
              card.costPerHa != null ? "text-zinc-900" : "text-zinc-300"
            )}
          >
            {card.costPerHa != null
              ? `${new Intl.NumberFormat("uk-UA", {
                  maximumFractionDigits: 0,
                }).format(card.costPerHa)} ₴/га`
              : "— ₴/га"}
          </p>
        </div>

        <ActivityRing
          segments={donutData}
          centerLabel={
            card.totalCostUah != null
              ? formatCompactUah(card.totalCostUah)
              : "—"
          }
          centerHint="витрати"
        />
      </div>

      {/* Category list */}
      <div className="mx-5 mb-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/60">
        {(activeCategories.length > 0
          ? activeCategories
          : card.categories
        ).map((cat) => (
          <div
            key={cat.key}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                style={{ backgroundColor: CAT_COLORS[cat.key] }}
              />
              <span className="truncate text-[13px] font-medium text-zinc-700">
                {cat.label}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[13px] font-bold tabular-nums text-zinc-900">
                {cat.costUah != null ? formatMoney(cat.costUah) : "без ціни"}
              </p>
              <p className="text-[11px] tabular-nums text-zinc-400">
                {formatQty(cat.qty, cat.unit)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Budget progress (ready for future budgetUah) */}
      <div className="border-t border-[#E5DFD3]/80 bg-[#FAF8F4]/80 px-5 py-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
            Бюджет поля
          </p>
          <p className="text-[11px] tabular-nums text-zinc-500">
            {budgetUah != null && budgetUah > 0 ? (
              <>
                <span
                  className={cn(
                    "font-semibold",
                    overBudget ? "text-red-600" : "text-zinc-800"
                  )}
                >
                  {formatMoney(spentUah)}
                </span>
                <span className="text-zinc-400">
                  {" "}
                  / {formatMoney(budgetUah)}
                </span>
              </>
            ) : (
              <span className="text-zinc-400">
                {card.totalCostUah != null
                  ? `${formatMoney(spentUah)} витрачено`
                  : "бюджет не задано"}
              </span>
            )}
          </p>
        </div>
        <Progress
          value={budgetPct != null ? Math.min(100, budgetPct) : 0}
          className={cn(
            "w-full gap-0",
            budgetPct == null
              ? "[&_[data-slot=progress-indicator]]:bg-zinc-300/80 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-zinc-200/70"
              : overBudget
                ? "[&_[data-slot=progress-indicator]]:bg-red-500 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-red-100"
                : nearLimit
                  ? "[&_[data-slot=progress-indicator]]:bg-amber-500 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-amber-100"
                  : "[&_[data-slot=progress-indicator]]:bg-[#276749] [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[#276749]/15"
          )}
        />
        <p className="mt-1.5 text-[10px] text-zinc-400">
          {budgetPct != null
            ? overBudget
              ? `Перевищення бюджету · ${budgetPct}%`
              : nearLimit
                ? `Увага · ${budgetPct}% від плану`
                : `${budgetPct}% від плану`
            : "Встановіть плановий бюджет у картці поля"}
        </p>
      </div>
    </GlassCard>
  );
}

/** Маленьке кільце активності з сумою в центрі */
function ActivityRing({
  segments,
  centerLabel,
  centerHint,
}: {
  segments: { key: string; name: string; value: number; fill: string }[];
  centerLabel: string;
  centerHint: string;
}) {
  const size = 88;
  const hasData = segments.length > 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      {hasData ? (
        <ChartContainer
          config={donutConfig}
          className="aspect-square h-full w-full"
          initialDimension={{ width: size, height: size }}
        >
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              innerRadius={28}
              outerRadius={40}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {segments.map((entry) => (
                <Cell key={entry.key} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      ) : (
        <div className="absolute inset-0 rounded-full border-[6px] border-zinc-100" />
      )}

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[13px] leading-none font-extrabold tracking-tight text-zinc-900 tabular-nums">
          {centerLabel}
        </span>
        <span className="mt-0.5 text-[8px] font-medium tracking-wide text-zinc-400 uppercase">
          {centerHint}
        </span>
      </div>
    </div>
  );
}

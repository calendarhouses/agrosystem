"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  AlertTriangle,
  Building2,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Fuel,
  Landmark,
  LayoutDashboard,
  Leaf,
  Loader2,
  MapPinned,
  Percent,
  Sprout,
  Sun,
  Target,
  TrendingUp,
  Wallet,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import { getCompanyFinancialOverview, getFinanceBasDashboard } from "@/app/finance/actions";
import { FinanceCashflowChart } from "@/components/dashboard/finance-cashflow-chart";
import {
  FinanceDrillSheet,
  type FinanceDrillTarget,
} from "@/components/dashboard/finance-drill-sheet";
import Link from "next/link";
import { FinanceExpenseAnatomy } from "@/components/dashboard/finance-expense-anatomy";
import { FieldDetailSheet } from "@/components/dashboard/field-detail-sheet";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type {
  CompanyFieldBurnRow,
  CompanyFinancialOverview,
} from "@/lib/company-finance";
import type { Field } from "@/lib/dashboard-data";
import { listFarmFields, type FarmField } from "@/lib/farm-fields";
import {
  FINANCE_QUICK_PERIODS,
  getFinancePeriodRange,
  toIsoRange,
  type FinancePeriod,
} from "@/lib/finance-period";
import { nextDateRangeSelection } from "@/lib/date-range-select";
import {
  filterDashboardByRange,
  type InventoryFullDashboard,
} from "@/lib/inventory-bas";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
import { useAnimatedNumber } from "@/lib/use-animated-number";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function parseIsoLocal(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function pluralFields(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "поле";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "поля";
  return "полів";
}

function pluralDrafts(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "чернетка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "чернетки";
  return "чернеток";
}

/** KPI: ≥1 млн → «93.4 млн», інакше повне число без truncate. */
function formatHeroUah(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    const formatted = new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(millions);
    return `${formatted} млн`;
  }
  return formatUah(value);
}

function AnimatedUah({
  value,
  enabled = true,
  showPlus = false,
  toneClassName,
}: {
  value: number;
  enabled?: boolean;
  showPlus?: boolean;
  toneClassName?: string;
}) {
  const animated = useAnimatedNumber(value, { enabled, duration: 1.5 });
  const rounded = Math.round(animated);
  const prefix = showPlus && rounded > 0 ? "+" : "";
  const abs = Math.abs(animated);
  const isMillion = abs >= 1_000_000;

  const numberText = isMillion
    ? `${prefix}${new Intl.NumberFormat("uk-UA", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }).format(animated / 1_000_000)}`
    : `${prefix}${formatUah(animated)}`;

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0"
      title={`${prefix}${formatUah(value)} ₴`}
    >
      <span
        className={cn(
          "text-[1.35rem] leading-none font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-[1.85rem]",
          toneClassName
        )}
      >
        {numberText}
      </span>
      <span className="text-sm font-medium tracking-tight text-zinc-500/90">
        {isMillion ? "млн ₴" : "₴"}
      </span>
    </div>
  );
}

/** Clay glass — як деталі поля: глина + смарагд, не біла пляма. */
const glassCardClass = cn(
  "rounded-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA]/75 shadow-[0_8px_30px_rgb(39,33,24,0.06)]",
  "backdrop-blur-2xl"
);

const kpiGlassClass = cn(
  "group relative isolate overflow-hidden rounded-xl p-3 text-left sm:rounded-2xl sm:p-4",
  "border border-white/70 shadow-[0_6px_24px_rgb(0,0,0,0.06)]",
  "backdrop-blur-2xl",
  "transition-all duration-200",
  "hover:shadow-[0_10px_28px_rgb(0,0,0,0.09)]",
  "outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/25",
  "disabled:cursor-default disabled:opacity-70",
  "[transform:translateZ(0)]" // force rounded clip for glow layers
);

const kpiLabelClass =
  "relative mb-1 text-left text-[9px] font-bold tracking-[0.14em] text-zinc-500 uppercase sm:mb-1.5 sm:text-[10px]";

const kpiGradientRevenue = "text-emerald-700";

const kpiGradientExpense = "text-orange-600";

const kpiGradientLoss = "text-rose-600";

function BreakEvenBar({
  revenue,
  expense,
}: {
  revenue: number;
  expense: number;
}) {
  const profitable = revenue >= expense && revenue > 0;
  const loss = expense > revenue;

  let fillPct = 0;
  let label = "Немає даних для точки беззбитковості";
  let barClass = "bg-zinc-300";

  if (loss && expense > 0) {
    fillPct = Math.min(100, Math.max(0, (revenue / expense) * 100));
    const gap = Math.round(expense - revenue);
    label = `До нуля ще ${formatHeroUah(gap)} ₴ · покрито ${Math.round(fillPct)}%`;
    barClass = "bg-rose-500";
  } else if (profitable) {
    const marginPct = Math.min(
      100,
      Math.max(0, ((revenue - expense) / revenue) * 100)
    );
    fillPct = marginPct;
    label = `Маржа ${Math.round(marginPct)}% · прибуток від виручки`;
    barClass = "bg-emerald-500";
  } else if (expense === 0 && revenue === 0) {
    fillPct = 0;
    label = "Немає рухів за період";
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-900/5">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            barClass
          )}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <p className="text-[10px] font-medium tracking-wide text-zinc-500">
        {label}
      </p>
    </div>
  );
}

const SEASON_OPTIONS = [2026, 2025, 2024] as const;

function fieldBudgetTone(burnRate: number | null): {
  card: string;
  bar: string;
  badge: string;
} {
  if (burnRate == null) {
    return {
      card: "border-zinc-300/40 bg-white/40 hover:bg-white/55",
      bar: "bg-zinc-400",
      badge: "border-zinc-200/80 bg-zinc-100/80 text-zinc-500",
    };
  }
  if (burnRate > 100) {
    return {
      card: "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10",
      bar: "bg-rose-500",
      badge: "border-rose-500/25 bg-rose-500/10 text-rose-700",
    };
  }
  if (burnRate >= 80) {
    return {
      card: "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10",
      bar: "bg-amber-500",
      badge: "border-amber-500/25 bg-amber-500/10 text-amber-800",
    };
  }
  return {
    card: "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10",
    bar: "bg-emerald-500",
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-800",
  };
}

function burnRowToSheetField(
  row: CompanyFieldBurnRow,
  farm?: FarmField | null
): Field {
  return {
    id: farm?.id ?? row.fieldId,
    name: farm?.name ?? row.name,
    crop: farm?.crop ?? row.crop,
    areaHa: farm?.areaHa ?? row.areaHa,
    status: "active",
    mapPositionClass: "",
    accent: "lime",
    economics: {
      costPerHaUsd: 0,
      fuelUsedL: 0,
      expectedRevenueUsd: 0,
    },
    timeline: [],
  };
}

function globalBarTone(pct: number | null): {
  bar: string;
  track: string;
  label: string;
} {
  if (pct == null) {
    return { bar: "bg-zinc-300", track: "bg-zinc-900/5", label: "text-zinc-500" };
  }
  if (pct > 100) {
    return { bar: "bg-rose-500", track: "bg-rose-500/10", label: "text-rose-700" };
  }
  if (pct >= 75) {
    return {
      bar: "bg-amber-500",
      track: "bg-amber-500/10",
      label: "text-amber-800",
    };
  }
  return {
    bar: "bg-emerald-600",
    track: "bg-emerald-500/10",
    label: "text-emerald-800",
  };
}

export function FinanceView({
  overview: initialOverview,
  overviewError: initialOverviewError,
  bas,
  basError: initialBasError,
  initialSeasonYear,
}: {
  overview: CompanyFinancialOverview | null;
  overviewError: string | null;
  bas: InventoryFullDashboard | null;
  basError: string | null;
  /** Сезон, під який пораховано initialOverview на сервері */
  initialSeasonYear: number;
}) {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"overview" | "fields" | "flow">(
    "overview"
  );
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);

  const storeSeasonYear = (() => {
    const y = Number(activeSeason);
    return Number.isFinite(y) && y >= 2020 ? y : initialSeasonYear;
  })();

  const [period, setPeriod] = useState<FinancePeriod>("Сезон");
  const [seasonYear, setSeasonYear] = useState(storeSeasonYear);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [showBudgeted, setShowBudgeted] = useState(false);
  const [showUnplanned, setShowUnplanned] = useState(false);
  const [showCrops, setShowCrops] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  // Не показуємо SSR-огляд іншого сезону — інакше маржа «стрибає» 98%→100%
  const ssrMatchesClient = storeSeasonYear === initialSeasonYear;
  const [overview, setOverview] = useState(
    ssrMatchesClient ? initialOverview : null
  );
  const [overviewError, setOverviewError] = useState(
    ssrMatchesClient ? initialOverviewError : null
  );
  const [overviewLoading, setOverviewLoading] = useState(!ssrMatchesClient);
  /** Сезон, якому відповідає поточний `overview` (не мішати з виручкою іншого сезону) */
  const [overviewSeasonYear, setOverviewSeasonYear] = useState<number | null>(
    ssrMatchesClient && initialOverview ? initialSeasonYear : null
  );
  const skipSeasonFetchOnce = useRef(
    ssrMatchesClient && Boolean(initialOverview)
  );
  const skipBasFetchOnce = useRef(ssrMatchesClient && Boolean(bas));

  const [basData, setBasData] = useState<InventoryFullDashboard | null>(
    ssrMatchesClient ? bas : null
  );
  const [basDataError, setBasDataError] = useState<string | null>(
    ssrMatchesClient ? initialBasError : null
  );
  const [basSeasonYear, setBasSeasonYear] = useState<number | null>(
    ssrMatchesClient && bas ? initialSeasonYear : null
  );
  const [basLoading, setBasLoading] = useState(!ssrMatchesClient);

  const [farmFieldsById, setFarmFieldsById] = useState<
    Record<string, FarmField>
  >({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<CompanyFieldBurnRow | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTarget, setDrillTarget] = useState<FinanceDrillTarget | null>(
    null
  );

  const dateRange = useMemo(
    () => getFinancePeriodRange(period, seasonYear, customRange),
    [period, seasonYear, customRange]
  );
  const isoRange = useMemo(() => toIsoRange(dateRange), [dateRange]);

  const basView = useMemo(() => {
    if (!basData) return null;
    return filterDashboardByRange(basData, isoRange.startIso, isoRange.endIso);
  }, [basData, isoRange]);

  useEffect(() => {
    const y = Number(activeSeason);
    if (Number.isFinite(y) && y >= 2020 && y !== seasonYear) {
      setSeasonYear(y);
      setOverview(null);
      setOverviewSeasonYear(null);
      setOverviewLoading(true);
      skipSeasonFetchOnce.current = false;
      skipBasFetchOnce.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from store only
  }, [activeSeason]);

  useEffect(() => {
    let cancelled = false;
    if (skipBasFetchOnce.current) {
      skipBasFetchOnce.current = false;
      setBasLoading(false);
      return;
    }
    setBasLoading(true);
    const fetchSeason = seasonYear;
    void getFinanceBasDashboard(fetchSeason).then((res) => {
      if (cancelled) return;
      setBasLoading(false);
      if (!res.ok) {
        setBasData(null);
        setBasSeasonYear(null);
        setBasDataError(res.error);
        return;
      }
      setBasData(res.data);
      setBasSeasonYear(fetchSeason);
      setBasDataError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonYear]);

  useEffect(() => {
    let cancelled = false;
    void listFarmFields().then((fields) => {
      if (cancelled) return;
      const map: Record<string, FarmField> = {};
      for (const f of fields) {
        map[f.id.toLowerCase()] = f;
      }
      setFarmFieldsById(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // SSR уже дав огляд для цього сезону — не перезапитуємо одразу (уникаємо миготіння маржі)
    if (skipSeasonFetchOnce.current && period === "Сезон") {
      skipSeasonFetchOnce.current = false;
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    // Не чистимо overview одразу — лишаємо каркас блоку; маржа все одно
    // чекає overviewInSync (overviewSeasonYear скидаємо).
    setOverviewSeasonYear(null);
    // Примітиви start/end — надійніше для Server Action, ніж обʼєкт range.
    const fetchSeason = seasonYear;
    const fetchStart = isoRange.startIso;
    const fetchEnd = isoRange.endIso;
    void getCompanyFinancialOverview(
      String(fetchSeason),
      fetchStart,
      fetchEnd
    ).then((res) => {
      if (cancelled) return;
      setOverviewLoading(false);
      if (!res.ok) {
        setOverview(null);
        setOverviewSeasonYear(null);
        setOverviewError(res.error);
        return;
      }
      setOverview(res.data);
      setOverviewSeasonYear(fetchSeason);
      setOverviewError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonYear, period, isoRange.startIso, isoRange.endIso]);

  const detailFarm = detailRow
    ? farmFieldsById[detailRow.fieldId.toLowerCase()] ?? null
    : null;
  const detailSheetField = detailRow
    ? burnRowToSheetField(detailRow, detailFarm)
    : null;

  function openFieldDetail(row: CompanyFieldBurnRow) {
    setDetailRow(row);
    setDetailOpen(true);
  }

  function openDrill(target: FinanceDrillTarget) {
    setDrillTarget(target);
    setDrillOpen(true);
  }

  function selectSeasonYear(year: number) {
    setSeasonYear(year);
    setPeriod("Сезон");
    setSeasonOpen(false);
    setActiveSeason(String(year));
    skipSeasonFetchOnce.current = false;
    skipBasFetchOnce.current = false;
  }

  const burn = overview?.globalBurnRate ?? null;
  const tone = globalBarTone(burn);

  /** Витрати лише коли overview відповідає сезону + періоду — інакше хибна маржа */
  const overviewInSync =
    overview != null &&
    overviewSeasonYear === seasonYear &&
    !overviewLoading &&
    overview.periodStartIso === isoRange.startIso &&
    overview.periodEndIso === isoRange.endIso;

  const fieldsPeriodLabel = useMemo(() => {
    if (period === "Сезон") return `Сезон ${seasonYear}`;
    if (period === "Діапазон" && customRange?.from) {
      const from = format(customRange.from, "d MMM", { locale: uk });
      const to = customRange.to
        ? format(customRange.to, "d MMM", { locale: uk })
        : from;
      return `${from} – ${to}`;
    }
    if (period === "Діапазон") return "Діапазон";
    return `${period} · ${format(parseIsoLocal(isoRange.startIso), "d MMM", { locale: uk })} – ${format(parseIsoLocal(isoRange.endIso), "d MMM", { locale: uk })}`;
  }, [period, seasonYear, customRange, isoRange.startIso, isoRange.endIso]);
  const basInSync =
    basSeasonYear === seasonYear &&
    !basLoading &&
    (basData != null || Boolean(basDataError));
  const basReady = basInSync && (Boolean(basView) || Boolean(basDataError));
  const marginReady = overviewInSync && basInSync;

  const basSalesUah = basInSync && basView ? basView.totalSales : 0;
  const localSalesUah = overviewInSync ? (overview?.localSalesUah ?? 0) : 0;
  const revenueUah = basSalesUah + localSalesUah;
  const opsCostUah = overviewInSync ? (overview?.globalFactUah ?? 0) : 0;
  const pnlUah = revenueUah - opsCostUah;
  const marginPctDisplay =
    marginReady && revenueUah > 0
      ? Math.round(((revenueUah - opsCostUah) / revenueUah) * 100)
      : null;

  const { budgetedFields, unplannedFields } = useMemo(() => {
    const fields = overview?.fields ?? [];
    return {
      budgetedFields: fields.filter((f) => f.budgetUah != null && f.budgetUah > 0),
      unplannedFields: fields.filter(
        (f) => f.budgetUah == null || f.budgetUah <= 0
      ),
    };
  }, [overview?.fields]);

  const budgetedTotals = useMemo(() => {
    let fact = 0;
    let plan = 0;
    for (const f of budgetedFields) {
      fact += f.spentUah;
      plan += f.budgetUah ?? 0;
    }
    return { fact, plan };
  }, [budgetedFields]);

  const anatomySlices = overview?.expenseAnatomy ?? [];
  const hasAnatomy = anatomySlices.some((s) => s.amountUah > 0);

  const cropEconomics = useMemo(() => {
    const fields = overview?.fields ?? [];
    const map = new Map<
      string,
      { crop: string; areaHa: number; spentUah: number; fields: number }
    >();
    for (const f of fields) {
      const crop =
        f.crop && f.crop !== "—" ? f.crop : "Без культури";
      const prev = map.get(crop) ?? {
        crop,
        areaHa: 0,
        spentUah: 0,
        fields: 0,
      };
      prev.areaHa += f.areaHa || 0;
      prev.spentUah += f.spentUah || 0;
      prev.fields += 1;
      map.set(crop, prev);
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        costPerHa: r.areaHa > 0 ? r.spentUah / r.areaHa : 0,
      }))
      .sort((a, b) => b.spentUah - a.spentUah || b.areaHa - a.areaHa)
      .slice(0, 6);
  }, [overview?.fields]);

  const ownerPulse = useMemo(() => {
    if (!overview) return null;
    const overBudgetFields = overview.fields
      .filter((f) => f.burnRate != null && f.burnRate > 100)
      .sort((a, b) => (b.burnRate ?? 0) - (a.burnRate ?? 0));
    const costPerHa =
      overview.totalAreaHa > 0
        ? overview.globalFactUah / overview.totalAreaHa
        : 0;
    const planPerHa =
      overview.totalAreaHa > 0 && overview.globalPlanUah > 0
        ? overview.globalPlanUah / overview.totalAreaHa
        : 0;

    const risks: Array<{
      id: string;
      text: string;
      tone: "warn" | "danger" | "info";
      field?: CompanyFieldBurnRow;
    }> = [];

    for (const f of overBudgetFields) {
      const over = Math.round((f.burnRate ?? 100) - 100);
      risks.push({
        id: `over-${f.fieldId}`,
        text: `${f.name} — перевитрата бюджету на ${over}%`,
        tone: "danger",
        field: f,
      });
    }
    for (const f of unplannedFields) {
      const cropLabel =
        f.crop && f.crop !== "—" ? ` (${f.crop})` : "";
      risks.push({
        id: `no-budget-${f.fieldId}`,
        text: `${f.name}${cropLabel} — немає запланованого бюджету`,
        tone: "warn",
        field: f,
      });
    }
    if (
      overview.fuelCostUah > 0 &&
      overview.globalFactUah > 0 &&
      overview.fuelCostUah / overview.globalFactUah >= 0.35
    ) {
      const fuelPct = Math.round(
        (overview.fuelCostUah / overview.globalFactUah) * 100
      );
      risks.push({
        id: "fuel-share",
        text: `Паливо — ${fuelPct}% операційних витрат`,
        tone: "info",
      });
    }
    if (overview.draftMovesCount > 0) {
      risks.push({
        id: "drafts",
        text: `${overview.draftMovesCount} ${pluralDrafts(overview.draftMovesCount)} очікують експорту бухгалтеру`,
        tone: "warn",
      });
    }
    if (overview.unpricedTmcLines > 0) {
      risks.push({
        id: "unpriced",
        text: `${overview.unpricedTmcLines} списань ТМЦ без ціни (${overview.unpricedTmcQty} од.)`,
        tone: "warn",
      });
    }
    for (const [i, w] of overview.dataWarnings.entries()) {
      risks.push({ id: `dw-${i}`, text: w, tone: "warn" });
    }

    return {
      overBudget: overBudgetFields.length,
      unplanned: unplannedFields.length,
      fieldsWithBudget: overview.fieldsWithBudget,
      fieldsCount: overview.fieldsCount,
      totalAreaHa: overview.totalAreaHa,
      globalPlanUah: overview.globalPlanUah,
      globalFactUah: overview.globalFactUah,
      burnRate: overview.globalBurnRate,
      burnComparesToSeasonPlan: overview.burnComparesToSeasonPlan,
      inventorySpentUah: overview.inventorySpentUah,
      fuelCostUah: overview.fuelCostUah,
      salaryUah: overview.salaryUah,
      draftMovesCount: overview.draftMovesCount,
      costPerHa,
      planPerHa,
      risks,
      marginPct: marginPctDisplay,
    };
  }, [overview, revenueUah, opsCostUah, unplannedFields, marginPctDisplay]);

  return (
    <main
      className={cn(
        "relative h-full w-full overflow-y-auto overscroll-none",
        "min-h-0 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]",
        "pb-[calc(var(--app-bottom-inset)+1.25rem)] md:pb-0"
      )}
    >
      <div
        className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-[#276749]/10 blur-3xl"
        aria-hidden
      />

      {isMobile ? (
        <div className="sticky top-0 z-40 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/92 px-4 pt-[max(0.75rem,var(--safe-top))] pb-2.5 backdrop-blur-xl">
          <div
            className="inline-flex w-full rounded-2xl border border-[#E5DFD3]/90 bg-white/85 p-1 shadow-sm"
            role="tablist"
            aria-label="Розділ фінансів"
          >
            {(
              [
                { id: "overview", label: "Огляд", icon: LayoutDashboard },
                { id: "fields", label: "Поля", icon: MapPinned },
                { id: "flow", label: "Динаміка", icon: TrendingUp },
              ] as const satisfies ReadonlyArray<{
                id: "overview" | "fields" | "flow";
                label: string;
                icon: LucideIcon;
              }>
            ).map((tab) => {
              const active = mobileTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMobileTab(tab.id)}
                  className={cn(
                    "flex min-h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[12px] font-bold transition-all",
                    active
                      ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                      : "text-zinc-500 active:bg-white/80"
                  )}
                >
                  <Icon
                    className="h-3.5 w-3.5"
                    strokeWidth={active ? 2.25 : 2}
                  />
                  <span className="leading-none">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 space-y-2.5">
            {/* 1: сезон + діапазон */}
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
                    "inline-flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 text-left text-sm font-semibold transition-all",
                    period === "Сезон"
                      ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                      : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                  )}
                  aria-label="Обрати агросезон"
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                      period === "Сезон"
                        ? "bg-white/15 text-white"
                        : "bg-[#276749]/12 text-[#276749]"
                    )}
                  >
                    <Sprout className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate tabular-nums">
                    Сезон {seasonYear}
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-3.5 w-3.5 shrink-0",
                      period === "Сезон" ? "text-white/80" : "text-zinc-400"
                    )}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  sheetOnMobile={false}
                  className="z-[100] w-[min(100vw-2rem,22rem)] rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
                >
                  <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-snug text-zinc-500">
                    Фільтр фінансів за агросезоном (березень–лютий).
                  </p>
                  <div className="space-y-1">
                    {SEASON_OPTIONS.map((year) => (
                      <button
                        key={year}
                        type="button"
                        onClick={() => selectSeasonYear(year)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors",
                          seasonYear === year
                            ? "bg-[#276749] text-white"
                            : "text-zinc-800 hover:bg-zinc-50"
                        )}
                      >
                        <span className="text-sm font-semibold">
                          Сезон {year}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            seasonYear === year
                              ? "text-white/75"
                              : "text-zinc-400"
                          )}
                        >
                          бер {year} – лют {year + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover
                open={rangeOpen}
                onOpenChange={(next) => {
                  setRangeOpen(next);
                  if (next) {
                    setSeasonOpen(false);
                    setPeriod("Діапазон");
                  }
                }}
              >
                <PopoverTrigger
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-all",
                    period === "Діапазон"
                      ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                      : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                  )}
                >
                  <CalendarIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      period === "Діапазон" ? "text-white/90" : "text-zinc-500"
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
                  className="z-[100] w-[min(100vw-1.5rem,22.5rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl"
                >
                  <p className="mb-2 px-1 text-[11px] text-zinc-500">
                    {customRange?.from && customRange?.to
                      ? "Натисніть дату, щоб обрати новий початок"
                      : customRange?.from
                        ? "Тепер оберіть кінець періоду"
                        : "Оберіть початок, потім кінець періоду"}
                  </p>
                  <Calendar
                    mode="range"
                    numberOfMonths={1}
                    selected={customRange}
                    defaultMonth={customRange?.from ?? new Date()}
                    onSelect={(range, triggerDate) => {
                      setPeriod("Діапазон");
                      setCustomRange(
                        nextDateRangeSelection(customRange, range, triggerDate)
                      );
                    }}
                    locale={uk}
                    className="w-full rounded-xl [--cell-size:2.5rem]"
                  />
                  <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomRange(undefined);
                        setPeriod("Сезон");
                        setRangeOpen(false);
                      }}
                      className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
                    >
                      Скинути
                    </button>
                    <button
                      type="button"
                      disabled={!customRange?.from}
                      onClick={() => {
                        if (!customRange?.from) return;
                        if (!customRange.to) {
                          setCustomRange({
                            from: customRange.from,
                            to: customRange.from,
                          });
                        }
                        setPeriod("Діапазон");
                        setRangeOpen(false);
                      }}
                      className="h-11 flex-[1.4] rounded-xl bg-[#276749] text-sm font-bold text-white hover:bg-[#22543d] disabled:opacity-50"
                    >
                      Застосувати
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {overviewLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
              ) : null}
            </div>

            {/* 2: швидкі періоди */}
            <div className="flex min-w-0 items-center gap-0.5 rounded-xl bg-[#EDE8DF] p-0.5">
              {FINANCE_QUICK_PERIODS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPeriod(tab)}
                  className={cn(
                    "h-11 min-w-0 flex-1 rounded-[10px] px-1 text-[11px] font-semibold transition-all sm:px-2 sm:text-xs",
                    period === tab
                      ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                      : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <header className="sticky top-0 z-40 w-full border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/80 px-6 py-4 backdrop-blur-2xl">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
                Фінанси
              </h1>
              <p className="mt-1 truncate text-sm text-zinc-500">
                {seasonLabel(String(seasonYear))} · аналітика компанії
              </p>
            </div>

            <div className="w-full max-w-xl space-y-2 lg:w-auto">
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
                      "inline-flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 text-left text-xs font-semibold transition-all",
                      period === "Сезон"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                    )}
                    aria-label="Обрати агросезон"
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                        period === "Сезон"
                          ? "bg-white/15 text-white"
                          : "bg-[#276749]/12 text-[#276749]"
                      )}
                    >
                      <Sprout className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate tabular-nums">
                      Сезон {seasonYear}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-3.5 w-3.5 shrink-0",
                        period === "Сезон" ? "text-white/80" : "text-zinc-400"
                      )}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="z-[100] w-56 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
                  >
                    {SEASON_OPTIONS.map((year) => (
                      <button
                        key={year}
                        type="button"
                        onClick={() => selectSeasonYear(year)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors",
                          seasonYear === year
                            ? "bg-[#276749] text-white"
                            : "text-zinc-800 hover:bg-zinc-50"
                        )}
                      >
                        <span className="font-semibold">Сезон {year}</span>
                        <span
                          className={cn(
                            "text-[11px]",
                            seasonYear === year
                              ? "text-white/75"
                              : "text-zinc-400"
                          )}
                        >
                          бер–лют
                        </span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>

                <Popover
                  open={rangeOpen}
                  onOpenChange={(next) => {
                    setRangeOpen(next);
                    if (next) {
                      setSeasonOpen(false);
                      setPeriod("Діапазон");
                    }
                  }}
                >
                  <PopoverTrigger
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all",
                      period === "Діапазон"
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                    )}
                  >
                    <CalendarIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        period === "Діапазон"
                          ? "text-white/90"
                          : "text-zinc-500"
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
                    className="z-[100] w-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl"
                  >
                    <p className="mb-2 px-1 text-[11px] text-zinc-500">
                      {customRange?.from && customRange?.to
                        ? "Натисніть дату, щоб обрати новий початок"
                        : customRange?.from
                          ? "Тепер оберіть кінець періоду"
                          : "Оберіть початок, потім кінець періоду"}
                    </p>
                    <Calendar
                      mode="range"
                      numberOfMonths={1}
                      selected={customRange}
                      defaultMonth={customRange?.from ?? new Date()}
                      onSelect={(range, triggerDate) => {
                        setPeriod("Діапазон");
                        setCustomRange(
                          nextDateRangeSelection(
                            customRange,
                            range,
                            triggerDate
                          )
                        );
                      }}
                      locale={uk}
                    />
                    <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRange(undefined);
                          setPeriod("Сезон");
                          setRangeOpen(false);
                        }}
                        className="h-9 flex-1 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                      >
                        Скинути
                      </button>
                      <button
                        type="button"
                        disabled={!customRange?.from}
                        onClick={() => {
                          if (!customRange?.from) return;
                          if (!customRange.to) {
                            setCustomRange({
                              from: customRange.from,
                              to: customRange.from,
                            });
                          }
                          setPeriod("Діапазон");
                          setRangeOpen(false);
                        }}
                        className="h-9 flex-[1.4] rounded-xl bg-[#276749] text-xs font-bold text-white hover:bg-[#22543d] disabled:opacity-50"
                      >
                        Застосувати
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>

                {overviewLoading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                ) : null}
              </div>

              <div className="flex min-w-0 items-center gap-0.5 rounded-xl bg-[#EDE8DF] p-0.5">
                {FINANCE_QUICK_PERIODS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setPeriod(tab)}
                    className={cn(
                      "h-8 min-w-0 flex-1 rounded-[10px] px-2 text-xs font-semibold transition-all",
                      period === tab
                        ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                        : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
        {overviewError && !overview ? (
          <div
            className={cn(
              glassCardClass,
              "border-amber-500/30 bg-amber-50/80 p-5"
            )}
          >
            <p className="text-sm font-semibold text-amber-950">
              Не вдалося завантажити витрати
            </p>
            <p className="mt-1 text-xs text-amber-900/80">{overviewError}</p>
          </div>
        ) : null}

        {overviewInSync && overview.dataWarnings.length > 0 ? (
          <div
            className={cn(
              glassCardClass,
              "flex items-start gap-3 border-amber-300/50 bg-amber-50/70 p-4"
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-950">
                Частина джерел недоступна
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-amber-900/80">
                {overview.dataWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* 1. Hero KPI — виручка+витрати в ряд, результат під ними */}
        {(!isMobile || mobileTab === "overview") && (
        <section className="grid grid-cols-2 gap-2 sm:gap-2.5 md:gap-3">
          <button
            type="button"
            disabled={Boolean(basDataError && !localSalesUah) || (!basReady && overviewLoading)}
            onClick={() =>
              openDrill({
                kind: "revenue",
                title: "Виручка",
                subtitle: "З чого складається виручка за період",
                docType: "sale",
              })
            }
            className={cn(
              kpiGlassClass,
              "bg-gradient-to-br from-emerald-50/95 via-white/80 to-teal-50/70",
              "hover:border-emerald-300/50"
            )}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_top_left,rgba(52,211,153,0.38),transparent_58%)]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_bottom_right,rgba(45,212,191,0.22),transparent_55%)]"
              aria-hidden
            />
            <div className="relative">
              <p className={kpiLabelClass}>Виручка</p>
              {basDataError && !localSalesUah ? (
                <p className="text-xs text-amber-800 sm:text-sm">Дані недоступні</p>
              ) : !basReady && overviewLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <>
                  <AnimatedUah
                    value={revenueUah}
                    toneClassName={kpiGradientRevenue}
                  />
                  <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-emerald-800/60 sm:mt-1.5 sm:text-[11px]">
                    {basDataError
                      ? "лише продажі зі складу"
                      : revenueUah === 0
                        ? "Немає реалізацій"
                        : localSalesUah > 0
                          ? `Реал. ${formatHeroUah(basSalesUah)} · свої ${formatHeroUah(localSalesUah)}`
                          : `${basView?.docs.filter((d) => d.type === "sale").length ?? 0} реалізацій`}
                  </p>
                </>
              )}
            </div>
          </button>

          <button
            type="button"
            disabled={overviewLoading || !overview}
            onClick={() =>
              openDrill({
                kind: "expense",
                title: "Витрати",
                subtitle: "ТМЦ · паливо · ЗП · топ поля",
              })
            }
            className={cn(
              kpiGlassClass,
              "bg-gradient-to-br from-orange-50/95 via-white/80 to-rose-50/60",
              "hover:border-orange-300/50"
            )}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_top_right,rgba(251,146,60,0.4),transparent_58%)]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_at_bottom_left,rgba(251,113,133,0.18),transparent_55%)]"
              aria-hidden
            />
            <div className="relative">
              <p className={kpiLabelClass}>Витрати</p>
              {overviewLoading || !overview ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <>
                  <AnimatedUah
                    value={opsCostUah}
                    toneClassName={kpiGradientExpense}
                  />
                  <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-orange-900/55 sm:mt-1.5 sm:text-[11px]">
                    {opsCostUah <= 0
                      ? "Немає витрат"
                      : [
                          overview.inventorySpentUah > 0
                            ? `ТМЦ ${formatHeroUah(overview.inventorySpentUah)}`
                            : null,
                          overview.fuelCostUah > 0
                            ? `ДП ${formatHeroUah(overview.fuelCostUah)}`
                            : null,
                          overview.salaryUah > 0
                            ? `ЗП ${formatHeroUah(overview.salaryUah)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Деталі по кліку"}
                  </p>
                </>
              )}
            </div>
          </button>

          <button
            type="button"
            disabled={
              overviewLoading || !overview || (!basReady && !basDataError)
            }
            onClick={() =>
              openDrill({
                kind: "result",
                title: "Результат",
                subtitle: "P&L · виручка мінус операційні витрати",
              })
            }
            className={cn(
              kpiGlassClass,
              "col-span-2",
              pnlUah >= 0
                ? "bg-gradient-to-br from-teal-50/95 via-white/80 to-emerald-50/70 hover:border-teal-300/50"
                : "bg-gradient-to-br from-rose-50/95 via-white/80 to-orange-50/60 hover:border-rose-300/50"
            )}
          >
            <div
              className={cn(
                "pointer-events-none absolute inset-0 rounded-[inherit]",
                pnlUah >= 0
                  ? "bg-[radial-gradient(ellipse_at_top_right,rgba(45,212,191,0.38),transparent_58%)]"
                  : "bg-[radial-gradient(ellipse_at_top_right,rgba(251,113,133,0.38),transparent_58%)]"
              )}
              aria-hidden
            />
            <div className="relative flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className={kpiLabelClass}>Результат</p>
                {overviewLoading || !overview || (!basReady && !basDataError) ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <AnimatedUah
                    value={pnlUah}
                    showPlus
                    toneClassName={
                      pnlUah >= 0 ? kpiGradientRevenue : kpiGradientLoss
                    }
                  />
                )}
              </div>
              {!overviewLoading && overview && (basReady || basDataError) ? (
                <div className="min-w-[40%] flex-1 sm:min-w-[12rem]">
                  <BreakEvenBar revenue={revenueUah} expense={opsCostUah} />
                </div>
              ) : null}
            </div>
          </button>
        </section>
        )}

        {/* Smart Insights Strip */}
        {overview && (!isMobile || mobileTab === "overview") ? (
          <section
            className={cn(
              "overflow-hidden rounded-xl border border-white/60",
              "bg-gradient-to-r from-white/70 via-[#F4F1EA]/75 to-white/60",
              "p-1.5 shadow-[0_8px_30px_rgb(39,33,24,0.06)] backdrop-blur-2xl"
            )}
          >
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowUnplanned(true);
                  setShowBudgeted(false);
                  if (isMobile) {
                    setMobileTab("fields");
                    return;
                  }
                  window.setTimeout(() => {
                    document
                      .getElementById("finance-unplanned-fields")
                      ?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                  }, 50);
                }}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left",
                  "bg-white/55 transition hover:bg-white/80 active:scale-[0.99]",
                  "ring-1 ring-transparent hover:ring-rose-200/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    unplannedFields.length > 0
                      ? "bg-rose-500/10 text-rose-600"
                      : "bg-emerald-500/10 text-emerald-600"
                  )}
                >
                  <MapPinned size={14} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-bold tracking-[0.12em] text-zinc-400 uppercase">
                    Бюджети
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug font-semibold text-zinc-900 sm:text-xs">
                    {unplannedFields.length > 0
                      ? `${unplannedFields.length} без плану`
                      : "Усі з планом"}
                  </span>
                </span>
                {unplannedFields.length > 0 ? (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
                ) : null}
              </button>

              <Link
                href="/accounting"
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2",
                  "bg-white/55 transition hover:bg-white/80 active:scale-[0.99]",
                  "ring-1 ring-transparent hover:ring-amber-200/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    overview.draftMovesCount > 0
                      ? "bg-amber-500/10 text-amber-600"
                      : "bg-zinc-500/10 text-zinc-500"
                  )}
                >
                  <FileSpreadsheet size={14} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-bold tracking-[0.12em] text-zinc-400 uppercase">
                    Бухгалтерія
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] leading-snug font-semibold sm:text-xs",
                      overview.draftMovesCount > 0
                        ? "text-amber-800"
                        : "text-zinc-900"
                    )}
                  >
                    {overview.draftMovesCount > 0
                      ? `${overview.draftMovesCount} ${pluralDrafts(overview.draftMovesCount)}`
                      : "Немає чернеток"}
                  </span>
                </span>
              </Link>
            </div>
          </section>
        ) : null}

        {(overviewLoading || overview) &&
        (!isMobile || mobileTab === "overview") ? (
          <section className="mb-2 space-y-3 sm:mb-8 sm:space-y-4">
            {overviewLoading && !overviewInSync ? (
              <>
                <div
                  className={cn(
                    "flex min-h-[280px] flex-col rounded-3xl border border-white/10 bg-slate-900 p-5 text-white shadow-lg",
                    "dark:bg-zinc-950"
                  )}
                >
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold tracking-tight text-white">
                      Ризики й маржа одним поглядом
                    </h3>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />
                  </div>
                  <MidTierPulseSkeleton />
                </div>
                <div
                  className={cn(
                    "overflow-hidden rounded-2xl border border-white/50 bg-white/40 shadow-sm",
                    "backdrop-blur-2xl"
                  )}
                >
                  <div className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                    <div>
                      <p className="text-sm font-bold text-zinc-900">
                        Економіка культур
                      </p>
                      <p className="text-[11px] text-zinc-500">Витрати ₴/га</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
            {ownerPulse ? (
              <div
                className={cn(
                  "flex flex-col rounded-3xl border border-white/10 bg-slate-900 p-4 text-white shadow-lg sm:max-h-[560px] sm:p-5",
                  "dark:bg-zinc-950"
                )}
              >
                <div>
                  <h3 className="text-base font-bold tracking-tight text-white">
                    Ризики й маржа одним поглядом
                  </h3>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <MarginRadialGauge pct={ownerPulse.marginPct} size={112} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
                      <p className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
                        Факт до плану
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
                        {ownerPulse.burnRate != null
                          ? `${Math.round(ownerPulse.burnRate)}%`
                          : "—"}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                        {ownerPulse.burnComparesToSeasonPlan
                          ? "Скільки % сезонного бюджету вже витрачено"
                          : "% від сезонного плану (факт — лише за вибраний зріз)"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
                      <p className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
                        Факт / план
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] font-medium tabular-nums text-zinc-200">
                        {formatUah(ownerPulse.globalFactUah)} /{" "}
                        {ownerPulse.globalPlanUah > 0
                          ? `${formatUah(ownerPulse.globalPlanUah)} ₴`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/10">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Landmark size={12} />
                      <span className="text-[9px] font-bold tracking-wider uppercase">
                        ₴/га факт
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {formatUah(ownerPulse.costPerHa)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/10">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Wallet size={12} />
                      <span className="text-[9px] font-bold tracking-wider uppercase">
                        Площа
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {formatUah(ownerPulse.totalAreaHa)} га
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/10">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Fuel size={12} />
                      <span className="text-[9px] font-bold tracking-wider uppercase">
                        Паливо
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {formatUah(ownerPulse.fuelCostUah)} ₴
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/10">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <MapPinned size={12} />
                      <span className="text-[9px] font-bold tracking-wider uppercase">
                        Без плану
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 font-mono text-sm font-semibold tabular-nums",
                        ownerPulse.unplanned > 0
                          ? "text-amber-300"
                          : "text-emerald-300"
                      )}
                    >
                      {ownerPulse.unplanned}/{ownerPulse.fieldsCount}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex min-h-0 flex-1 flex-col">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-300">
                      <AlertTriangle size={13} className="text-amber-400" />
                      Зона уваги
                    </p>
                    {ownerPulse.risks.length > 0 ? (
                      <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                        {ownerPulse.risks.length}
                      </span>
                    ) : null}
                  </div>
                  {ownerPulse.risks.length === 0 ? (
                    <p className="rounded-xl bg-emerald-500/15 px-3 py-3 text-sm font-medium text-emerald-300">
                      Усі показники в нормі
                    </p>
                  ) : (
                    <ul className="no-scrollbar max-h-[min(40vh,280px)] space-y-2 overflow-y-auto overscroll-contain pr-0.5 sm:max-h-[220px]">
                      {ownerPulse.risks.map((risk) => (
                        <li key={risk.id}>
                          <button
                            type="button"
                            disabled={!risk.field && risk.id !== "drafts"}
                            onClick={() => {
                              if (risk.field) {
                                openFieldDetail(risk.field);
                                return;
                              }
                              if (risk.id === "drafts") {
                                window.location.href = "/accounting";
                              }
                            }}
                            className={cn(
                              "flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left",
                              "bg-white/10 transition hover:bg-white/15",
                              risk.tone === "danger" && "ring-1 ring-rose-400/20",
                              risk.tone === "warn" && "ring-1 ring-amber-400/15",
                              risk.tone === "info" && "ring-1 ring-sky-400/15"
                            )}
                          >
                            <AlertTriangle
                              className={cn(
                                "mt-0.5 h-3.5 w-3.5 shrink-0",
                                risk.tone === "danger" && "text-rose-400",
                                risk.tone === "warn" && "text-amber-400",
                                risk.tone === "info" && "text-sky-400"
                              )}
                            />
                            <span className="text-xs leading-snug text-zinc-100">
                              {risk.text}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}

            {cropEconomics.length > 0 ? (
              <div
                className={cn(
                  "overflow-hidden rounded-2xl border border-white/50 bg-white/50 shadow-sm",
                  "backdrop-blur-2xl dark:border-white/10 dark:bg-black/20"
                )}
              >
                <button
                  type="button"
                  onClick={() => setShowCrops((v) => !v)}
                  aria-expanded={showCrops}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-white/70 sm:px-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700">
                    <Wheat className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold tracking-tight text-zinc-900">
                      Економіка культур
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                      {cropEconomics.length} культур · витрати ₴/га
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
                      showCrops && "rotate-180"
                    )}
                  />
                </button>
                {showCrops ? (
                  <div className="border-t border-[#E5DFD3]/80 px-3 pb-3.5 pt-3 sm:px-4">
                    <ul>
                      {cropEconomics.map((row) => {
                        const maxSpent = Math.max(
                          ...cropEconomics.map((c) => c.spentUah),
                          1
                        );
                        const barPct =
                          row.spentUah > 0
                            ? Math.min(100, (row.spentUah / maxSpent) * 100)
                            : 0;
                        const Icon = cropGlyph(row.crop);
                        return (
                          <li
                            key={row.crop}
                            className={cn(
                              "mb-2.5 flex flex-col gap-2.5 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-3.5",
                              "bg-white/55 transition-transform sm:hover:scale-[1.01]",
                              "active:scale-[0.99] dark:bg-black/40 last:mb-0"
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                                <Icon size={16} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-zinc-900">
                                  {row.crop}
                                </p>
                                <p className="text-xs text-zinc-400">
                                  {formatUah(row.areaHa)} га · {row.fields}{" "}
                                  {pluralFields(row.fields)}
                                </p>
                              </div>
                              <p className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-zinc-900 sm:hidden">
                                {formatUah(row.spentUah)} ₴
                              </p>
                            </div>

                            <div className="w-full sm:w-32 sm:shrink-0">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                              <p className="mt-1 text-[10px] font-medium text-zinc-400">
                                {row.costPerHa > 0
                                  ? `${formatUah(row.costPerHa)} ₴/га`
                                  : "0 ₴/га"}
                              </p>
                            </div>

                            <p className="hidden shrink-0 text-right font-mono text-base font-medium tabular-nums text-zinc-900 sm:block">
                              {formatUah(row.spentUah)} ₴
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
              </>
            )}
          </section>
        ) : null}

        {overview &&
        !overviewLoading &&
        overview.fields.length === 0 &&
        isMobile &&
        mobileTab === "fields" ? (
          <div
            className={cn(
              glassCardClass,
              "px-4 py-10 text-center text-sm text-zinc-500"
            )}
          >
            Немає даних по полях за цей період
          </div>
        ) : null}

        {(overviewLoading || (overview && overview.fields.length > 0)) &&
        (!isMobile || mobileTab === "fields") ? (
          <section
            id="finance-field-budget"
            className="mt-2 sm:mt-8"
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold tracking-tight text-zinc-900">
                  Бюджет полів
                </h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {fieldsPeriodLabel}
                  {overviewLoading || !overviewInSync ? " · оновлення…" : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-medium text-zinc-500">
                {overviewLoading || !overviewInSync ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/40" />
                  &lt;80%
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/40" />
                  80–100%
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/40" />
                  &gt;100%
                </span>
              </div>
            </div>

            {!overview ? (
              <div
                className={cn(
                  glassCardClass,
                  "flex items-center justify-center gap-2 px-4 py-12 text-sm text-zinc-500"
                )}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Завантаження бюджету полів…
              </div>
            ) : (
              <div
                key={`fields-body-${isoRange.startIso}-${isoRange.endIso}`}
                className={cn(
                  (overviewLoading || !overviewInSync) &&
                    "pointer-events-none opacity-55"
                )}
              >
            <div
              className={cn(
                "mb-4 overflow-hidden rounded-2xl border border-[#E5DFD3]/80",
                "bg-gradient-to-br from-white/75 via-white/55 to-[#F4F1EA]/70",
                "shadow-[0_8px_28px_-12px_rgba(39,33,24,0.12)] backdrop-blur-md"
              )}
            >
              <div className="grid grid-cols-2 divide-x divide-y divide-[#E5DFD3]/70 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
                {(
                  [
                    {
                      key: "fields",
                      label: "Полів",
                      icon: MapPinned,
                      iconClass: "bg-[#276749]/10 text-[#276749]",
                      value: String(overview.fieldsCount),
                      valueClass: "text-zinc-900",
                    },
                    {
                      key: "fact",
                      label: "Факт",
                      icon: Wallet,
                      iconClass: "bg-sky-500/10 text-sky-700",
                      value: `${formatUah(overview.globalFactUah)} ₴`,
                      valueClass: "text-zinc-900",
                    },
                    {
                      key: "plan",
                      label: "План",
                      icon: Target,
                      iconClass: "bg-violet-500/10 text-violet-700",
                      value:
                        overview.globalPlanUah > 0
                          ? `${formatUah(overview.globalPlanUah)} ₴`
                          : "—",
                      valueClass: "text-zinc-900",
                    },
                    {
                      key: "burn",
                      label: overview.burnComparesToSeasonPlan
                        ? "Від плану"
                        : "% сез. плану",
                      icon: Percent,
                      iconClass:
                        burn == null
                          ? "bg-zinc-500/10 text-zinc-500"
                          : burn > 100
                            ? "bg-rose-500/10 text-rose-600"
                            : burn >= 80
                              ? "bg-amber-500/10 text-amber-700"
                              : "bg-emerald-500/10 text-emerald-700",
                      value: burn != null ? `${Math.round(burn)}%` : "—",
                      valueClass:
                        burn != null ? tone.label : "text-zinc-400",
                    },
                    {
                      key: "diesel",
                      label: "ДП",
                      icon: Fuel,
                      iconClass: "bg-amber-500/10 text-amber-700",
                      value: overview.dieselPriceUah
                        ? `${formatUah(overview.dieselPriceUah)} ₴/л`
                        : "—",
                      valueClass: "text-zinc-900",
                      span: true,
                    },
                  ] as const
                ).map((cell) => {
                  const Icon = cell.icon;
                  return (
                    <div
                      key={cell.key}
                      className={cn(
                        "flex items-start gap-2.5 px-3.5 py-3.5 sm:px-4",
                        "span" in cell &&
                          cell.span &&
                          "col-span-2 sm:col-span-1 lg:col-span-1"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                          cell.iconClass
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold tracking-wider text-zinc-400 uppercase">
                          {cell.label}
                        </p>
                        <p
                          className={cn(
                            "mt-1 font-mono text-sm font-semibold tabular-nums sm:text-base",
                            cell.valueClass
                          )}
                        >
                          {cell.value}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              {budgetedFields.length > 0 ? (
                <div
                  id="finance-budgeted-fields"
                  className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white/50 shadow-sm backdrop-blur-md"
                >
                  <button
                    type="button"
                    onClick={() => setShowBudgeted((v) => !v)}
                    aria-expanded={showBudgeted}
                    className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left transition hover:bg-white/70 sm:px-4"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold tracking-tight text-zinc-900">
                        З планом
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        {budgetedFields.length}{" "}
                        {pluralFields(budgetedFields.length)}
                        {" · "}
                        факт {formatUah(budgetedTotals.fact)} ₴
                        {budgetedTotals.plan > 0
                          ? ` · план ${formatUah(budgetedTotals.plan)} ₴`
                          : ""}
                        {burn != null ? ` · ${Math.round(burn)}%` : ""}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
                        showBudgeted && "rotate-180"
                      )}
                    />
                  </button>
                  {showBudgeted ? (
                    <div className="border-t border-[#E5DFD3]/80 px-3 pb-3.5 pt-3 sm:px-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {budgetedFields.map((field) => (
                          <FieldBudgetCard
                            key={field.fieldId}
                            field={field}
                            onOpen={() => openFieldDetail(field)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {unplannedFields.length > 0 ? (
                <div
                  id="finance-unplanned-fields"
                  className="scroll-mt-28 overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white/50 shadow-sm backdrop-blur-md"
                >
                  <button
                    type="button"
                    onClick={() => setShowUnplanned((v) => !v)}
                    aria-expanded={showUnplanned}
                    className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left transition hover:bg-white/70 sm:px-4"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600">
                      <MapPinned className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold tracking-tight text-zinc-900">
                        Без плану
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        {unplannedFields.length}{" "}
                        {pluralFields(unplannedFields.length)} без ₴/га
                        {" · "}
                        факт{" "}
                        {formatUah(
                          unplannedFields.reduce((s, f) => s + f.spentUah, 0)
                        )}{" "}
                        ₴
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
                        showUnplanned && "rotate-180"
                      )}
                    />
                  </button>
                  {showUnplanned ? (
                    <div className="border-t border-[#E5DFD3]/80 px-3 pb-3.5 pt-3 sm:px-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {unplannedFields.map((field) => (
                          <FieldBudgetCard
                            key={field.fieldId}
                            field={field}
                            onOpen={() => openFieldDetail(field)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
              </div>
            )}
          </section>
        ) : null}

        {basView &&
        (basView.topBuyers.length > 0 || basView.topSuppliers.length > 0) &&
        (!isMobile || mobileTab === "overview") ? (
          <section
            id="finance-counterparties"
            className={cn(
              "grid grid-cols-1 gap-4",
              basView.topBuyers.length > 0 &&
                basView.topSuppliers.length > 0 &&
                "md:grid-cols-2"
            )}
          >
            {basView.topBuyers.length > 0 ? (
              <CounterpartyList
                title="Топ покупці"
                subtitle="Клік → операції реалізації"
                items={basView.topBuyers}
                onSelect={(name) =>
                  openDrill({
                    kind: "counterparty",
                    title: name,
                    subtitle: "Реалізації з цим покупцем за період",
                    counterparty: name,
                    docType: "sale",
                  })
                }
              />
            ) : null}
            {basView.topSuppliers.length > 0 ? (
              <CounterpartyList
                title="Топ постачальники"
                subtitle="Клік → операції надходження"
                items={basView.topSuppliers}
                onSelect={(name) =>
                  openDrill({
                    kind: "counterparty",
                    title: name,
                    subtitle: "Надходження від цього постачальника",
                    counterparty: name,
                    docType: "receipt",
                  })
                }
              />
            ) : null}
          </section>
        ) : null}

        {(!isMobile || mobileTab === "flow") ? (
          <div className="space-y-4">
            {basLoading ||
            overviewLoading ||
            !overviewInSync ||
            (!basReady && !basDataError) ? (
              <DynamicsPremiumSkeleton periodLabel={fieldsPeriodLabel} />
            ) : (
              <>
            {hasAnatomy ? (
              <section>
                <FinanceExpenseAnatomy slices={anatomySlices} />
              </section>
            ) : null}

            {basDataError ? (
              <div
                className={cn(
                  glassCardClass,
                  "border-amber-300/60 bg-amber-50/70 p-5"
                )}
              >
                <p className="text-sm font-semibold text-amber-950">
                  Не вдалося завантажити динаміку
                </p>
                <p className="mt-1 text-xs text-amber-900/80">{basDataError}</p>
              </div>
            ) : null}

            {!basDataError &&
            basView &&
            (basView.docs.length > 0 ||
              basView.monthly.some((m) => m.sales > 0 || m.receipts > 0)) ? (
              <FinanceCashflowChart
                docs={basView.docs}
                monthly={basView.monthly}
                startIso={isoRange.startIso}
                endIso={isoRange.endIso}
                onPeriodClick={(point) =>
                  openDrill({
                    kind: "period",
                    title: point.label,
                    subtitle: "Документи за обраний період",
                    periodKey: point.key,
                    docType: "all",
                  })
                }
              />
            ) : null}

            {!basDataError &&
            !hasAnatomy &&
            !(
              basView &&
              (basView.docs.length > 0 ||
                basView.monthly.some((m) => m.sales > 0 || m.receipts > 0))
            ) ? (
              <div
                className={cn(
                  glassCardClass,
                  "flex flex-col items-center px-5 py-12 text-center"
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#276749]/10 text-[#276749]">
                  <TrendingUp className="h-5 w-5" strokeWidth={2} />
                </span>
                <p className="mt-4 text-sm font-bold text-zinc-900">
                  Немає динаміки за період
                </p>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                  Коли з’являться реалізації, надходження або розбивка витрат —
                  тут буде графік і анатомія витрат.
                </p>
              </div>
            ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <FinanceDrillSheet
        open={drillOpen}
        onOpenChange={(open) => {
          setDrillOpen(open);
          if (!open) setDrillTarget(null);
        }}
        target={drillTarget}
        docs={basView?.docs ?? []}
        localSalesUah={localSalesUah}
        localInboundUah={overview?.localInboundUah ?? 0}
        revenueUah={revenueUah}
        opsCostUah={opsCostUah}
        inventorySpentUah={overview?.inventorySpentUah ?? 0}
        fuelCostUah={overview?.fuelCostUah ?? 0}
        salaryUah={overview?.salaryUah ?? 0}
        fields={overview?.fields ?? []}
        onOpenField={(field) => {
          setDrillOpen(false);
          openFieldDetail(field);
        }}
      />

      <FieldDetailSheet
        key={detailRow?.fieldId ?? "closed"}
        variant="sheet"
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailRow(null);
        }}
        field={detailSheetField}
        fieldKey={detailRow ? `farm:${detailRow.fieldId}` : null}
        farmFieldId={detailRow?.fieldId ?? null}
        fieldGeometry={detailFarm?.geometry ?? null}
        fieldColor={detailFarm?.color ?? null}
        mapSource="saved"
        initialTab="history"
        passportMode="edit"
        passportName={detailSheetField?.name ?? ""}
        passportCrop={detailSheetField?.crop ?? ""}
        passportAreaHa={detailSheetField?.areaHa ?? 0}
        passportColor={detailFarm?.color ?? "#276749"}
        wialonZoneId={detailFarm?.wialonZoneId ?? null}
        canDeleteField={false}
      />
    </main>
  );
}

function MidTierPulseSkeleton() {
  return (
    <div className="mt-2 flex flex-1 flex-col gap-4" aria-hidden>
      <div className="flex items-center gap-4">
        <div className="h-[112px] w-[112px] shrink-0 animate-pulse rounded-full bg-white/10" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-[72px] animate-pulse rounded-xl bg-white/10" />
          <div className="h-[52px] animate-pulse rounded-xl bg-white/10" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[58px] animate-pulse rounded-xl bg-white/10"
          />
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-white/15" />
        <div className="h-12 animate-pulse rounded-xl bg-white/10" />
        <div className="h-12 animate-pulse rounded-xl bg-white/10" />
      </div>
    </div>
  );
}

/** Преміальний лоадер вкладки «Динаміка» при зміні періоду */
function DynamicsPremiumSkeleton({ periodLabel }: { periodLabel: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div
        className={cn(
          glassCardClass,
          "relative overflow-hidden p-5 sm:p-6"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/50 to-transparent"
        />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.14em] text-zinc-400 uppercase">
              Динаміка
            </p>
            <h3 className="mt-1 text-sm font-bold tracking-tight text-zinc-900">
              Оновлюємо зріз
            </h3>
            <p className="mt-1 text-xs text-zinc-500">{periodLabel}</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
          </span>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-2">
          {["Реалізації", "Надходження", "Кумулятив"].map((label) => (
            <div
              key={label}
              className="rounded-2xl border border-[#E5DFD3]/70 bg-white/55 px-3 py-3"
            >
              <p className="text-[9px] font-bold tracking-wider text-zinc-400 uppercase">
                {label}
              </p>
              <div className="mt-2 h-5 w-16 animate-pulse rounded-md bg-zinc-200/80" />
            </div>
          ))}
        </div>

        <div className="relative mt-5 flex h-[180px] items-end gap-1.5 rounded-2xl border border-[#E5DFD3]/60 bg-gradient-to-b from-white/40 to-[#EDE8DF]/50 px-3 pb-3 pt-6 sm:h-[220px]">
          {[42, 68, 35, 82, 55, 74, 48, 90, 62, 78, 44, 70].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-md bg-[#276749]/15"
              style={{
                height: `${h}%`,
                animation: `pulse 1.6s ease-in-out ${i * 0.07}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      <div
        className={cn(
          glassCardClass,
          "relative overflow-hidden p-5 sm:p-6"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/45 to-transparent [animation-delay:0.35s]"
        />
        <div className="relative mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-zinc-900">
              Анатомія витрат
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Збираємо розбивку за період…
            </p>
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="relative h-[160px] w-[160px] shrink-0 sm:h-[200px] sm:w-[200px]">
            <div className="absolute inset-0 animate-pulse rounded-full border-[18px] border-[#E5DFD3]/80" />
            <div className="absolute inset-[28%] animate-pulse rounded-full bg-white/70" />
          </div>
          <div className="w-full flex-1 space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-[#E5DFD3]/70 bg-white/50 px-3 py-2.5"
              >
                <div
                  className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-zinc-300"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
                <div className="h-3 flex-1 animate-pulse rounded bg-zinc-200/90" />
                <div className="h-3 w-12 animate-pulse rounded bg-zinc-200/70" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function cropGlyph(crop: string) {
  const c = crop.toLowerCase();
  if (
    c.includes("соняш") ||
    c.includes("sunflower") ||
    c.includes("ріпак") ||
    c.includes("рапс")
  ) {
    return Sun;
  }
  if (
    c.includes("пшен") ||
    c.includes("ячм") ||
    c.includes("жит") ||
    c.includes("овес") ||
    c.includes("wheat") ||
    c.includes("зерн")
  ) {
    return Wheat;
  }
  return Leaf;
}

function MarginRadialGauge({
  pct,
  size = 148,
}: {
  pct: number | null;
  size?: number;
}) {
  const stroke = size < 130 ? 8 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe =
    pct == null ? 0 : Math.max(0, Math.min(100, Math.abs(pct)));
  const offset = c - (safe / 100) * c;
  const positive = (pct ?? 0) >= 0;
  const strokeColor = pct == null ? "#52525b" : positive ? "#34d399" : "#fb7185";
  const label =
    pct == null ? "—" : `${pct > 0 ? "" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "font-semibold tracking-tighter tabular-nums",
            size < 130 ? "text-xl" : "text-3xl",
            pct == null
              ? "text-zinc-400"
              : positive
                ? "text-emerald-400"
                : "text-rose-400"
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 text-[9px] font-medium tracking-wider text-zinc-500 uppercase">
          Маржа
        </span>
      </div>
    </div>
  );
}

function FieldBudgetCard({
  field,
  onOpen,
}: {
  field: CompanyFieldBurnRow;
  onOpen: () => void;
}) {
  const tone = fieldBudgetTone(field.burnRate);
  const plan = field.budgetUah;
  const spent = field.spentUah;
  const barPct =
    plan != null && plan > 0
      ? Math.min(100, Math.max(0, (spent / plan) * 100))
      : field.burnRate != null
        ? Math.min(100, Math.max(0, field.burnRate))
        : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-2xl border p-4 text-left shadow-sm sm:p-5",
        "backdrop-blur-md transition-all active:scale-[0.99]",
        "outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15",
        tone.card
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {field.name}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {field.crop && field.crop !== "—" ? field.crop : "Без культури"}
            {field.areaHa > 0 ? ` · ${field.areaHa} га` : ""}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-6 rounded-full px-2.5 font-mono text-[11px] font-medium tabular-nums",
            tone.badge
          )}
        >
          {field.burnRate != null ? `${Math.round(field.burnRate)}%` : "—"}
        </Badge>
      </div>

      <div className="mt-4 mb-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/5">
        <div
          className={cn("h-full rounded-full transition-all duration-500", tone.bar)}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <p className="font-mono text-[11px] text-zinc-500 tabular-nums">
        {formatUah(spent)} ₴
        <span className="text-zinc-300"> / </span>
        {plan != null ? `${formatUah(plan)} ₴` : "—"}
      </p>
      {plan == null ? (
        <p className="mt-1 text-[11px] text-zinc-400">
          Плановий бюджет ₴/га не заданий
        </p>
      ) : null}
    </button>
  );
}

function CounterpartyList({
  title,
  subtitle,
  items,
  onSelect,
}: {
  title: string;
  subtitle: string;
  items: { name: string; total: number }[];
  onSelect?: (name: string) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/50 bg-white/40 p-4 sm:p-6",
        "backdrop-blur-xl dark:border-white/10 dark:bg-black/20"
      )}
    >
      <h3 className="text-sm font-bold tracking-tight text-zinc-900">{title}</h3>
      <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          Немає даних за період
        </p>
      ) : (
        <ul className="mt-3">
          {items.slice(0, 8).map((item) => (
            <li
              key={item.name}
              className="border-b border-border/30 last:border-0"
            >
              <button
                type="button"
                onClick={() => onSelect?.(item.name)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left transition active:scale-[0.99] hover:opacity-80"
              >
                <div className="flex min-w-0 items-center">
                  <div className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-black/40">
                    <Building2
                      className="text-muted-foreground"
                      size={14}
                    />
                  </div>
                  <p className="truncate text-sm font-medium text-zinc-800">
                    {item.name || "—"}
                  </p>
                </div>
                <p className="shrink-0 text-right font-mono text-sm font-medium tabular-nums text-zinc-900">
                  {formatUah(item.total)} ₴
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

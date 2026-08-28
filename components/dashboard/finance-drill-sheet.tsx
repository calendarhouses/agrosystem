"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { uk } from "date-fns/locale";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  Equal,
  ExternalLink,
  FileText,
  Fuel,
  Loader2,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CompanyFieldBurnRow } from "@/lib/company-finance";
import type { DocRow } from "@/lib/inventory-bas";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatUaDate(iso: string): string {
  try {
    return format(parseISO(iso.slice(0, 10)), "d MMM yyyy", { locale: uk });
  } catch {
    return iso.slice(0, 10);
  }
}

type DocLine = {
  name?: string;
  qty?: number;
  unit?: string;
  sum?: number;
  amount?: number;
  price?: number;
};

export type FinanceDrillKind =
  | "revenue"
  | "expense"
  | "result"
  | "counterparty"
  | "period";

export type FinanceDrillTarget = {
  kind: FinanceDrillKind;
  title: string;
  subtitle?: string;
  /** sale | receipt | all */
  docType?: "sale" | "receipt" | "all";
  counterparty?: string;
  /** ISO day YYYY-MM-DD or month YYYY-MM */
  periodKey?: string;
};

export function FinanceDrillSheet({
  open,
  onOpenChange,
  target,
  docs,
  localSalesUah,
  localInboundUah,
  revenueUah,
  opsCostUah,
  inventorySpentUah,
  fuelCostUah,
  salaryUah,
  fields,
  onOpenField,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: FinanceDrillTarget | null;
  docs: DocRow[];
  localSalesUah: number;
  localInboundUah: number;
  revenueUah: number;
  opsCostUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
  fields: CompanyFieldBurnRow[];
  onOpenField?: (field: CompanyFieldBurnRow) => void;
}) {
  const filteredDocs = useMemo(() => {
    if (!target) return [];
    let list = [...docs];

    if (target.kind === "revenue") {
      list = list.filter((d) => d.type === "sale");
    } else if (target.docType === "sale") {
      list = list.filter((d) => d.type === "sale");
    } else if (target.docType === "receipt") {
      list = list.filter((d) => d.type === "receipt");
    }

    if (target.counterparty) {
      const name = target.counterparty.toLowerCase();
      list = list.filter(
        (d) => (d.counterparty || "").toLowerCase() === name
      );
    }

    if (target.periodKey) {
      const key = target.periodKey;
      list = list.filter((d) => {
        const day = d.date.slice(0, 10);
        if (key.length === 7) return day.startsWith(key);
        return day === key;
      });
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [docs, target]);

  const docsTotal = filteredDocs.reduce((s, d) => s + d.amount, 0);

  const topFields = useMemo(
    () =>
      [...fields]
        .filter((f) => f.spentUah > 0)
        .sort((a, b) => b.spentUah - a.spentUah)
        .slice(0, 12),
    [fields]
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const reset = () => {
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    };
    reset();
    const raf = window.requestAnimationFrame(reset);
    const t = window.setTimeout(reset, 50);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [open, target?.kind, target?.title, target?.periodKey, target?.counterparty]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        initialFocus={focusRef}
        className={cn(
          "gap-0 overflow-hidden border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900",
          "sm:max-w-lg"
        )}
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-[#E5DFD3]/80 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] px-6 py-5 pr-14 text-left">
          <div
            ref={focusRef}
            tabIndex={-1}
            className="outline-none"
          >
            <SheetTitle className="text-lg font-bold tracking-tight">
              {target?.title ?? "Деталі"}
            </SheetTitle>
            {target?.subtitle ? (
              <SheetDescription className="text-xs text-zinc-500">
                {target.subtitle}
              </SheetDescription>
            ) : null}
          </div>
        </SheetHeader>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
        >
          {target?.kind === "revenue" ? (
            <RevenuePanel
              key={`rev-${target.title}`}
              basSales={docsTotal}
              localSalesUah={localSalesUah}
              revenueUah={revenueUah}
              docs={filteredDocs}
            />
          ) : null}

          {target?.kind === "expense" ? (
            <ExpensePanel
              opsCostUah={opsCostUah}
              inventorySpentUah={inventorySpentUah}
              fuelCostUah={fuelCostUah}
              salaryUah={salaryUah}
              localInboundUah={localInboundUah}
              topFields={topFields}
              onOpenField={onOpenField}
            />
          ) : null}

          {target?.kind === "result" ? (
            <ResultPanel
              revenueUah={revenueUah}
              opsCostUah={opsCostUah}
              inventorySpentUah={inventorySpentUah}
              fuelCostUah={fuelCostUah}
              salaryUah={salaryUah}
            />
          ) : null}

          {target?.kind === "counterparty" || target?.kind === "period" ? (
            <DocsPanel
              docs={filteredDocs}
              total={docsTotal}
              emptyHint={
                target.kind === "period"
                  ? "Немає документів за цю дату"
                  : "Немає операцій з цим контрагентом за період"
              }
            />
          ) : null}

          {target?.kind === "revenue" ? (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                Документи реалізації
              </p>
              <DocsPanel
                docs={filteredDocs}
                total={docsTotal}
                emptyHint="Немає реалізацій за період"
                compact
              />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RevenuePanel({
  basSales,
  localSalesUah,
  revenueUah,
  docs,
}: {
  basSales: number;
  localSalesUah: number;
  revenueUah: number;
  docs: DocRow[];
}) {
  const buyers = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of docs) {
      const name = d.counterparty || "—";
      map.set(name, (map.get(name) ?? 0) + d.amount);
    }
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [docs]);

  const slices = [
    {
      key: "bas",
      label: "Реалізації",
      hint: "Документи продажу з BAS",
      value: basSales,
      icon: ShoppingBag,
      color: "text-emerald-700 bg-emerald-500/10",
      bar: "bg-emerald-400/80",
      plain: false,
    },
    {
      key: "local",
      label: "Продажі зі складу",
      hint: "Ще не передані бухгалтеру",
      value: localSalesUah,
      icon: ArrowUpRight,
      color: "text-sky-700 bg-sky-500/10",
      bar: "bg-sky-400/80",
      plain: false,
    },
    {
      key: "docs",
      label: "Документів",
      hint: "Кількість реалізацій за період",
      value: docs.length,
      icon: FileText,
      color: "text-zinc-600 bg-zinc-500/10",
      bar: "bg-zinc-400/70",
      plain: true,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-emerald-500/20",
          "bg-gradient-to-br from-emerald-500/10 via-white/60 to-white/40 p-4",
          "shadow-[0_12px_40px_rgb(39,33,24,0.06)] backdrop-blur-md"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-emerald-400/25 blur-2xl"
        />
        <p className="relative text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
          Разом
        </p>
        <p className="relative mt-1 text-3xl font-light tracking-tight text-[#276749] tabular-nums">
          {formatUah(revenueUah)}{" "}
          <span className="text-lg text-zinc-400">₴</span>
        </p>
      </div>

      <ul className="space-y-2">
        {slices.map((s) => {
          const Icon = s.icon;
          const pct =
            !s.plain && revenueUah > 0
              ? Math.round((s.value / revenueUah) * 100)
              : null;
          return (
            <li
              key={s.key}
              className={cn(
                "rounded-2xl border border-[#E5DFD3]/60 bg-white/55 px-3.5 py-3",
                "shadow-sm backdrop-blur-md"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      s.color
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-800">
                      {s.label}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {pct != null ? `${pct}% виручки · ${s.hint}` : s.hint}
                    </p>
                  </div>
                </div>
                <p
                  className={cn(
                    "shrink-0 font-mono text-sm font-semibold tabular-nums",
                    s.plain ? "text-zinc-700" : "text-zinc-900"
                  )}
                >
                  {s.plain ? s.value : `${formatUah(s.value)} ₴`}
                </p>
              </div>
              {pct != null ? (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#E5DFD3]/80">
                  <div
                    className={cn("h-full rounded-full", s.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {buyers.length > 0 ? (
        <div
          className={cn(
            "overflow-hidden rounded-2xl border border-[#E5DFD3]/60",
            "bg-white/55 shadow-sm backdrop-blur-md"
          )}
        >
          <p className="border-b border-[#E5DFD3]/60 px-3.5 py-2.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            Топ покупці в цій виручці
          </p>
          <ul className="divide-y divide-[#E5DFD3]/50">
            {buyers.map((b, i) => (
              <li
                key={b.name}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#276749]/10 text-[10px] font-bold text-[#276749]">
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-zinc-800">
                    {b.name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-zinc-900">
                  {formatUah(b.total)} ₴
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ExpensePanel({
  opsCostUah,
  inventorySpentUah,
  fuelCostUah,
  salaryUah,
  localInboundUah,
  topFields,
  onOpenField,
}: {
  opsCostUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
  localInboundUah: number;
  topFields: CompanyFieldBurnRow[];
  onOpenField?: (field: CompanyFieldBurnRow) => void;
}) {
  const slices = [
    {
      key: "inv",
      label: "ТМЦ / списання",
      value: inventorySpentUah,
      icon: Package,
      color: "text-emerald-700 bg-emerald-500/10",
    },
    {
      key: "fuel",
      label: "Паливо (ДП)",
      value: fuelCostUah,
      icon: Fuel,
      color: "text-orange-700 bg-orange-500/10",
    },
    {
      key: "salary",
      label: "Зарплата",
      value: salaryUah,
      icon: Wallet,
      color: "text-sky-700 bg-sky-500/10",
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E5DFD3]/80 bg-white/50 p-4 backdrop-blur-md">
        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
          Операційні витрати
        </p>
        <p className="mt-1 text-3xl font-light tracking-tight text-orange-600 tabular-nums">
          {formatUah(opsCostUah)}{" "}
          <span className="text-lg text-zinc-400">₴</span>
        </p>
        {localInboundUah > 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500">
            Локальні закупки (окремо): {formatUah(localInboundUah)} ₴
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {slices.map((s) => {
          const Icon = s.icon;
          const pct =
            opsCostUah > 0 ? Math.round((s.value / opsCostUah) * 100) : 0;
          return (
            <li
              key={s.key}
              className="rounded-2xl border border-[#E5DFD3]/60 bg-white/40 px-3.5 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full",
                      s.color
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{s.label}</p>
                    <p className="text-[11px] text-zinc-400">{pct}% від витрат</p>
                  </div>
                </div>
                <p className="font-mono text-sm font-medium tabular-nums text-zinc-900">
                  {formatUah(s.value)} ₴
                </p>
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#E5DFD3]/80">
                <div
                  className="h-full rounded-full bg-orange-400/80"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {topFields.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            Поля з найбільшими витратами
          </p>
          <ul className="space-y-1">
            {topFields.map((f) => (
              <li key={f.fieldId}>
                <button
                  type="button"
                  onClick={() => onOpenField?.(f)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-800">
                      {f.name}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {f.crop && f.crop !== "—" ? f.crop : "Без культури"}
                      {f.burnRate != null
                        ? ` · ${Math.round(f.burnRate)}% плану`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-zinc-900">
                    {formatUah(f.spentUah)} ₴
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResultPanel({
  revenueUah,
  opsCostUah,
  inventorySpentUah,
  fuelCostUah,
  salaryUah,
}: {
  revenueUah: number;
  opsCostUah: number;
  inventorySpentUah: number;
  fuelCostUah: number;
  salaryUah: number;
}) {
  const pnl = revenueUah - opsCostUah;
  const margin =
    revenueUah > 0
      ? Math.round(((revenueUah - opsCostUah) / revenueUah) * 100)
      : null;

  const slices = [
    {
      key: "rev",
      label: "Виручка",
      hint: "Усі продажі за період",
      value: revenueUah,
      icon: TrendingUp,
      color: "text-emerald-700 bg-emerald-500/10",
      valueClass: "text-emerald-700",
      sign: "" as const,
    },
    {
      key: "inv",
      label: "ТМЦ",
      hint: "Списання зі складу",
      value: inventorySpentUah,
      icon: Package,
      color: "text-emerald-700 bg-emerald-500/10",
      valueClass: "text-orange-700",
      sign: "−" as const,
    },
    {
      key: "fuel",
      label: "Паливо",
      hint: "ДП по полях і нарядах",
      value: fuelCostUah,
      icon: Fuel,
      color: "text-orange-700 bg-orange-500/10",
      valueClass: "text-orange-700",
      sign: "−" as const,
    },
    {
      key: "salary",
      label: "Зарплата",
      hint: "Оплата по операціях",
      value: salaryUah,
      icon: Wallet,
      color: "text-sky-700 bg-sky-500/10",
      valueClass: "text-orange-700",
      sign: "−" as const,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-4 backdrop-blur-md",
          "shadow-[0_12px_40px_rgb(39,33,24,0.06)]",
          pnl >= 0
            ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-white/60 to-white/40"
            : "border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-white/60 to-white/40"
        )}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl",
            pnl >= 0 ? "bg-emerald-400/25" : "bg-rose-400/25"
          )}
        />
        <p className="relative text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
          Фінансовий результат
        </p>
        <p
          className={cn(
            "relative mt-1 text-3xl font-light tracking-tight tabular-nums",
            pnl >= 0 ? "text-emerald-700" : "text-rose-700"
          )}
        >
          {pnl > 0 ? "+" : ""}
          {formatUah(pnl)} <span className="text-lg text-zinc-400">₴</span>
        </p>
        <p className="relative mt-2 text-xs text-zinc-500">
          {margin != null
            ? `Маржа ${margin}% від виручки`
            : "Немає виручки для розрахунку маржі"}
        </p>
      </div>

      <ul className="space-y-2">
        {slices.map((s) => {
          const Icon = s.icon;
          const share =
            opsCostUah > 0 && s.sign === "−"
              ? Math.round((s.value / opsCostUah) * 100)
              : revenueUah > 0 && s.sign === ""
                ? 100
                : null;
          return (
            <li
              key={s.key}
              className={cn(
                "rounded-2xl border border-[#E5DFD3]/60 bg-white/55 px-3.5 py-3",
                "shadow-sm backdrop-blur-md"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      s.color
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-800">
                      {s.sign ? `${s.sign} ${s.label}` : s.label}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {share != null && s.sign === "−"
                        ? `${share}% витрат · ${s.hint}`
                        : s.hint}
                    </p>
                  </div>
                </div>
                <p
                  className={cn(
                    "shrink-0 font-mono text-sm font-semibold tabular-nums",
                    s.valueClass
                  )}
                >
                  {formatUah(s.value)} ₴
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3.5",
          "shadow-sm backdrop-blur-md",
          pnl >= 0
            ? "border-emerald-500/25 bg-emerald-500/8"
            : "border-rose-500/25 bg-rose-500/8"
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full",
              pnl >= 0
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-rose-500/15 text-rose-700"
            )}
          >
            <Equal className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-800">Результат</p>
            <p className="text-[11px] text-zinc-400">Виручка − операційні витрати</p>
          </div>
        </div>
        <p
          className={cn(
            "font-mono text-base font-bold tabular-nums",
            pnl >= 0 ? "text-emerald-700" : "text-rose-700"
          )}
        >
          {pnl > 0 ? "+" : ""}
          {formatUah(pnl)} ₴
        </p>
      </div>
    </div>
  );
}

function DocsPanel({
  docs,
  total,
  emptyHint,
  compact = false,
}: {
  docs: DocRow[];
  total: number;
  emptyHint: string;
  compact?: boolean;
}) {
  if (docs.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-zinc-400">{emptyHint}</p>
    );
  }

  return (
    <div className="space-y-2">
      {!compact ? (
        <div className="mb-3 flex items-baseline justify-between gap-2 rounded-2xl border border-[#E5DFD3]/80 bg-white/50 px-4 py-3">
          <span className="text-xs text-zinc-500">
            {docs.length} док.
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
            {formatUah(total)} ₴
          </span>
        </div>
      ) : null}
      {docs.map((doc) => (
        <FinanceDocRow key={`${doc.type}-${doc.refKey}`} doc={doc} />
      ))}
    </div>
  );
}

function FinanceDocRow({ doc }: { doc: DocRow }) {
  const isReceipt = doc.type === "receipt";
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DocLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const printHtmlHref = `/api/inventory/document/print?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}&format=html`;
  const printPdfHref = `/api/inventory/document/print?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}`;

  function openDocumentInNewTab() {
    if (!doc.refKey) return;
    window.open(printHtmlHref, "_blank", "noopener,noreferrer");
  }

  async function loadLines() {
    if (inFlightRef.current || !doc.refKey) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    const timeoutId = window.setTimeout(() => ac.abort(), 45_000);
    try {
      const res = await fetch(
        `/api/inventory/document?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}`,
        { signal: ac.signal }
      );
      const data = (await res.json()) as {
        lines?: DocLine[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error || "Не вдалося завантажити рядки");
        setLines([]);
      } else {
        setLines(data.lines ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Таймаут завантаження рядків");
      } else {
        setError("Мережева помилка");
      }
      setLines([]);
    } finally {
      window.clearTimeout(timeoutId);
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  function toggleExpand() {
    if (open) {
      abortRef.current?.abort();
      setOpen(false);
      return;
    }
    setOpen(true);
    if (lines === null) {
      void loadLines();
    }
  }

  function retry() {
    setLines(null);
    setError(null);
    void loadLines();
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5DFD3]/70 bg-white/45">
      <div className="flex w-full items-stretch">
        <button
          type="button"
          onClick={openDocumentInNewTab}
          disabled={!doc.refKey}
          className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-60"
          title="Відкрити документ"
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
              isReceipt
                ? "bg-sky-500/10 text-sky-700"
                : "bg-emerald-500/10 text-emerald-700"
            )}
          >
            {isReceipt ? (
              <ArrowDownLeft className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {doc.counterparty || "—"}
              </p>
              <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-zinc-900">
                {formatUah(doc.amount)} ₴
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
              <span>{formatUaDate(doc.date)}</span>
              <span>·</span>
              <span>№{doc.number}</span>
              <Badge
                variant="outline"
                className={cn(
                  "h-4 border px-1.5 text-[9px]",
                  isReceipt
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                )}
              >
                {isReceipt ? "Надходження" : "Реалізація"}
              </Badge>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={toggleExpand}
          className="flex w-11 shrink-0 items-center justify-center border-l border-[#E5DFD3]/60 text-zinc-400 transition hover:bg-white/50 hover:text-zinc-700"
          aria-label={open ? "Згорнути рядки" : "Показати рядки"}
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition",
              open && "rotate-180"
            )}
          />
        </button>
      </div>

      {open ? (
        <div className="border-t border-[#E5DFD3]/60 bg-[#FAF8F4]/80 px-3.5 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Рядки документа…
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-amber-700">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="shrink-0 text-[11px] font-semibold text-zinc-600 underline-offset-2 hover:underline"
              >
                Повторити
              </button>
            </div>
          ) : !lines?.length ? (
            <p className="text-xs text-zinc-400">Порожній документ</p>
          ) : (
            <ul className="space-y-1.5">
              {lines.map((line, i) => {
                const lineSum = line.sum ?? line.amount ?? 0;
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-800">
                        {line.name || "Позиція"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        {line.qty != null
                          ? `${line.qty}${line.unit ? ` ${line.unit}` : ""}`
                          : "—"}
                        {lineSum > 0 ? ` · ${formatUah(lineSum)} ₴` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={printPdfHref}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#276749]/25 bg-[#276749]/8 px-2 text-[10px] font-semibold text-[#276749] transition hover:bg-[#276749]/15"
                        title="Завантажити PDF накладної"
                      >
                        <Download className="h-3 w-3" />
                        PDF
                      </a>
                      <a
                        href={printHtmlHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#E5DFD3] bg-white px-2 text-[10px] font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        title="Відкрити накладну"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Відкрити
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {doc.refKey && (lines?.length ?? 0) === 0 && !loading && !error ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={printPdfHref}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#276749]/25 bg-[#276749]/8 px-3 text-[11px] font-semibold text-[#276749] transition hover:bg-[#276749]/15"
              >
                <Download className="h-3.5 w-3.5" />
                Завантажити PDF
              </a>
              <a
                href={printHtmlHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-white px-3 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Відкрити
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Маленька підказка для клікабельних KPI */
export function KpiClickHint({
  icon: Icon = TrendingUp,
}: {
  icon?: typeof TrendingUp | typeof TrendingDown;
}) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#276749]/70 transition group-hover:text-[#276749]">
      <Icon className="h-3 w-3" />
      Деталі
    </span>
  );
}

"use client";

/**
 * Accounting / analytics panels — MonthlyChart/RankList/Documents на Фінансах.
 * InventoryOverviewPanel лишається утилітою для повторного використання.
 */

import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import {
  formatInventoryMoney,
  formatInventoryQty,
  type DocRow,
  type InventoryFullDashboard,
  type MonthBucket,
} from "@/lib/inventory-bas";
import { cn } from "@/lib/utils";

type DocLine = {
  lineNumber: number;
  name: string;
  unit: string;
  qty: number;
  price: number;
  sum: number;
  vat?: number;
  vatRate?: string;
  kind: "goods" | "service";
};

type FilteredView = InventoryFullDashboard;

export function InventoryOverviewPanel({
  view,
}: {
  view: FilteredView;
}) {
  return (
    <div className="mt-5 space-y-6">
      <GlassCard className="p-5">
        <h3 className="mb-4 text-sm font-bold text-zinc-900">
          Помісячна динаміка (грн)
        </h3>
        <MonthlyChart monthly={view.monthly} />
      </GlassCard>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <GlassCard className="p-5">
          <h3 className="mb-3 text-sm font-bold text-zinc-900">Топ покупці</h3>
          <RankList items={view.topBuyers} accent="#16A34A" />
        </GlassCard>
        <GlassCard className="p-5">
          <h3 className="mb-3 text-sm font-bold text-zinc-900">
            Топ постачальники
          </h3>
          <RankList items={view.topSuppliers} accent="#2563EB" />
        </GlassCard>
      </div>
    </div>
  );
}

export function InventoryDocumentsPanel({
  docs,
}: {
  docs: DocRow[];
}) {
  const [docFilter, setDocFilter] = useState<"all" | "receipt" | "sale">("all");
  const [docSearch, setDocSearch] = useState("");

  const filteredDocs = docs.filter((d) => {
    if (docFilter !== "all" && d.type !== docFilter) return false;
    const q = docSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      d.counterparty.toLowerCase().includes(q) ||
      d.number.includes(q) ||
      d.date.includes(q)
    );
  });

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          {(
            [
              { id: "all", label: "Усі" },
              { id: "receipt", label: "Надходження" },
              { id: "sale", label: "Продажі" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setDocFilter(f.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                docFilter === f.id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-[#E5DFD3] bg-white text-zinc-600 hover:bg-zinc-50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            placeholder="Пошук контрагента…"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-zinc-500">
          {filteredDocs.length} документів ·{" "}
          {formatInventoryMoney(
            filteredDocs.reduce((s, d) => s + d.amount, 0)
          )}
        </p>
        <p className="text-[11px] text-zinc-400">
          Сезон тут фільтрує дату документа в BAS, а не рік у назві номенклатури.
          Тому в сезоні 2025 можуть бути продажі позицій типу «Кукурудза 2024».
        </p>
      </div>

      <div className="space-y-2">
        {filteredDocs.slice(0, 100).map((d) => (
          <DocCard key={`${d.type}-${d.refKey}`} doc={d} />
        ))}
        {filteredDocs.length > 100 && (
          <p className="py-4 text-center text-xs text-zinc-400">
            Показано 100 із {filteredDocs.length}
          </p>
        )}
      </div>
    </div>
  );
}

export function MonthlyChart({ monthly }: { monthly: MonthBucket[] }) {
  const maxVal = Math.max(
    ...monthly.map((m) => Math.max(m.receipts, m.sales, m.harvest)),
    1
  );

  return (
    <div className="overflow-x-auto">
      <div
        className="flex items-end gap-1.5"
        style={{ minWidth: monthly.length * 56 }}
      >
        {monthly.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-40 items-end gap-px">
              <Bar
                value={m.receipts}
                max={maxVal}
                color="#2563EB"
                title={`Закупки: ${fmt(m.receipts)}`}
              />
              <Bar
                value={m.sales}
                max={maxVal}
                color="#16A34A"
                title={`Продажі: ${fmt(m.sales)}`}
              />
              <Bar
                value={m.harvest}
                max={maxVal}
                color="#D97706"
                title={`Врожай: ${fmt(m.harvest)}`}
              />
            </div>
            <span className="mt-1 text-[9px] font-medium text-zinc-500">
              {m.label}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#2563EB]" />
          Закупки
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#16A34A]" />
          Продажі
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#D97706]" />
          Врожай
        </span>
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  color,
  title,
}: {
  value: number;
  max: number;
  color: string;
  title: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <div
      className="w-3 rounded-t transition-all duration-500"
      style={{
        height: `${pct}%`,
        backgroundColor: color,
        minHeight: value > 0 ? 3 : 0,
      }}
      title={title}
    />
  );
}

export function RankList({
  items,
  accent,
}: {
  items: { name: string; total: number }[];
  accent: string;
}) {
  const max = items[0]?.total ?? 1;
  if (!items.length)
    return <p className="py-4 text-center text-xs text-zinc-400">Немає даних</p>;
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.name} className="flex items-center gap-3">
          <span className="w-5 text-right text-[11px] font-bold text-zinc-400">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-semibold text-zinc-800">
                {item.name}
              </p>
              <span className="shrink-0 text-xs font-bold text-zinc-900">
                {formatInventoryMoney(item.total)}
              </span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-zinc-100">
              <div
                className="h-1 rounded-full transition-all duration-700"
                style={{
                  width: `${(item.total / max) * 100}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocCard({ doc }: { doc: DocRow }) {
  const isReceipt = doc.type === "receipt";
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DocLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (lines !== null || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/inventory/document?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}`
      );
      const data = (await res.json()) as { lines?: DocLine[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error || "Не вдалося завантажити");
        setLines([]);
      } else {
        setLines(data.lines ?? []);
      }
    } catch {
      setError("Мережева помилка");
      setLines([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <GlassCard className="overflow-hidden p-0 shadow-sm hover:translate-y-0 hover:shadow-sm">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            isReceipt ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
          )}
        >
          {isReceipt ? (
            <ArrowDownLeft className="h-4 w-4" />
          ) : (
            <ArrowUpRight className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {doc.counterparty}
            </p>
            <span className="shrink-0 text-sm font-bold text-zinc-900">
              {formatInventoryMoney(doc.amount)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
            <span>{formatUaDate(doc.date)}</span>
            <span>№{doc.number}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px]",
                isReceipt
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              )}
            >
              {isReceipt ? "Надходження" : "Реалізація"}
            </Badge>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-[#E5DFD3]/80 bg-[#FAF8F4]/60 px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Завантаження з BAS…
            </div>
          ) : error ? (
            <p className="py-2 text-center text-xs text-red-600">{error}</p>
          ) : !lines?.length ? (
            <p className="py-2 text-center text-xs text-zinc-400">
              У документі немає рядків товарів/послуг
            </p>
          ) : (
            <div className="space-y-1.5">
              {lines.map((line, i) => (
                <div
                  key={`${line.lineNumber}-${i}`}
                  className="flex items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zinc-800">
                      {line.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {formatInventoryQty(line.qty, line.unit)}
                      {line.price > 0
                        ? ` · ${formatInventoryMoney(line.price)}/од.`
                        : ""}
                      {line.vatRate ? ` · ПДВ ${line.vatRate}` : ""}
                      {line.kind === "service" ? " · послуга" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-zinc-900">
                    {formatInventoryMoney(line.sum)}
                  </span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-2">
                <a
                  href={`/api/inventory/document/print?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#276749]/25 bg-[#276749]/8 px-3 text-[11px] font-semibold text-[#276749] transition hover:bg-[#276749]/15"
                >
                  <Download className="h-3.5 w-3.5" />
                  Завантажити PDF
                </a>
                <a
                  href={`/api/inventory/document/print?type=${doc.type}&refKey=${encodeURIComponent(doc.refKey)}&format=html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-white px-3 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Відкрити
                </a>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </GlassCard>
  );
}

function formatUaDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(n);
}

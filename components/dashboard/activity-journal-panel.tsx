"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday, startOfDay, subDays } from "date-fns";
import { uk } from "date-fns/locale";
import {
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { listRecentActivityAction } from "@/app/team/actions";
import type { ActivityLogRow } from "@/lib/activity-log";
import { ROLE_LABEL_UK, type AppRole } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

type PeriodFilter = "all" | "today" | "7d" | "30d";
type ActionFilter = "all" | string;

const ACTION_META: Record<
  string,
  { label: string; icon: LucideIcon; tone: string; ring: string }
> = {
  create: {
    label: "Створення",
    icon: Plus,
    tone: "bg-emerald-500/15 text-emerald-700",
    ring: "ring-emerald-500/20",
  },
  update: {
    label: "Зміна",
    icon: Pencil,
    tone: "bg-sky-500/15 text-sky-700",
    ring: "ring-sky-500/20",
  },
  delete: {
    label: "Видалення",
    icon: Trash2,
    tone: "bg-rose-500/15 text-rose-700",
    ring: "ring-rose-500/20",
  },
  close: {
    label: "Закриття",
    icon: X,
    tone: "bg-amber-500/15 text-amber-800",
    ring: "ring-amber-500/20",
  },
  export: {
    label: "Експорт",
    icon: Upload,
    tone: "bg-violet-500/15 text-violet-700",
    ring: "ring-violet-500/20",
  },
  login: {
    label: "Вхід",
    icon: UserRound,
    tone: "bg-zinc-500/15 text-zinc-700",
    ring: "ring-zinc-500/20",
  },
  mapping: {
    label: "Мапінг",
    icon: RefreshCw,
    tone: "bg-[#C05621]/15 text-[#9c4221]",
    ring: "ring-[#C05621]/20",
  },
  sync: {
    label: "Синк",
    icon: RefreshCw,
    tone: "bg-cyan-500/15 text-cyan-700",
    ring: "ring-cyan-500/20",
  },
  other: {
    label: "Інше",
    icon: History,
    tone: "bg-zinc-500/12 text-zinc-600",
    ring: "ring-zinc-500/15",
  },
};

const ENTITY_LABEL: Record<string, string> = {
  field: "Поле",
  farm_field: "Поле",
  field_operation: "Наряд",
  fuel_transaction: "Паливо",
  fuel_storage: "Склад ДП",
  inventory_move: "ТМЦ",
  inventory_item: "Товар",
  equipment: "Техніка",
  purchase_request: "Заявка",
  mapping: "Мапінг",
  bas_request: "Черга 1С",
  profile: "Профіль",
  session: "Сесія",
};

function actionMeta(action: string) {
  return ACTION_META[action] ?? ACTION_META.other;
}

function entityLabel(type: string): string {
  return ENTITY_LABEL[type] ?? type.replace(/_/g, " ");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (isToday(d)) return `сьогодні, ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `вчора, ${format(d, "HH:mm")}`;
  return format(d, "d MMM, HH:mm", { locale: uk });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (isToday(d)) return "Сьогодні";
  if (isYesterday(d)) return "Вчора";
  return format(d, "d MMMM yyyy", { locale: uk });
}

function roleLabel(role: AppRole | null): string | null {
  if (!role) return null;
  return ROLE_LABEL_UK[role];
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-tight transition-colors",
        active
          ? "bg-zinc-900 text-white shadow-sm"
          : "bg-white/70 text-zinc-600 ring-1 ring-[#E5DFD3]/90 hover:bg-white hover:text-zinc-900"
      )}
    >
      {children}
    </button>
  );
}

export function ActivityJournalPanel({
  className,
}: {
  className?: string;
}) {
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [action, setAction] = useState<ActionFilter>("all");
  const [actor, setActor] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listRecentActivityAction({ limit: 200 }).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const key = row.actorId ?? row.actorName;
      if (!key) continue;
      if (!map.has(key)) map.set(key, row.actorName || "Користувач");
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "uk")
    );
  }, [rows]);

  const actionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.action) set.add(row.action);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    let from: Date | null = null;
    if (period === "today") from = startOfDay(now);
    else if (period === "7d") from = startOfDay(subDays(now, 6));
    else if (period === "30d") from = startOfDay(subDays(now, 29));

    return rows.filter((row) => {
      if (from) {
        const t = new Date(row.createdAt).getTime();
        if (!Number.isFinite(t) || t < from.getTime()) return false;
      }
      if (action !== "all" && row.action !== action) return false;
      if (actor !== "all") {
        const key = row.actorId ?? row.actorName;
        if (key !== actor) return false;
      }
      if (q) {
        const hay = `${row.summary} ${row.actorName} ${row.entityType} ${row.action}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, period, action, actor]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ActivityLogRow[]>();
    for (const row of filtered) {
      const key = dayKey(row.createdAt);
      if (!map.has(key)) {
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(row);
    }
    return order.map((label) => ({ label, items: map.get(label)! }));
  }, [filtered]);

  const hasFilters =
    query.trim().length > 0 ||
    period !== "all" ||
    action !== "all" ||
    actor !== "all";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]",
        className
      )}
    >
      <div className="shrink-0 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/90 px-4 pt-[max(0.75rem,var(--safe-top))] pb-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-[0_8px_24px_-12px_rgba(24,24,27,0.55)]">
            <History className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
              Журнал
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              Хто що зробив у системі — створення, зміни, видалення
            </p>
          </div>
          {!loading ? (
            <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-600 ring-1 ring-[#E5DFD3]">
              {filtered.length}
              {filtered.length !== rows.length ? ` / ${rows.length}` : ""}
            </span>
          ) : null}
        </div>

        <div className="mx-auto mt-3 w-full max-w-3xl space-y-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук за текстом, людиною, типом…"
              className={cn(
                "h-11 w-full rounded-2xl border border-[#E5DFD3]/90 bg-white/85 pl-10 pr-10",
                "text-sm font-medium text-zinc-900 shadow-sm outline-none",
                "placeholder:text-zinc-400",
                "focus:border-[#276749]/40 focus:ring-2 focus:ring-[#276749]/15"
              )}
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистити пошук"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip
              active={period === "all"}
              onClick={() => setPeriod("all")}
            >
              Увесь час
            </FilterChip>
            <FilterChip
              active={period === "today"}
              onClick={() => setPeriod("today")}
            >
              Сьогодні
            </FilterChip>
            <FilterChip
              active={period === "7d"}
              onClick={() => setPeriod("7d")}
            >
              7 днів
            </FilterChip>
            <FilterChip
              active={period === "30d"}
              onClick={() => setPeriod("30d")}
            >
              30 днів
            </FilterChip>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip
              active={action === "all"}
              onClick={() => setAction("all")}
            >
              Усі дії
            </FilterChip>
            {actionOptions.map((key) => (
              <FilterChip
                key={key}
                active={action === key}
                onClick={() => setAction(key)}
              >
                {actionMeta(key).label}
              </FilterChip>
            ))}
          </div>

          {actors.length > 1 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <FilterChip
                active={actor === "all"}
                onClick={() => setActor("all")}
              >
                Усі люди
              </FilterChip>
              {actors.map(([id, name]) => (
                <FilterChip
                  key={id}
                  active={actor === id}
                  onClick={() => setActor(id)}
                >
                  {name}
                </FilterChip>
              ))}
            </div>
          ) : null}

          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPeriod("all");
                setAction("all");
                setActor("all");
              }}
              className="text-[11px] font-semibold text-[#C05621] hover:underline"
            >
              Скинути фільтри
            </button>
          ) : null}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-none px-4 py-4 pb-[calc(var(--app-bottom-inset)+1.25rem)] sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Завантаження…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#E5DFD3] bg-white/60 px-5 py-14 text-center">
              <History className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-3 text-sm font-semibold text-zinc-700">
                {hasFilters ? "Нічого не знайдено" : "Поки немає записів"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {hasFilters
                  ? "Спробуйте інші фільтри або скиньте їх"
                  : "Після дій користувачів вони зʼявляться тут"}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <section key={group.label}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <h2 className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                      {group.label}
                    </h2>
                    <span className="h-px flex-1 bg-[#E5DFD3]/80" />
                    <span className="text-[10px] font-semibold tabular-nums text-zinc-400">
                      {group.items.length}
                    </span>
                  </div>
                  <ul className="overflow-hidden rounded-3xl border border-[#E5DFD3]/80 bg-white/85 shadow-[0_8px_30px_-18px_rgba(39,33,24,0.35)] backdrop-blur-sm">
                    {group.items.map((row, index) => {
                      const meta = actionMeta(row.action);
                      const Icon = meta.icon;
                      const role = roleLabel(row.actorRole);
                      return (
                        <li
                          key={row.id}
                          className={cn(
                            "flex gap-3 px-3.5 py-3 sm:px-4",
                            index > 0 && "border-t border-[#E5DFD3]/70"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1",
                              meta.tone,
                              meta.ring
                            )}
                          >
                            <Icon className="h-4 w-4" strokeWidth={2} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] leading-snug font-semibold text-zinc-900 sm:text-sm">
                              {row.summary}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                                <UserRound className="h-3 w-3" />
                                {row.actorName || "—"}
                                {role ? ` · ${role}` : ""}
                              </span>
                              <span className="rounded-full bg-[#276749]/8 px-2 py-0.5 text-[10px] font-semibold text-[#276749]">
                                {meta.label}
                              </span>
                              {row.entityType ? (
                                <span className="rounded-full bg-[#C05621]/8 px-2 py-0.5 text-[10px] font-semibold text-[#9c4221]">
                                  {entityLabel(row.entityType)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <time className="shrink-0 pt-0.5 text-[10px] font-medium tabular-nums text-zinc-400 sm:text-[11px]">
                            {formatWhen(row.createdAt)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

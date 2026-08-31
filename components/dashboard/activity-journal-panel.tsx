"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday, startOfDay, subDays } from "date-fns";
import { uk } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronDown,
  Fuel,
  History,
  Link2,
  ListFilter,
  Loader2,
  LogIn,
  MapPinned,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Tractor,
  Trash2,
  Upload,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { listRecentActivityAction } from "@/app/team/actions";
import type { ActivityLogRow } from "@/lib/activity-log";
import { normalizeActorDisplayName } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

type PeriodFilter = "all" | "today" | "7d" | "30d";

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
    icon: LogIn,
    tone: "bg-zinc-500/15 text-zinc-700",
    ring: "ring-zinc-500/20",
  },
  mapping: {
    label: "Мапінг",
    icon: Link2,
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

/** Усі відомі дії — завжди в фільтрі, навіть якщо ще немає записів */
const ACTION_FILTER_KEYS = [
  "create",
  "update",
  "delete",
  "close",
  "export",
  "login",
  "mapping",
  "sync",
  "other",
] as const;

const ENTITY_META: Record<string, { label: string; icon: LucideIcon }> = {
  field: { label: "Поле", icon: MapPinned },
  farm_field: { label: "Поле", icon: MapPinned },
  field_operation: { label: "Наряд", icon: Tractor },
  fuel_transaction: { label: "Паливо", icon: Fuel },
  fuel_storage: { label: "Склад ДП", icon: Warehouse },
  inventory_move: { label: "ТМЦ", icon: Package },
  inventory_item: { label: "Товар", icon: Package },
  equipment: { label: "Техніка", icon: Tractor },
  purchase_request: { label: "Заявка", icon: ShoppingCart },
  mapping: { label: "Мапінг", icon: Link2 },
  bas_request: { label: "Черга 1С", icon: Upload },
  profile: { label: "Профіль", icon: UserRound },
  session: { label: "Сесія", icon: LogIn },
};

const ENTITY_FILTER_KEYS = [
  "field_operation",
  "fuel_transaction",
  "fuel_storage",
  "inventory_move",
  "inventory_item",
  "equipment",
  "farm_field",
  "purchase_request",
  "mapping",
  "bas_request",
  "session",
  "profile",
] as const;

const PERIOD_FILTERS: { id: PeriodFilter; label: string }[] = [
  { id: "all", label: "Увесь час" },
  { id: "today", label: "Сьогодні" },
  { id: "7d", label: "7 днів" },
  { id: "30d", label: "30 днів" },
];

function actionMeta(action: string) {
  return ACTION_META[action] ?? ACTION_META.other;
}

function entityLabel(type: string): string {
  return ENTITY_META[type]?.label ?? type.replace(/_/g, " ");
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

type ActorOption = {
  /** Стабільний ключ фільтра: uuid або name:… */
  key: string;
  name: string;
  actorIds: Set<string>;
  normNames: Set<string>;
};

/** Зливає «Власник Ігор» і «Ігор» в одного актора (за id або нормалізованим імʼям). */
function buildActorOptions(rows: ActivityLogRow[]): ActorOption[] {
  const byId = new Map<string, ActorOption>();
  const byNorm = new Map<string, ActorOption>();

  const preferName = (a: string, b: string) =>
    a.length <= b.length ? a : b;

  for (const row of rows) {
    const display = normalizeActorDisplayName(row.actorName || "");
    const norm = display.toLowerCase();
    if (!norm) continue;

    if (row.actorId) {
      let opt = byId.get(row.actorId);
      if (!opt) {
        opt = byNorm.get(norm);
        if (opt) {
          opt.actorIds.add(row.actorId);
          byId.set(row.actorId, opt);
        } else {
          opt = {
            key: row.actorId,
            name: display,
            actorIds: new Set([row.actorId]),
            normNames: new Set([norm]),
          };
          byId.set(row.actorId, opt);
          byNorm.set(norm, opt);
        }
      }
      opt.name = preferName(opt.name, display);
      opt.normNames.add(norm);
      byNorm.set(norm, opt);
      continue;
    }

    let opt = byNorm.get(norm);
    if (!opt) {
      opt = {
        key: `name:${norm}`,
        name: display,
        actorIds: new Set(),
        normNames: new Set([norm]),
      };
      byNorm.set(norm, opt);
    } else {
      opt.name = preferName(opt.name, display);
      opt.normNames.add(norm);
    }
  }

  const unique = new Map<string, ActorOption>();
  for (const opt of byNorm.values()) unique.set(opt.key, opt);
  for (const opt of byId.values()) unique.set(opt.key, opt);

  return Array.from(unique.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "uk")
  );
}

function rowMatchesActor(row: ActivityLogRow, opt: ActorOption): boolean {
  if (row.actorId && opt.actorIds.has(row.actorId)) return true;
  const norm = normalizeActorDisplayName(row.actorName || "").toLowerCase();
  return Boolean(norm) && opt.normNames.has(norm);
}

function FilterCard({
  active,
  onClick,
  label,
  icon: Icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[4.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center transition-all",
        active
          ? "bg-zinc-900 text-white shadow-[0_6px_16px_-10px_rgba(24,24,27,0.55)]"
          : "bg-white/85 text-zinc-600 ring-1 ring-[#E5DFD3]/90 hover:bg-white hover:text-zinc-900"
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-white/90" : "text-zinc-400"
          )}
          strokeWidth={2}
        />
      ) : null}
      <span className="line-clamp-2 max-w-full text-[9px] leading-tight font-bold tracking-tight">
        {label}
      </span>
      {count != null ? (
        <span
          className={cn(
            "text-[9px] font-semibold tabular-nums",
            active ? "text-white/55" : "text-zinc-400"
          )}
        >
          {count}
        </span>
      ) : null}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [action, setAction] = useState<string>("all");
  const [entity, setEntity] = useState<string>("all");
  const [actor, setActor] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listRecentActivityAction({ limit: 500 })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setLoadError(
          err instanceof Error ? err.message : "Помилка завантаження"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const actors = useMemo(() => buildActorOptions(rows), [rows]);

  const actionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = ACTION_META[row.action] ? row.action : "other";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const entityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.entityType) continue;
      const key =
        row.entityType === "field" ? "farm_field" : row.entityType;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const entityOptions = useMemo(() => {
    const keys = new Set<string>(ENTITY_FILTER_KEYS);
    for (const row of rows) {
      if (row.entityType) {
        keys.add(
          row.entityType === "field" ? "farm_field" : row.entityType
        );
      }
    }
    return Array.from(keys).sort((a, b) =>
      entityLabel(a).localeCompare(entityLabel(b), "uk")
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    let from: Date | null = null;
    if (period === "today") from = startOfDay(now);
    else if (period === "7d") from = startOfDay(subDays(now, 6));
    else if (period === "30d") from = startOfDay(subDays(now, 29));

    const actorOpt =
      actor === "all" ? null : actors.find((a) => a.key === actor) ?? null;

    return rows.filter((row) => {
      if (from) {
        const t = new Date(row.createdAt).getTime();
        if (!Number.isFinite(t) || t < from.getTime()) return false;
      }
      if (action !== "all") {
        const rowAction = ACTION_META[row.action] ? row.action : "other";
        if (rowAction !== action) return false;
      }
      if (entity !== "all") {
        const rowEntity =
          row.entityType === "field" ? "farm_field" : row.entityType;
        if (rowEntity !== entity) return false;
      }
      if (actorOpt && !rowMatchesActor(row, actorOpt)) return false;
      if (q) {
        const displayName = normalizeActorDisplayName(row.actorName);
        const hay =
          `${row.summary} ${displayName} ${row.entityType} ${row.action}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, period, action, entity, actor, actors]);

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
    entity !== "all" ||
    actor !== "all";

  const activeChipCount =
    (period !== "all" ? 1 : 0) +
    (action !== "all" ? 1 : 0) +
    (entity !== "all" ? 1 : 0) +
    (actor !== "all" ? 1 : 0);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]",
        className
      )}
    >
      <div className="shrink-0 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/90 px-4 pt-[max(0.75rem,var(--safe-top))] pb-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-[0_8px_24px_-12px_rgba(24,24,27,0.55)]">
            <History className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h1 className="min-w-0 flex-1 text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
            Журнал дій
          </h1>
          {!loading ? (
            <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-600 ring-1 ring-[#E5DFD3]">
              {filtered.length}
              {filtered.length !== rows.length ? ` / ${rows.length}` : ""}
            </span>
          ) : null}
        </div>

        <div className="relative mx-auto mt-3 w-full max-w-3xl">
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
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-none px-4 py-4 pb-[calc(var(--app-bottom-inset)+1.25rem)] sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <div className="overflow-hidden rounded-2xl border border-[#E5DFD3]/90 bg-white/80 shadow-sm">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition hover:bg-[#F4F1EA]/70"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white">
                <ListFilter className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-zinc-900">
                  Фільтр
                </span>
                <span className="block text-[11px] text-zinc-400">
                  {activeChipCount > 0
                    ? `Активно: ${activeChipCount}`
                    : "Період · дія · розділ · хто"}
                </span>
              </span>
              {activeChipCount > 0 ? (
                <span className="rounded-full bg-[#276749]/12 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[#276749]">
                  {activeChipCount}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
                  filtersOpen && "rotate-180"
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {filtersOpen ? (
                <motion.div
                  key="filters"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-[#E5DFD3]/80 px-3 pt-3 pb-3.5">
                    <div>
                      <p className="mb-1.5 px-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                        Період
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {PERIOD_FILTERS.map((p) => (
                          <FilterCard
                            key={p.id}
                            active={period === p.id}
                            onClick={() => setPeriod(p.id)}
                            label={p.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 px-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                        Дія
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        <FilterCard
                          active={action === "all"}
                          onClick={() => setAction("all")}
                          label="Усі"
                          icon={History}
                          count={rows.length}
                        />
                        {ACTION_FILTER_KEYS.map((key) => {
                          const meta = actionMeta(key);
                          return (
                            <FilterCard
                              key={key}
                              active={action === key}
                              onClick={() => setAction(key)}
                              label={meta.label}
                              icon={meta.icon}
                              count={actionCounts.get(key) ?? 0}
                            />
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 px-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                        Розділ
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        <FilterCard
                          active={entity === "all"}
                          onClick={() => setEntity("all")}
                          label="Усі"
                          icon={History}
                        />
                        {entityOptions.map((key) => {
                          const meta = ENTITY_META[key];
                          return (
                            <FilterCard
                              key={key}
                              active={entity === key}
                              onClick={() => setEntity(key)}
                              label={entityLabel(key)}
                              icon={meta?.icon}
                              count={entityCounts.get(key) ?? 0}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {actors.length > 1 ? (
                      <div>
                        <p className="mb-1.5 px-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                          Хто
                        </p>
                        <div className="grid grid-cols-4 gap-1.5">
                          <FilterCard
                            active={actor === "all"}
                            onClick={() => setActor("all")}
                            label="Усі"
                            icon={UserRound}
                          />
                          {actors.map((a) => (
                            <FilterCard
                              key={a.key}
                              active={actor === a.key}
                              onClick={() => setActor(a.key)}
                              label={a.name}
                              icon={UserRound}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {activeChipCount > 0 || query.trim() ? (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setPeriod("all");
                          setAction("all");
                          setEntity("all");
                          setActor("all");
                        }}
                        className="text-[11px] font-semibold text-[#C05621] hover:underline"
                      >
                        Скинути фільтри
                      </button>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="pt-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Завантаження…
              </div>
            ) : loadError ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50/80 px-5 py-14 text-center">
                <AlertTriangle className="mx-auto h-8 w-8 text-rose-400" />
                <p className="mt-3 text-sm font-semibold text-rose-900">
                  Помилка завантаження
                </p>
                <p className="mt-1 text-xs text-rose-700">{loadError}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#276749] px-4 text-sm font-semibold text-white hover:bg-[#1f5339]"
                >
                  Повторити
                </button>
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
                        const displayName = normalizeActorDisplayName(
                          row.actorName || ""
                        );
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
                                  {displayName || "—"}
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
    </div>
  );
}

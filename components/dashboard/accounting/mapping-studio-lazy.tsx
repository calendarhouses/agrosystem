"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Fuel,
  Link2,
  Loader2,
  Map as MapIcon,
  Package,
  Tractor,
  Unlink,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import {
  loadMappingBasOptions,
  loadMappingLocalRows,
} from "@/app/accounting/actions";
import {
  saveBasMapping,
  saveBasMappingBatch,
} from "@/app/admin/mapping/actions";
import { MappingBasCombobox } from "@/components/dashboard/accounting/mapping-bas-combobox";
import { Button } from "@/components/ui/button";
import {
  UNMAPPED_VALUE,
  autoMapByExactName,
  autoMapFieldRows,
  autoMapMachineryRows,
  type BasMappingTable,
  type BasSelectOption,
  type MappingCatalogKind,
  type MappingLocalRow,
} from "@/lib/bas-mapping";
import { cn } from "@/lib/utils";

const CATALOGS: {
  id: MappingCatalogKind;
  label: string;
  hint: string;
  icon: typeof Package;
  table: BasMappingTable;
  allowClear: boolean;
}[] = [
  {
    id: "tmc",
    label: "Товари",
    hint: "Номенклатура складу ↔ довідник BAS AGRO",
    icon: Package,
    table: "inventory_items_cache",
    allowClear: false,
  },
  {
    id: "machinery",
    label: "Техніка",
    hint: "GPS-техніка ↔ основні засоби BAS AGRO",
    icon: Tractor,
    table: "wialon_bas_mapping",
    allowClear: true,
  },
  {
    id: "storages",
    label: "Склади ДП",
    hint: "Наші склади палива ↔ склади BAS AGRO",
    icon: Fuel,
    table: "fuel_storages",
    allowClear: true,
  },
  {
    id: "fields",
    label: "Поля",
    hint: "Поля з обміру ↔ довідник полів BAS AGRO",
    icon: MapIcon,
    table: "farm_fields",
    allowClear: true,
  },
];

const BAS_DEBOUNCE_MS = 350;

type CatalogStat = { linked: number; total: number };

function countLinked(rows: MappingLocalRow[]): number {
  return rows.filter((row) => row.basRefKey).length;
}

function initialValues(rows: MappingLocalRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [row.id, row.basRefKey ?? UNMAPPED_VALUE])
  );
}

/** Скільки наших рядків вказують на той самий ключ BAS. */
function sharedBasCounts(
  rows: MappingLocalRow[],
  values: Record<string, string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (!raw || raw === UNMAPPED_VALUE) continue;
    const key = raw.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function buildAutoSuggestions(
  catalog: MappingCatalogKind,
  rows: MappingLocalRow[],
  options: BasSelectOption[],
  current: Record<string, string>
): { next: Record<string, string>; filled: number } {
  if (catalog === "fields") {
    const next = autoMapFieldRows(rows, options, current);
    let filled = 0;
    for (const row of rows) {
      const before = current[row.id] ?? UNMAPPED_VALUE;
      const after = next[row.id] ?? before;
      if (before === UNMAPPED_VALUE && after !== UNMAPPED_VALUE) filled += 1;
    }
    return { next, filled };
  }
  if (catalog === "machinery") {
    const next = autoMapMachineryRows(rows, options, current);
    let filled = 0;
    for (const row of rows) {
      const before = current[row.id] ?? UNMAPPED_VALUE;
      const after = next[row.id] ?? before;
      if (before === UNMAPPED_VALUE && after !== UNMAPPED_VALUE) filled += 1;
    }
    return { next, filled };
  }
  const res = autoMapByExactName(rows, options, current);
  return { next: res.next, filled: res.filled };
}

/** Лінивий мапінг: локальні рядки одразу, BAS — після debounce. */
export function MappingStudioLazy({
  initialCatalog = "storages",
}: {
  initialCatalog?: MappingCatalogKind;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<MappingCatalogKind>(initialCatalog);
  const loadGen = useRef(0);

  useEffect(() => {
    setCatalog(initialCatalog);
  }, [initialCatalog]);

  const [rows, setRows] = useState<MappingLocalRow[]>([]);
  const [options, setOptions] = useState<BasSelectOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [basLoading, setBasLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [pendingAuto, setPendingAuto] = useState<Record<string, string> | null>(
    null
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const autoAppliedFor = useRef<string | null>(null);
  const [catalogStats, setCatalogStats] = useState<
    Partial<Record<MappingCatalogKind, CatalogStat>>
  >({});
  const [statsLoading, setStatsLoading] = useState(true);

  const meta = CATALOGS.find((c) => c.id === catalog)!;

  // Статистика по всіх категоріях — одразу на картках
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    void Promise.all(
      CATALOGS.map(async (c) => {
        const res = await loadMappingLocalRows(c.id);
        if (!res.ok) return null;
        return {
          id: c.id,
          linked: countLinked(res.data.rows),
          total: res.data.rows.length,
        };
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Partial<Record<MappingCatalogKind, CatalogStat>> = {};
      for (const row of results) {
        if (!row) continue;
        next[row.id] = { linked: row.linked, total: row.total };
      }
      setCatalogStats(next);
      setStatsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 1) Локальні рядки — швидко, без BAS
  useEffect(() => {
    let cancelled = false;
    const gen = ++loadGen.current;
    setRowsLoading(true);
    setBasLoading(false);
    setLoadError(null);
    setAutoNote(null);
    setPendingAuto(null);
    setOptions([]);
    setOptionsError(null);
    autoAppliedFor.current = null;

    void loadMappingLocalRows(catalog).then((res) => {
      if (cancelled || gen !== loadGen.current) return;
      setRowsLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        setRows([]);
        return;
      }
      setRows(res.data.rows);
      setValues(initialValues(res.data.rows));
      setSaved(
        Object.fromEntries(res.data.rows.map((r) => [r.id, r.basRefKey]))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [catalog]);

  useEffect(() => {
    if (rowsLoading) return;
    const linked = rows.filter((row) => {
      const v = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
      return v !== UNMAPPED_VALUE;
    }).length;
    setCatalogStats((prev) => ({
      ...prev,
      [catalog]: { linked, total: rows.length },
    }));
  }, [catalog, rows, rowsLoading, values]);

  // 2) BAS — лише після debounce (швидке клікання не бʼє OData кілька разів)
  useEffect(() => {
    let cancelled = false;
    const gen = loadGen.current;
    setBasLoading(true);

    const timer = window.setTimeout(() => {
      void loadMappingBasOptions(catalog).then((res) => {
        if (cancelled || gen !== loadGen.current) return;
        setBasLoading(false);
        if (!res.ok) {
          setOptionsError(res.error);
          setOptions([]);
          return;
        }
        setOptions(res.data.options);
        setOptionsError(res.data.error);
      });
    }, BAS_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalog]);

  // 3) Живий авто-звʼязок: точні збіги для незавʼязаних — пропонуємо й зберігаємо
  useEffect(() => {
    if (basLoading || options.length === 0 || rows.length === 0) return;
    if (autoAppliedFor.current === catalog) return;

    const current = initialValues(rows);
    const { next, filled } = buildAutoSuggestions(
      catalog,
      rows,
      options,
      current
    );
    autoAppliedFor.current = catalog;
    if (filled === 0) return;

    setValues(next);
    setPendingAuto(next);
    setAutoNote(
      `Автоматично знайдено ${filled} збігів з BAS AGRO. Перевірте й натисніть «Застосувати».`
    );
  }, [basLoading, options, rows, catalog]);

  const sharedCounts = useMemo(
    () => sharedBasCounts(rows, values),
    [rows, values]
  );

  const mappedCount = useMemo(
    () =>
      rows.filter((row) => {
        const v = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
        return v !== UNMAPPED_VALUE;
      }).length,
    [rows, values]
  );

  const splitWarnCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      const raw = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
      if (!raw || raw === UNMAPPED_VALUE) continue;
      if ((sharedCounts.get(raw.toLowerCase()) ?? 0) > 1) n += 1;
    }
    return n;
  }, [rows, values, sharedCounts]);

  function runAutoMatch() {
    const current = values;
    const { next, filled } = buildAutoSuggestions(
      catalog,
      rows,
      options,
      current
    );
    setValues(next);
    setPendingAuto(next);
    setAutoNote(
      filled > 0
        ? `Знайдено ${filled} збігів. Натисніть «Застосувати».`
        : "Збігів не знайдено."
    );
  }

  function applyAutoMatch() {
    if (!pendingAuto) return;
    const dirty = rows
      .map((row) => {
        const next = pendingAuto[row.id] ?? UNMAPPED_VALUE;
        const prev = saved[row.id] ?? null;
        const nextKey = next === UNMAPPED_VALUE ? null : next;
        if (nextKey === prev) return null;
        if (!nextKey && !meta.allowClear) return null;
        return { table: meta.table, id: row.id, basRefKey: nextKey };
      })
      .filter(Boolean) as Array<{
      table: BasMappingTable;
      id: string;
      basRefKey: string | null;
    }>;

    if (dirty.length === 0) {
      toast.message("Немає змін");
      return;
    }

    startTransition(async () => {
      const res = await saveBasMappingBatch(dirty);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSaved((prev) => {
        const copy = { ...prev };
        for (const item of dirty) copy[item.id] = item.basRefKey;
        return copy;
      });
      setPendingAuto(null);
      setAutoNote(null);
      toast.success(`Збережено ${res.saved} звʼязків`);
      router.refresh();
    });
  }

  function persistRow(rowId: string, nextValue: string) {
    const nextKey = nextValue === UNMAPPED_VALUE ? null : nextValue;
    if (!meta.allowClear && nextKey == null) {
      toast.error("Товар має бути привʼязаний до номенклатури BAS AGRO");
      return;
    }
    startTransition(async () => {
      const res = await saveBasMapping({
        table: meta.table,
        id: rowId,
        basRefKey: nextKey,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSaved((prev) => ({ ...prev, [rowId]: nextKey }));
      setValues((prev) => ({
        ...prev,
        [rowId]: nextKey ?? UNMAPPED_VALUE,
      }));
      toast.success(nextKey ? "Звʼязок збережено" : "Відвʼязано");
    });
  }

  const loading = rowsLoading;

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {CATALOGS.map((c) => {
          const Icon = c.icon;
          const active = catalog === c.id;
          const stat = catalogStats[c.id];
          const countLabel =
            stat != null
              ? `${stat.linked}/${stat.total}`
              : statsLoading
                ? "…"
                : "—";
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatalog(c.id)}
              disabled={pending}
              className={cn(
                "rounded-2xl border px-3 py-3 text-left transition sm:px-4 sm:py-3.5",
                "shadow-[0_4px_16px_rgb(39,33,24,0.04)] backdrop-blur-xl",
                active
                  ? "border-[#276749]/40 bg-[#276749] text-white ring-2 ring-[#276749]/25"
                  : "border-[#E5DFD3]/80 bg-[#FDFBF7]/90 text-zinc-900 hover:border-[#276749]/25 hover:bg-white",
                pending && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-[10px] font-bold tracking-wide uppercase sm:text-[11px]",
                    active ? "text-white/70" : "text-zinc-400"
                  )}
                >
                  {c.label}
                </span>
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    active ? "text-white/80" : "text-zinc-400"
                  )}
                />
              </div>
              <p
                className={cn(
                  "mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl",
                  active ? "text-white" : "text-zinc-900"
                )}
              >
                {countLabel}
              </p>
              <p
                className={cn(
                  "mt-0.5 line-clamp-2 text-[10px] leading-snug sm:text-[11px]",
                  active ? "text-white/65" : "text-zinc-500"
                )}
              >
                {c.hint}
              </p>
            </button>
          );
        })}
      </section>

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-zinc-900 sm:text-sm">
              Зіставлення · {meta.label}
            </p>
            <p className="text-[11px] leading-snug text-zinc-500 sm:text-xs">
              <span className="hidden sm:inline">{meta.hint} · </span>
              {loading
                ? "завантаження…"
                : `${mappedCount} / ${rows.length} зіставлено`}
              {basLoading ? " · довідник BAS…" : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                pending || loading || basLoading || rows.length === 0
              }
              onClick={runAutoMatch}
              className="h-9 gap-1.5 rounded-xl border-[#E5DFD3] bg-white text-[11px] sm:text-xs"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Авто
              <span className="hidden sm:inline">-зіставлення</span>
            </Button>
            {pendingAuto ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={applyAutoMatch}
                className="h-9 gap-1.5 rounded-xl bg-[#276749] text-white hover:bg-[#1f5239]"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Застосувати
              </Button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Завантажуємо {meta.label}…
          </div>
        ) : loadError ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </p>
        ) : (
          <>
            {optionsError ? (
              <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {optionsError}
              </p>
            ) : null}
            {autoNote ? (
              <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {autoNote}
              </p>
            ) : null}
            {splitWarnCount > 0 ? (
              <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  {splitWarnCount}{" "}
                  {splitWarnCount === 1 ? "позиція вказує" : "позицій вказують"}{" "}
                  на той самий запис BAS AGRO (кілька наших → один у довіднику).
                  Звʼязок не скасовуємо — перевірте, чи так і має бути, або
                  розділіть записи в BAS AGRO.
                </span>
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#E5DFD3] px-4 py-12 text-center text-sm text-zinc-500">
                Немає записів
              </p>
            ) : (
              <ul>
                {rows.map((row) => {
                  const value =
                    values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
                  const linked = value !== UNMAPPED_VALUE;
                  const shared =
                    linked &&
                    (sharedCounts.get(value.toLowerCase()) ?? 0) > 1;
                  const Icon = meta.icon;
                  return (
                    <li
                      key={row.id}
                      className={cn(
                        "mb-2.5 flex flex-col gap-2.5 rounded-2xl border bg-white/70 p-3 shadow-sm backdrop-blur-xl transition-all sm:mb-3 sm:gap-3 sm:p-4",
                        "hover:shadow-md sm:flex-row sm:items-center sm:justify-between",
                        shared
                          ? "border-amber-300/90 ring-1 ring-amber-200/60"
                          : "border-[#E5DFD3]/80"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                            shared
                              ? "bg-amber-500/15 text-amber-800"
                              : linked
                                ? "bg-emerald-500/10 text-emerald-700"
                                : "bg-zinc-100 text-zinc-500"
                          )}
                        >
                          {shared ? (
                            <AlertTriangle className="h-4 w-4" />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-zinc-900">
                            {row.title}
                          </p>
                          {row.subtitle ? (
                            <p className="mt-0.5 truncate text-xs text-zinc-500">
                              {row.subtitle}
                            </p>
                          ) : null}
                          {shared ? (
                            <p className="mt-1 text-[11px] font-semibold text-amber-800">
                              Увага: ще{" "}
                              {(sharedCounts.get(value.toLowerCase()) ?? 1) -
                                1}{" "}
                              наших{" "}
                              {(sharedCounts.get(value.toLowerCase()) ?? 1) -
                                1 ===
                              1
                                ? "запис"
                                : "записів"}{" "}
                              на цей самий BAS AGRO
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center justify-center gap-2 px-2">
                        {linked ? (
                          <>
                            <span className="hidden h-px w-8 bg-emerald-400 sm:block" />
                            <Link2 className="h-4 w-4 text-emerald-600" />
                            <span className="hidden h-px w-8 bg-emerald-400 sm:block" />
                          </>
                        ) : (
                          <>
                            <span className="hidden h-px w-8 border-t border-dashed border-orange-400 sm:block" />
                            <Unlink className="h-4 w-4 text-orange-500" />
                            <span className="hidden h-px w-8 border-t border-dashed border-orange-400 sm:block" />
                          </>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 sm:max-w-md sm:justify-end">
                        <MappingBasCombobox
                          options={options}
                          value={value === UNMAPPED_VALUE ? "" : value}
                          linked={linked}
                          disabled={pending || basLoading}
                          allowClear={meta.allowClear}
                          onChange={(next) => {
                            setValues((prev) => ({ ...prev, [row.id]: next }));
                            setAutoNote(null);
                            persistRow(row.id, next);
                          }}
                          onClear={() => {
                            setValues((prev) => ({
                              ...prev,
                              [row.id]: UNMAPPED_VALUE,
                            }));
                            persistRow(row.id, UNMAPPED_VALUE);
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

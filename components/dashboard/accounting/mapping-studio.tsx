"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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

export type MappingStudioProps = {
  tmc: MappingLocalRow[];
  machinery: MappingLocalRow[];
  storages: MappingLocalRow[];
  fields: MappingLocalRow[];
  tmcOptions: BasSelectOption[];
  machineryOptions: BasSelectOption[];
  storageOptions: BasSelectOption[];
  fieldOptions: BasSelectOption[];
  tmcError: string | null;
  machineryError: string | null;
  storageError: string | null;
  fieldError: string | null;
};

const CATALOGS: {
  id: MappingCatalogKind;
  label: string;
  icon: typeof Package;
  table: BasMappingTable;
  allowClear: boolean;
}[] = [
  { id: "tmc", label: "ТМЦ", icon: Package, table: "inventory_items_cache", allowClear: false },
  { id: "machinery", label: "Техніка", icon: Tractor, table: "wialon_bas_mapping", allowClear: true },
  { id: "storages", label: "Склади", icon: Fuel, table: "fuel_storages", allowClear: true },
  { id: "fields", label: "Поля", icon: MapIcon, table: "farm_fields", allowClear: true },
];

function initialValues(rows: MappingLocalRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [row.id, row.basRefKey ?? UNMAPPED_VALUE])
  );
}

function EntityIcon({
  kind,
  className,
}: {
  kind: MappingCatalogKind;
  className?: string;
}) {
  const Icon =
    kind === "tmc"
      ? Package
      : kind === "machinery"
        ? Tractor
        : kind === "storages"
          ? Fuel
          : MapIcon;
  return <Icon className={className} />;
}

export function MappingStudio(props: MappingStudioProps) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<MappingCatalogKind>("tmc");
  const [pending, startTransition] = useTransition();
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [pendingAuto, setPendingAuto] = useState<Record<string, string> | null>(
    null
  );

  const meta = CATALOGS.find((c) => c.id === catalog)!;

  const rows =
    catalog === "tmc"
      ? props.tmc
      : catalog === "machinery"
        ? props.machinery
        : catalog === "storages"
          ? props.storages
          : props.fields;

  const rowsKey = useMemo(
    () => rows.map((r) => `${r.id}:${r.basRefKey ?? ""}`).join("|"),
    [rows]
  );

  const options =
    catalog === "tmc"
      ? props.tmcOptions
      : catalog === "machinery"
        ? props.machineryOptions
        : catalog === "storages"
          ? props.storageOptions
          : props.fieldOptions;

  const optionsError =
    catalog === "tmc"
      ? props.tmcError
      : catalog === "machinery"
        ? props.machineryError
        : catalog === "storages"
          ? props.storageError
          : props.fieldError;

  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(rows)
  );
  const [saved, setSaved] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.basRefKey]))
  );

  useEffect(() => {
    setValues(initialValues(rows));
    setSaved(Object.fromEntries(rows.map((r) => [r.id, r.basRefKey])));
    setAutoNote(null);
    setPendingAuto(null);
    // rowsKey фіксує зміну даних без зайвого скидання на кожен рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, rowsKey]);

  const mappedCount = useMemo(
    () =>
      rows.filter((row) => {
        const v = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
        return v !== UNMAPPED_VALUE;
      }).length,
    [rows, values]
  );

  const stats = useMemo(() => {
    return CATALOGS.map((c) => {
      const list =
        c.id === "tmc"
          ? props.tmc
          : c.id === "machinery"
            ? props.machinery
            : c.id === "storages"
              ? props.storages
              : props.fields;
      const linked = list.filter((r) => r.basRefKey).length;
      return { id: c.id, total: list.length, linked };
    });
  }, [props.tmc, props.machinery, props.storages, props.fields]);

  function runAutoMatch() {
    const current = values;
    let suggested: Record<string, string>;
    let filled = 0;

    if (catalog === "fields") {
      suggested = autoMapFieldRows(rows, options, current);
      for (const row of rows) {
        const before = current[row.id] ?? UNMAPPED_VALUE;
        const after = suggested[row.id] ?? before;
        if (before === UNMAPPED_VALUE && after !== UNMAPPED_VALUE) filled += 1;
      }
    } else if (catalog === "machinery") {
      suggested = autoMapMachineryRows(rows, options, current);
      for (const row of rows) {
        const before = current[row.id] ?? UNMAPPED_VALUE;
        const after = suggested[row.id] ?? before;
        if (before === UNMAPPED_VALUE && after !== UNMAPPED_VALUE) filled += 1;
      }
    } else {
      const res = autoMapByExactName(rows, options, current);
      suggested = res.next;
      filled = res.filled;
    }

    setValues(suggested);
    setPendingAuto(suggested);
    setAutoNote(
      filled > 0
        ? `Знайдено ${filled} точних збігів. Натисніть «Застосувати», щоб зберегти.`
        : "Точних збігів назв не знайдено серед незіставлених."
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
        return {
          table: meta.table,
          id: row.id,
          basRefKey: nextKey,
        };
      })
      .filter(Boolean) as Array<{
      table: BasMappingTable;
      id: string;
      basRefKey: string | null;
    }>;

    if (dirty.length === 0) {
      toast.message("Немає змін для збереження");
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
      toast.error("ТМЦ має лишатися привʼязаною до номенклатури BAS AGRO");
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
      toast.success(nextKey ? "Звʼязок збережено" : "Відвʼязано від BAS AGRO");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
      {/* Catalog sub-nav */}
      <aside className="flex shrink-0 flex-row flex-wrap gap-1.5 lg:w-52 lg:flex-col">
        {CATALOGS.map((c) => {
          const Icon = c.icon;
          const active = catalog === c.id;
          const st = stats.find((s) => s.id === c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatalog(c.id)}
              className={cn(
                "inline-flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition",
                active
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{c.label}</span>
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  active ? "opacity-80" : "opacity-50"
                )}
              >
                {st ? `${st.linked}/${st.total}` : "—"}
              </span>
            </button>
          );
        })}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-foreground">
              Картки звʼязку · {meta.label}
            </p>
            <p className="text-xs text-muted-foreground">
              {mappedCount} / {rows.length} зіставлено з BAS AGRO
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || rows.length === 0}
              onClick={runAutoMatch}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Авто-зіставлення за назвою
            </Button>
            {pendingAuto ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={applyAutoMatch}
                className="h-9 gap-1.5 rounded-xl"
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

        {optionsError ? (
          <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {optionsError}
          </p>
        ) : null}

        {autoNote ? (
          <p className="mb-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
            {autoNote}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground">
            Немає записів у цьому довіднику
          </p>
        ) : (
          <ul>
            {rows.map((row) => {
              const value = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
              const linked = value !== UNMAPPED_VALUE;
              const dirty =
                (value === UNMAPPED_VALUE ? null : value) !==
                (saved[row.id] ?? null);

              return (
                <li
                  key={row.id}
                  className={cn(
                    "mb-3 flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/40 p-4 shadow-sm backdrop-blur-xl transition-all",
                    "hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
                  )}
                >
                  {/* AgroSystem */}
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                        linked
                          ? "bg-emerald-500/10 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <EntityIcon kind={catalog} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {row.title}
                      </p>
                      {row.subtitle ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {row.subtitle}
                        </p>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                        {row.id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>

                  {/* Link indicator */}
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

                  {/* BAS combobox */}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md sm:items-end">
                    <MappingBasCombobox
                      options={options}
                      value={value === UNMAPPED_VALUE ? "" : value}
                      linked={linked}
                      disabled={pending}
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
                    {dirty && pendingAuto ? (
                      <span className="text-[10px] font-semibold text-amber-700">
                        очікує застосування
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

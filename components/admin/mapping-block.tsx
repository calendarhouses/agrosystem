"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Sparkles, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UNMAPPED_VALUE,
  autoMapMachineryRows,
  withUnmappedOption,
  type BasSelectOption,
  type MappingLocalRow,
} from "@/lib/bas-mapping";
import { cn } from "@/lib/utils";

type AutoMapMessages = {
  success: (filled: number) => string;
  empty: string;
};

type MappingBlockProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  rows: MappingLocalRow[];
  options: BasSelectOption[];
  optionsError?: string | null;
  emptyText: string;
  enableAutoMap?: boolean;
  autoMapRows?: (
    rows: MappingLocalRow[],
    options: BasSelectOption[],
    values: Record<string, string>
  ) => Record<string, string>;
  autoMapMessages?: AutoMapMessages;
  onSave: (id: string, basRefKey: string | null) => Promise<void>;
};

function initialValues(rows: MappingLocalRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [row.id, row.basRefKey ?? UNMAPPED_VALUE])
  );
}

export function MappingBlock({
  title,
  description,
  icon: Icon,
  rows,
  options,
  optionsError,
  emptyText,
  enableAutoMap = false,
  autoMapRows = autoMapMachineryRows,
  autoMapMessages = {
    success: (filled) =>
      `Підставлено ${filled} збіг(ів). Перевірте і натисніть «Зберегти».`,
    empty: "Збігів не знайдено для незіставлених записів.",
  },
  onSave,
}: MappingBlockProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(rows)
  );
  const [autoMapNote, setAutoMapNote] = useState<string | null>(null);

  const mappedCount = rows.filter((row) => {
    const value = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    return value !== UNMAPPED_VALUE;
  }).length;

  function handleAutoMap() {
    const suggested = autoMapRows(rows, options, values);
    let filled = 0;
    for (const row of rows) {
      const before = values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
      const after = suggested[row.id] ?? before;
      if (
        (before === UNMAPPED_VALUE || !before) &&
        after &&
        after !== UNMAPPED_VALUE
      ) {
        filled += 1;
      }
    }
    setValues(suggested);
    setAutoMapNote(filled > 0 ? autoMapMessages.success(filled) : autoMapMessages.empty);
  }

  return (
    <GlassCard className="hover:translate-y-0 hover:shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#C05621]/25 bg-[#C05621]/10 text-[#C05621]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900">{title}</h2>
            <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enableAutoMap ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleAutoMap}
              className="h-9 gap-1.5 rounded-lg border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-[#E5DFD3]/50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#C05621]" />
              Авто-мапінг 🪄
            </Button>
          ) : null}
          <Badge
            variant="outline"
            className="rounded-lg border-[#E5DFD3] bg-zinc-100/80 text-zinc-600"
          >
            {mappedCount} / {rows.length}
          </Badge>
        </div>
      </div>

      {optionsError ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {optionsError}
        </p>
      ) : null}

      {autoMapNote ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {autoMapNote}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E5DFD3] bg-zinc-100/50 px-4 py-8 text-center text-sm text-zinc-500">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_7.5rem] md:gap-3">
            <span>У AgroSystem</span>
            <span>Довідник BAS AGRO</span>
            <span className="text-right">Дія</span>
          </div>
          {rows.map((row) => (
            <MappingRow
              key={row.id}
              row={row}
              options={options}
              value={values[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE}
              onValueChange={(next) => {
                setValues((prev) => ({ ...prev, [row.id]: next }));
                setAutoMapNote(null);
              }}
              onSave={onSave}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function MappingRow({
  row,
  options,
  value,
  onValueChange,
  onSave,
}: {
  row: MappingLocalRow;
  options: BasSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  onSave: (id: string, basRefKey: string | null) => Promise<void>;
}) {
  const [savedKey, setSavedKey] = useState(row.basRefKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const selectItems = useMemo(() => {
    const next = withUnmappedOption(options);
    if (savedKey && !next.some((item) => item.value === savedKey)) {
      next.splice(1, 0, {
        value: savedKey,
        label: `Збережений ключ (${savedKey.slice(0, 8)}…)`,
      });
    }
    return next;
  }, [options, savedKey]);

  const dirty = (value === UNMAPPED_VALUE ? null : value) !== savedKey;
  const mapped = savedKey != null;

  async function handleSave() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextKey = value === UNMAPPED_VALUE ? null : value;
      await onSave(row.id, nextKey);
      setSavedKey(nextKey);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100/40 px-3 py-3">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_7.5rem]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-zinc-900">{row.title}</p>
            <Badge
              variant="outline"
              className={cn(
                "hidden rounded-md sm:inline-flex",
                mapped
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : dirty
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-[#E5DFD3] bg-white text-zinc-500"
              )}
            >
              {mapped ? "Зіставлено" : dirty ? "Підставлено" : "Порожньо"}
            </Badge>
          </div>
          {row.subtitle ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {row.subtitle}
            </p>
          ) : null}
        </div>

        <Select
          items={selectItems}
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string" && next) {
              onValueChange(next);
              setJustSaved(false);
              setError(null);
            }
          }}
        >
          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-[#E5DFD3] bg-[#F4F1EA] text-left text-sm text-zinc-900 data-[size=default]:h-10">
            <SelectValue placeholder="Оберіть запис BAS AGRO" />
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            className="z-[220] max-h-72 border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900"
          >
            {selectItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span className="line-clamp-2">{item.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void handleSave()}
          className={cn(
            "h-10 w-full rounded-lg border-0 px-3 text-sm font-semibold shadow-sm md:w-[7.5rem]",
            justSaved
              ? "bg-emerald-600 text-white hover:bg-emerald-600"
              : "bg-[#276749] text-white hover:bg-[#22543d]"
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved ? (
            <>
              <Check className="h-4 w-4" />
              Ок
            </>
          ) : (
            "Зберегти"
          )}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

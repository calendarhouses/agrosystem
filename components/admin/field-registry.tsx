"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Save, Sparkles, TriangleAlert, X } from "lucide-react";

import {
  saveFieldRegistryRow,
  saveFieldRegistryRows,
  type SaveFieldRegistryInput,
} from "@/app/admin/fields/actions";
import { BasFieldGaps } from "@/components/admin/bas-field-gaps";
import { BasMergedFields } from "@/components/admin/bas-merged-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { suggestFieldRegistry } from "@/lib/bas-field-names";
import {
  canonicalNameCounts,
  describeIssue,
  fieldsMissingInBas,
  mergedBasRecords,
  registryIssue,
  toBasFieldRefs,
  toRegistryInputRows,
  unmatchedBasFields,
  type BasFieldSummary,
  type FieldRegistryRow,
  type RegistryIssue,
} from "@/lib/field-registry";
import { cn } from "@/lib/utils";

type Draft = {
  canonicalName: string;
  fieldNo: string;
  tract: string;
  isField: boolean;
  basRefKey: string | null;
};

function toDraft(row: FieldRegistryRow): Draft {
  return {
    canonicalName: row.canonicalName,
    fieldNo: row.fieldNo,
    tract: row.tract,
    isField: row.isField,
    basRefKey: row.basRefKey,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.canonicalName.trim() === b.canonicalName.trim() &&
    a.fieldNo.trim() === b.fieldNo.trim() &&
    a.tract.trim() === b.tract.trim() &&
    a.isField === b.isField &&
    (a.basRefKey ?? null) === (b.basRefKey ?? null)
  );
}

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});

export function FieldRegistry({
  rows,
  basFields,
  basError,
}: {
  rows: FieldRegistryRow[];
  basFields: BasFieldSummary[];
  basError: string | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, toDraft(row)]))
  );
  const [saved, setSaved] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, toDraft(row)]))
  );
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const basByRef = useMemo(
    () => new Map(basFields.map((field) => [field.refKey, field])),
    [basFields]
  );

  const effectiveRows = useMemo(
    () => rows.map((row) => ({ ...row, ...(drafts[row.id] ?? toDraft(row)) })),
    [rows, drafts]
  );

  const nameCounts = useMemo(
    () => canonicalNameCounts(effectiveRows),
    [effectiveRows]
  );
  const issueById = useMemo(
    () =>
      new Map(
        effectiveRows.map((row) => [row.id, registryIssue(row, nameCounts)])
      ),
    [effectiveRows, nameCounts]
  );

  const missing = useMemo(
    () => fieldsMissingInBas(effectiveRows),
    [effectiveRows]
  );
  const gaps = useMemo(
    () => unmatchedBasFields(effectiveRows, basFields),
    [effectiveRows, basFields]
  );
  const merged = useMemo(
    () => mergedBasRecords(effectiveRows, basFields),
    [effectiveRows, basFields]
  );

  const fieldCount = effectiveRows.filter((row) => row.isField).length;
  const linkedCount = fieldCount - missing.length;
  const issueCount = [...issueById.values()].filter(Boolean).length;

  const dirtyRows = rows.filter(
    (row) =>
      !sameDraft(drafts[row.id] ?? toDraft(row), saved[row.id] ?? toDraft(row))
  );

  function handleAutoFill() {
    const suggestions = suggestFieldRegistry(
      toRegistryInputRows(rows.filter((row) => row.isField)),
      toBasFieldRefs(basFields)
    );

    let touched = 0;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const suggestion = suggestions[row.id];
        if (!suggestion) continue;
        const current = next[row.id] ?? toDraft(row);
        const updated: Draft = {
          ...current,
          canonicalName: suggestion.canonicalName,
          fieldNo: suggestion.fieldNo ?? "",
          tract: suggestion.tract ?? "",
          // Зв'язок лише підставляємо; наявний вибір не перетираємо.
          basRefKey: current.basRefKey ?? suggestion.basRefKey,
        };
        if (!sameDraft(current, updated)) touched += 1;
        next[row.id] = updated;
      }
      return next;
    });

    setError(null);
    setNote(
      touched > 0
        ? `Оновлено ${touched} рядк(ів): назва, номер і збіг із довідником 1С. Перевірте і збережіть.`
        : "Підказки збігаються з тим, що вже введено."
    );
  }

  async function handleSaveRow(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    const result = await saveFieldRegistryRow({ id, ...draft });
    if (!result.ok) throw new Error(result.error);
    setSaved((prev) => ({ ...prev, [id]: { ...draft } }));
  }

  async function handleSaveAll() {
    if (dirtyRows.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const payload: SaveFieldRegistryInput[] = dirtyRows.map((row) => ({
        id: row.id,
        ...(drafts[row.id] ?? toDraft(row)),
      }));
      const result = await saveFieldRegistryRows(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved((prev) => {
        const next = { ...prev };
        for (const row of dirtyRows) {
          next[row.id] = { ...(drafts[row.id] ?? toDraft(row)) };
        }
        return next;
      });
      setNote(
        `Збережено ${result.data.saved} рядк(ів)` +
          (result.data.failed ? `, не вдалося ${result.data.failed}` : "")
      );
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="hover:translate-y-0 hover:shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900">Реєстр полів</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Назви з Wialon неоднозначні, тому канонічну назву й номер поля
              задаєте ви. Дані живуть тільки в нашій базі — у 1С ми лише читаємо
              довідник, нічого там не змінюємо.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleAutoFill}
              className="h-9 gap-1.5 rounded-lg border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-[#E5DFD3]/50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#C05621]" />
              Заповнити автоматично
            </Button>
            <Button
              type="button"
              disabled={dirtyRows.length === 0 || bulkBusy}
              onClick={() => void handleSaveAll()}
              className="h-9 gap-1.5 rounded-lg border-0 bg-[#276749] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#22543d]"
            >
              {bulkBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Зберегти все ({dirtyRows.length})
            </Button>
            <Badge
              variant="outline"
              className="rounded-lg border-[#E5DFD3] bg-zinc-100/80 text-zinc-600"
            >
              {linkedCount} / {fieldCount} звірено з 1С
            </Badge>
          </div>
        </div>

        {basError ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {basError}
          </p>
        ) : null}

        {note ? (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {note}
          </p>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {issueCount > 0 ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {issueCount} рядк(ів) ще не готові: порожня чи неунікальна назва або
            невідома площа.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E5DFD3] bg-zinc-100/50 px-4 py-8 text-center text-sm text-zinc-500">
            Немає полів у farm_fields. Синхронізація Wialon не знайшла геозон.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_minmax(0,0.7fr)_minmax(0,0.9fr)_5.5rem] lg:gap-3">
              <span>Wialon</span>
              <span>Канонічна назва</span>
              <span>№ поля</span>
              <span>Урочище</span>
              <span>Поле в 1С</span>
              <span className="text-right">Дія</span>
            </div>
            {rows.map((row) => (
              <RegistryRow
                key={row.id}
                row={row}
                draft={drafts[row.id] ?? toDraft(row)}
                savedDraft={saved[row.id] ?? toDraft(row)}
                issue={issueById.get(row.id) ?? null}
                basField={
                  (drafts[row.id] ?? toDraft(row)).basRefKey
                    ? basByRef.get((drafts[row.id] ?? toDraft(row)).basRefKey!) ??
                      null
                    : null
                }
                onChange={(patch) => {
                  setDrafts((prev) => ({
                    ...prev,
                    [row.id]: { ...(prev[row.id] ?? toDraft(row)), ...patch },
                  }));
                  setNote(null);
                }}
                onSave={() => handleSaveRow(row.id)}
              />
            ))}
          </div>
        )}
      </GlassCard>

      <MissingInBas rows={missing} />
      <BasMergedFields records={merged} />
      <BasFieldGaps fields={gaps} />
    </div>
  );
}

function MissingInBas({ rows }: { rows: FieldRegistryRow[] }) {
  return (
    <GlassCard className="hover:translate-y-0 hover:shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
          <TriangleAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">
            Наші поля, яких немає в 1С
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Нічого не створюємо в BAS. Це список під майбутні чернетки, які
            бухгалтер перевірить і проведе сам.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E5DFD3] bg-zinc-100/50 px-4 py-6 text-center text-sm text-zinc-500">
          Кожне наше поле звірене з довідником 1С.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {rows.map((row) => (
              <span
                key={row.id}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-sm text-zinc-800"
              >
                <span className="font-medium">
                  {row.canonicalName.trim() || row.wialonName}
                </span>
                <span className="text-xs text-zinc-500">
                  {row.fieldNo ? `№${row.fieldNo} · ` : ""}
                  {row.areaHa != null
                    ? `${numberFormat.format(row.areaHa)} га`
                    : "без площі"}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Разом {rows.length} поле(ів) на{" "}
            {numberFormat.format(
              rows.reduce((sum, row) => sum + (row.areaHa ?? 0), 0)
            )}{" "}
            га.
          </p>
        </>
      )}
    </GlassCard>
  );
}

function RegistryRow({
  row,
  draft,
  savedDraft,
  issue,
  basField,
  onChange,
  onSave,
}: {
  row: FieldRegistryRow;
  draft: Draft;
  savedDraft: Draft;
  issue: RegistryIssue | null;
  basField: BasFieldSummary | null;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = !sameDraft(draft, savedDraft);

  async function handleSave() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave();
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-10 rounded-lg border-[#E5DFD3] bg-[#F4F1EA] px-3 text-sm text-zinc-900";

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3",
        draft.isField
          ? "border-[#E5DFD3] bg-zinc-100/40"
          : "border-[#E5DFD3]/60 bg-zinc-100/20 opacity-70"
      )}
    >
      <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_minmax(0,0.7fr)_minmax(0,0.9fr)_5.5rem]">
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-900">
            {row.wialonName}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="truncate text-xs text-zinc-500">
              {row.areaHa != null
                ? `${numberFormat.format(row.areaHa)} га`
                : "площа невідома"}
            </p>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={draft.isField}
                onChange={(event) => onChange({ isField: event.target.checked })}
                className="h-3.5 w-3.5 accent-[#276749]"
              />
              Це поле
            </label>
          </div>
        </div>

        <Input
          value={draft.canonicalName}
          onChange={(event) => onChange({ canonicalName: event.target.value })}
          placeholder="Назва для 1С"
          className={inputClass}
          disabled={!draft.isField}
        />

        <Input
          value={draft.fieldNo}
          onChange={(event) => onChange({ fieldNo: event.target.value })}
          placeholder="1.1"
          className={inputClass}
          disabled={!draft.isField}
        />

        <Input
          value={draft.tract}
          onChange={(event) => onChange({ tract: event.target.value })}
          placeholder="Урочище"
          className={inputClass}
          disabled={!draft.isField}
        />

        <BasLink
          basField={basField}
          isField={draft.isField}
          issue={issue}
          onUnlink={() => onChange({ basRefKey: null })}
        />

        <Button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void handleSave()}
          className={cn(
            "h-10 w-full rounded-lg border-0 px-3 text-sm font-semibold shadow-sm",
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

function BasLink({
  basField,
  isField,
  issue,
  onUnlink,
}: {
  basField: BasFieldSummary | null;
  isField: boolean;
  issue: RegistryIssue | null;
  onUnlink: () => void;
}) {
  if (!isField) {
    return (
      <Badge
        variant="outline"
        className="justify-center rounded-md border-[#E5DFD3] bg-white text-zinc-500"
      >
        Не поле
      </Badge>
    );
  }

  if (basField) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-emerald-800">
          {basField.description || "Без назви"}
          {basField.areaHa != null
            ? ` · ${numberFormat.format(basField.areaHa)} га`
            : ""}
        </span>
        <button
          type="button"
          onClick={onUnlink}
          title="Відв'язати від 1С"
          className="shrink-0 rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (issue) {
    return (
      <Badge
        variant="outline"
        className="justify-center rounded-md border-amber-200 bg-amber-50 text-amber-800"
        title={describeIssue(issue)}
      >
        {describeIssue(issue)}
      </Badge>
    );
  }

  return (
    <Link
      href="/admin/mapping"
      className="truncate rounded-md border border-[#E5DFD3] bg-white px-2 py-1.5 text-center text-xs text-zinc-500 hover:bg-[#E5DFD3]/40"
      title="Обрати запис 1С вручну на сторінці мапінгу"
    >
      Немає в 1С
    </Link>
  );
}

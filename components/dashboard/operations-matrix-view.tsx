"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";

import { FinancePeriodToolbar } from "@/components/dashboard/finance-period-toolbar";
import { OperationsEventDetailSheet } from "@/components/dashboard/operations-event-detail-sheet";
import { OperationsFieldAddSheet } from "@/components/dashboard/operations-field-add-sheet";
import { OperationsMetroMap } from "@/components/dashboard/operations-metro-map";
import { OperationsOperationFormSheet } from "@/components/dashboard/operations-operation-form-sheet";
import { OperationsPanelShell } from "@/components/dashboard/operations-sheet-chrome";
import { QuickIssueSheet } from "@/components/dashboard/quick-issue-sheet";
import { Input } from "@/components/ui/input";
import {
  filterTimelineByIsoRange,
} from "@/lib/field-timeline-filter";
import type { FieldTimelineField, UnifiedTimelineEvent } from "@/lib/field-timeline";
import { useFieldTimeline } from "@/lib/use-field-timeline";
import { useFinancePeriodFilter } from "@/lib/use-finance-period-filter";
import { cn } from "@/lib/utils";

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function fieldMatchesSearch(field: FieldTimelineField, query: string): boolean {
  if (!query) return true;
  return (
    field.name.toLowerCase().includes(query) ||
    field.crop.toLowerCase().includes(query)
  );
}

export function OperationsMatrixView() {
  const router = useRouter();
  const periodFilter = useFinancePeriodFilter("Сезон");
  const { isoRange, seasonYear } = periodFilter;
  const { fieldsWithTimeline, isLoading, error, refresh, season } =
    useFieldTimeline(String(seasonYear));

  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<{
    event: UnifiedTimelineEvent;
    field: FieldTimelineField;
  } | null>(null);
  const [addField, setAddField] = useState<FieldTimelineField | null>(null);
  const [addOperationField, setAddOperationField] =
    useState<FieldTimelineField | null>(null);
  const [addIssueField, setAddIssueField] = useState<FieldTimelineField | null>(
    null
  );

  const searchQuery = normalizeSearch(search);

  const filteredFields = useMemo(
    () =>
      filterTimelineByIsoRange(
        fieldsWithTimeline,
        isoRange.startIso,
        isoRange.endIso
      ),
    [fieldsWithTimeline, isoRange.endIso, isoRange.startIso]
  );

  const visibleFields = useMemo(() => {
    const bySearch = filteredFields.filter((item) =>
      fieldMatchesSearch(item.field, searchQuery)
    );
    if (searchQuery) return bySearch;
    return bySearch.filter((item) => item.events.length > 0);
  }, [filteredFields, searchQuery]);

  function handleExit() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-50">
      <header className="shrink-0 border-b border-white/5 px-4 pt-[max(0.75rem,var(--safe-top))] pb-2">
        <div className="relative mb-3 flex h-10 items-center justify-center">
          <button
            type="button"
            onClick={handleExit}
            className="absolute left-0 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="size-4" />
            На карту
          </button>
          <h1 className="px-24 text-center text-base font-semibold tracking-tight text-zinc-50">
            Хронологія полів
          </h1>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук поля…"
            className="h-11 border-white/10 bg-white/5 pl-10 pr-10 text-zinc-50 placeholder:text-zinc-500 focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/20"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
              aria-label="Очистити пошук"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <FinancePeriodToolbar
          {...periodFilter}
          theme="dark"
          loading={isLoading}
          className="space-y-2"
        />
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-y-auto px-4 pt-1.5 pb-4",
          "touch-pan-y [-webkit-overflow-scrolling:touch]",
          "pb-[calc(var(--bottom-nav-height)+1rem)] md:pb-6"
        )}
        data-allow-pan="true"
        data-vaul-no-drag=""
      >
        {!isLoading && error ? (
          <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && visibleFields.length === 0 ? (
          <p className="rounded-3xl border border-white/10 bg-white/5 px-4 py-12 text-center text-sm text-zinc-500">
            {searchQuery
              ? "Полів за запитом не знайдено."
              : "За обраний період подій немає. Спробуйте інший діапазон або додайте операцію через пошук поля."}
          </p>
        ) : (
          <OperationsMetroMap
            fields={visibleFields}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onEventClick={(field, event) => setSelectedEvent({ field, event })}
            onAddClick={(field) => setAddField(field)}
          />
        )}
      </div>

      <OperationsEventDetailSheet
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
        event={selectedEvent?.event ?? null}
        field={selectedEvent?.field ?? null}
        season={season}
        onChanged={refresh}
      />

      <OperationsFieldAddSheet
        open={Boolean(addField)}
        onOpenChange={(open) => {
          if (!open) setAddField(null);
        }}
        field={addField}
        onAddOperation={() => {
          setAddOperationField(addField);
          setAddField(null);
        }}
        onAddInventory={() => {
          setAddIssueField(addField);
          setAddField(null);
        }}
      />

      <OperationsOperationFormSheet
        open={Boolean(addOperationField)}
        onOpenChange={(open) => {
          if (!open) setAddOperationField(null);
        }}
        field={addOperationField}
        seasonYear={seasonYear}
        onSaved={refresh}
      />

      <OperationsPanelShell
        open={Boolean(addIssueField)}
        onOpenChange={(open) => {
          if (!open) setAddIssueField(null);
        }}
        title="Списати ТМЦ"
      >
        {addIssueField ? (
          <QuickIssueSheet
            variant="panel"
            theme="dark"
            open
            onOpenChange={(open) => {
              if (!open) setAddIssueField(null);
            }}
            presetFieldId={addIssueField.id}
            lockField
            onSuccess={() => {
              refresh();
              setAddIssueField(null);
            }}
          />
        ) : null}
      </OperationsPanelShell>
    </section>
  );
}

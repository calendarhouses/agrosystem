"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";

import { FinancePeriodToolbar } from "@/components/dashboard/finance-period-toolbar";
import { allowHistoryBack } from "@/components/layout/prevent-edge-swipe-back";
import { OperationsEventDetailSheet } from "@/components/dashboard/operations-event-detail-sheet";
import { OperationsFieldAddSheet } from "@/components/dashboard/operations-field-add-sheet";
import { OperationsMetroMap } from "@/components/dashboard/operations-metro-map";
import { OperationsOperationFormSheet } from "@/components/dashboard/operations-operation-form-sheet";
import { OperationsScoutingFormSheet } from "@/components/dashboard/operations-scouting-form-sheet";
import { OperationsPanelShell } from "@/components/dashboard/operations-sheet-chrome";
import { QuickIssueSheet } from "@/components/dashboard/quick-issue-sheet";
import { Input } from "@/components/ui/input";
import {
  filterTimelineByIsoRange,
  getChroniclePeriodIsoRange,
} from "@/lib/field-timeline-filter";
import type { FieldTimelineField, FieldWithTimeline, UnifiedTimelineEvent } from "@/lib/field-timeline";
import { useFieldTimeline } from "@/lib/use-field-timeline";
import { ukFieldLabel, ukStationLabel } from "@/lib/uk-plural";
import { useFinancePeriodFilter } from "@/lib/use-finance-period-filter";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function fieldMatchesSearch(item: FieldWithTimeline, query: string): boolean {
  if (!query) return true;
  return (
    item.fieldName.toLowerCase().includes(query) ||
    item.cropName.toLowerCase().includes(query)
  );
}

function OperationsSheets({
  selectedEvent,
  setSelectedEvent,
  addField,
  setAddField,
  addOperationField,
  setAddOperationField,
  addIssueField,
  setAddIssueField,
  addScoutingField,
  setAddScoutingField,
  season,
  seasonYear,
  refresh,
  issueTheme,
}: {
  selectedEvent: {
    event: UnifiedTimelineEvent;
    field: FieldTimelineField;
  } | null;
  setSelectedEvent: (
    value: {
      event: UnifiedTimelineEvent;
      field: FieldTimelineField;
    } | null
  ) => void;
  addField: FieldTimelineField | null;
  setAddField: (value: FieldTimelineField | null) => void;
  addOperationField: FieldTimelineField | null;
  setAddOperationField: (value: FieldTimelineField | null) => void;
  addIssueField: FieldTimelineField | null;
  setAddIssueField: (value: FieldTimelineField | null) => void;
  addScoutingField: FieldTimelineField | null;
  setAddScoutingField: (value: FieldTimelineField | null) => void;
  season: string;
  seasonYear: number;
  refresh: () => void;
  issueTheme: "dark" | "light";
}) {
  return (
    <>
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
        onAddScouting={() => {
          setAddScoutingField(addField);
          setAddField(null);
        }}
      />

      <OperationsScoutingFormSheet
        open={Boolean(addScoutingField)}
        onOpenChange={(open) => {
          if (!open) setAddScoutingField(null);
        }}
        field={addScoutingField}
        onSaved={refresh}
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
            theme={issueTheme}
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
    </>
  );
}

export function OperationsMatrixView() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const periodFilter = useFinancePeriodFilter("Сезон");
  const { period, customRange, seasonYear } = periodFilter;
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
  const [addScoutingField, setAddScoutingField] =
    useState<FieldTimelineField | null>(null);

  const searchQuery = normalizeSearch(search);

  const chronicleIsoRange = useMemo(
    () => getChroniclePeriodIsoRange(period, seasonYear, customRange),
    [period, seasonYear, customRange]
  );

  const filteredFields = useMemo(
    () =>
      filterTimelineByIsoRange(
        fieldsWithTimeline,
        chronicleIsoRange.startIso,
        chronicleIsoRange.endIso
      ),
    [fieldsWithTimeline, chronicleIsoRange.endIso, chronicleIsoRange.startIso]
  );

  const visibleFields = useMemo(() => {
    const bySearch = filteredFields.filter((item) =>
      fieldMatchesSearch(item, searchQuery)
    );
    if (searchQuery) return bySearch;
    return bySearch.filter((item) => item.events.length > 0);
  }, [filteredFields, searchQuery]);

  const summary = useMemo(() => {
    const stationCount = visibleFields.reduce(
      (sum, item) => sum + item.events.length,
      0
    );
    return { fieldCount: visibleFields.length, stationCount };
  }, [visibleFields]);

  function handleExit() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      allowHistoryBack();
      router.back();
      return;
    }
    router.push("/");
  }

  const sheets = (
    <OperationsSheets
      selectedEvent={selectedEvent}
      setSelectedEvent={setSelectedEvent}
      addField={addField}
      setAddField={setAddField}
      addOperationField={addOperationField}
      setAddOperationField={setAddOperationField}
      addIssueField={addIssueField}
      setAddIssueField={setAddIssueField}
      addScoutingField={addScoutingField}
      setAddScoutingField={setAddScoutingField}
      season={season}
      seasonYear={seasonYear}
      refresh={refresh}
      issueTheme="dark"
    />
  );

  const metroMap = (
    <OperationsMetroMap
      variant={isMobile ? "mobile" : "desktop"}
      fields={visibleFields}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onEventClick={(field, event) => setSelectedEvent({ field, event })}
      onAddClick={(field) => setAddField(field)}
    />
  );

  const emptyState = !isLoading && !error && visibleFields.length === 0;

  if (!isMobile) {
    return (
      <section className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-50">
        <header className="shrink-0 border-b border-white/5 px-6 pt-0 pb-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
                Хронологія полів
              </h1>
              <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">
                Наряди техніки та списання ТМЦ по полях обраного сезону.
                {!isLoading && !error ? (
                  <span className="ml-1 font-medium text-zinc-300">
                    {ukFieldLabel(summary.fieldCount)} ·{" "}
                    {ukStationLabel(summary.stationCount)}
                  </span>
                ) : null}
              </p>
            </div>

            <FinancePeriodToolbar
              {...periodFilter}
              variant="desktop"
              theme="dark"
              loading={isLoading}
              className="w-full shrink-0 lg:w-auto"
            />
          </div>

          <div className="relative mt-2 max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук поля або культури…"
              className="h-11 border-white/10 bg-white/5 pl-10 pr-10 text-zinc-50 placeholder:text-zinc-500 focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
                aria-label="Очистити пошук"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-2 pb-3">
          {!isLoading && error ? (
            <div className="mb-4 shrink-0 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {emptyState ? (
            <p className="rounded-3xl border border-white/10 bg-white/5 px-6 py-16 text-center text-sm text-zinc-500">
              {searchQuery
                ? "Полів за запитом не знайдено."
                : "За обраний період подій немає. Спробуйте інший діапазон або додайте операцію через пошук поля."}
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{metroMap}</div>
          )}
        </div>

        {sheets}
      </section>
    );
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
          "pb-[calc(var(--bottom-nav-height)+1rem)]"
        )}
        data-chronicle-scroll
        data-allow-pan="true"
        data-vaul-no-drag=""
      >
        {!isLoading && error ? (
          <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {emptyState ? (
          <p className="rounded-3xl border border-white/10 bg-white/5 px-4 py-12 text-center text-sm text-zinc-500">
            {searchQuery
              ? "Полів за запитом не знайдено."
              : "За обраний період подій немає. Спробуйте інший діапазон або додайте операцію через пошук поля."}
          </p>
        ) : (
          metroMap
        )}
      </div>

      {sheets}
    </section>
  );
}

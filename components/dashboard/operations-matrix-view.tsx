"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CircleDot,
  FileSpreadsheet,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { buildTimelineExcelPayload } from "@/app/operations/timeline-export-actions";
import { FinancePeriodToolbar } from "@/components/dashboard/finance-period-toolbar";
import { allowHistoryBack } from "@/components/layout/prevent-edge-swipe-back";
import { OperationsEventDetailSheet } from "@/components/dashboard/operations-event-detail-sheet";
import { OperationsFieldAddSheet } from "@/components/dashboard/operations-field-add-sheet";
import { OperationsMetroMap } from "@/components/dashboard/operations-metro-map";
import { OperationsOperationFormSheet } from "@/components/dashboard/operations-operation-form-sheet";
import { OperationsScoutingFormSheet } from "@/components/dashboard/operations-scouting-form-sheet";
import { OperationsPanelShell } from "@/components/dashboard/operations-sheet-chrome";
import { OperationsYearCalendar } from "@/components/dashboard/operations-year-calendar";
import { QuickIssueSheet } from "@/components/dashboard/quick-issue-sheet";
import { Input } from "@/components/ui/input";
import {
  filterTimelineByIsoRange,
  getChroniclePeriodIsoRange,
} from "@/lib/field-timeline-filter";
import {
  downloadFieldTimelineExcel,
  stationsFromVisibleFields,
} from "@/lib/field-timeline-excel-export";
import type { FieldTimelineField, FieldWithTimeline, UnifiedTimelineEvent } from "@/lib/field-timeline";
import { useFieldTimeline } from "@/lib/use-field-timeline";
import { ukFieldLabel, ukStationLabel } from "@/lib/uk-plural";
import { useFinancePeriodFilter } from "@/lib/use-finance-period-filter";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

const VIEW_MODE_KEY = "agrosystem-chronicle-view";

type ChronicleViewMode = "stations" | "calendar";

function readStoredViewMode(): ChronicleViewMode {
  if (typeof window === "undefined") return "stations";
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === "calendar" ? "calendar" : "stations";
  } catch {
    return "stations";
  }
}

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
  const [excelPending, startExcelTransition] = useTransition();
  const [viewMode, setViewMode] = useState<ChronicleViewMode>("stations");

  useEffect(() => {
    setViewMode(readStoredViewMode());
  }, []);

  function selectViewMode(next: ChronicleViewMode) {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }

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

  /** Календар року — увесь сезон (з урахуванням пошуку поля), без вузького періоду */
  const calendarFields = useMemo(() => {
    const bySearch = fieldsWithTimeline.filter((item) =>
      fieldMatchesSearch(item, searchQuery)
    );
    if (searchQuery) return bySearch;
    return bySearch.filter((item) => item.events.length > 0);
  }, [fieldsWithTimeline, searchQuery]);

  const summarySource =
    viewMode === "calendar" ? calendarFields : visibleFields;

  const summary = useMemo(() => {
    const stationCount = summarySource.reduce(
      (sum, item) => sum + item.events.length,
      0
    );
    return { fieldCount: summarySource.length, stationCount };
  }, [summarySource]);

  const excelFields =
    viewMode === "calendar" ? calendarFields : visibleFields;

  function handleExit() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      allowHistoryBack();
      router.back();
      return;
    }
    router.push("/");
  }

  function handleExcelExport() {
    if (summary.stationCount === 0) {
      toast.error("Немає станцій для експорту");
      return;
    }
    startExcelTransition(async () => {
      try {
        const stations = stationsFromVisibleFields(excelFields);
        const res = await buildTimelineExcelPayload(stations);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        const filename = downloadFieldTimelineExcel({
          rows: res.rows,
          fieldSummary: res.fieldSummary,
          periodLabel: `${period}_${seasonYear}`,
        });
        toast.success("Excel збережено", {
          description: `${ukStationLabel(res.rows.length)} · ${filename}`,
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не вдалося сформувати Excel"
        );
      }
    });
  }

  const excelButton = (
    <button
      type="button"
      onClick={handleExcelExport}
      disabled={excelPending || isLoading || summary.stationCount === 0}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition",
        "border-white/10 bg-white/5 text-zinc-100",
        "hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      )}
    >
      {excelPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FileSpreadsheet className="size-4" />
      )}
      Excel
      {!excelPending && summary.stationCount > 0 ? (
        <span className="text-[11px] font-medium text-zinc-400 tabular-nums">
          {summary.stationCount}
        </span>
      ) : null}
    </button>
  );

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

  const viewSwitcher = (
    <div className="inline-flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
      {(
        [
          { id: "stations" as const, label: "Станції", Icon: CircleDot },
          { id: "calendar" as const, label: "Календар", Icon: CalendarDays },
        ] as const
      ).map(({ id, label, Icon }) => {
        const active = viewMode === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => selectViewMode(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
              active
                ? "bg-white text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-100"
            )}
          >
            <Icon className="size-4" strokeWidth={2.2} />
            {label}
          </button>
        );
      })}
    </div>
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

  const yearCalendar = (
    <OperationsYearCalendar
      fields={calendarFields}
      seasonYear={seasonYear}
      isLoading={isLoading}
      onEventClick={(field, event) => setSelectedEvent({ field, event })}
    />
  );

  const mainContent =
    viewMode === "calendar" ? yearCalendar : metroMap;

  const emptyState =
    !isLoading &&
    !error &&
    (viewMode === "calendar"
      ? calendarFields.length === 0
      : visibleFields.length === 0);

  if (!isMobile) {
    return (
      <section className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-50">
        <header className="shrink-0 border-b border-white/5 px-6 pb-4 pt-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
                  Хронологія полів
                </h1>
              </div>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                {viewMode === "calendar"
                  ? "Річний огляд рухів по полях агросезону."
                  : "Наряди техніки та списання ТМЦ по полях обраного сезону."}
                {!isLoading && !error ? (
                  <span className="ml-1 font-medium text-zinc-300">
                    {ukFieldLabel(summary.fieldCount)} ·{" "}
                    {ukStationLabel(summary.stationCount)}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
              {viewMode === "stations" ? (
                <FinancePeriodToolbar
                  {...periodFilter}
                  variant="desktop"
                  theme="dark"
                  loading={isLoading}
                  className="w-full shrink-0 lg:w-auto"
                />
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex max-w-2xl items-center gap-3">
            <div className="relative flex-1">
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
            {viewSwitcher}
            {excelButton}
          </div>
        </header>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col px-6 pt-2 pb-3",
            viewMode === "calendar"
              ? "overflow-y-auto overscroll-y-auto"
              : "overflow-hidden"
          )}
          data-chronicle-scroll={viewMode === "calendar" ? true : undefined}
        >
          {!isLoading && error ? (
            <div className="mb-4 shrink-0 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {emptyState ? (
            <p className="rounded-3xl border border-white/10 bg-white/5 px-6 py-16 text-center text-sm text-zinc-500">
              {searchQuery
                ? "Полів за запитом не знайдено."
                : viewMode === "calendar"
                  ? "За сезон подій немає. Додайте наряд, списання або скаутинг."
                  : "За обраний період подій немає. Спробуйте інший діапазон або додайте операцію через пошук поля."}
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{mainContent}</div>
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

        <div className="mb-3 flex items-center justify-between gap-3">
          {viewSwitcher}
          {excelButton}
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

        {viewMode === "stations" ? (
          <FinancePeriodToolbar
            {...periodFilter}
            theme="dark"
            loading={isLoading}
            className="space-y-2"
          />
        ) : null}
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
              : viewMode === "calendar"
                ? "За сезон подій немає. Додайте наряд, списання або скаутинг."
                : "За обраний період подій немає. Спробуйте інший діапазон або додайте операцію через пошук поля."}
          </p>
        ) : (
          mainContent
        )}
      </div>

      {sheets}
    </section>
  );
}

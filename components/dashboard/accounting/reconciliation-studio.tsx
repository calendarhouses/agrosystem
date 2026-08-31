"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Fuel,
  Link2,
  Loader2,
  Map as MapIcon,
  Package,
  Plus,
  RefreshCw,
  Ruler,
  Sparkles,
  Split,
  Tractor,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildImportWorkbook,
  relinkFieldsWithBas,
  setBasRequestStatus,
} from "@/app/admin/bas-request/actions";
import { Button } from "@/components/ui/button";
import {
  allChangeItems,
  describeItem,
  describeStatus,
  itemStatus,
  requestToCsv,
  requestToText,
  type BasChangeRequest,
  type ChangeItem,
  type ChangeKind,
  type OrphanCollision,
} from "@/lib/bas-change-request";
import type { MappingCatalogKind } from "@/lib/bas-mapping";
import type { BasFieldSummary, BasRequestStatus } from "@/lib/field-registry";
import type {
  ReconciliationGapItem,
  ReconciliationHubCounts,
  ReconciliationLinkDomain,
  ReconciliationLinkGaps,
} from "@/lib/reconciliation-gaps";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});
const ha = (value: number) => `${numberFormat.format(value)} га`;

type DomainTab = "overview" | "fields" | ReconciliationLinkDomain;
type FieldFocus = "all" | ChangeKind | "orphans";

const KIND_META: Record<
  ChangeKind,
  {
    title: string;
    short: string;
    doLabel: string;
    hint: string;
    icon: typeof Plus;
    soft: string;
    ring: string;
  }
> = {
  create: {
    title: "Додати в BAS AGRO",
    short: "Нові поля",
    doLabel: "Додати",
    hint: "Поле є на карті / в обмірі, але його ще немає в довіднику BAS AGRO.",
    icon: Plus,
    soft: "bg-sky-50 text-sky-900 ring-sky-200/80",
    ring: "border-sky-200/80 bg-gradient-to-br from-sky-50/90 to-white",
  },
  split: {
    title: "Розділити в BAS AGRO",
    short: "Злиті",
    doLabel: "Розділити",
    hint: "У BAS AGRO один запис, а за обміром — кілька окремих полів.",
    icon: Split,
    soft: "bg-rose-50 text-rose-900 ring-rose-200/80",
    ring: "border-rose-200/80 bg-gradient-to-br from-rose-50/80 to-white",
  },
  area: {
    title: "Уточнити площу",
    short: "Площі",
    doLabel: "Уточнити",
    hint: "Звʼязок є, але площа в BAS AGRO помітно відрізняється від обміру.",
    icon: Ruler,
    soft: "bg-amber-50 text-amber-950 ring-amber-200/80",
    ring: "border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-white",
  },
};

const STATUS_STYLE: Record<BasRequestStatus, string> = {
  none: "border-zinc-200 bg-white text-zinc-500",
  pending: "border-sky-200 bg-sky-50 text-sky-800",
  synced: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

const LINK_DOMAIN_META: Record<
  ReconciliationLinkDomain,
  {
    title: string;
    short: string;
    /** Пояснення, коли в черзі є позиції */
    hint: string;
    /** Заголовок, коли черга порожня */
    empty: string;
    mappingCatalog: MappingCatalogKind;
    icon: typeof Tractor;
    cta: string;
  }
> = {
  machinery: {
    title: "Техніка",
    short: "Техніка",
    hint: "Нижче — техніка з GPS без пари в довіднику основних засобів. Оберіть запис у Мапінгу.",
    empty: "Уся техніка вже зіставлена з BAS AGRO",
    mappingCatalog: "machinery",
    icon: Tractor,
    cta: "Відкрити мапінг техніки",
  },
  storages: {
    title: "Склади ДП",
    short: "Склади ДП",
    hint: "Нижче — склади палива без пари в довіднику BAS AGRO. Оберіть склад у Мапінгу.",
    empty: "Усі склади ДП вже зіставлені з BAS AGRO",
    mappingCatalog: "storages",
    icon: Fuel,
    cta: "Відкрити мапінг складів",
  },
  tmc: {
    title: "Товари",
    short: "Товари",
    hint: "Нижче — товари без пари в номенклатурі BAS AGRO. Заведіть у BAS AGRO і звʼяжіть у Мапінгу.",
    empty: "Усі товари вже зіставлені з BAS AGRO",
    mappingCatalog: "tmc",
    icon: Package,
    cta: "Відкрити мапінг товарів",
  },
};

type Props = {
  request: BasChangeRequest;
  orphans: BasFieldSummary[];
  collisions: OrphanCollision[];
  basError: string | null;
  gaps: ReconciliationLinkGaps;
  counts: ReconciliationHubCounts;
  onRefresh: () => Promise<void>;
  onOpenMapping: (catalog: MappingCatalogKind) => void;
};

export function ReconciliationStudio({
  request,
  orphans,
  collisions,
  basError,
  gaps,
  counts,
  onRefresh,
  onOpenMapping,
}: Props) {
  const isMobile = useIsMobile();
  const [domain, setDomain] = useState<DomainTab>("overview");
  const [focus, setFocus] = useState<FieldFocus>("all");
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const items = useMemo(() => allChangeItems(request), [request]);
  const openItems = useMemo(
    () => items.filter((item) => itemStatus(item) !== "synced"),
    [items]
  );
  const totalHa = items.reduce((sum, item) => sum + item.areaHa, 0);
  const openHa = openItems.reduce((sum, item) => sum + item.areaHa, 0);

  const visibleItems = useMemo(() => {
    if (focus === "all" || focus === "orphans") {
      return openItems.length ? openItems : items;
    }
    return request[focus];
  }, [focus, items, openItems, request]);

  const fieldsAllDone = items.length > 0 && openItems.length === 0;
  const fieldsNothing = items.length === 0 && orphans.length === 0;
  const hubQuiet = counts.totalOpen === 0 && orphans.length === 0;

  function runAction(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusyKey(null);
      }
    });
  }

  function applyStatus(item: ChangeItem, status: BasRequestStatus) {
    runAction(item.key, async () => {
      const result = await setBasRequestStatus({
        fieldIds: item.rows.map((row) => row.id),
        status,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Позначено: ${describeStatus(status)}`);
      await onRefresh();
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(requestToText(request));
      toast.success("Текст заявки скопійовано — можна надіслати колезі");
    } catch {
      toast.error("Немає доступу до буфера обміну");
    }
  }

  function download(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleWorkbook() {
    runAction("workbook", async () => {
      const result = await buildImportWorkbook();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.base64), (c) =>
        c.charCodeAt(0)
      );
      download(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        result.data.fileName
      );
      toast.success(
        "Файл готовий — відкрийте в Excel і завантажте в довідник BAS AGRO"
      );
    });
  }

  function handleCsv() {
    download(
      new Blob(["\uFEFF", requestToCsv(request)], {
        type: "text/csv;charset=utf-8",
      }),
      `zayavka-polya-1c-${new Date().toISOString().slice(0, 10)}.csv`
    );
    toast.success("CSV завантажено");
  }

  function handleRelink() {
    runAction("relink", async () => {
      const result = await relinkFieldsWithBas();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { linked } = result.data;
      if (linked.length === 0) {
        toast.message("Нових збігів назв немає — усе вже підвʼязано");
      } else {
        toast.success(
          `Підвʼязано ${linked.length}: ${linked.map((l) => l.field).join(", ")}`
        );
      }
      await onRefresh();
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Список розбіжностей оновлено");
    } finally {
      setRefreshing(false);
    }
  }

  const showFieldsPanel = domain === "overview" || domain === "fields";
  const showLinkDomain =
    domain === "machinery" || domain === "storages" || domain === "tmc";

  return (
    <div className="relative h-full min-h-0 overflow-y-auto overscroll-none bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]">
      <div
        className="pointer-events-none absolute -top-28 right-0 h-[28rem] w-[28rem] rounded-full bg-[#276749]/[0.12] blur-3xl"
        aria-hidden
      />

      <header
        className={cn(
          "sticky top-0 z-40 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/90 backdrop-blur-xl",
          isMobile ? "px-2 py-2.5" : "px-4 py-3 sm:px-6"
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-7xl items-center",
            isMobile
              ? "gap-1"
              : "flex-nowrap gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden"
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy()}
            aria-label="Скопіювати"
            className={cn(
              "h-9 rounded-xl border-[#E5DFD3] bg-white/90",
              isMobile
                ? "min-w-0 flex-1 gap-1 px-1.5 text-[11px] font-semibold"
                : "shrink-0 gap-1.5"
            )}
          >
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
            {isMobile ? null : "Скопіювати"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCsv}
            className={cn(
              "h-9 rounded-xl border-[#E5DFD3] bg-white/90",
              isMobile
                ? "min-w-0 flex-1 gap-1 px-1.5 text-[11px] font-semibold"
                : "shrink-0 gap-1.5"
            )}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending && busyKey === "workbook"}
            onClick={handleWorkbook}
            className={cn(
              "h-9 rounded-xl border-[#E5DFD3] bg-white/90",
              isMobile
                ? "min-w-0 flex-1 gap-1 px-1.5 text-[11px] font-semibold"
                : "shrink-0 gap-1.5"
            )}
          >
            {pending && busyKey === "workbook" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
            )}
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending && busyKey === "relink"}
            onClick={handleRelink}
            title="Після того, як поля вже заведені або розділені в BAS AGRO"
            aria-label="Підтягнути"
            className={cn(
              "h-9 rounded-xl border-[#E5DFD3] bg-white/90",
              isMobile
                ? "min-w-0 flex-1 gap-1 px-1.5 text-[11px] font-semibold"
                : "shrink-0 gap-1.5"
            )}
          >
            {pending && busyKey === "relink" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5 shrink-0" />
            )}
            {isMobile ? null : "Підтягнути"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || pending}
            onClick={() => void handleRefresh()}
            className={cn(
              "h-9 rounded-xl border-[#E5DFD3] bg-white/90",
              isMobile
                ? "min-w-0 flex-1 gap-1 px-1.5 text-[11px] font-semibold"
                : "shrink-0 gap-1.5"
            )}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                refreshing && "animate-spin"
              )}
            />
            Оновити
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "relative mx-auto w-full max-w-7xl",
          isMobile
            ? "space-y-3 px-3 py-3 pb-[calc(var(--app-bottom-inset)+1rem)]"
            : "space-y-6 px-4 py-6 sm:px-6 lg:px-8"
        )}
      >
        {basError ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold">Не вдалося повністю прочитати BAS AGRO</p>
              <p className="mt-0.5 text-amber-800/90">{basError}</p>
            </div>
          </motion.div>
        ) : null}

        {/* Domain overview */}
        <section className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5 [&::-webkit-scrollbar]:hidden">
          <DomainChip
            active={domain === "overview"}
            onClick={() => setDomain("overview")}
            label="Усе"
            value={String(counts.totalOpen)}
            hint="усі розбіжності"
            icon={Sparkles}
            tone={counts.totalOpen === 0 ? "ok" : "warn"}
            compact
          />
          <DomainChip
            active={domain === "fields"}
            onClick={() => setDomain("fields")}
            label="Поля"
            value={String(counts.fieldsOpen)}
            hint={`${ha(openHa)} у роботі`}
            icon={MapIcon}
            tone={counts.fieldsOpen > 0 ? "accent" : "ok"}
            compact
          />
          {(["machinery", "storages", "tmc"] as const).map((id) => {
            const meta = LINK_DOMAIN_META[id];
            const Icon = meta.icon;
            const n = counts[id];
            return (
              <DomainChip
                key={id}
                active={domain === id}
                onClick={() => setDomain(id)}
                label={meta.short}
                value={String(n)}
                hint={n > 0 ? "без зіставлення" : "усе зіставлено"}
                icon={Icon}
                tone={n > 0 ? "warn" : "ok"}
                compact
              />
            );
          })}
        </section>

        {/* Три кроки — лише заголовки */}
        <section className="rounded-[1.75rem] border border-[#E5DFD3]/80 bg-[#FDFBF7]/90 p-5 shadow-[0_8px_30px_rgb(39,33,24,0.05)] sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#276749]" />
            <h3 className="text-sm font-bold tracking-wide text-zinc-900 uppercase">
              Що зробити
            </h3>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              {
                n: "1",
                title: "Подивіться розбіжності в списку нижче",
              },
              {
                n: "2",
                title: "Виправте в BAS AGRO або звʼяжіть у Мапінгу",
              },
              {
                n: "3",
                title: "Позначте «Виконано» або підтягніть звʼязки",
              },
            ].map((step, i) => (
              <motion.li
                key={step.n}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="relative flex items-center gap-3 rounded-2xl border border-[#E5DFD3]/70 bg-white/70 p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#276749] text-sm font-bold text-white">
                  {step.n}
                </span>
                <p className="min-w-0 text-sm font-semibold leading-snug text-zinc-900">
                  {step.title}
                </p>
                {i < 2 ? (
                  <ArrowRight className="absolute top-1/2 -right-2 hidden h-4 w-4 -translate-y-1/2 text-zinc-300 sm:block lg:-right-3" />
                ) : null}
              </motion.li>
            ))}
          </ol>
        </section>

        {hubQuiet ? (
          <EmptyState
            icon={CheckCircle2}
            title="Усе зведено з BAS AGRO"
            body="Немає відкритих розбіжностей по полях, техніці, складах ДП і товарах."
          />
        ) : null}

        {/* Окремий домен техніка/склади/товари */}
        {showLinkDomain ? (
          <LinkGapQueue
            domain={domain}
            items={gaps[domain]}
            onOpenMapping={() =>
              onOpenMapping(LINK_DOMAIN_META[domain].mappingCatalog)
            }
          />
        ) : null}

        {/* Fields panel */}
        {showFieldsPanel && !hubQuiet ? (
          <>
            {(domain === "fields" || counts.fieldsOpen > 0 || !fieldsNothing) && (
              <section className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5 [&::-webkit-scrollbar]:hidden">
                <DomainChip
                  active={domain === "fields" && focus === "all"}
                  onClick={() => {
                    setDomain("fields");
                    setFocus("all");
                  }}
                  label="У роботі"
                  value={String(openItems.length)}
                  hint={`${ha(openHa)} · усього ${items.length}`}
                  icon={Sparkles}
                  tone={
                    openItems.length === 0
                      ? "ok"
                      : openItems.length > 5
                        ? "warn"
                        : "neutral"
                  }
                  compact
                />
                {(["create", "split", "area"] as const).map((kind) => (
                  <DomainChip
                    key={kind}
                    active={domain === "fields" && focus === kind}
                    onClick={() => {
                      setDomain("fields");
                      setFocus(kind);
                    }}
                    label={KIND_META[kind].short}
                    value={String(request[kind].length)}
                    hint={ha(
                      request[kind].reduce((s, item) => s + item.areaHa, 0)
                    )}
                    icon={KIND_META[kind].icon}
                    tone={request[kind].length > 0 ? "accent" : "neutral"}
                    compact
                  />
                ))}
                <DomainChip
                  active={domain === "fields" && focus === "orphans"}
                  onClick={() => {
                    setDomain("fields");
                    setFocus("orphans");
                  }}
                  label="Лише в BAS AGRO"
                  value={String(orphans.length)}
                  hint={
                    collisions.length > 0
                      ? `${collisions.length} з однаковою назвою`
                      : "без нашого поля"
                  }
                  icon={AlertTriangle}
                  tone={collisions.length > 0 ? "warn" : "neutral"}
                  compact
                />
              </section>
            )}

            <AnimatePresence>
              {collisions.length > 0 &&
              (domain === "overview" ||
                (domain === "fields" &&
                  (focus === "all" || focus === "orphans"))) ? (
                <motion.section
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-2xl border border-rose-200/80 bg-rose-50/90 px-4 py-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-rose-950">
                          Увага: однакові назви — різні ділянки
                        </h3>
                        <p className="mt-1 text-[13px] text-rose-800/90">
                          В BAS AGRO і в нас є записи з однаковою назвою, але різною
                          площею. Уточніть, яку ділянку має на увазі довідник,
                          перш ніж щось змінювати.
                        </p>
                        <ul className="mt-3 space-y-2">
                          {collisions.map((c) => (
                            <li
                              key={c.basField.refKey}
                              className="rounded-xl border border-rose-200/70 bg-white/80 px-3 py-2.5 text-sm text-rose-950"
                            >
                              <span className="font-semibold">
                                «{c.basField.description}»
                              </span>
                              <span className="text-rose-800/80">
                                {" "}
                                — у BAS AGRO{" "}
                                {c.basField.areaHa != null
                                  ? ha(c.basField.areaHa)
                                  : "без площі"}
                                , за обміром{" "}
                                {c.ourRow.areaHa != null
                                  ? ha(c.ourRow.areaHa)
                                  : "без площі"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </motion.section>
              ) : null}
            </AnimatePresence>

            {fieldsNothing && domain === "fields" ? (
              <EmptyState
                icon={CheckCircle2}
                title="Поля збігаються"
                body="Немає розбіжностей між обміром і довідником полів у BAS AGRO."
              />
            ) : null}

            {fieldsAllDone &&
            !fieldsNothing &&
            domain === "fields" &&
            focus !== "orphans" ? (
              <EmptyState
                icon={Sparkles}
                title="Усі позиції по полях закриті"
                body={`Опрацьовано ${items.length} · ${ha(totalHa)}.`}
              />
            ) : null}

            {domain === "fields" &&
            focus !== "orphans" &&
            visibleItems.length > 0 &&
            !(fieldsAllDone && focus === "all") ? (
              <section className="space-y-3">
                <div className="flex items-end justify-between gap-3 px-1">
                  <div>
                    <h3 className="text-base font-bold text-zinc-900">
                      {focus === "all"
                        ? "Що змінити в довіднику полів"
                        : KIND_META[focus].title}
                    </h3>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {focus === "all"
                        ? "Спочатку розділення й великі різниці площ."
                        : KIND_META[focus].hint}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-zinc-400 tabular-nums">
                    {visibleItems.length} поз.
                  </span>
                </div>

                <ul className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {sortedForDisplay(visibleItems).map((item, index) => (
                      <motion.li
                        key={item.key}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ delay: Math.min(index * 0.03, 0.24) }}
                      >
                        <ChangeCard
                          item={item}
                          busy={pending && busyKey === item.key}
                          onSetStatus={(status) => applyStatus(item, status)}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ) : null}

            {domain === "overview" && openItems.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-end justify-between gap-3 px-1">
                  <div>
                    <h3 className="text-base font-bold text-zinc-900">
                      Поля · черга
                    </h3>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      Що треба змінити в довіднику полів BAS AGRO
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDomain("fields")}
                    className="text-xs font-semibold text-[#276749] hover:underline"
                  >
                    Усі поля
                  </button>
                </div>
                <ul className="space-y-3">
                  {sortedForDisplay(openItems)
                    .slice(0, 5)
                    .map((item) => (
                      <ChangeCard
                        key={item.key}
                        item={item}
                        busy={pending && busyKey === item.key}
                        onSetStatus={(status) => applyStatus(item, status)}
                      />
                    ))}
                </ul>
                {openItems.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setDomain("fields")}
                    className="w-full rounded-2xl border border-dashed border-[#E5DFD3] bg-white/50 py-3 text-sm font-semibold text-zinc-600 hover:bg-white"
                  >
                    Ще {openItems.length - 5} по полях…
                  </button>
                ) : null}
              </section>
            ) : null}

            {domain === "fields" &&
            focus !== "orphans" &&
            focus !== "all" &&
            visibleItems.length === 0 &&
            !fieldsNothing ? (
              <EmptyState
                icon={CheckCircle2}
                title={`Немає: ${KIND_META[focus].short.toLowerCase()}`}
                body={KIND_META[focus].hint}
              />
            ) : null}

            {(domain === "fields" &&
              (focus === "orphans" || focus === "all") &&
              orphans.length > 0) ||
            (domain === "overview" && orphans.length > 0 && openItems.length === 0) ? (
              <section className="rounded-[1.75rem] border border-[#E5DFD3]/80 bg-[#FDFBF7]/90 p-5 shadow-[0_8px_30px_rgb(39,33,24,0.05)] sm:p-6">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900">
                      Є в BAS AGRO, немає в нас
                    </h3>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      Записи довідника без відповідного поля на карті. Їх не
                      чіпаємо автоматично — вирішіть, чи це застаріле, чи треба
                      додати поле в систему.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {orphans.map((field) => (
                    <span
                      key={field.refKey}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm"
                    >
                      <span className="font-medium">
                        {field.description || "Без назви"}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {field.areaHa != null ? ha(field.areaHa) : "без площі"}
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {/* Огляд: черги без зіставлення — після полів, списками + мапінг */}
        {domain === "overview" &&
        !hubQuiet &&
        (counts.machinery > 0 || counts.storages > 0 || counts.tmc > 0) ? (
          <section className="space-y-5">
            {(["machinery", "storages", "tmc"] as const).map((id) =>
              counts[id] > 0 ? (
                <LinkGapQueue
                  key={id}
                  domain={id}
                  items={gaps[id]}
                  onOpenMapping={() =>
                    onOpenMapping(LINK_DOMAIN_META[id].mappingCatalog)
                  }
                />
              ) : null
            )}
          </section>
        ) : null}

        <div className="pb-8" />
      </div>
    </div>
  );
}

function LinkGapQueue({
  domain,
  items,
  onOpenMapping,
}: {
  domain: ReconciliationLinkDomain;
  items: ReconciliationGapItem[];
  onOpenMapping: () => void;
}) {
  const meta = LINK_DOMAIN_META[domain];
  const Icon = meta.icon;

  if (items.length === 0) {
    return <EmptyState icon={CheckCircle2} title={meta.empty} />;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h3 className="text-base font-bold text-zinc-900">{meta.title}</h3>
          <p className="mt-0.5 text-sm text-zinc-500">{meta.hint}</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onOpenMapping}
          className="h-9 gap-1.5 rounded-xl bg-[#276749] text-white hover:bg-[#1f5339]"
        >
          <Link2 className="h-3.5 w-3.5" />
          {meta.cta}
        </Button>
      </div>
      <ul className="divide-y divide-[#E5DFD3]/70 overflow-hidden rounded-[1.75rem] border border-[#E5DFD3]/80 bg-[#FDFBF7]/90">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 px-4 py-3.5 sm:px-5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-800 ring-1 ring-amber-200/70">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {item.title}
              </p>
              {item.subtitle ? (
                <p className="truncate text-[12px] text-zinc-500">
                  {item.subtitle}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
              {item.reason === "local" ? "Нова позиція" : "Без зіставлення"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sortedForDisplay(items: ChangeItem[]): ChangeItem[] {
  const rank = (item: ChangeItem) => {
    if (item.kind === "split") return 0;
    if (item.kind === "area") return 1;
    return 2;
  };
  return [...items].sort((a, b) => {
    const statusA = itemStatus(a) === "synced" ? 1 : 0;
    const statusB = itemStatus(b) === "synced" ? 1 : 0;
    if (statusA !== statusB) return statusA - statusB;
    return rank(a) - rank(b);
  });
}

function DomainChip({
  active,
  onClick,
  label,
  value,
  hint,
  icon: Icon,
  tone,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  hint: string;
  icon: typeof Plus;
  tone: "ok" | "warn" | "accent" | "neutral";
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-2xl border text-left transition",
        "shadow-[0_4px_16px_rgb(39,33,24,0.04)] backdrop-blur-xl",
        compact
          ? "min-w-[7.25rem] px-3 py-2.5 sm:min-w-0 sm:px-4 sm:py-3.5"
          : "px-4 py-3.5",
        active
          ? "border-[#276749]/40 bg-[#276749] text-white ring-2 ring-[#276749]/25"
          : "border-[#E5DFD3]/80 bg-[#FDFBF7]/90 text-zinc-900 hover:border-[#276749]/25 hover:bg-white"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[10px] font-bold tracking-wide uppercase sm:text-[11px]",
            active ? "text-white/70" : "text-zinc-400"
          )}
        >
          {label}
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
          "mt-1 font-semibold tabular-nums tracking-tight",
          compact ? "text-xl sm:text-2xl" : "text-2xl"
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[10px] leading-snug sm:text-[11px]",
          active ? "text-white/65" : "text-zinc-500",
          compact && "line-clamp-1"
        )}
      >
        {hint}
      </p>
      <span className="sr-only">{tone}</span>
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CheckCircle2;
  title: string;
  body?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-[1.75rem] border border-emerald-200/70 bg-emerald-50/50 px-6 py-14 text-center"
    >
      <Icon className="mx-auto h-11 w-11 text-[#276749]/80" />
      <p className="mt-4 text-base font-semibold text-zinc-900">{title}</p>
      {body ? <p className="mt-1 text-sm text-zinc-500">{body}</p> : null}
    </motion.div>
  );
}

function ChangeCard({
  item,
  busy,
  onSetStatus,
}: {
  item: ChangeItem;
  busy: boolean;
  onSetStatus: (status: BasRequestStatus) => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const status = itemStatus(item);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm transition",
        meta.ring,
        status === "synced" && "opacity-70"
      )}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1",
                meta.soft
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ring-1",
                    meta.soft
                  )}
                >
                  {meta.doLabel}
                </span>
                <span className="text-xs font-medium text-zinc-400 tabular-nums">
                  {ha(item.areaHa)}
                </span>
                {item.kind === "split" ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-rose-200/80">
                    <AlertTriangle className="h-3 w-3" />
                    Пріоритет
                  </span>
                ) : null}
                {item.kind === "area" && Math.abs(item.deltaPct) >= 15 ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
                    <AlertTriangle className="h-3 w-3" />
                    {item.deltaHa > 0 ? "+" : ""}
                    {numberFormat.format(item.deltaPct)}%
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm font-medium leading-snug text-zinc-900">
                {describeItem(item)}
              </p>
              {item.kind === "area" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-lg bg-white/80 px-2 py-1 ring-1 ring-zinc-200/80">
                    У BAS AGRO: {ha(item.basField.areaHa ?? 0)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-zinc-300" />
                  <span className="rounded-lg bg-white/80 px-2 py-1 font-semibold text-zinc-800 ring-1 ring-zinc-200/80">
                    Обмір: {ha(item.areaHa)}
                  </span>
                </div>
              ) : null}
              {item.kind === "split" ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.rows.map((row) => (
                    <span
                      key={row.id}
                      className="rounded-lg bg-white/80 px-2 py-1 text-xs text-zinc-700 ring-1 ring-zinc-200/80"
                    >
                      {row.canonicalName.trim() || row.wialonName} ·{" "}
                      {ha(row.areaHa ?? 0)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold",
              STATUS_STYLE[status]
            )}
          >
            {status === "synced" ? <Check className="h-3 w-3" /> : null}
            {status === "error" ? <X className="h-3 w-3" /> : null}
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              describeStatus(status)
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-black/5 pt-3">
          <button
            type="button"
            disabled={busy || status === "synced"}
            onClick={() => onSetStatus("synced")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white transition disabled:opacity-40",
              "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            Виконано
          </button>
          <button
            type="button"
            disabled={busy || status === "error"}
            onClick={() => onSetStatus("error")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white transition disabled:opacity-40",
              "bg-red-600 hover:bg-red-700"
            )}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            Відмінити
          </button>
          {status !== "none" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSetStatus("none")}
              className="rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            >
              Скинути
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

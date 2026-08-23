"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Check,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Link2,
  Loader2,
  Plus,
  Ruler,
  Split,
} from "lucide-react";

import {
  buildImportWorkbook,
  relinkFieldsWithBas,
  setBasRequestStatus,
} from "@/app/admin/bas-request/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
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
import type { BasFieldSummary, BasRequestStatus } from "@/lib/field-registry";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});

const ha = (value: number) => `${numberFormat.format(value)} га`;

const SECTIONS: {
  kind: ChangeKind;
  title: string;
  hint: string;
  icon: typeof Plus;
}[] = [
  {
    kind: "create",
    title: "Завести нові поля",
    hint: "Цих полів у довіднику 1С немає взагалі — без них витрати нема на що відносити.",
    icon: Plus,
  },
  {
    kind: "split",
    title: "Розділити злиті записи",
    hint: "Один запис 1С покриває кілька фізичних полів. Wialon обміряв їх окремо.",
    icon: Split,
  },
  {
    kind: "area",
    title: "Уточнити площі",
    hint: "Зв'язок правильний, але гектари в 1С розходяться з обміром понад 5%.",
    icon: Ruler,
  },
];

const STATUS_BUTTONS: { status: BasRequestStatus; label: string }[] = [
  { status: "pending", label: "Передано" },
  { status: "synced", label: "Виконано" },
  { status: "error", label: "Відхилено" },
];

const STATUS_STYLE: Record<BasRequestStatus, string> = {
  none: "border-[#E5DFD3] bg-white text-zinc-500",
  pending: "border-sky-200 bg-sky-50 text-sky-800",
  synced: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

export function BasRequestView({
  request,
  orphans,
  collisions,
  basError,
}: {
  request: BasChangeRequest;
  orphans: BasFieldSummary[];
  collisions: OrphanCollision[];
  basError: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => allChangeItems(request), [request]);
  const totalHa = items.reduce((sum, item) => sum + item.areaHa, 0);
  const openCount = items.filter(
    (item) => itemStatus(item) !== "synced"
  ).length;

  function applyStatus(item: ChangeItem, status: BasRequestStatus) {
    setBusyKey(item.key);
    setError(null);
    startTransition(async () => {
      const result = await setBasRequestStatus({
        fieldIds: item.rows.map((row) => row.id),
        status,
      });
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote(`Позначено як «${describeStatus(status)}»`);
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(requestToText(request));
      setNote("Текст заявки скопійовано — можна вставити в лист бухгалтеру");
      setError(null);
    } catch {
      setError("Браузер не дав доступ до буфера обміну");
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
    setBusyKey("workbook");
    setError(null);
    startTransition(async () => {
      const result = await buildImportWorkbook();
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error);
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
      setNote(
        "Файл для 1С готовий. Бухгалтер відкриває його, перевіряє і завантажує в довідник сам."
      );
    });
  }

  function handleRelink() {
    setBusyKey("relink");
    setError(null);
    startTransition(async () => {
      const result = await relinkFieldsWithBas();
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { linked } = result.data;
      setNote(
        linked.length === 0
          ? "Нових записів у 1С не знайшлося — усі зв'язки вже актуальні."
          : `Підв'язано ${linked.length}: ${linked
              .map((item) => item.field)
              .join(", ")}`
      );
    });
  }

  function handleCsv() {
    // BOM, щоб Excel не поламав кирилицю
    download(
      new Blob(["\uFEFF", requestToCsv(request)], {
        type: "text/csv;charset=utf-8",
      }),
      `zayavka-bas-polya-${new Date().toISOString().slice(0, 10)}.csv`
    );
    setNote("CSV завантажено");
  }

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="hover:translate-y-0 hover:shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900">
              Що бухгалтеру треба зробити в 1С
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
              Список складається сам із реєстру полів. «Файл для 1С» — це книга
              Excel під штатне завантаження довідника: бухгалтер відкриває її у
              себе, перевіряє і завантажує сам. Чернетку для поля надіслати
              неможливо — поля лежать у довіднику, а в довідників у 1С немає
              ознаки проведення, тож проміжного стану «на розгляді» не буває.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending && busyKey === "workbook"}
              onClick={handleWorkbook}
              className="h-9 gap-1.5 rounded-lg border-0 bg-[#276749] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#22543d]"
            >
              {pending && busyKey === "workbook" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              Файл для 1С
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopy()}
              className="h-9 gap-1.5 rounded-lg border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-[#E5DFD3]/50"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Скопіювати текст
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCsv}
              className="h-9 gap-1.5 rounded-lg border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-[#E5DFD3]/50"
            >
              <Download className="h-3.5 w-3.5" />
              CSV для Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending && busyKey === "relink"}
              onClick={handleRelink}
              title="Запускати після того, як бухгалтер завів і розділив поля в 1С"
              className="h-9 gap-1.5 rounded-lg border-[#E5DFD3] bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-[#E5DFD3]/50"
            >
              {pending && busyKey === "relink" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Перезв&apos;язати з 1С
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="rounded-lg border-[#E5DFD3] bg-zinc-100/80 text-zinc-700"
          >
            {items.length} позицій на {ha(totalHa)}
          </Badge>
          {SECTIONS.map((section) => (
            <Badge
              key={section.kind}
              variant="outline"
              className="rounded-lg border-[#E5DFD3] bg-zinc-100/80 text-zinc-600"
            >
              {section.title}: {request[section.kind].length}
            </Badge>
          ))}
          <Badge
            variant="outline"
            className={cn(
              "rounded-lg",
              openCount === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            )}
          >
            {openCount === 0 ? "Все закрито" : `${openCount} у роботі`}
          </Badge>
        </div>

        {basError ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {basError}
          </p>
        ) : null}
        {note ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {note}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </GlassCard>

      {SECTIONS.map((section) => {
        const sectionItems: ChangeItem[] = request[section.kind];
        if (sectionItems.length === 0) return null;
        const sectionHa = sectionItems.reduce(
          (sum, item) => sum + item.areaHa,
          0
        );
        const Icon = section.icon;

        return (
          <GlassCard
            key={section.kind}
            className="hover:translate-y-0 hover:shadow-sm"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD3] bg-white text-zinc-600">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-zinc-900">
                  {section.title}
                  <span className="ml-2 text-sm font-medium text-zinc-500">
                    {sectionItems.length} поз. · {ha(sectionHa)}
                  </span>
                </h2>
                <p className="mt-0.5 text-sm text-zinc-500">{section.hint}</p>
              </div>
            </div>

            <div className="space-y-2">
              {sectionItems.map((item) => (
                <RequestItem
                  key={item.key}
                  item={item}
                  busy={pending && busyKey === item.key}
                  onSetStatus={(status) => applyStatus(item, status)}
                />
              ))}
            </div>
          </GlassCard>
        );
      })}

      {orphans.length > 0 ? (
        <GlassCard className="hover:translate-y-0 hover:shadow-sm">
          <h2 className="text-base font-bold text-zinc-900">
            Записи 1С без нашого поля
          </h2>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500">
            На них не вказує жодна геозона Wialon. Ми їх не чіпаємо — бухгалтер
            вирішує сам, чи це застарілі записи, чи ми чогось не бачимо.
          </p>

          {collisions.length > 0 ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-semibold">Однакові назви про різні ділянки</p>
              <ul className="mt-1 space-y-0.5">
                {collisions.map((collision) => (
                  <li key={collision.basField.refKey}>
                    «{collision.basField.description}» — у 1С це{" "}
                    {collision.basField.areaHa != null
                      ? ha(collision.basField.areaHa)
                      : "запис без площі"}
                    , а в нас{" "}
                    {collision.ourRow.areaHa != null
                      ? ha(collision.ourRow.areaHa)
                      : "поле без площі"}
                    . Проговорити з бухгалтером, яку ділянку він має на увазі.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {orphans.map((field) => (
              <span
                key={field.refKey}
                className="inline-flex items-center gap-2 rounded-lg border border-[#E5DFD3] bg-[#F4F1EA] px-3 py-1.5 text-sm text-zinc-800"
              >
                <span className="font-medium">
                  {field.description || "Без назви"}
                </span>
                <span className="text-xs text-zinc-500">
                  {field.areaHa != null ? ha(field.areaHa) : "без площі"}
                </span>
              </span>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}

function RequestItem({
  item,
  busy,
  onSetStatus,
}: {
  item: ChangeItem;
  busy: boolean;
  onSetStatus: (status: BasRequestStatus) => void;
}) {
  const status = itemStatus(item);

  return (
    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100/40 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-zinc-800">
          {describeItem(item)}
        </p>

        <div className="flex shrink-0 items-center gap-1.5">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : null}
          <Badge
            variant="outline"
            className={cn("rounded-md", STATUS_STYLE[status])}
          >
            {status === "synced" ? (
              <Check className="mr-1 h-3 w-3" />
            ) : null}
            {describeStatus(status)}
          </Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUS_BUTTONS.map((button) => (
          <button
            key={button.status}
            type="button"
            disabled={busy || status === button.status}
            onClick={() => onSetStatus(button.status)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40",
              status === button.status
                ? STATUS_STYLE[button.status]
                : "border-[#E5DFD3] bg-white text-zinc-600 hover:bg-[#E5DFD3]/40"
            )}
          >
            {button.label}
          </button>
        ))}
        {status !== "none" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetStatus("none")}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
          >
            Скинути
          </button>
        ) : null}
      </div>
    </div>
  );
}

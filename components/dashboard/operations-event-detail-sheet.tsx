"use client";

import { useEffect, useState, useTransition } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  CalendarDays as CalendarIcon,
  Camera,
  Clock,
  Droplets,
  Loader2,
  MapPin,
  PackageMinus,
  Pencil,
  Search,
  Tractor,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteLocalMove,
  listLocalMoves,
  updateLocalMove,
  type LocalMoveRow,
} from "@/app/admin/inventory/actions";
import { deleteScoutingReport } from "@/app/admin/scouting/actions";
import {
  loadFieldOperationByClientKey,
  OperationsOperationForm,
} from "@/components/dashboard/operations-operation-form-sheet";
import {
  OperationsConfirmDeleteDialog,
  OperationsPanelShell,
  OperationsSheetFooter,
  OperationsSheetHeader,
  useOpsChrome,
} from "@/components/dashboard/operations-sheet-chrome";
import { OperationsTimelineImage } from "@/components/dashboard/operations-timeline-image";
import { OperationsWeatherBadge } from "@/components/dashboard/operations-weather-badge";
import { deleteFieldOperation, type FieldOperation } from "@/lib/field-operations";
import { formatOperationMaterialsLine } from "@/lib/field-operation-materials";
import type { FieldTimelineField, UnifiedTimelineEvent } from "@/lib/field-timeline";
import {
  isFutureTimelineOperation,
  timelineOperationStatusLabel,
} from "@/lib/field-timeline";
import {
  fieldOperationsKeyFromFarmId,
  parseTimelineEventId,
} from "@/lib/field-timeline-ids";
import { suppressLocalInventoryMovesRealtimeToast } from "@/lib/realtime-toast-guard";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

type OperationsEventDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: UnifiedTimelineEvent | null;
  field: FieldTimelineField | null;
  season: string;
  onChanged: () => void;
};

type DetailView = "detail" | "edit-equipment" | "edit-inventory";

function formatDetailDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMMM yyyy", { locale: uk });
}

function OperationsInventoryEditForm({
  move,
  onBack,
  onSaved,
}: {
  move: LocalMoveRow;
  onBack: () => void;
  onSaved: () => void;
}) {
  const chrome = useOpsChrome();
  const [qty, setQty] = useState(String(move.qty));
  const [note, setNote] = useState(move.note ?? "");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setQty(String(move.qty));
    setNote(move.note ?? "");
  }, [move.id, move.qty, move.note]);

  function handleSave() {
    const qtyNum = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("Вкажіть кількість більше нуля");
      return;
    }

    startTransition(async () => {
      suppressLocalInventoryMovesRealtimeToast();
      const res = await updateLocalMove({
        id: move.id,
        qty: qtyNum,
        note: note.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Списання оновлено");
      onSaved();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <OperationsSheetHeader
        icon={PackageMinus}
        accent="emerald"
        title="Редагувати списання"
        description={move.itemName}
        onBack={onBack}
      />

      <div className={chrome.body}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
          <p className={chrome.label}>Товар</p>
          <p className="mt-1 text-base font-semibold text-zinc-50">{move.itemName}</p>
          {move.fieldName ? (
            <p className="mt-1 text-sm text-zinc-400">{move.fieldName}</p>
          ) : null}
        </div>

        <section className="space-y-2">
          <label className={chrome.label}>
            Кількість{move.itemUnit ? `, ${move.itemUnit}` : ""}
          </label>
          <input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={cn(chrome.input, "text-center text-2xl font-bold tabular-nums")}
            autoFocus
          />
        </section>

        <section className="space-y-2">
          <label className={chrome.label}>Примітка</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={chrome.input}
            placeholder="Необовʼязково"
          />
        </section>
      </div>

      <OperationsSheetFooter>
        <button
          type="submit"
          disabled={pending}
          className={chrome.primaryBtn}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Збереження…
            </>
          ) : (
            "Зберегти зміни"
          )}
        </button>
      </OperationsSheetFooter>
    </form>
  );
}

function ScoutingDetailHero({
  event,
  fieldName,
}: {
  event: UnifiedTimelineEvent;
  fieldName?: string;
}) {
  const isMobile = useIsMobile();
  const notes = event.notes?.trim() ?? "";
  const hasPhoto = Boolean(event.imageUrl?.trim());

  if (isMobile) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-white/[0.04] to-transparent p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-sky-300 uppercase">
            Скаутинг
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
            {formatDetailDate(event.date)}
          </span>
          <OperationsWeatherBadge weatherContext={event.weatherContext} />
        </div>

        {hasPhoto ? (
          <OperationsTimelineImage
            src={event.imageUrl}
            variant="dark"
            aspectClassName="aspect-[4/3] w-full"
            expandable
            alt="Фото скаутингу"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02]">
            <Camera className="size-8 text-zinc-600" strokeWidth={1.5} />
          </div>
        )}

        {notes ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {notes}
          </p>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">Без нотаток</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {hasPhoto ? (
        <div className="group relative overflow-hidden rounded-[1.35rem] border border-sky-500/25 bg-gradient-to-b from-sky-500/[0.08] to-transparent p-1.5 shadow-[0_20px_50px_-24px_rgba(14,165,233,0.35)]">
          <OperationsTimelineImage
            src={event.imageUrl}
            variant="dark"
            aspectClassName="aspect-[5/4] w-full rounded-[1.15rem]"
            frameClassName="rounded-[1.15rem]"
            expandable
            alt="Фото скаутингу"
          />
          <div className="pointer-events-none absolute top-4 left-4">
            <span className="rounded-full border border-sky-400/30 bg-sky-950/85 px-3 py-1 text-[10px] font-bold tracking-[0.14em] text-sky-200 uppercase backdrop-blur-md">
              Польовий огляд
            </span>
          </div>
        </div>
      ) : (
        <div className="flex aspect-[5/4] w-full flex-col items-center justify-center gap-3 rounded-[1.35rem] border border-dashed border-white/15 bg-white/[0.03]">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
            <Camera className="size-7 text-zinc-500" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-zinc-500">Фото не додано</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300">
          {formatDetailDate(event.date)}
        </span>
        <OperationsWeatherBadge weatherContext={event.weatherContext} />
        {fieldName ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400">
            {fieldName}
          </span>
        ) : null}
      </div>

      <section className="relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-sky-500/10 blur-3xl"
        />
        <p className="text-[11px] font-bold tracking-[0.12em] text-sky-400/90 uppercase">
          Звіт агронома
        </p>
        {notes ? (
          <p className="relative mt-3 whitespace-pre-wrap text-[15px] leading-[1.7] text-zinc-100">
            {notes}
          </p>
        ) : (
          <p className="relative mt-3 text-sm italic text-zinc-500">
            Агроном не залишив текстового коментаря
          </p>
        )}
      </section>
    </div>
  );
}

function EventDetailHero({
  event,
  isEquipment,
  operation,
  inventoryMove,
}: {
  event: UnifiedTimelineEvent;
  isEquipment: boolean;
  operation: FieldOperation | null;
  inventoryMove: LocalMoveRow | null;
}) {
  const isFuture = isFutureTimelineOperation(event);
  const statusLabel = timelineOperationStatusLabel(event.operationStatus, event.date);
  const materialLine = formatOperationMaterialsLine(operation?.materials);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-visible rounded-3xl border p-5",
        isEquipment && isFuture
          ? "border-sky-500/25 border-dashed bg-gradient-to-br from-sky-500/10 via-white/[0.04] to-transparent"
          : isEquipment
            ? "border-orange-500/20 bg-gradient-to-br from-orange-500/10 via-white/[0.04] to-transparent"
            : "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-white/[0.04] to-transparent"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-12 -right-8 size-32 rounded-full blur-3xl",
          isEquipment && isFuture
            ? "bg-sky-500/15"
            : isEquipment
              ? "bg-orange-500/15"
              : "bg-emerald-500/15"
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1",
            isEquipment && isFuture
              ? "bg-sky-500/20 text-sky-300 ring-sky-500/25"
              : isEquipment
                ? "bg-orange-500/20 text-orange-300 ring-orange-500/25"
                : "bg-emerald-500/20 text-emerald-300 ring-emerald-500/25"
          )}
        >
          {isEquipment ? (
            <Tractor className="size-[18px]" strokeWidth={1.9} />
          ) : (
            <PackageMinus className="size-[18px]" strokeWidth={1.9} />
          )}
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] uppercase",
            isEquipment && isFuture
              ? "bg-sky-500/15 text-sky-300"
              : isEquipment
                ? "bg-orange-500/15 text-orange-300"
                : "bg-emerald-500/15 text-emerald-300"
          )}
        >
          {statusLabel ?? (isEquipment ? "Техніка" : "ТМЦ")}
        </span>
      </div>

      <p className="relative mt-4 text-4xl font-bold tracking-tight text-zinc-50 tabular-nums">
        {event.metric}
      </p>
      <p className="relative mt-1 text-base font-semibold text-zinc-100">
        {event.title}
      </p>
      {!isEquipment || !operation?.machinery ? (
        <p className="relative mt-0.5 text-sm text-zinc-400">{event.subtitle}</p>
      ) : null}

      {materialLine ? (
        <p className="relative mt-3 rounded-2xl bg-black/25 px-3.5 py-2.5 text-sm text-emerald-200/90">
          {materialLine}
        </p>
      ) : null}

      {operation?.machinery ? (
        <p className="relative mt-4 rounded-2xl bg-black/25 px-3.5 py-2.5 text-sm text-zinc-300">
          {operation.machinery}
          {operation.implement ? ` · ${operation.implement}` : ""}
        </p>
      ) : null}

      {/* Механізатор */}
      {operation?.mechanicName ? (
        <p className="relative mt-3 rounded-2xl border border-white/5 bg-black/20 px-3.5 py-2.5 text-sm text-zinc-300">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Механізатор
          </span>
          <br />
          {operation.mechanicName}
        </p>
      ) : null}

      {(operation?.agronomistComment || inventoryMove?.note) && (
        <p className="relative mt-3 rounded-2xl border border-white/5 bg-black/20 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-300">
          {operation?.agronomistComment ?? inventoryMove?.note}
        </p>
      )}

      {/* Деталі — сітка характеристик */}
      <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {/* Дата */}
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
          <CalendarIcon className="size-3.5 shrink-0 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-300">{formatDetailDate(event.date)}</span>
        </div>
        {/* Площа */}
        {isEquipment && !isFuture && operation?.areaDone ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <span className="text-[10px] font-bold text-zinc-500">ГА</span>
            <span className="text-xs font-medium tabular-nums text-zinc-300">{operation.areaDone} га</span>
          </div>
        ) : null}
        {/* Паливо */}
        {isEquipment && operation?.fuelUsed ? (
          <div className="flex items-center gap-2 rounded-xl border border-orange-500/15 bg-orange-500/[0.04] px-3 py-2">
            <Droplets className="size-3.5 shrink-0 text-orange-400/70" />
            <span className="text-xs font-medium tabular-nums text-zinc-300">{operation.fuelUsed} л</span>
          </div>
        ) : null}
        {/* ЗП */}
        {isEquipment && operation?.wage ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2">
            <Wallet className="size-3.5 shrink-0 text-emerald-400/70" />
            <div className="min-w-0">
              <span className="block text-xs font-medium tabular-nums text-zinc-300">
                {new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(operation.wage)} ₴
              </span>
              {operation.wageRateUahPerHa ? (
                <span className="block text-[10px] tabular-nums text-zinc-500">
                  {operation.wageRateUahPerHa} ₴/га
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* GPS — дистанція */}
        {operation?.trackerDistanceKm ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <MapPin className="size-3.5 shrink-0 text-zinc-500" />
            <span className="text-xs font-medium tabular-nums text-zinc-300">{operation.trackerDistanceKm.toFixed(1)} км</span>
          </div>
        ) : null}
        {/* GPS — години */}
        {operation?.trackerWorkHours ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <Clock className="size-3.5 shrink-0 text-zinc-500" />
            <span className="text-xs font-medium tabular-nums text-zinc-300">{operation.trackerWorkHours.toFixed(1)} год</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OperationsEventDetailSheet({
  open,
  onOpenChange,
  event,
  field,
  season,
  onChanged,
}: OperationsEventDetailSheetProps) {
  const chrome = useOpsChrome();
  const isMobile = useIsMobile();
  const [view, setView] = useState<DetailView>("detail");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [operation, setOperation] = useState<FieldOperation | null>(null);
  const [inventoryMove, setInventoryMove] = useState<LocalMoveRow | null>(null);

  const eventId = event?.id ?? null;
  const fieldId = field?.id ?? null;
  const isEquipment = event?.type === "equipment";
  const isScouting = event?.type === "scouting";

  useEffect(() => {
    if (!open) {
      setView("detail");
      setOperation(null);
      setInventoryMove(null);
      setLoading(false);
      setDeleteOpen(false);
      return;
    }
    if (!eventId || !fieldId) return;

    const parsed = parseTimelineEventId(eventId);
    if (!parsed) return;

    let cancelled = false;
    setLoading(true);

    async function load() {
      if (parsed!.kind === "equipment") {
        const op = await loadFieldOperationByClientKey(fieldId!, parsed!.clientKey);
        if (!cancelled) {
          setOperation(op);
          setInventoryMove(null);
          setLoading(false);
        }
        return;
      }

      if (parsed!.kind === "scouting") {
        if (!cancelled) {
          setOperation(null);
          setInventoryMove(null);
          setLoading(false);
        }
        return;
      }

      const res = await listLocalMoves({ season });
      if (cancelled) return;
      if (!res.ok) {
        toast.error(res.error);
        setLoading(false);
        return;
      }
      if (parsed!.kind !== "inventory") {
        if (!cancelled) setLoading(false);
        return;
      }

      const move =
        res.moves.find((m) => m.id === parsed!.moveId) ?? null;
      setInventoryMove(move);
      setOperation(null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [eventId, fieldId, open, season]);

  async function handleDelete() {
    if (!eventId || !fieldId) return;
    const parsed = parseTimelineEventId(eventId);
    if (!parsed) return;

    setDeleting(true);
    try {
      if (parsed.kind === "equipment") {
        await deleteFieldOperation(
          fieldOperationsKeyFromFarmId(fieldId),
          parsed.clientKey
        );
        toast.success("Наряд видалено");
      } else if (parsed.kind === "inventory") {
        const res = await deleteLocalMove(parsed.moveId);
        if (!res.ok) throw new Error(res.error);
        toast.success("Списання видалено");
      } else if (parsed.kind === "scouting") {
        const res = await deleteScoutingReport(parsed.reportId);
        if (!res.ok) throw new Error(res.error);
        toast.success("Звіт скаутингу видалено");
      } else {
        toast.error("Невідомий тип події");
        return;
      }
      setDeleteOpen(false);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося видалити");
    } finally {
      setDeleting(false);
    }
  }

  function handleEdit() {
    if (isScouting) {
      toast.message("Редагування скаутингу поки недоступне");
      return;
    }
    const parsed = eventId ? parseTimelineEventId(eventId) : null;
    if (parsed?.kind === "equipment") {
      if (operation) setView("edit-equipment");
      else toast.error("Наряд не знайдено");
    } else if (inventoryMove) {
      setView("edit-inventory");
    } else {
      toast.error("Списання не знайдено");
    }
  }

  const shellTitle =
    view === "edit-equipment"
      ? "Редагувати наряд"
      : view === "edit-inventory"
        ? "Редагувати списання"
        : isScouting
          ? "Скаутинг"
          : (event?.title ?? "Деталі");

  const detailHeaderTitle = isScouting ? "Польовий звіт" : (event?.title ?? "Деталі");
  const detailHeaderDescription = isScouting ? (
    field?.name ?? "Поле"
  ) : (
    <>
      {field?.name ?? "Поле"} · {event ? formatDetailDate(event.date) : ""}
    </>
  );

  return (
    <>
      <OperationsPanelShell
        open={open}
        onOpenChange={onOpenChange}
        title={shellTitle}
        className={isScouting && !isMobile ? "sm:max-w-[32rem]" : undefined}
      >
        {view === "edit-equipment" && field && operation ? (
          <OperationsOperationForm
            field={field}
            seasonYear={Number(season) || new Date().getFullYear()}
            initial={operation}
            onBack={() => setView("detail")}
            onSaved={() => {
              onChanged();
              onOpenChange(false);
            }}
          />
        ) : view === "edit-inventory" && inventoryMove ? (
          <OperationsInventoryEditForm
            move={inventoryMove}
            onBack={() => setView("detail")}
            onSaved={() => {
              onChanged();
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <OperationsSheetHeader
              icon={isScouting ? Search : isEquipment ? Tractor : PackageMinus}
              accent={isScouting ? "sky" : isEquipment ? "orange" : "emerald"}
              title={detailHeaderTitle}
              description={detailHeaderDescription}
            />

            <div className={chrome.body} data-vaul-no-drag="" data-allow-pan="true">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-zinc-400">
                  <Loader2 className="mr-2 size-5 animate-spin" />
                  Завантаження…
                </div>
              ) : event ? (
                isScouting ? (
                  <ScoutingDetailHero event={event} fieldName={field?.name} />
                ) : (
                  <EventDetailHero
                    event={event}
                    isEquipment={isEquipment}
                    operation={operation}
                    inventoryMove={inventoryMove}
                  />
                )
              ) : null}
            </div>

            {!loading && event ? (
              <OperationsSheetFooter>
                {!isScouting ? (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className={cn(
                      chrome.primaryBtn,
                      isEquipment
                        ? "border border-orange-500/35 bg-orange-500/20 text-orange-100 shadow-none hover:bg-orange-500/30 hover:text-orange-50"
                        : undefined
                    )}
                  >
                    <Pencil className="mr-2 inline size-4" />
                    Редагувати
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  disabled={deleting}
                  className={cn(
                    "inline-flex h-12 w-full items-center justify-center rounded-2xl",
                    "border border-red-500/30 bg-red-500/10 text-sm font-semibold text-red-200",
                    "transition hover:bg-red-500/20 active:scale-[0.99]",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  <Trash2 className="mr-2 size-4" />
                  Видалити станцію
                </button>
              </OperationsSheetFooter>
            ) : null}
          </div>
        )}

        <OperationsConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Видалити станцію?"
          description={
            <>
              <span className="font-medium text-zinc-200">{event?.title}</span>
              {field?.name ? (
                <>
                  {" "}
                  з хронології поля{" "}
                  <span className="font-medium text-zinc-200">{field.name}</span>
                </>
              ) : null}
              . Цю дію не можна скасувати.
            </>
          }
          pending={deleting}
          onConfirm={() => void handleDelete()}
        />
      </OperationsPanelShell>
    </>
  );
}

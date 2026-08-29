"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  Tractor,
} from "lucide-react";

import { getRefuelSmartContext } from "@/app/fuel/actions";
import {
  AttachmentDropzone,
  flushPendingAttachments,
  type PendingAttachment,
} from "@/components/dashboard/attachment-dropzone";
import {
  FuelPanelShell,
  FuelSheetFooter,
  FuelSheetHeader,
  fuelFieldLabelClass,
  fuelPrimaryBtnClass,
  fuelSelectItemClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RefuelActiveOpHint } from "@/lib/fuel-refuel-context";
import type { FuelStorage } from "@/lib/fuel-storages";
import type {
  FuelTransaction,
  FuelTransactionType,
} from "@/lib/fuel-transactions";
import {
  findEquipmentOpsOption,
  type EquipmentOpsOption,
} from "@/lib/equipment-ops-options";
import { cn } from "@/lib/utils";

export type FleetUnitOption = {
  key: string;
  name: string;
  equipmentId?: string | null;
  wialonUnitId?: number | null;
  /** Чи є ДУТ / паливний сенсор для GPS-звірки */
  hasFuelSensor: boolean;
  hasTracker: boolean;
};

export function unitSelectLabel(unit: FleetUnitOption): string {
  if (!unit.hasTracker) return `${unit.name} (Без трекера)`;
  return unit.hasFuelSensor
    ? `${unit.name} (GPS-контроль)`
    : `${unit.name} (Без датчика)`;
}

type FuelActionDialogsProps = {
  storages: FuelStorage[];
  units: FleetUnitOption[];
  unitsLoading?: boolean;
  isReceiveOpen: boolean;
  isTransferOpen: boolean;
  isRefuelOpen: boolean;
  onReceiveOpenChange: (open: boolean) => void;
  onTransferOpenChange: (open: boolean) => void;
  onRefuelOpenChange: (open: boolean) => void;
  /** Редагування існуючого запису (підставляє форму) */
  editTransaction?: FuelTransaction | null;
  onEditTransactionChange?: (tx: FuelTransaction | null) => void;
  onSuccess: () => void | Promise<void>;
};

const selectTriggerClass = fuelSelectTriggerClass;
const selectItemClass = fuelSelectItemClass;

async function saveTransaction(
  payload: {
    transactionType: FuelTransactionType;
    amountLiters: number;
    fromStorageId?: string | null;
    toStorageId?: string | null;
    equipmentId?: string | null;
    wialonUnitId?: number | null;
    hasFuelSensor?: boolean | null;
    pricePerLiter?: number | null;
  },
  editId?: string | null
): Promise<{ message?: string; transactionId?: string }> {
  const response = await fetch(
    editId ? `/api/fuel/transactions/${editId}` : "/api/fuel/transactions",
    {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    message?: string;
    transaction?: { id?: string };
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Не вдалося зберегти операцію");
  }
  return {
    message: data.message,
    transactionId: data.transaction?.id ?? editId ?? undefined,
  };
}

async function submitRefuel(payload: {
  fromStorageId: string;
  equipmentId?: string | null;
  wialonUnitId?: number | null;
  amountLiters: number;
  operatorName?: string | null;
  hasFuelSensor: boolean;
  fieldOperationId?: string | null;
}): Promise<{ transaction?: FuelTransaction }> {
  const response = await fetch("/api/fuel/refuel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    transaction?: FuelTransaction;
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Не вдалося зберегти заправку");
  }
  return { transaction: data.transaction };
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parsePrice(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function formatPartyCost(liters: number, price: number): string {
  const total = Math.round(liters * price * 100) / 100;
  return total.toLocaleString("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const MAX_TRACTOR_TANK_LITERS = 1500;

function FormErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4 text-rose-600">
      <AlertCircle size={18} className="shrink-0" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

/** Доступний обʼєм донора (+ сума поточної операції при редагуванні). */
function donorAvailableVolume(
  storages: FuelStorage[],
  fromStorageId: string,
  editTransaction: FuelTransaction | null | undefined
): number {
  const donor = storages.find((s) => s.id === fromStorageId);
  if (!donor) return 0;
  let available = donor.currentVolume;
  if (
    editTransaction &&
    (editTransaction.type === "transfer" ||
      editTransaction.type === "outbound") &&
    editTransaction.fromStorageId === fromStorageId
  ) {
    available += editTransaction.amountLiters;
  }
  return Math.round(available * 100) / 100;
}

/** Вільне місце в приймачі (л) з урахуванням edit rollback. */
function receiverFreeSpace(
  storages: FuelStorage[],
  toStorageId: string,
  editTransaction: FuelTransaction | null | undefined
): number {
  const target = storages.find((s) => s.id === toStorageId);
  if (!target) return 0;
  let occupied = target.currentVolume;
  if (
    editTransaction &&
    (editTransaction.type === "inbound" ||
      editTransaction.type === "transfer") &&
    editTransaction.toStorageId === toStorageId
  ) {
    occupied -= editTransaction.amountLiters;
  }
  const free = target.capacity - Math.max(0, occupied);
  return Math.max(0, Math.round(free * 100) / 100);
}

function overflowMessage(maxAddLiters: number): string {
  return `Переповнення: Максимум можна додати ${Math.round(maxAddLiters).toLocaleString("uk-UA")} л`;
}

function OverflowHint({ maxAddLiters }: { maxAddLiters: number }) {
  return (
    <p className="flex items-start gap-2 text-sm font-medium text-rose-600">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{overflowMessage(maxAddLiters)}</span>
    </p>
  );
}

function defaultStationaryId(storages: FuelStorage[]): string {
  return (
    storages.find((s) => s.type === "stationary")?.id ?? storages[0]?.id ?? ""
  );
}

function defaultMobileId(storages: FuelStorage[]): string {
  return (
    storages.find((s) => s.type === "mobile")?.id ??
    storages[storages.length - 1]?.id ??
    ""
  );
}

function storageLabel(storage: FuelStorage): string {
  return storage.name;
}

function storageMeta(storage: FuelStorage): string {
  return `${Math.round(storage.currentVolume).toLocaleString("uk-UA")} / ${Math.round(storage.capacity).toLocaleString("uk-UA")} л`;
}

/** Велике поле кількості літрів (фінансовий термінал) */
function LitersAmountField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={fuelFieldLabelClass}>
        Кількість (літрів)
      </Label>
      <div
        className={cn(
          "relative flex items-center justify-center rounded-2xl px-3 py-2",
          "border border-zinc-200/90 bg-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.04)]"
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "h-20 w-full min-w-0 bg-transparent text-center text-4xl font-light tracking-tight text-zinc-900",
            "border-none outline-none focus:ring-0 focus:outline-none",
            "tabular-nums placeholder:font-light placeholder:text-zinc-300"
          )}
        />
        <span className="pointer-events-none absolute right-4 bottom-3 text-xs font-medium tracking-wide text-zinc-400 uppercase">
          л
        </span>
      </div>
    </div>
  );
}

/** Фінансове поле (ціна) — великі цифри по центру */
function MoneyAmountField({
  id,
  label,
  value,
  onChange,
  placeholder,
  suffix = "₴/л",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={fuelFieldLabelClass}>
        {label}
      </Label>
      <div
        className={cn(
          "relative flex items-center justify-center rounded-2xl px-3 py-2",
          "border border-zinc-200/90 bg-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.04)]"
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "h-20 w-full min-w-0 bg-transparent text-center text-4xl font-light tracking-tight text-zinc-900",
            "border-none outline-none focus:ring-0 focus:outline-none",
            "tabular-nums placeholder:font-light placeholder:text-zinc-300"
          )}
        />
        <span className="pointer-events-none absolute right-4 bottom-3 text-xs font-semibold text-zinc-400">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function StorageSelect({
  label,
  value,
  onChange,
  storages,
  items,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  storages: FuelStorage[];
  items: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className={fuelFieldLabelClass}>{label}</Label>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => {
          if (typeof next === "string" && next) onChange(next);
        }}
      >
        <SelectTrigger className={selectTriggerClass}>
          <SelectValue placeholder={placeholder}>
            {storages.find((s) => s.id === value)?.name ?? null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent sheetOnMobile={false} className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-lg">
          {storages.map((storage) => (
            <SelectItem
              key={storage.id}
              value={storage.id}
              className={selectItemClass}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-base font-semibold text-zinc-900">
                  {storageLabel(storage)}
                </span>
                <span className="text-sm font-medium text-zinc-500">
                  {storageMeta(storage)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Три модалки швидких дій з паливом */
export function FuelActionDialogs({
  storages,
  units,
  unitsLoading,
  isReceiveOpen,
  isTransferOpen,
  isRefuelOpen,
  onReceiveOpenChange,
  onTransferOpenChange,
  onRefuelOpenChange,
  editTransaction = null,
  onEditTransactionChange,
  onSuccess,
}: FuelActionDialogsProps) {
  const [amount, setAmount] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [fromStorage, setFromStorage] = useState("");
  const [toStorage, setToStorage] = useState("");
  const [unitId, setUnitId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Успіх закупівлі: локально + черга BAS AGRO (без POST у BAS) */
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [transferPendingFiles, setTransferPendingFiles] = useState<
    PendingAttachment[]
  >([]);
  /** Smart Context: локація + активний наряд */
  const [refuelLocationLabel, setRefuelLocationLabel] = useState<string | null>(
    null
  );
  const [refuelActiveOp, setRefuelActiveOp] =
    useState<RefuelActiveOpHint | null>(null);
  const [refuelContextLoading, setRefuelContextLoading] = useState(false);
  const [linkActiveOp, setLinkActiveOp] = useState(true);

  const stationaryId = useMemo(
    () => defaultStationaryId(storages),
    [storages]
  );
  const mobileId = useMemo(() => defaultMobileId(storages), [storages]);
  const editId = editTransaction?.id ?? null;
  const isEditing = Boolean(editId);

  const storageItems = useMemo(
    () =>
      storages.map((storage) => ({
        value: storage.id,
        label: storageLabel(storage),
      })),
    [storages]
  );

  const unitItems = useMemo(
    () =>
      units.map((unit) => ({
        value: unit.key,
        label: unitSelectLabel(unit),
      })),
    [units]
  );

  const trackedUnits = useMemo(
    () => units.filter((u) => u.hasTracker),
    [units]
  );
  const nonTrackedUnits = useMemo(
    () => units.filter((u) => !u.hasTracker),
    [units]
  );

  const selectedUnit = useMemo(
    () => units.find((u) => u.key === unitId) ?? null,
    [units, unitId]
  );

  const amountValue = parseAmount(amount);
  const hasAmount = amountValue != null;
  const priceValue = parsePrice(pricePerLiter);
  const partyCost =
    amountValue != null && priceValue != null
      ? formatPartyCost(amountValue, priceValue)
      : null;

  const selectedReceiveStorage = useMemo(
    () => storages.find((s) => s.id === toStorage) ?? null,
    [storages, toStorage]
  );

  const availableVolume = useMemo(
    () => donorAvailableVolume(storages, fromStorage, editTransaction),
    [storages, fromStorage, editTransaction]
  );
  const receiveFreeSpace = useMemo(
    () => receiverFreeSpace(storages, toStorage, editTransaction),
    [storages, toStorage, editTransaction]
  );
  const transferFreeSpace = useMemo(
    () => receiverFreeSpace(storages, toStorage, editTransaction),
    [storages, toStorage, editTransaction]
  );
  const donorName =
    storages.find((s) => s.id === fromStorage)?.name ?? "ємності";

  const receiveOverflow =
    hasAmount && Boolean(toStorage) && amountValue > receiveFreeSpace + 0.001;
  const transferOverflow =
    hasAmount && Boolean(toStorage) && amountValue > transferFreeSpace + 0.001;
  const isError =
    hasAmount && Boolean(fromStorage) && amountValue > availableVolume;
  const isAbsurdAmount =
    hasAmount && amountValue > MAX_TRACTOR_TANK_LITERS;

  const insufficientFuelError = isError
    ? `Недостатньо палива в «${donorName}» (є ${Math.round(availableVolume).toLocaleString("uk-UA")} л)`
    : null;
  const refuelValidationError = isAbsurdAmount
    ? "Перевищено максимальну місткість бака техніки"
    : insufficientFuelError;

  useEffect(() => {
    if (!isReceiveOpen) return;
    setError(null);
    setPurchaseSuccess(null);
    setPendingFiles([]);
    if (editTransaction?.type === "inbound") {
      setAmount(String(editTransaction.amountLiters));
      const targetId = editTransaction.toStorageId ?? stationaryId;
      setToStorage(targetId);
      const storagePrice =
        storages.find((s) => s.id === targetId)?.pricePerLiter ?? 0;
      setPricePerLiter(storagePrice > 0 ? String(storagePrice) : "");
      return;
    }
    setAmount("");
    setToStorage(stationaryId);
    const storagePrice =
      storages.find((s) => s.id === stationaryId)?.pricePerLiter ?? 0;
    setPricePerLiter(storagePrice > 0 ? String(storagePrice) : "");
  }, [isReceiveOpen, stationaryId, editTransaction, storages]);

  useEffect(() => {
    if (!isTransferOpen) return;
    setError(null);
    setTransferPendingFiles([]);
    if (editTransaction?.type === "transfer") {
      setAmount(String(editTransaction.amountLiters));
      setFromStorage(editTransaction.fromStorageId ?? stationaryId);
      setToStorage(editTransaction.toStorageId ?? mobileId);
      return;
    }
    setAmount("");
    setFromStorage(stationaryId);
    setToStorage(mobileId);
  }, [isTransferOpen, stationaryId, mobileId, editTransaction]);

  useEffect(() => {
    if (!isRefuelOpen) return;
    setError(null);
    setRefuelLocationLabel(null);
    setRefuelActiveOp(null);
    setLinkActiveOp(true);
    if (editTransaction?.type === "outbound") {
      setAmount(String(editTransaction.amountLiters));
      setFromStorage(editTransaction.fromStorageId ?? mobileId);
      const match = findEquipmentOpsOption(
        units.map(
          (u): EquipmentOpsOption => ({
            key: u.key,
            label: u.name,
            equipmentId: u.equipmentId ?? null,
            wialonUnitId: u.wialonUnitId ?? null,
            hasTracker: u.hasTracker,
            group: u.hasTracker ? "tracked" : "non_tracked",
          })
        ),
        {
          equipmentId: editTransaction.equipmentId,
          wialonUnitId: editTransaction.wialonUnitId,
        }
      );
      setUnitId(match?.key ?? units[0]?.key ?? "");
      return;
    }
    setAmount("");
    setFromStorage(mobileId);
    setUnitId(units[0]?.key ?? "");
  }, [isRefuelOpen, mobileId, units, editTransaction]);

  /** Smart Context: локація Wialon + активний наряд при виборі техніки з GPS */
  useEffect(() => {
    if (!isRefuelOpen || !selectedUnit?.wialonUnitId) {
      setRefuelLocationLabel(null);
      setRefuelActiveOp(null);
      return;
    }
    const parsed = selectedUnit.wialonUnitId;

    let cancelled = false;
    setRefuelContextLoading(true);
    setRefuelLocationLabel(null);
    setRefuelActiveOp(null);
    setLinkActiveOp(true);

    void getRefuelSmartContext(parsed).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRefuelLocationLabel(res.data.locationLabel);
        setRefuelActiveOp(res.data.activeOperation);
        setLinkActiveOp(Boolean(res.data.activeOperation));
      }
      setRefuelContextLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isRefuelOpen, selectedUnit?.wialonUnitId]);

  function closeReceive(open: boolean) {
    onReceiveOpenChange(open);
    if (!open) {
      setPurchaseSuccess(null);
      setPendingFiles([]);
      onEditTransactionChange?.(null);
    }
  }
  function closeTransfer(open: boolean) {
    onTransferOpenChange(open);
    if (!open) {
      setTransferPendingFiles([]);
      onEditTransactionChange?.(null);
    }
  }
  function closeRefuel(open: boolean) {
    onRefuelOpenChange(open);
    if (!open) onEditTransactionChange?.(null);
  }

  async function runSubmit(
    event: FormEvent,
    action: () => Promise<void>,
    close: () => void
  ) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await action();
      close();
      setAmount("");
      setPricePerLiter("");
      onEditTransactionChange?.(null);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Закупівля */}
      <FuelPanelShell
        open={isReceiveOpen}
        onOpenChange={closeReceive}
        title="Закупівля"
      >
          <FuelSheetHeader
            icon={Plus}
            accent="emerald"
            title={
              isEditing && editTransaction?.type === "inbound"
                ? "Редагувати закупівлю"
                : "Закупівля"
            }
            description="Прихід на базу · видно залишки складів"
          />

          {purchaseSuccess ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                  <CheckCircle2 className="h-8 w-8" strokeWidth={1.8} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-base font-semibold text-zinc-900">
                    Партію збережено
                  </p>
                  <p className="max-w-xs text-sm leading-relaxed text-zinc-500">
                    {purchaseSuccess}
                  </p>
                </div>
              </div>
              <FuelSheetFooter>
                <Button
                  type="button"
                  onClick={() => closeReceive(false)}
                  className={fuelPrimaryBtnClass}
                >
                  Готово
                </Button>
              </FuelSheetFooter>
            </div>
          ) : (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                setSubmitting(true);
                setError(null);
                try {
                  const liters = parseAmount(amount);
                  if (liters == null) throw new Error("Вкажіть кількість літрів");
                  if (!toStorage) throw new Error("Оберіть ємність");
                  const price = parsePrice(pricePerLiter);
                  if (price == null) {
                    throw new Error("Вкажіть ціну за літр (₴)");
                  }
                  const free = receiverFreeSpace(
                    storages,
                    toStorage,
                    editTransaction
                  );
                  if (liters > free + 0.001) {
                    throw new Error(overflowMessage(free));
                  }
                  const result = await saveTransaction(
                    {
                      transactionType: "inbound",
                      amountLiters: liters,
                      toStorageId: toStorage,
                      pricePerLiter: price,
                    },
                    editTransaction?.type === "inbound" ? editId : null
                  );
                  if (result.transactionId && pendingFiles.length > 0) {
                    await flushPendingAttachments(
                      "fuel_transaction",
                      result.transactionId,
                      pendingFiles
                    );
                    setPendingFiles([]);
                  }
                  setAmount("");
                  setPricePerLiter("");
                  onEditTransactionChange?.(null);
                  await onSuccess();
                  setPurchaseSuccess(
                    result.message ??
                      "Партію збережено"
                    );
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Помилка збереження"
                  );
                } finally {
                  setSubmitting(false);
                }
              })();
            }}
          >
            <div className={cn(fuelSheetBodyClass, "space-y-6")} data-vaul-no-drag="" data-allow-pan="true">
              <StorageSelect
                label="Куди зливаємо"
                value={toStorage}
                onChange={(id) => {
                  setToStorage(id);
                  const next = storages.find((s) => s.id === id);
                  if (next && next.pricePerLiter > 0 && !pricePerLiter.trim()) {
                    setPricePerLiter(String(next.pricePerLiter));
                  }
                }}
                storages={storages}
                items={storageItems}
                placeholder="Оберіть ємність"
              />

              <LitersAmountField
                id="receive-amount"
                value={amount}
                onChange={setAmount}
                placeholder="2 000"
              />
              {receiveOverflow ? (
                <OverflowHint maxAddLiters={receiveFreeSpace} />
              ) : null}

              <MoneyAmountField
                id="receive-price"
                label="Ціна за літр"
                value={pricePerLiter}
                onChange={setPricePerLiter}
                placeholder={
                  selectedReceiveStorage?.pricePerLiter
                    ? String(selectedReceiveStorage.pricePerLiter)
                    : "52.50"
                }
              />

              {partyCost ? (
                <p className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-3.5 py-2.5 text-sm text-emerald-900">
                  Загальна вартість партії:{" "}
                  <span className="font-bold tabular-nums">{partyCost} ₴</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Вартість партії зʼявиться після кількості та ціни
                </p>
              )}

              <div className="space-y-2">
                <p className={fuelFieldLabelClass}>Накладна</p>
                <AttachmentDropzone
                  entityType="fuel_transaction"
                  entityId={
                    editTransaction?.type === "inbound" ? editId : null
                  }
                  pending={pendingFiles}
                  onPendingChange={setPendingFiles}
                />
              </div>

              {error ? <FormErrorBanner message={error} /> : null}
            </div>

            <FuelSheetFooter>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !amount ||
                  !pricePerLiter ||
                  receiveOverflow ||
                  storages.length === 0
                }
                className={fuelPrimaryBtnClass}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "inbound" ? (
                  "Зберегти зміни"
                ) : (
                  "Підтвердити прихід"
                )}
              </Button>
            </FuelSheetFooter>
          </form>
          )}
      </FuelPanelShell>

      {/* Переміщення */}
      <FuelPanelShell
        open={isTransferOpen}
        onOpenChange={closeTransfer}
        title="Переміщення"
      >
          <FuelSheetHeader
            icon={ArrowRightLeft}
            accent="sky"
            title={
              isEditing && editTransaction?.type === "transfer"
                ? "Редагувати переміщення"
                : "Переміщення"
            }
            description="Цистерни → бензовоз · видно залишки"
          />

          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) =>
              void runSubmit(
                event,
                async () => {
                  const liters = parseAmount(amount);
                  if (liters == null) throw new Error("Вкажіть кількість літрів");
                  if (!fromStorage || !toStorage) {
                    throw new Error("Оберіть обидві ємності");
                  }
                  if (liters > availableVolume) {
                    throw new Error(
                      `Недостатньо палива в «${donorName}» (є ${Math.round(availableVolume).toLocaleString("uk-UA")} л)`
                    );
                  }
                  const free = receiverFreeSpace(
                    storages,
                    toStorage,
                    editTransaction
                  );
                  if (liters > free + 0.001) {
                    throw new Error(overflowMessage(free));
                  }
                  const result = await saveTransaction(
                    {
                      transactionType: "transfer",
                      amountLiters: liters,
                      fromStorageId: fromStorage,
                      toStorageId: toStorage,
                    },
                    editTransaction?.type === "transfer" ? editId : null
                  );
                  if (result.transactionId && transferPendingFiles.length > 0) {
                    await flushPendingAttachments(
                      "fuel_transaction",
                      result.transactionId,
                      transferPendingFiles
                    );
                    setTransferPendingFiles([]);
                  }
                },
                () => closeTransfer(false)
              )
            }
          >
            <div className={cn(fuelSheetBodyClass, "space-y-6")} data-vaul-no-drag="" data-allow-pan="true">
              <StorageSelect
                label="Звідки"
                value={fromStorage}
                onChange={setFromStorage}
                storages={storages}
                items={storageItems}
                placeholder="Ємність-донор"
              />

              <StorageSelect
                label="Куди"
                value={toStorage}
                onChange={setToStorage}
                storages={storages}
                items={storageItems}
                placeholder="Ємність-отримувач"
              />

              <LitersAmountField
                id="transfer-amount"
                value={amount}
                onChange={setAmount}
                placeholder="500"
              />
              {transferOverflow ? (
                <OverflowHint maxAddLiters={transferFreeSpace} />
              ) : null}
              {!transferOverflow && insufficientFuelError ? (
                <FormErrorBanner message={insufficientFuelError} />
              ) : null}

              <div className="space-y-2">
                <p className={fuelFieldLabelClass}>Накладна</p>
                <AttachmentDropzone
                  entityType="fuel_transaction"
                  entityId={
                    editTransaction?.type === "transfer" ? editId : null
                  }
                  pending={transferPendingFiles}
                  onPendingChange={setTransferPendingFiles}
                />
              </div>

              {error ? <FormErrorBanner message={error} /> : null}
            </div>

            <FuelSheetFooter>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !amount ||
                  isError ||
                  transferOverflow ||
                  storages.length < 2
                }
                className={cn(fuelPrimaryBtnClass, "bg-sky-700 hover:bg-sky-800 shadow-sky-700/30")}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "transfer" ? (
                  "Зберегти зміни"
                ) : (
                  "Перемістити паливо"
                )}
              </Button>
            </FuelSheetFooter>
          </form>
      </FuelPanelShell>

      {/* Заправка техніки */}
      <FuelPanelShell
        open={isRefuelOpen}
        onOpenChange={closeRefuel}
        title="Заправка техніки"
      >
          <FuelSheetHeader
            icon={Tractor}
            accent="emerald"
            title={
              isEditing && editTransaction?.type === "outbound"
                ? "Редагувати заправку"
                : "Заправка техніки"
            }
            description="Списання з бензовоза · видно залишки"
          />

          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) =>
              void runSubmit(
                event,
                async () => {
                  const liters = parseAmount(amount);
                  if (liters == null) throw new Error("Вкажіть кількість літрів");
                  if (!fromStorage) throw new Error("Оберіть ємність-донор");
                  if (liters > MAX_TRACTOR_TANK_LITERS) {
                    throw new Error(
                      "Перевищено максимальну місткість бака техніки"
                    );
                  }
                  if (liters > availableVolume) {
                    throw new Error(
                      `Недостатньо палива в «${donorName}» (є ${Math.round(availableVolume).toLocaleString("uk-UA")} л)`
                    );
                  }
                  const selected = units.find((u) => u.key === unitId);
                  if (!selected) {
                    throw new Error("Оберіть техніку");
                  }
                  const hasFuelSensor = selected.hasFuelSensor;
                  const editOutboundId =
                    editTransaction?.type === "outbound" ? editId : null;
                  if (editOutboundId) {
                    await saveTransaction(
                      {
                        transactionType: "outbound",
                        amountLiters: liters,
                        fromStorageId: fromStorage,
                        equipmentId: selected.equipmentId ?? null,
                        wialonUnitId: selected.wialonUnitId ?? null,
                        hasFuelSensor,
                      },
                      editOutboundId
                    );
                  } else {
                    await submitRefuel({
                      fromStorageId: fromStorage,
                      equipmentId: selected.equipmentId ?? null,
                      wialonUnitId: selected.wialonUnitId ?? null,
                      amountLiters: liters,
                      operatorName: null,
                      hasFuelSensor,
                      fieldOperationId:
                        linkActiveOp && refuelActiveOp
                          ? refuelActiveOp.id
                          : null,
                    });
                  }
                },
                () => closeRefuel(false)
              )
            }
          >
            <div className={cn(fuelSheetBodyClass, "space-y-6")} data-vaul-no-drag="" data-allow-pan="true">
              <StorageSelect
                label="Звідки"
                value={fromStorage}
                onChange={setFromStorage}
                storages={storages}
                items={storageItems}
                placeholder="Ємність-донор"
              />

              <div className="min-w-0 space-y-1.5">
                <Label className={fuelFieldLabelClass}>
                  Техніка
                </Label>
                <Select
                  items={unitItems}
                  value={unitId || null}
                  onValueChange={(next) => {
                    if (typeof next === "string" && next) setUnitId(next);
                  }}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue
                      placeholder={
                        unitsLoading ? "Завантаження…" : "Оберіть техніку"
                      }
                    >
                      {selectedUnit ? unitSelectLabel(selectedUnit) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    sheetOnMobile={false}
                    alignItemWithTrigger
                    className="z-[80] max-w-[min(100vw-2rem,28rem)] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-lg"
                  >
                    {trackedUnits.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>З GPS</SelectLabel>
                        {trackedUnits.map((unit) => (
                          <SelectItem
                            key={unit.key}
                            value={unit.key}
                            className={selectItemClass}
                          >
                            <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                              <span className="truncate font-semibold text-zinc-900">
                                {unit.hasFuelSensor
                                  ? `${unit.name} (GPS-контроль)`
                                  : `${unit.name} (Без датчика)`}
                              </span>
                              <span
                                className={cn(
                                  "truncate text-sm font-medium",
                                  unit.hasFuelSensor
                                    ? "text-emerald-600"
                                    : "text-zinc-500"
                                )}
                              >
                                {unit.hasFuelSensor
                                  ? "Звірка з датчиком палива Wialon"
                                  : "Ручний облік · без ДУТ"}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {nonTrackedUnits.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Без трекера</SelectLabel>
                        {nonTrackedUnits.map((unit) => (
                          <SelectItem
                            key={unit.key}
                            value={unit.key}
                            className={selectItemClass}
                          >
                            <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                              <span className="truncate font-semibold text-zinc-900">
                                {unit.name}
                              </span>
                              <span className="truncate text-sm font-medium text-zinc-500">
                                Ручний облік · без GPS
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>

              {unitId ? (
                <div className="space-y-2.5 rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 to-white px-3.5 py-3 shadow-sm">
                  {refuelContextLoading ? (
                    <p className="flex items-center gap-2 text-sm text-emerald-800/80">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Шукаємо техніку в полі…
                    </p>
                  ) : (
                    <>
                      {refuelLocationLabel ? (
                        <p className="flex items-start gap-2 text-sm font-medium text-emerald-900">
                          <MapPin
                            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                            strokeWidth={2}
                          />
                          <span>
                            Локація зараз: {refuelLocationLabel}
                          </span>
                        </p>
                      ) : (
                        <p className="flex items-start gap-2 text-sm text-zinc-500">
                          <MapPin
                            className="mt-0.5 h-4 w-4 shrink-0"
                            strokeWidth={2}
                          />
                          <span>Локація за GPS зараз невідома</span>
                        </p>
                      )}

                      {refuelActiveOp ? (
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/70 px-2.5 py-2.5 text-sm text-zinc-800 shadow-sm ring-1 ring-emerald-100">
                          <input
                            type="checkbox"
                            checked={linkActiveOp}
                            onChange={(event) =>
                              setLinkActiveOp(event.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                          />
                          <span className="leading-snug">
                            Привʼязати заправку до активного наряду (
                            {refuelActiveOp.workType}
                            {refuelActiveOp.fieldName
                              ? ` · ${refuelActiveOp.fieldName}`
                              : ""}
                            )
                          </span>
                        </label>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              <LitersAmountField
                id="refuel-amount"
                value={amount}
                onChange={setAmount}
                placeholder="80"
              />
              {refuelValidationError || error ? (
                <FormErrorBanner
                  message={refuelValidationError || error || ""}
                />
              ) : null}
            </div>

            <FuelSheetFooter>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !amount ||
                  isError ||
                  isAbsurdAmount ||
                  units.length === 0
                }
                className={cn(fuelPrimaryBtnClass, "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/35")}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "outbound" ? (
                  "Зберегти зміни"
                ) : (
                  "Заправити техніку"
                )}
              </Button>
            </FuelSheetFooter>
          </form>
      </FuelPanelShell>
    </>
  );
}

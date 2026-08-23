"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Loader2,
  Plus,
  Tractor,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FuelStorage } from "@/lib/fuel-storages";
import type {
  FuelTransaction,
  FuelTransactionType,
} from "@/lib/fuel-transactions";
import { cn } from "@/lib/utils";

export type FleetUnitOption = {
  id: number;
  name: string;
  /** Чи є ДУТ / паливний сенсор для GPS-звірки */
  hasFuelSensor: boolean;
};

export function unitSelectLabel(unit: FleetUnitOption): string {
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

const selectTriggerClass = cn(
  "h-16 w-full min-w-0 max-w-full data-[size=default]:h-16 rounded-2xl border border-zinc-200 bg-zinc-50 px-4",
  "text-lg font-medium text-zinc-900",
  "overflow-hidden outline-none transition-all",
  "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
  "data-placeholder:text-zinc-400"
);

const selectItemClass = cn(
  "cursor-pointer rounded-xl px-3 py-3 text-base",
  "focus:bg-zinc-100"
);

async function saveTransaction(
  payload: {
    transactionType: FuelTransactionType;
    amountLiters: number;
    fromStorageId?: string | null;
    toStorageId?: string | null;
    wialonUnitId?: number | null;
    hasFuelSensor?: boolean | null;
  },
  editId?: string | null
): Promise<void> {
  const response = await fetch(
    editId ? `/api/fuel/transactions/${editId}` : "/api/fuel/transactions",
    {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Не вдалося зберегти операцію");
  }
}

async function submitRefuel(payload: {
  fromStorageId: string;
  wialonUnitId: number;
  amountLiters: number;
  operatorName?: string | null;
  hasFuelSensor: boolean;
}): Promise<void> {
  const response = await fetch("/api/fuel/refuel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Не вдалося зберегти заправку");
  }
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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

/** Велике поле кількості літрів (банківський стиль, без spinner) */
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
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs font-semibold tracking-wide text-zinc-500 uppercase"
      >
        Кількість
      </Label>
      <div className="relative flex items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <input
          id={id}
          type="number"
          min={1}
          step="0.1"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "h-20 w-full min-w-0 bg-transparent text-center text-5xl font-bold text-zinc-900",
            "border-none outline-none focus:ring-0 focus:outline-none",
            "tabular-nums placeholder:text-zinc-300",
            "[&::-webkit-inner-spin-button]:appearance-none",
            "[&::-webkit-outer-spin-button]:appearance-none",
            "[-moz-appearance:textfield]"
          )}
        />
        <span className="pointer-events-none absolute right-5 bottom-4 text-lg font-medium tracking-wide text-zinc-400 uppercase">
          літрів
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
      <Label className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </Label>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => {
          if (typeof next === "string" && next) onChange(next);
        }}
      >
        <SelectTrigger className={selectTriggerClass}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-lg">
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
  const [fromStorage, setFromStorage] = useState("");
  const [toStorage, setToStorage] = useState("");
  const [unitId, setUnitId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        value: String(unit.id),
        label: unitSelectLabel(unit),
      })),
    [units]
  );

  const amountValue = parseAmount(amount);
  const hasAmount = amountValue != null;

  const availableVolume = useMemo(
    () => donorAvailableVolume(storages, fromStorage, editTransaction),
    [storages, fromStorage, editTransaction]
  );
  const donorName =
    storages.find((s) => s.id === fromStorage)?.name ?? "ємності";

  const isError =
    hasAmount && Boolean(fromStorage) && amountValue > availableVolume;
  const isAbsurdAmount =
    hasAmount && amountValue > MAX_TRACTOR_TANK_LITERS;

  const insufficientFuelError = isError
    ? `Недостатньо палива в «${donorName}» (є ${Math.round(availableVolume).toLocaleString("uk-UA")} л)`
    : null;
  const transferValidationError = insufficientFuelError;
  const refuelValidationError = isAbsurdAmount
    ? "Перевищено максимальну місткість бака техніки"
    : insufficientFuelError;

  useEffect(() => {
    if (!isReceiveOpen) return;
    setError(null);
    if (editTransaction?.type === "inbound") {
      setAmount(String(editTransaction.amountLiters));
      setToStorage(editTransaction.toStorageId ?? stationaryId);
      return;
    }
    setAmount("");
    setToStorage(stationaryId);
  }, [isReceiveOpen, stationaryId, editTransaction]);

  useEffect(() => {
    if (!isTransferOpen) return;
    setError(null);
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
    if (editTransaction?.type === "outbound") {
      setAmount(String(editTransaction.amountLiters));
      setFromStorage(editTransaction.fromStorageId ?? mobileId);
      setUnitId(
        editTransaction.wialonUnitId != null
          ? String(editTransaction.wialonUnitId)
          : units[0]
            ? String(units[0].id)
            : ""
      );
      return;
    }
    setAmount("");
    setFromStorage(mobileId);
    setUnitId(units[0] ? String(units[0].id) : "");
  }, [isRefuelOpen, mobileId, units, editTransaction]);

  function closeReceive(open: boolean) {
    onReceiveOpenChange(open);
    if (!open) onEditTransactionChange?.(null);
  }
  function closeTransfer(open: boolean) {
    onTransferOpenChange(open);
    if (!open) onEditTransactionChange?.(null);
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
      {/* Прийомка */}
      <Dialog open={isReceiveOpen} onOpenChange={closeReceive}>
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-md",
            "[&_[data-slot=dialog-close]]:text-zinc-500"
          )}
        >
          <DialogHeader className="border-b border-zinc-100 px-6 py-5 pr-12">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm">
                <Plus className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold tracking-tight">
                  {isEditing && editTransaction?.type === "inbound"
                    ? "Редагувати закупівлю"
                    : "Закупівля (Прихід на Базу)"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-zinc-500">
                  Поповнення резервуара · запис у журнал операцій
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            className="flex flex-col gap-6 px-6 py-5"
            onSubmit={(event) =>
              void runSubmit(
                event,
                async () => {
                  const liters = parseAmount(amount);
                  if (liters == null) throw new Error("Вкажіть кількість літрів");
                  if (!toStorage) throw new Error("Оберіть ємність");
                  await saveTransaction(
                    {
                      transactionType: "inbound",
                      amountLiters: liters,
                      toStorageId: toStorage,
                    },
                    editTransaction?.type === "inbound" ? editId : null
                  );
                },
                () => closeReceive(false)
              )
            }
          >
            <StorageSelect
              label="Куди зливаємо"
              value={toStorage}
              onChange={setToStorage}
              storages={storages}
              items={storageItems}
              placeholder="Оберіть ємність"
            />

            <div className="space-y-4">
              <LitersAmountField
                id="receive-amount"
                value={amount}
                onChange={setAmount}
                placeholder="2000"
              />
              {error ? <FormErrorBanner message={error} /> : null}
            </div>

            <DialogFooter className="mt-2 gap-2 border-0 bg-transparent p-0 sm:justify-stretch">
              <Button
                type="submit"
                disabled={submitting || !amount || storages.length === 0}
                className={cn(
                  "h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white",
                  "transition-transform hover:bg-zinc-800 active:scale-[0.98]",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "inbound" ? (
                  "Зберегти зміни"
                ) : (
                  "Підтвердити прихід"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Переміщення */}
      <Dialog open={isTransferOpen} onOpenChange={closeTransfer}>
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-md",
            "[&_[data-slot=dialog-close]]:text-zinc-500"
          )}
        >
          <DialogHeader className="border-b border-zinc-100 px-6 py-5 pr-12">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 shadow-sm">
                <ArrowRightLeft className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold tracking-tight">
                  {isEditing && editTransaction?.type === "transfer"
                    ? "Редагувати переміщення"
                    : "Переміщення (Цистерни → Бензовоз)"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-zinc-500">
                  Внутрішнє переливання між ємностями
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            className="flex flex-col gap-6 px-6 py-5"
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
                  await saveTransaction(
                    {
                      transactionType: "transfer",
                      amountLiters: liters,
                      fromStorageId: fromStorage,
                      toStorageId: toStorage,
                    },
                    editTransaction?.type === "transfer" ? editId : null
                  );
                },
                () => closeTransfer(false)
              )
            }
          >
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

            <div className="space-y-4">
              <LitersAmountField
                id="transfer-amount"
                value={amount}
                onChange={setAmount}
                placeholder="500"
              />
              {transferValidationError || error ? (
                <FormErrorBanner
                  message={transferValidationError || error || ""}
                />
              ) : null}
            </div>

            <DialogFooter className="mt-2 gap-2 border-0 bg-transparent p-0 sm:justify-stretch">
              <Button
                type="submit"
                disabled={
                  submitting || !amount || isError || storages.length < 2
                }
                className={cn(
                  "h-12 w-full rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-800",
                  "transition-transform hover:bg-zinc-50 active:scale-[0.98]",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "transfer" ? (
                  "Зберегти зміни"
                ) : (
                  "Перемістити паливо"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Заправка техніки */}
      <Dialog open={isRefuelOpen} onOpenChange={closeRefuel}>
        <DialogContent
          className={cn(
            "w-full max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-md",
            "[&_[data-slot=dialog-close]]:text-zinc-500"
          )}
        >
          <DialogHeader className="border-b border-zinc-100 px-6 py-5 pr-12">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                <Tractor className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold tracking-tight">
                  {isEditing && editTransaction?.type === "outbound"
                    ? "Редагувати заправку"
                    : "Заправка Техніки"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-zinc-500">
                  Списання з бензовоза на обрану техніку
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            className="flex min-w-0 flex-col gap-6 overflow-hidden px-6 py-5"
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
                  const parsedUnit = Number(unitId);
                  if (!Number.isFinite(parsedUnit) || parsedUnit <= 0) {
                    throw new Error("Оберіть техніку");
                  }
                  const selectedUnit = units.find((u) => u.id === parsedUnit);
                  const hasFuelSensor = selectedUnit?.hasFuelSensor ?? false;
                  const editOutboundId =
                    editTransaction?.type === "outbound" ? editId : null;
                  if (editOutboundId) {
                    await saveTransaction(
                      {
                        transactionType: "outbound",
                        amountLiters: liters,
                        fromStorageId: fromStorage,
                        wialonUnitId: parsedUnit,
                        hasFuelSensor,
                      },
                      editOutboundId
                    );
                  } else {
                    await submitRefuel({
                      fromStorageId: fromStorage,
                      wialonUnitId: parsedUnit,
                      amountLiters: liters,
                      operatorName: null,
                      hasFuelSensor,
                    });
                  }
                },
                () => closeRefuel(false)
              )
            }
          >
            <StorageSelect
              label="Звідки"
              value={fromStorage}
              onChange={setFromStorage}
              storages={storages}
              items={storageItems}
              placeholder="Ємність-донор"
            />

            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
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
                  />
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger
                  className="z-[80] max-w-[min(100vw-2rem,28rem)] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-lg"
                >
                  {units.map((unit) => {
                    const hasFuelSensor = unit.hasFuelSensor;
                    return (
                      <SelectItem
                        key={unit.id}
                        value={String(unit.id)}
                        className={selectItemClass}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                          <span className="truncate font-semibold text-zinc-900">
                            {hasFuelSensor
                              ? `${unit.name} (GPS-контроль)`
                              : `${unit.name} (Без датчика)`}
                          </span>
                          <span
                            className={cn(
                              "truncate text-sm font-medium",
                              hasFuelSensor
                                ? "text-emerald-600"
                                : "text-zinc-500"
                            )}
                          >
                            {hasFuelSensor
                              ? "Звірка з датчиком палива Wialon"
                              : "Ручний облік · без ДУТ"}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
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

            <DialogFooter className="mt-2 gap-2 border-0 bg-transparent p-0 sm:justify-stretch">
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !amount ||
                  isError ||
                  isAbsurdAmount ||
                  units.length === 0
                }
                className={cn(
                  "h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-white",
                  "transition-transform hover:bg-emerald-600 active:scale-[0.98]",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditing && editTransaction?.type === "outbound" ? (
                  "Зберегти зміни"
                ) : (
                  "Заправити техніку"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

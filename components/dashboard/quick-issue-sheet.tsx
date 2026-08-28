"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  FlaskConical,
  Leaf,
  Loader2,
  PackageMinus,
  Sprout,
  Wheat,
  Wrench,
} from "lucide-react";

import {
  createLocalOutboundMove,
  getQuickIssueOptions,
  syncInventoryNomenclatureAction,
  type QuickIssueFieldOption,
  type QuickIssueItemOption,
} from "@/app/admin/inventory/actions";
import {
  AttachmentDropzone,
  flushPendingAttachments,
  type PendingAttachment,
} from "@/components/dashboard/attachment-dropzone";
import { FieldPassportQuickFix } from "@/components/dashboard/field-passport-quick-fix";
import {
  FuelSheetHeader,
  fuelFieldLabelClass,
  fuelHeroAmountClass,
  fuelPrimaryBtnClass,
  fuelSelectItemClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
  fuelSheetContentClass,
  fuelSheetStickyFooterClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { isFieldPassportComplete } from "@/lib/field-passport";
import { suppressLocalInventoryMovesRealtimeToast } from "@/lib/realtime-toast-guard";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

const comboboxTriggerClass = cn(
  fuelSelectTriggerClass,
  "flex items-center justify-between gap-3 text-left"
);

function formatQtyLabel(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatAreaHa(areaHa: number): string {
  if (!Number.isFinite(areaHa) || areaHa <= 0) return "—";
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: areaHa >= 100 ? 0 : 1,
  }).format(areaHa);
}

type Cat = QuickIssueItemOption["category"];

const CATEGORIES: {
  id: Cat;
  label: string;
  icon: typeof FlaskConical;
  accent: string;
  fieldRequired: boolean;
}[] = [
  { id: "zzr", label: "ЗЗР", icon: FlaskConical, accent: "#276749", fieldRequired: true },
  { id: "fertilizer", label: "Добрива", icon: Sprout, accent: "#C05621", fieldRequired: true },
  { id: "seed", label: "Насіння", icon: Leaf, accent: "#2F855A", fieldRequired: true },
  { id: "parts", label: "Запчастини", icon: Wrench, accent: "#4A5568", fieldRequired: false },
];

type QuickIssueSuccessPayload = {
  moveId: string;
  fieldId: string;
  fieldName: string;
  itemTitle: string;
  category: QuickIssueItemOption["category"];
  qty: number;
  unit: string;
};

type QuickIssueSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetItemRefKey?: string | null;
  presetFieldId?: string | null;
  lockField?: boolean;
  variant?: "sheet" | "panel";
  onBack?: () => void;
  onSuccess?: (payload: QuickIssueSuccessPayload) => void;
};

export function QuickIssueSheet({
  open,
  onOpenChange,
  presetItemRefKey = null,
  presetFieldId = null,
  lockField = false,
  variant = "sheet",
  onBack,
  onSuccess,
}: QuickIssueSheetProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<QuickIssueItemOption[]>([]);
  const [fields, setFields] = useState<QuickIssueFieldOption[]>([]);

  const [category, setCategory] = useState<Cat | null>(null);
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [itemOpen, setItemOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [pending, startTransition] = useTransition();
  const activeSeason = useSeasonStore((s) => s.activeSeason);

  const selectedItem = useMemo(
    () => items.find((i) => i.basRefKey === itemKey) ?? null,
    [items, itemKey]
  );
  const selectedField = useMemo(
    () => fields.find((f) => f.id === fieldId) ?? null,
    [fields, fieldId]
  );

  const fieldPassportOk = isFieldPassportComplete(selectedField);
  const isBlocked = Boolean(selectedField) && !fieldPassportOk;

  const qtyNum = Number(String(qty).replace(",", "."));
  const qtyExceedsBalance =
    selectedItem != null &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    qtyNum > selectedItem.virtualBalance;

  const fieldRequired =
    CATEGORIES.find((c) => c.id === category)?.fieldRequired ?? true;

  const isSubmitDisabled =
    isBlocked ||
    pending ||
    loading ||
    Boolean(loadError) ||
    !category ||
    !itemKey ||
    (fieldRequired && !fieldId) ||
    !Number.isFinite(qtyNum) ||
    qtyNum <= 0 ||
    qtyExceedsBalance ||
    (selectedItem != null && selectedItem.virtualBalance <= 0);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { zzr: 0, fertilizer: 0, seed: 0, parts: 0 };
    for (const item of items) counts[item.category] += 1;
    return counts;
  }, [items]);

  const categoryItems = useMemo(() => {
    if (!category) return [];
    return items.filter((i) => i.category === category);
  }, [items, category]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoadError(null);
      setFormError(null);
      setLoading(true);

      let res = await getQuickIssueOptions();
      if (cancelled) return;

      if (res.ok && res.items.length === 0) {
        const sync = await syncInventoryNomenclatureAction();
        if (cancelled) return;
        if (!sync.ok) {
          setLoading(false);
          setLoadError(
            sync.error ||
              "Довідник ТМЦ порожній. Не вдалося синхронізувати номенклатуру."
          );
          setItems([]);
          setFields(res.fields);
          return;
        }
        res = await getQuickIssueOptions();
        if (cancelled) return;
      }

      setLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        setItems([]);
        setFields([]);
        return;
      }
      setItems(res.items);
      setFields(res.fields);
      if (res.items.length === 0) {
        setLoadError(
          "Довідник ТМЦ порожній. Додайте позицію на складі або синхронізуйте номенклатуру."
        );
        return;
      }

      const preset = presetItemRefKey?.trim().toLowerCase();
      if (preset) {
        const found = res.items.find(
          (i) => i.basRefKey.toLowerCase() === preset
        );
        if (found) {
          setCategory(found.category);
          setItemKey(found.basRefKey);
        }
      }

      const fieldPreset = presetFieldId?.trim();
      if (fieldPreset) {
        const foundField = res.fields.find((f) => f.id === fieldPreset);
        if (foundField) setFieldId(foundField.id);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, presetItemRefKey, presetFieldId]);

  function resetForm() {
    setCategory(null);
    setItemKey(null);
    setFieldId(null);
    setQty("");
    setItemOpen(false);
    setFieldOpen(false);
    setFormError(null);
    setPendingFiles([]);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!category) {
      setFormError("Оберіть категорію");
      return;
    }
    if (!itemKey) {
      setFormError("Оберіть товар");
      return;
    }
    const needsField =
      CATEGORIES.find((c) => c.id === category)?.fieldRequired ?? true;
    if (needsField && !fieldId) {
      setFormError("Оберіть поле");
      return;
    }
    if (needsField && !isFieldPassportComplete(selectedField)) {
      setFormError(
        "У цього поля не заповнений паспорт (площа або культура)."
      );
      return;
    }
    const parsedQty = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setFormError("Вкажіть кількість більше нуля");
      return;
    }
    if (selectedItem && parsedQty > selectedItem.virtualBalance) {
      setFormError("Перевищення доступного залишку на складі");
      return;
    }

    startTransition(async () => {
      suppressLocalInventoryMovesRealtimeToast();
      const res = await createLocalOutboundMove({
        itemRefKey: itemKey,
        fieldId: fieldId,
        qty: parsedQty,
        season: activeSeason,
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      if (pendingFiles.length > 0) {
        await flushPendingAttachments(
          "inventory_move",
          res.id,
          pendingFiles
        );
      }
      const unit = selectedItem?.unit ? ` ${selectedItem.unit}` : "";
      toast.success(
        needsField
          ? `Списано ${parsedQty}${unit} → ${selectedField?.name ?? "поле"}`
          : `Списано ${parsedQty}${unit} зі складу`
      );
      onSuccess?.({
        moveId: res.id,
        fieldId: fieldId ?? "",
        fieldName: selectedField?.name ?? (needsField ? "поле" : "склад"),
        itemTitle: selectedItem?.name ?? "ТМЦ",
        category: selectedItem?.category ?? "zzr",
        qty: parsedQty,
        unit: selectedItem?.unit ?? "",
      });
      resetForm();
      onOpenChange(false);
    });
  }

  const fieldLabel = (label: string) => (
    <p className={fuelFieldLabelClass}>{label}</p>
  );

  const issueHeader =
    variant === "panel" ? (
      <div className="shrink-0 border-b border-zinc-200/70 bg-white px-4 py-3 text-left md:px-5 md:py-4">
        <button
          type="button"
          onClick={() => {
            onBack?.();
            onOpenChange(false);
          }}
          className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-900 md:min-h-0 md:text-xs"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Назад до поля
        </button>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900">
          Списати ТМЦ
        </h2>
        {selectedField ? (
          <p className="mt-1 text-sm text-zinc-500">{selectedField.name}</p>
        ) : null}
      </div>
    ) : (
      <FuelSheetHeader
        icon={PackageMinus}
        title="Списання зі складу"
        accent="emerald"
      />
    );

  const issueForm = (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className={cn(fuelSheetBodyClass, "space-y-5")}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Завантаження довідників…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{loadError}</p>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              {fieldLabel("Категорія")}
              <Select
                items={CATEGORIES.map((c) => ({
                  value: c.id,
                  label: c.label,
                }))}
                value={category}
                onValueChange={(v) => {
                  if (typeof v !== "string" || !v) return;
                  setCategory(v as Cat);
                  setItemKey(null);
                  setFormError(null);
                }}
              >
                <SelectTrigger className={fuelSelectTriggerClass}>
                  <SelectValue placeholder="Оберіть категорію…">
                    {CATEGORIES.find((c) => c.id === category)?.label ?? null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-xl"
                >
                  {CATEGORIES.map((cat) => {
                    const count = categoryCounts[cat.id] ?? 0;
                    return (
                      <SelectItem
                        key={cat.id}
                        value={cat.id}
                        disabled={count === 0}
                        className={fuelSelectItemClass}
                      >
                        {cat.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-2">
              {fieldLabel("Товар")}
              <Popover open={itemOpen} onOpenChange={setItemOpen}>
                <PopoverTrigger
                  disabled={!category}
                  className={comboboxTriggerClass}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                    {selectedItem ? (
                      selectedItem.name
                    ) : (
                      <span className="font-normal text-zinc-400">
                        {category ? "Оберіть товар…" : "Спочатку категорію"}
                      </span>
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl"
                >
                  <Command className="rounded-2xl bg-white">
                    <CommandInput
                      placeholder="Пошук товару…"
                      className="h-11 text-sm"
                    />
                    <CommandList className="max-h-64 bg-white">
                      <CommandEmpty>Нічого не знайдено</CommandEmpty>
                      <CommandGroup>
                        {categoryItems.map((item) => {
                          const outOfStock = item.virtualBalance <= 0;
                          return (
                            <CommandItem
                              key={item.basRefKey}
                              value={`${item.name} ${item.unit}`}
                              disabled={outOfStock}
                              data-checked={
                                itemKey === item.basRefKey || undefined
                              }
                              onSelect={() => {
                                setItemKey(item.basRefKey);
                                setItemOpen(false);
                                setFormError(null);
                              }}
                              className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {item.name}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-xs tabular-nums",
                                  outOfStock
                                    ? "font-semibold text-red-500"
                                    : "text-zinc-400"
                                )}
                              >
                                {formatQtyLabel(
                                  item.virtualBalance,
                                  item.unit
                                )}
                              </span>
                              {itemKey === item.basRefKey ? (
                                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                              ) : null}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedItem ? (
                <p className="text-sm tabular-nums text-zinc-500">
                  Доступно на складі:{" "}
                  {formatQtyLabel(
                    selectedItem.virtualBalance,
                    selectedItem.unit
                  )}
                </p>
              ) : null}
              {selectedItem && selectedItem.virtualBalance <= 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Немає залишку. Спочатку зробіть{" "}
                  <span className="font-semibold">Прихід</span> на склад.
                </p>
              ) : null}
            </section>

            {!lockField ? (
              <section className="space-y-2">
                {fieldLabel(fieldRequired ? "Поле" : "Поле (опційно)")}
                <Popover open={fieldOpen} onOpenChange={setFieldOpen}>
                  <PopoverTrigger className={comboboxTriggerClass}>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                      {selectedField ? (
                        selectedField.name
                      ) : (
                        <span className="font-normal text-zinc-400">
                          Оберіть поле…
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl"
                  >
                    <Command className="rounded-2xl bg-white">
                      <CommandInput
                        placeholder="Пошук поля…"
                        className="h-11 text-sm"
                      />
                      <CommandList className="max-h-64 bg-white">
                        <CommandEmpty>Полів не знайдено</CommandEmpty>
                        <CommandGroup>
                          {fields.map((field) => (
                            <CommandItem
                              key={field.id}
                              value={`${field.name} ${field.crop}`}
                              data-checked={fieldId === field.id || undefined}
                              onSelect={() => {
                                setFieldId(field.id);
                                setFieldOpen(false);
                                setFormError(null);
                              }}
                              className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">
                                  {field.name}
                                </span>
                                <span className="mt-0.5 block text-[11px] text-zinc-400">
                                  {formatAreaHa(field.areaHa)} га ·{" "}
                                  {field.crop || "—"}
                                </span>
                              </span>
                              {fieldId === field.id ? (
                                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedField ? (
                  <p className="text-sm text-zinc-500">
                    Площа: {formatAreaHa(selectedField.areaHa)} га
                  </p>
                ) : null}
              </section>
            ) : selectedField ? (
              <section className="space-y-1">
                {fieldLabel("Поле")}
                <p className="text-[15px] font-semibold text-zinc-900">
                  {selectedField.name}
                </p>
                <p className="text-sm text-zinc-500">
                  Площа: {formatAreaHa(selectedField.areaHa)} га
                </p>
              </section>
            ) : null}

            <section className="space-y-2">
              {fieldLabel("Кількість")}
              <div className={fuelHeroAmountClass}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => {
                    setQty(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="0"
                  aria-label="Кількість"
                  className={cn(
                    "w-full border-none bg-transparent py-6 text-center text-7xl font-light tabular-nums",
                    "placeholder:text-zinc-300 focus:ring-0 focus:outline-none",
                    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                    qtyExceedsBalance ? "text-red-600" : "text-zinc-900"
                  )}
                />
              </div>
              <p className="text-center text-sm font-medium text-zinc-400">
                {selectedItem?.unit || "од."}
              </p>
              {selectedItem && selectedItem.virtualBalance > 0 ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      const n = selectedItem.virtualBalance;
                      setQty(
                        Number.isInteger(n)
                          ? String(n)
                          : String(Math.round(n * 1000) / 1000)
                      );
                      setFormError(null);
                    }}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
                  >
                    MAX (Доступно:{" "}
                    {formatQtyLabel(
                      selectedItem.virtualBalance,
                      selectedItem.unit
                    )}
                    )
                  </button>
                </div>
              ) : null}
              {qtyExceedsBalance ? (
                <p className="text-center text-sm font-medium text-red-600">
                  Перевищення доступного залишку на складі
                </p>
              ) : null}
            </section>

            <section className="space-y-2">
              {fieldLabel("Накладна")}
              <AttachmentDropzone
                entityType="inventory_move"
                pending={pendingFiles}
                onPendingChange={setPendingFiles}
                compact
              />
            </section>
          </>
        )}

        {formError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        ) : null}
      </div>

      <div className={cn(fuelSheetStickyFooterClass, "space-y-3")}>
        {isBlocked && selectedField ? (
          <FieldPassportQuickFix
            fieldId={selectedField.id}
            fieldName={selectedField.name}
            crop={selectedField.crop}
            areaHa={selectedField.areaHa}
            onSaved={(patch: { crop: string; areaHa: number }) => {
              setFields((prev) =>
                prev.map((f) =>
                  f.id === selectedField.id
                    ? { ...f, crop: patch.crop, areaHa: patch.areaHa }
                    : f
                )
              );
            }}
          />
        ) : null}
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          className={fuelPrimaryBtnClass}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Зберігаємо…
            </>
          ) : (
            <>
              <PackageMinus className="h-4 w-4" />
              {fieldRequired ? "Списати на поле" : "Списати зі складу"}
            </>
          )}
        </Button>
      </div>
    </form>
  );

  if (variant === "panel") {
    if (!open) return null;
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#fafaf9_48%,#f5f5f4_100%)]">
        {issueHeader}
        {issueForm}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("flex flex-col", fuelSheetContentClass)}
      >
        {issueHeader}
        {issueForm}
      </SheetContent>
    </Sheet>
  );
}

export function QuickIssueButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition",
        "hover:bg-zinc-800 active:scale-[0.98]",
        className
      )}
    >
      <PackageMinus className="h-4 w-4 sm:h-5 sm:w-5" />
      <span className="truncate">Списати</span>
    </button>
  );
}

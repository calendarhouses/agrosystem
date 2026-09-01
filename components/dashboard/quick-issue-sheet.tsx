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
  FuelPanelShell,
  FuelSheetHeader,
  fuelPrimaryBtnClass,
  fuelSelectTriggerClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import {
  OperationsSheetHeader,
  opsFieldLabelClass,
  opsPrimaryBtnClass,
  opsSelectTriggerClass,
  opsSheetBodyClass,
  opsSheetFooterClass,
} from "@/components/dashboard/operations-sheet-chrome";
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
  itemRefKey: string;
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
  theme?: "light" | "dark";
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
  theme = "light",
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
  const [itemSearch, setItemSearch] = useState("");
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
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
  const isDark = theme === "dark";

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

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return categoryItems;
    return categoryItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q)
    );
  }, [categoryItems, itemSearch]);

  const filteredFields = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (field) =>
        field.name.toLowerCase().includes(q) ||
        (field.crop ?? "").toLowerCase().includes(q)
    );
  }, [fields, fieldSearch]);

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
        itemRefKey: itemKey,
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

  const issueHeader =
    variant === "panel" ? (
      isDark ? (
        <OperationsSheetHeader
          icon={PackageMinus}
          accent="emerald"
          title="Списати ТМЦ"
          description={
            selectedField ? (
              <>
                {selectedField.name}
                {selectedField.crop ? ` · ${selectedField.crop}` : ""}
                {selectedField.areaHa > 0
                  ? ` · ${formatAreaHa(selectedField.areaHa)} га`
                  : ""}
              </>
            ) : (
              "Списання зі складу на поле"
            )
          }
          onBack={() => {
            onBack?.();
            onOpenChange(false);
          }}
        />
      ) : (
      <div className="shrink-0 bg-[#F4F1EA] px-4 pb-3 pt-1 text-left md:px-5">
        <button
          type="button"
          onClick={() => {
            onBack?.();
            onOpenChange(false);
          }}
          className="mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <ChevronLeft className="h-4 w-4" />
          Назад до поля
        </button>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#276749] text-white shadow-md shadow-[#276749]/25">
            <PackageMinus className="h-5 w-5" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-[1.35rem] font-extrabold tracking-tight text-zinc-900">
              Списати ТМЦ
            </h2>
            {selectedField ? (
              <p className="mt-0.5 truncate text-sm font-medium text-zinc-500">
                {selectedField.name}
                {selectedField.crop ? ` · ${selectedField.crop}` : ""}
                {selectedField.areaHa > 0
                  ? ` · ${formatAreaHa(selectedField.areaHa)} га`
                  : ""}
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-medium text-zinc-500">
                Списання зі складу на поле
              </p>
            )}
          </div>
        </div>
      </div>
      )
    ) : (
      <FuelSheetHeader
        icon={PackageMinus}
        title="Списання зі складу"
        accent="emerald"
      />
    );

  const issueForm = (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          isDark
            ? opsSheetBodyClass
            : "min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4 pb-[max(2.5rem,calc(1.25rem+var(--safe-bottom)))] md:px-5"
        )}
        data-vaul-no-drag=""
        data-allow-pan="true"
      >        {loading ? (
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
            <section className="space-y-2.5">
              <div>
                <p className={cn(isDark ? opsFieldLabelClass : "text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase")}>
                  Категорія
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Оберіть тип матеріалу
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {CATEGORIES.map((cat) => {
                  const count = categoryCounts[cat.id] ?? 0;
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  const disabled = count === 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setCategory(cat.id);
                        setItemKey(null);
                        setFormError(null);
                      }}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition-all",
                        active
                          ? "bg-[#276749] text-white shadow-[0_12px_28px_-14px_rgba(39,103,73,0.65)]"
                          : isDark
                            ? "bg-white/[0.05] text-zinc-100 ring-1 ring-white/10 hover:ring-emerald-500/30"
                            : "bg-white text-zinc-800 shadow-sm ring-1 ring-[#E5DFD3]/90 hover:ring-[#276749]/30",
                        disabled && "cursor-not-allowed opacity-40"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          active
                            ? "bg-white/15"
                            : isDark
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-[#276749]/10 text-[#276749]"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold leading-tight">
                          {cat.label}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-[11px] font-medium tabular-nums",
                            active ? "text-white/70" : "text-zinc-400"
                          )}
                        >
                          {count} поз.
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2.5">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                  Товар
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Позиція зі складського залишку
                </p>
              </div>
              <Popover
                open={itemOpen}
                onOpenChange={(open) => {
                  setItemOpen(open);
                  if (!open) setItemSearch("");
                }}
              >
                <PopoverTrigger
                  disabled={!category}
                  className={cn(
                    isDark ? opsSelectTriggerClass : comboboxTriggerClass,
                    "h-14 rounded-2xl",
                    isDark
                      ? ""
                      : "border-transparent bg-white shadow-sm ring-1 ring-[#E5DFD3]/90"
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-sm font-semibold",
                      isDark ? "text-zinc-50" : "text-zinc-900"
                    )}
                  >
                    {selectedItem ? (
                      selectedItem.name
                    ) : (
                      <span className="font-medium text-zinc-400">
                        {category ? "Оберіть товар…" : "Спочатку категорію"}
                      </span>
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                </PopoverTrigger>
                <PopoverContent sheetOnMobile={false}
                  align="start"
                  sideOffset={6}
                  className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl"
                >
                  <Command className="rounded-2xl bg-white" shouldFilter={false}>
                    <CommandInput
                      placeholder="Пошук товару…"
                      value={itemSearch}
                      onValueChange={setItemSearch}
                      className="h-11 text-sm"
                    />
                    <CommandList className="max-h-64 bg-white">
                      <CommandEmpty>Нічого не знайдено</CommandEmpty>
                      <CommandGroup>
                        {filteredItems.map((item) => {
                          const outOfStock = item.virtualBalance <= 0;
                          return (
                            <CommandItem
                              key={item.basRefKey}
                              value={item.basRefKey}
                              disabled={outOfStock}
                              data-checked={
                                itemKey === item.basRefKey || undefined
                              }
                              onSelect={() => {
                                setItemKey(item.basRefKey);
                                setItemOpen(false);
                                setItemSearch("");
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
                <div
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3.5 py-2.5",
                    isDark
                      ? "bg-white/[0.05] ring-1 ring-white/10"
                      : "bg-white shadow-sm ring-1 ring-[#E5DFD3]/80"
                  )}
                >
                  <span className="text-xs font-medium text-zinc-500">
                    Доступно на складі
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      isDark ? "text-zinc-50" : "text-zinc-900"
                    )}
                  >
                    {formatQtyLabel(
                      selectedItem.virtualBalance,
                      selectedItem.unit
                    )}
                  </span>
                </div>
              ) : null}
              {selectedItem && selectedItem.virtualBalance <= 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Немає залишку. Спочатку зробіть{" "}
                  <span className="font-semibold">Прихід</span> на склад.
                </p>
              ) : null}
            </section>

            {!lockField ? (
              <section className="space-y-2.5">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                    {fieldRequired ? "Поле" : "Поле (опційно)"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Куди віднести списання
                  </p>
                </div>
                <Popover
                  open={fieldOpen}
                  onOpenChange={(open) => {
                    setFieldOpen(open);
                    if (!open) setFieldSearch("");
                  }}
                >
                  <PopoverTrigger
                    className={cn(
                      comboboxTriggerClass,
                      "h-14 rounded-2xl border-transparent bg-white shadow-sm ring-1 ring-[#E5DFD3]/90"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-zinc-900">
                      {selectedField ? (
                        selectedField.name
                      ) : (
                        <span className="font-medium text-zinc-400">
                          Оберіть поле…
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                  </PopoverTrigger>
                  <PopoverContent sheetOnMobile={false}
                    align="start"
                    sideOffset={6}
                    className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl"
                  >
                    <Command className="rounded-2xl bg-white" shouldFilter={false}>
                      <CommandInput
                        placeholder="Пошук поля…"
                        value={fieldSearch}
                        onValueChange={setFieldSearch}
                        className="h-11 text-sm"
                      />
                      <CommandList className="max-h-64 bg-white">
                        <CommandEmpty>Полів не знайдено</CommandEmpty>
                        <CommandGroup>
                          {filteredFields.map((field) => (
                            <CommandItem
                              key={field.id}
                              value={field.id}
                              data-checked={fieldId === field.id || undefined}
                              onSelect={() => {
                                setFieldId(field.id);
                                setFieldOpen(false);
                                setFieldSearch("");
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
              </section>
            ) : selectedField ? (
              <section
                className={cn(
                  "rounded-2xl px-4 py-3.5",
                  isDark
                    ? "bg-white/[0.05] ring-1 ring-white/10"
                    : "bg-white shadow-sm ring-1 ring-[#E5DFD3]/90"
                )}
              >
                <p className={opsFieldLabelClass}>Поле</p>
                <p
                  className={cn(
                    "mt-1 text-base font-bold",
                    isDark ? "text-zinc-50" : "text-zinc-900"
                  )}
                >
                  {selectedField.name}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {formatAreaHa(selectedField.areaHa)} га
                  {selectedField.crop ? ` · ${selectedField.crop}` : ""}
                </p>
              </section>
            ) : null}

            <section className="space-y-2.5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                    Кількість
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {selectedItem?.unit
                      ? `Одиниця: ${selectedItem.unit}`
                      : "Скільки списати"}
                  </p>
                </div>
                {selectedItem && selectedItem.virtualBalance > 0 ? (
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
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[11px] font-bold tracking-wide shadow-sm ring-1",
                      isDark
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"
                        : "bg-white text-[#276749] ring-[#276749]/20"
                    )}
                  >
                    MAX
                  </button>
                ) : null}
              </div>
              <div
                className={cn(
                  "rounded-[1.5rem] px-4 py-5",
                  isDark
                    ? "bg-white/[0.05] ring-1 ring-white/10"
                    : "bg-white shadow-sm ring-1 ring-[#E5DFD3]/90"
                )}
              >
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
                    "w-full border-none bg-transparent text-center text-5xl font-semibold tabular-nums tracking-tight",
                    "placeholder:text-zinc-500 focus:ring-0 focus:outline-none",
                    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                    qtyExceedsBalance
                      ? "text-red-500"
                      : isDark
                        ? "text-zinc-50"
                        : "text-zinc-900"
                  )}
                />
                <p className="mt-1 text-center text-sm font-semibold text-zinc-400">
                  {selectedItem?.unit || "од."}
                </p>
              </div>
              {qtyExceedsBalance ? (
                <p className="text-center text-sm font-medium text-red-600">
                  Перевищення доступного залишку на складі
                </p>
              ) : null}
            </section>

            <section className="space-y-2.5 pb-2">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
                  Накладна
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Фото або файл (за бажанням)
                </p>
              </div>
              <div
                className={cn(
                  "rounded-2xl p-3",
                  isDark
                    ? "bg-white/[0.04] ring-1 ring-white/10"
                    : "bg-white shadow-sm ring-1 ring-[#E5DFD3]/90"
                )}
              >
                <AttachmentDropzone
                  entityType="inventory_move"
                  pending={pendingFiles}
                  onPendingChange={setPendingFiles}
                  compact
                />
              </div>
            </section>
          </>
        )}

        {formError ? (
          <p
            className={cn(
              "rounded-xl px-3 py-2 text-sm",
              isDark
                ? "border border-red-500/30 bg-red-500/10 text-red-200"
                : "border border-red-200 bg-red-50 text-red-700"
            )}
          >
            {formError}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "shrink-0 space-y-3 px-4 pt-3 pb-4 md:px-5",
          isDark
            ? opsSheetFooterClass
            : "border-t border-[#E5DFD3]/80 bg-[#F4F1EA]"
        )}
      >
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
          className={cn(
            isDark
              ? opsPrimaryBtnClass
              : cn(
                  fuelPrimaryBtnClass,
                  "rounded-2xl bg-gradient-to-br from-[#1a3d2c] via-[#276749] to-[#3a8f5e] text-[15px] shadow-[0_16px_36px_-12px_rgba(39,103,73,0.65)] hover:from-[#1a3d2c] hover:via-[#1f5239] hover:to-[#276749]"
                )
          )}
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
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          isDark ? "bg-zinc-950 text-zinc-50" : "bg-[#F4F1EA]"
        )}
      >
        {issueHeader}
        {issueForm}
      </div>
    );
  }

  return (
    <FuelPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={fieldRequired ? "Списати на поле" : "Списати зі складу"}
    >
        {issueHeader}
        {issueForm}
    </FuelPanelShell>
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

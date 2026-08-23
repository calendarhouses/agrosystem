"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bug,
  Check,
  ChevronDown,
  Leaf,
  Loader2,
  MapPin,
  PackageMinus,
  Search,
  Sprout,
} from "lucide-react";

import {
  createLocalOutboundMove,
  getQuickIssueOptions,
  syncInventoryNomenclatureAction,
  type QuickIssueFieldOption,
  type QuickIssueItemOption,
} from "@/app/admin/inventory/actions";
import { FieldPassportQuickFix } from "@/components/dashboard/field-passport-quick-fix";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isFieldPassportComplete } from "@/lib/field-passport";
import { formatUahCurrency } from "@/lib/fuel-price";
import { suppressLocalInventoryMovesRealtimeToast } from "@/lib/realtime-toast-guard";
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

function formatQtyLabel(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

function formatAvailableLabel(balance: number, unit: string): string {
  return `Доступно: ${formatQtyLabel(Math.max(0, balance), unit)}`;
}

function formatPlannedPriceLabel(
  price: number | null,
  unit: string
): string | null {
  if (price == null || price <= 0) return null;
  const unitSuffix = unit.trim() || "од.";
  return `${formatUahCurrency(price)}/${unitSuffix}`;
}

type Cat = QuickIssueItemOption["category"];

const CATEGORIES: {
  id: Cat;
  label: string;
  hint: string;
  icon: typeof Bug;
  accent: string;
}[] = [
  {
    id: "zzr",
    label: "ЗЗР",
    hint: "Захист рослин",
    icon: Bug,
    accent: "#276749",
  },
  {
    id: "fertilizer",
    label: "Добрива",
    hint: "Живлення",
    icon: Leaf,
    accent: "#C05621",
  },
  {
    id: "seed",
    label: "Насіння",
    hint: "Посівний матеріал",
    icon: Sprout,
    accent: "#B7791F",
  },
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
  /** Якщо задано — після завантаження одразу обрати цю позицію */
  presetItemRefKey?: string | null;
  /** Якщо задано — одразу обрати поле для списання */
  presetFieldId?: string | null;
  onSuccess?: (payload: QuickIssueSuccessPayload) => void;
};

export function QuickIssueSheet({
  open,
  onOpenChange,
  presetItemRefKey = null,
  presetFieldId = null,
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
  const [itemQuery, setItemQuery] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
  /** Немає площі або культури у паспорті обраного поля */
  const isBlocked = Boolean(selectedField) && !fieldPassportOk;

  const qtyNum = Number(String(qty).replace(",", "."));
  const qtyExceedsBalance =
    selectedItem != null &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    qtyNum > selectedItem.virtualBalance;
  const qtyOverBy =
    selectedItem && qtyExceedsBalance
      ? Math.round((qtyNum - selectedItem.virtualBalance) * 100) / 100
      : null;

  const isSubmitDisabled =
    isBlocked ||
    pending ||
    loading ||
    Boolean(loadError) ||
    qtyExceedsBalance ||
    (selectedItem != null && selectedItem.virtualBalance <= 0);

  const categoryCounts = useMemo(() => {
    const counts: Record<Cat, number> = { zzr: 0, fertilizer: 0, seed: 0 };
    for (const item of items) counts[item.category] += 1;
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!category) return [];
    const q = itemQuery.trim().toLowerCase();
    return items
      .filter((i) => i.category === category)
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .slice(0, 80);
  }, [items, category, itemQuery]);

  const filteredFields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return fields
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          f.crop.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [fields, fieldQuery]);

  useEffect(() => {
    if (!open) {
      setItemPickerOpen(false);
      setFieldPickerOpen(false);
      return;
    }
    if (category && !itemKey) setItemPickerOpen(true);
  }, [open, category, itemKey]);

  useEffect(() => {
    if (!open) return;
    if (itemKey && !fieldId) setFieldPickerOpen(true);
  }, [open, itemKey, fieldId]);

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
              "Довідник ТМЦ порожній. Не вдалося синхронізувати з BAS."
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
          "Довідник ТМЦ порожній. Перевір міграцію 014 і доступ до BAS."
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
          setItemPickerOpen(false);
        }
      }

      const fieldPreset = presetFieldId?.trim();
      if (fieldPreset) {
        const foundField = res.fields.find((f) => f.id === fieldPreset);
        if (foundField) {
          setFieldId(foundField.id);
          setFieldPickerOpen(false);
        }
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
    setItemQuery("");
    setFieldQuery("");
    setItemPickerOpen(false);
    setFieldPickerOpen(false);
    setFormError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!category) {
      setFormError("Оберіть категорію");
      return;
    }
    if (!itemKey) {
      setFormError("Оберіть позицію");
      return;
    }
    if (!fieldId) {
      setFormError("Оберіть поле");
      return;
    }
    if (!isFieldPassportComplete(selectedField)) {
      setFormError(
        "У цього поля не заповнений паспорт (площа або культура)."
      );
      return;
    }
    const qtyNum = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setFormError("Вкажіть кількість більше нуля");
      return;
    }
    if (
      selectedItem &&
      qtyNum > selectedItem.virtualBalance
    ) {
      setFormError(
        `Недостатньо на складі. Доступно: ${formatQtyLabel(
          selectedItem.virtualBalance,
          selectedItem.unit
        )}`
      );
      return;
    }

    startTransition(async () => {
      suppressLocalInventoryMovesRealtimeToast();
      const res = await createLocalOutboundMove({
        itemRefKey: itemKey,
        fieldId,
        qty: qtyNum,
        season: activeSeason,
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      const unit = selectedItem?.unit ? ` ${selectedItem.unit}` : "";
      toast.success(
        `Списано ${qtyNum}${unit} → ${selectedField?.name ?? "поле"}`
      );
      onSuccess?.({
        moveId: res.id,
        fieldId,
        fieldName: selectedField?.name ?? "поле",
        itemTitle: selectedItem?.name ?? "ТМЦ",
        category: selectedItem?.category ?? "zzr",
        qty: qtyNum,
        unit: selectedItem?.unit ?? "",
      });
      resetForm();
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-sm sm:max-w-md",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-zinc-100"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-zinc-100 px-6 py-5 pr-12 text-left">
          <SheetTitle className="text-2xl font-bold tracking-tight text-zinc-900">
            Списання на поле
          </SheetTitle>
          <SheetDescription className="text-sm text-zinc-500">
            Тіньовий склад · збережеться локально, без 1С
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* Hero summary */}
            <div className="relative overflow-hidden rounded-2xl bg-zinc-900 p-5 text-white">
              <PackageMinus
                className="pointer-events-none absolute -right-3 -bottom-3 h-24 w-24 text-white/5"
                strokeWidth={1}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-transparent to-amber-500/10" />
              <div className="relative space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                  Операція
                </p>
                <p className="text-lg font-bold tracking-tight">
                  {selectedItem?.name ?? "Оберіть ТМЦ"}
                </p>
                <p className="text-sm text-zinc-300">
                  {selectedField
                    ? `→ ${selectedField.name}`
                    : "Куди: поле не обрано"}
                  {qty.trim()
                    ? ` · ${qty}${selectedItem?.unit ? ` ${selectedItem.unit}` : ""}`
                    : ""}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
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
                {/* Category tiles */}
                <section className="space-y-2.5">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    1. Категорія
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {CATEGORIES.map((cat) => {
                      const Icon = cat.icon;
                      const active = category === cat.id;
                      const count = categoryCounts[cat.id];
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          disabled={count === 0}
                          onClick={() => {
                            setCategory(cat.id);
                            setItemKey(null);
                            setItemQuery("");
                            setItemPickerOpen(true);
                            setFieldPickerOpen(false);
                          }}
                          className={cn(
                            "relative flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition",
                            active
                              ? "border-zinc-900 bg-zinc-900 text-white shadow-md"
                              : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300 hover:bg-white",
                            count === 0 && "opacity-40"
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-xl",
                              active ? "bg-white/10" : "bg-white"
                            )}
                            style={
                              active
                                ? undefined
                                : {
                                    color: cat.accent,
                                    backgroundColor: `${cat.accent}14`,
                                  }
                            }
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-bold leading-tight">
                              {cat.label}
                            </span>
                            <span
                              className={cn(
                                "mt-0.5 block text-[10px]",
                                active ? "text-zinc-400" : "text-zinc-400"
                              )}
                            >
                              {count} поз.
                            </span>
                          </span>
                          {active ? (
                            <Check className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-emerald-400" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Items */}
                <section className="space-y-2.5">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    2. Що списуємо
                  </p>
                  {!category ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-400">
                      Спочатку оберіть категорію вище
                    </div>
                  ) : selectedItem && !itemPickerOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setItemPickerOpen(true);
                        setItemQuery("");
                      }}
                      className="flex w-full items-start gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-zinc-300"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-zinc-900">
                              {selectedItem.name}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-zinc-400">
                              {selectedItem.categoryLabel}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-800">
                            {formatAvailableLabel(
                              selectedItem.virtualBalance,
                              selectedItem.unit
                            )}
                          </span>
                        </span>
                        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#276749]">
                          Змінити
                          <ChevronDown className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </button>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <Input
                          value={itemQuery}
                          onChange={(e) => setItemQuery(e.target.value)}
                          onFocus={() => setItemPickerOpen(true)}
                          placeholder={`Пошук у «${CATEGORIES.find((c) => c.id === category)?.label}»…`}
                          className="h-11 rounded-xl border-zinc-200 bg-zinc-50 pl-10 text-sm"
                        />
                      </div>
                      {itemPickerOpen ? (
                      <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-2xl border border-zinc-100 bg-zinc-50/80 p-1.5">
                        {filteredItems.length === 0 ? (
                          <p className="px-3 py-8 text-center text-sm text-zinc-400">
                            Нічого не знайдено
                          </p>
                        ) : (
                          filteredItems.map((item) => {
                            const active = itemKey === item.basRefKey;
                            const outOfStock = item.virtualBalance <= 0;
                            const priceLabel = formatPlannedPriceLabel(
                              item.plannedPriceUah,
                              item.unit
                            );
                            return (
                              <button
                                key={item.basRefKey}
                                type="button"
                                disabled={outOfStock}
                                onClick={() => {
                                  setItemKey(item.basRefKey);
                                  setItemPickerOpen(false);
                                  setItemQuery("");
                                  setFormError(null);
                                }}
                                className={cn(
                                  "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition",
                                  outOfStock && "cursor-not-allowed opacity-50",
                                  active
                                    ? "bg-white shadow-sm ring-1 ring-zinc-900/10"
                                    : !outOfStock && "hover:bg-white/80"
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                    active
                                      ? "bg-zinc-900 text-white"
                                      : "bg-white text-zinc-500"
                                  )}
                                >
                                  {active ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <PackageMinus className="h-3.5 w-3.5" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-start justify-between gap-3">
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-bold text-zinc-900">
                                        {item.name}
                                      </span>
                                      <span className="mt-0.5 block text-[11px] text-zinc-400">
                                        {item.categoryLabel}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right">
                                      <span
                                        className={cn(
                                          "block text-[11px] font-semibold tabular-nums",
                                          outOfStock
                                            ? "text-red-600"
                                            : "text-zinc-800"
                                        )}
                                      >
                                        {formatAvailableLabel(
                                          item.virtualBalance,
                                          item.unit
                                        )}
                                      </span>
                                      {priceLabel ? (
                                        <span className="mt-0.5 block text-[10px] tabular-nums text-zinc-400">
                                          {priceLabel}
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                  {outOfStock ? (
                                    <span className="mt-2 inline-flex rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                      Немає на складі
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                      ) : null}
                    </>
                  )}
                </section>

                {/* Fields */}
                <section className="space-y-2.5">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    3. Куди (поле)
                  </p>
                  {selectedField && !fieldPickerOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFieldPickerOpen(true);
                        setFieldQuery("");
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-zinc-300"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#276749] text-white">
                        <MapPin className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-900">
                          {selectedField.name}
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          {selectedField.crop || "—"}
                          {selectedField.areaHa
                            ? ` · ${selectedField.areaHa} га`
                            : ""}
                        </span>
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#276749]">
                          Змінити
                          <ChevronDown className="h-3.5 w-3.5" />
                        </span>
                      </span>
                      <Check className="h-4 w-4 shrink-0 text-[#276749]" />
                    </button>
                  ) : (
                    <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={fieldQuery}
                      onChange={(e) => setFieldQuery(e.target.value)}
                      onFocus={() => setFieldPickerOpen(true)}
                      placeholder="Пошук поля…"
                      className="h-11 rounded-xl border-zinc-200 bg-zinc-50 pl-10 text-sm"
                    />
                  </div>
                  {fieldPickerOpen ? (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-2xl border border-zinc-100 bg-zinc-50/80 p-1.5">
                    {filteredFields.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-zinc-400">
                        Полів не знайдено
                      </p>
                    ) : (
                      filteredFields.map((field) => {
                        const active = fieldId === field.id;
                        return (
                          <button
                            key={field.id}
                            type="button"
                            onClick={() => {
                              setFieldId(field.id);
                              setFieldPickerOpen(false);
                              setFieldQuery("");
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                              active
                                ? "bg-white shadow-sm ring-1 ring-zinc-900/10"
                                : "hover:bg-white/80"
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                active
                                  ? "bg-[#276749] text-white"
                                  : "bg-white text-[#276749]"
                              )}
                            >
                              <MapPin className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-zinc-900">
                                {field.name}
                              </span>
                              <span className="text-[11px] text-zinc-400">
                                {field.crop || "—"}
                                {field.areaHa ? ` · ${field.areaHa} га` : ""}
                              </span>
                            </span>
                            {active ? (
                              <Check className="h-4 w-4 shrink-0 text-[#276749]" />
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                  ) : null}
                    </>
                  )}
                </section>

                {/* Qty */}
                <section className="space-y-2.5">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    4. Скільки
                  </p>
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-2xl border bg-zinc-50 p-5",
                      qtyExceedsBalance
                        ? "border-red-200 ring-1 ring-red-100"
                        : "border-zinc-200"
                    )}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => {
                        setQty(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="0"
                      className={cn(
                        "h-16 w-full bg-transparent text-center text-5xl font-bold tracking-tight tabular-nums outline-none placeholder:text-zinc-300",
                        qtyExceedsBalance ? "text-red-600" : "text-zinc-900"
                      )}
                    />
                    <p className="mt-1 text-center text-sm font-medium text-zinc-400">
                      {selectedItem?.unit || "од. виміру"}
                    </p>
                    {selectedItem ? (
                      <p
                        className={cn(
                          "mt-2 text-center text-xs tabular-nums",
                          qtyExceedsBalance
                            ? "font-semibold text-red-600"
                            : "text-zinc-500"
                        )}
                      >
                        {qtyExceedsBalance
                          ? `Перевищує залишок на ${formatQtyLabel(
                              qtyOverBy ?? 0,
                              selectedItem.unit
                            )} · макс. ${formatQtyLabel(
                              selectedItem.virtualBalance,
                              selectedItem.unit
                            )}`
                          : `Максимум: ${formatAvailableLabel(
                              selectedItem.virtualBalance,
                              selectedItem.unit
                            )}`}
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            )}

            {formError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 space-y-3 border-t border-zinc-100 bg-white px-6 py-4">
            {isBlocked && selectedField ? (
              <FieldPassportQuickFix
                fieldId={selectedField.id}
                fieldName={selectedField.name}
                crop={selectedField.crop}
                areaHa={selectedField.areaHa}
                onSaved={(patch) => {
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
                "h-12 w-full rounded-xl text-base font-semibold text-white",
                "bg-[#276749] hover:bg-[#1f5339]",
                "disabled:cursor-not-allowed disabled:bg-gray-400 disabled:text-gray-200",
                "disabled:opacity-50 disabled:hover:bg-gray-400 disabled:hover:text-gray-200"
              )}
            >
              {pending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Зберігаємо…
                </>
              ) : (
                <>
                  <PackageMinus className="h-5 w-5" />
                  Списати на поле
                </>
              )}
            </Button>
          </div>
        </form>
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#276749] px-4 text-sm font-semibold text-white shadow-sm transition",
        "hover:bg-[#1f5339] active:scale-[0.98]",
        className
      )}
    >
      <PackageMinus className="h-4 w-4 sm:h-5 sm:w-5" />
      <span className="truncate">Швидке списання на поле</span>
    </button>
  );
}

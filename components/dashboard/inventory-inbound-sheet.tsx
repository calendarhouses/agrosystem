"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FlaskConical,
  Leaf,
  Loader2,
  PackagePlus,
  Plus,
  Sprout,
  Wheat,
  Wrench,
} from "lucide-react";

import {
  createLocalInboundMove,
  createLocalInventoryItem,
  getQuickIssueOptions,
  listSupplierSuggestions,
  type QuickIssueFieldOption,
  type QuickIssueItemOption,
} from "@/app/admin/inventory/actions";
import {
  AttachmentDropzone,
  flushPendingAttachments,
  type PendingAttachment,
} from "@/components/dashboard/attachment-dropzone";
import {
  FuelPanelShell,
  FuelSheetHeader,
  fuelFieldLabelClass,
  fuelHeroAmountClass,
  fuelInputClass,
  fuelPrimaryBtnClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
  fuelSheetStickyFooterClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { useSeasonStore } from "@/lib/season-store";
import { cn } from "@/lib/utils";

type Cat = QuickIssueItemOption["category"];

const CATEGORIES: {
  id: Cat;
  label: string;
  icon: typeof FlaskConical;
  accent: string;
}[] = [
  { id: "zzr", label: "ЗЗР", icon: FlaskConical, accent: "#276749" },
  { id: "fertilizer", label: "Добрива", icon: Sprout, accent: "#C05621" },
  { id: "seed", label: "Насіння", icon: Leaf, accent: "#2F855A" },
  { id: "parts", label: "Запчастини", icon: Wrench, accent: "#4A5568" },
  { id: "harvest", label: "Врожай", icon: Wheat, accent: "#B7791F" },
];

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

function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function parseYmd(ymd: string): Date | undefined {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function InventoryInboundSheet({
  open,
  onOpenChange,
  presetCategory = null,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetCategory?: Cat | null;
  onSuccess?: (meta: {
    category: Cat;
    itemRefKey: string;
    flowFilter: "purchase" | "harvest";
  }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<QuickIssueItemOption[]>([]);
  const [fields, setFields] = useState<QuickIssueFieldOption[]>([]);
  const [category, setCategory] = useState<Cat | null>(null);
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [note, setNote] = useState("");
  const [inboundDate, setInboundDate] = useState(todayYmd);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("л");
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
  const categoryItems = useMemo(() => {
    if (!category) return [];
    return items.filter((i) => i.category === category);
  }, [items, category]);

  const filteredCategoryItems = useMemo(() => {
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
        field.crop.toLowerCase().includes(q)
    );
  }, [fields, fieldSearch]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<Cat, number>> = {};
    for (const item of items) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const filteredSuppliers = useMemo(() => {
    const q = supplier.trim().toLowerCase();
    return suppliers
      .filter((n) => !q || n.toLowerCase().includes(q))
      .slice(0, 40);
  }, [suppliers, supplier]);

  const qtyNum = Number(String(qty).replace(",", "."));
  const priceNum = Number(String(unitPrice).replace(",", "."));
  const partyTotal =
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    Number.isFinite(priceNum) &&
    priceNum >= 0
      ? Math.round(qtyNum * priceNum * 100) / 100
      : null;
  const isSubmitDisabled =
    pending ||
    loading ||
    Boolean(loadError) ||
    !category ||
    !itemKey ||
    !Number.isFinite(qtyNum) ||
    qtyNum <= 0 ||
    !Number.isFinite(priceNum) ||
    priceNum < 0 ||
    !unitPrice.trim() ||
    (category === "harvest" && !fieldId);

  useEffect(() => {
    if (!selectedItem) return;
    if (unitPrice.trim()) return;
    if (
      selectedItem.plannedPriceUah != null &&
      selectedItem.plannedPriceUah > 0
    ) {
      setUnitPrice(String(selectedItem.plannedPriceUah));
    }
  }, [selectedItem, unitPrice]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setFormError(null);
      const [res, supplierRes] = await Promise.all([
        getQuickIssueOptions(),
        listSupplierSuggestions(),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        setItems([]);
        setFields([]);
        return;
      }
      setItems(res.items);
      setFields(res.fields);
      if (supplierRes.ok) setSuppliers(supplierRes.names);
      if (presetCategory) {
        setCategory(presetCategory);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, presetCategory]);

  function resetForm() {
    setCategory(presetCategory);
    setItemKey(null);
    setFieldId(null);
    setQty("");
    setUnitPrice("");
    setSupplier("");
    setNote("");
    setInboundDate(todayYmd());
    setPendingFiles([]);
    setCreatingItem(false);
    setNewName("");
    setNewUnit("л");
    setFormError(null);
  }

  function handleCreateItem() {
    if (!category) {
      setFormError("Спочатку оберіть категорію");
      return;
    }
    if (!newName.trim()) {
      setFormError("Вкажіть назву нової позиції");
      return;
    }
    const priceFromForm = Number(String(unitPrice).replace(",", "."));
    startTransition(async () => {
      const res = await createLocalInventoryItem({
        name: newName.trim(),
        category,
        unit: newUnit.trim() || (category === "harvest" ? "т" : "шт"),
        plannedPriceUah:
          Number.isFinite(priceFromForm) && priceFromForm >= 0
            ? priceFromForm
            : 0,
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      const opts = await getQuickIssueOptions();
      if (opts.ok) setItems(opts.items);
      setItemKey(res.basRefKey);
      setCreatingItem(false);
      setNewName("");
      toast.success("Позицію додано");
    });
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
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setFormError("Вкажіть кількість більше нуля");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0 || !unitPrice.trim()) {
      setFormError("Вкажіть ціну за одиницю (₴)");
      return;
    }
    if (category === "harvest" && !fieldId) {
      setFormError("Оберіть поле, з якого зібрано врожай");
      return;
    }
    startTransition(async () => {
      const { suppressLocalInventoryMovesRealtimeToast } = await import(
        "@/lib/realtime-toast-guard"
      );
      suppressLocalInventoryMovesRealtimeToast();
      const cat = category;
      const res = await createLocalInboundMove({
        itemRefKey: itemKey,
        qty: qtyNum,
        unitPriceUah: priceNum,
        buyerName: cat === "harvest" ? null : supplier.trim() || null,
        fieldId: cat === "harvest" ? fieldId : null,
        note: note.trim() || null,
        season: activeSeason,
        date: inboundDate,
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
      toast.success(
        cat === "harvest"
          ? `Врожай ${qtyNum}${selectedItem?.unit ? ` ${selectedItem.unit}` : ""} на склад`
          : `Прихід ${qtyNum}${selectedItem?.unit ? ` ${selectedItem.unit}` : ""} · ${partyTotal?.toLocaleString("uk-UA")} ₴`
      );
      resetForm();
      onSuccess?.({
        category: cat,
        itemRefKey: itemKey,
        flowFilter: cat === "harvest" ? "harvest" : "purchase",
      });
      onOpenChange(false);
    });
  }

  const isHarvest = category === "harvest";

  return (
    <FuelPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={isHarvest ? "Прийом врожаю" : "Прихід на склад"}
    >
        <FuelSheetHeader
          icon={isHarvest ? Wheat : PackagePlus}
          title={isHarvest ? "Прийом врожаю" : "Прихід на склад"}
          description={
            isHarvest
              ? "З поля на склад"
              : "Закупівля / надходження на склад"
          }
          accent={isHarvest ? "amber" : "sky"}
        />

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(fuelSheetBodyClass, "space-y-5")}
            data-vaul-no-drag=""
            data-allow-pan="true"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Завантаження…
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
                    <p className={fuelFieldLabelClass}>Дата приходу</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Можна вказати заднім числом
                    </p>
                  </div>
                  <DatePicker
                    date={parseYmd(inboundDate)}
                    onChange={(next) => {
                      if (next) setInboundDate(toYmd(next));
                    }}
                  />
                </section>

                <section className="space-y-2.5">
                  <div>
                    <p className={fuelFieldLabelClass}>Категорія</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Оберіть тип матеріалу
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {CATEGORIES.map((cat) => {
                      const count = categoryCounts[cat.id] ?? 0;
                      const Icon = cat.icon;
                      const active = category === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setCategory(cat.id);
                            setItemKey(null);
                            setSupplier("");
                            setFormError(null);
                            if (cat.id === "harvest") {
                              setNewUnit((u) => (u === "л" || !u ? "т" : u));
                            }
                          }}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition-all",
                            active
                              ? "bg-[#276749] text-white shadow-[0_12px_28px_-14px_rgba(39,103,73,0.65)]"
                              : "bg-white text-zinc-800 shadow-sm ring-1 ring-[#E5DFD3]/90 hover:ring-[#276749]/30",
                            cat.id === "harvest" && "col-span-2"
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                              active
                                ? "bg-white/15"
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

                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className={fuelFieldLabelClass}>Товар</p>
                    <button
                      type="button"
                      disabled={!category}
                      onClick={() => setCreatingItem((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Нова позиція
                    </button>
                  </div>

                  {creatingItem ? (
                    <div className="space-y-2 rounded-2xl border border-sky-200/80 bg-sky-50/50 p-3">
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={
                          isHarvest
                            ? "Культура / сорт (напр. Кукурудза)"
                            : "Назва товару"
                        }
                        className={fuelInputClass}
                      />
                      <div className="flex gap-2">
                        <input
                          value={newUnit}
                          onChange={(e) => setNewUnit(e.target.value)}
                          placeholder={isHarvest ? "Од. (т, кг)" : "Од. (л, кг, шт)"}
                          className={cn(fuelInputClass, "flex-1")}
                        />
                        <Button
                          type="button"
                          disabled={pending}
                          onClick={handleCreateItem}
                          className="h-12 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700"
                        >
                          Додати
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Popover
                      open={itemOpen}
                      onOpenChange={(open) => {
                        setItemOpen(open);
                        if (!open) setItemSearch("");
                      }}
                    >
                      <PopoverTrigger
                        disabled={!category}
                        className={comboboxTriggerClass}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                          {selectedItem ? (
                            selectedItem.name
                          ) : (
                            <span className="font-normal text-zinc-400">
                              {category
                                ? "Оберіть товар…"
                                : "Спочатку категорію"}
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
                              {filteredCategoryItems.map((item) => (
                                <CommandItem
                                  key={item.basRefKey}
                                  value={`${item.name} ${item.unit}`}
                                  data-checked={
                                    itemKey === item.basRefKey || undefined
                                  }
                                  onSelect={() => {
                                    setItemKey(item.basRefKey);
                                    setUnitPrice(
                                      item.plannedPriceUah != null &&
                                        item.plannedPriceUah > 0
                                        ? String(item.plannedPriceUah)
                                        : ""
                                    );
                                    setItemOpen(false);
                                  }}
                                  className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                                >
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {item.name}
                                  </span>
                                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                                    {formatQtyLabel(
                                      item.virtualBalance,
                                      item.unit
                                    )}
                                  </span>
                                  {itemKey === item.basRefKey ? (
                                    <Check className="h-4 w-4 text-sky-600" />
                                  ) : null}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                  {selectedItem ? (
                    <p className="text-sm tabular-nums text-zinc-500">
                      Зараз на складі:{" "}
                      {formatQtyLabel(
                        selectedItem.virtualBalance,
                        selectedItem.unit
                      )}
                      {selectedItem.isLocal ? " · нова" : ""}
                    </p>
                  ) : null}
                </section>

                {isHarvest ? (
                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>Поле (звідки зібрано)</p>
                    <Popover
                      open={fieldOpen}
                      onOpenChange={(open) => {
                        setFieldOpen(open);
                        if (!open) setFieldSearch("");
                      }}
                    >
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
                      <PopoverContent sheetOnMobile={false}
                        align="start"
                        sideOffset={6}
                        className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl"
                      >
                        <Command className="rounded-2xl bg-white" shouldFilter={false}>
                          <CommandInput
                            placeholder="Пошук поля…"
                            value={fieldSearch}
                            onValueChange={setFieldSearch}
                            className="h-11 text-sm"
                          />
                          <CommandList className="max-h-64 bg-white">
                            <CommandEmpty>Немає полів</CommandEmpty>
                            <CommandGroup>
                              {filteredFields.map((field) => (
                                <CommandItem
                                  key={field.id}
                                  value={field.id}
                                  onSelect={() => {
                                    setFieldId(field.id);
                                    setFieldOpen(false);
                                    setFieldSearch("");
                                  }}
                                  className="cursor-pointer rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">
                                      {field.name}
                                    </span>
                                    <span className="text-[11px] text-zinc-400">
                                      {formatAreaHa(field.areaHa)} га
                                      {field.crop ? ` · ${field.crop}` : ""}
                                    </span>
                                  </span>
                                  {fieldId === field.id ? (
                                    <Check className="h-4 w-4 text-sky-600" />
                                  ) : null}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </section>
                ) : null}

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Кількість</p>
                  <div className={fuelHeroAmountClass}>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0"
                      className="w-full border-none bg-transparent py-6 text-center text-7xl font-light tabular-nums text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                  <p className="text-center text-sm text-zinc-400">
                    {selectedItem?.unit || newUnit || "од."}
                  </p>
                </section>

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>
                    {isHarvest
                      ? `Оцінка собівартості ₴ / ${selectedItem?.unit || newUnit || "од."}`
                      : `Ціна ₴ / ${selectedItem?.unit || newUnit || "од."}`}
                  </p>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    placeholder="0.00"
                    className={fuelInputClass}
                  />
                  {partyTotal != null ? (
                    <p className="rounded-xl border border-sky-100 bg-sky-50/80 px-3.5 py-2.5 text-sm text-sky-950">
                      {isHarvest ? "Оцінка партії" : "Сума партії"}:{" "}
                      <span className="font-bold tabular-nums">
                        {partyTotal.toLocaleString("uk-UA", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₴
                      </span>
                    </p>
                  ) : null}
                </section>

                {!isHarvest ? (
                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Постачальник</p>
                  <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
                    <PopoverTrigger className={comboboxTriggerClass}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                        {supplier || (
                          <span className="font-normal text-zinc-400">
                            Оберіть…
                          </span>
                        )}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                    </PopoverTrigger>
                    <PopoverContent sheetOnMobile={false}
                      align="start"
                      sideOffset={6}
                      className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl"
                    >
                      <Command className="rounded-2xl bg-white">
                        <CommandInput
                          placeholder="Пошук постачальника…"
                          value={supplier}
                          onValueChange={setSupplier}
                          className="h-11"
                        />
                        <CommandList className="max-h-56 bg-white">
                          <CommandEmpty>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-zinc-600"
                              onClick={() => setSupplierOpen(false)}
                            >
                              Використати введений текст
                            </button>
                          </CommandEmpty>
                          <CommandGroup>
                            {filteredSuppliers.map((name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={() => {
                                  setSupplier(name);
                                  setSupplierOpen(false);
                                }}
                                className="cursor-pointer rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100"
                              >
                                {name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Або введіть вручну"
                    className={fuelInputClass}
                  />
                </section>
                ) : null}

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Примітка</p>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      isHarvest ? "Опційно…" : "№ накладної (опційно)"
                    }
                    className={fuelInputClass}
                  />
                </section>

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>
                    {isHarvest ? "Фото / документи" : "Накладна"}
                  </p>
                  <AttachmentDropzone
                    entityType="inventory_move"
                    pending={pendingFiles}
                    onPendingChange={setPendingFiles}
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

          <div className={fuelSheetStickyFooterClass}>
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
                  {isHarvest ? (
                    <Wheat className="h-4 w-4" />
                  ) : (
                    <PackagePlus className="h-4 w-4" />
                  )}
                  {isHarvest ? "Зафіксувати випуск" : "Зафіксувати прихід"}
                </>
              )}
            </Button>
          </div>
        </form>
    </FuelPanelShell>
  );
}

export function InventoryInboundButton({
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white px-4 text-sm font-semibold text-sky-900 shadow-sm transition",
        "hover:border-sky-300 hover:from-sky-100 active:scale-[0.98]",
        className
      )}
    >
      <PackagePlus className="h-4 w-4" />
      <span className="truncate">Прихід</span>
    </button>
  );
}

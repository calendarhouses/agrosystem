"use client";

import {
  useEffect,
  useId,
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
  Trash2,
  Wheat,
  Wrench,
} from "lucide-react";

import {
  createLocalInboundMove,
  createLocalInventoryItem,
  createManualInboundReceipt,
  getQuickIssueOptions,
  listSupplierSuggestions,
  loadManualInboundReceiptForEdit,
  updateManualInboundReceipt,
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
import {
  INVENTORY_VAT_RATES,
  computeInventoryVat,
  computeInventoryVatFromIncl,
  formatMoney2,
  moneyToInput,
  parseDecimalInput,
  priceToInput,
  roundPrice4,
  sanitizeDecimalInput,
  unitPriceExVatFromIncl,
  type InventoryVatRateId,
} from "@/lib/inventory-vat";
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

const PURCHASE_CATEGORIES = CATEGORIES.filter((c) => c.id !== "harvest");

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

function formatMoneyUa(n: number): string {
  return formatMoney2(n);
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

function newLineKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MoneyEdit = "price" | "amount" | "incl";

type LineDraft = {
  key: string;
  /** id inventory_local_moves при редагуванні існуючого приходу */
  moveId: string | null;
  category: Cat | null;
  itemKey: string | null;
  qty: string;
  /** Ціна без ПДВ (до 4 знаків) або з ПДВ, якщо priceIncludesVat */
  unitPrice: string;
  amountExVat: string;
  amountInclVat: string;
  vatRate: InventoryVatRateId;
  /** true = поле ціни трактується як «з ПДВ» */
  priceIncludesVat: boolean;
  lastMoneyEdit: MoneyEdit;
};

function emptyLine(presetCategory?: Cat | null): LineDraft {
  return {
    key: newLineKey(),
    moveId: null,
    category:
      presetCategory && presetCategory !== "harvest" ? presetCategory : null,
    itemKey: null,
    qty: "",
    unitPrice: "",
    amountExVat: "",
    amountInclVat: "",
    vatRate: "20",
    priceIncludesVat: false,
    lastMoneyEdit: "price",
  };
}

function DecimalField({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  disabled,
  maxFractionDigits,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  maxFractionDigits?: number;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) =>
        onChange(
          sanitizeDecimalInput(e.target.value, {
            maxFractionDigits,
          })
        )
      }
      placeholder={placeholder ?? "0"}
      className={className}
    />
  );
}

function lineBreakdown(line: LineDraft) {
  const qty = parseDecimalInput(line.qty);
  if (qty == null || qty <= 0) return null;

  if (line.lastMoneyEdit === "incl") {
    const incl = parseDecimalInput(line.amountInclVat);
    if (incl == null || incl < 0) return null;
    return computeInventoryVatFromIncl({
      qty,
      amountInclVat: incl,
      vatRate: line.vatRate,
    });
  }

  if (line.lastMoneyEdit === "amount") {
    const amount = parseDecimalInput(line.amountExVat);
    if (amount == null || amount < 0) return null;
    const unit = qty > 0 ? roundPrice4(amount / qty) : 0;
    return computeInventoryVat({
      qty,
      unitPriceExVat: unit,
      vatRate: line.vatRate,
      amountExVat: amount,
    });
  }

  const priceRaw = parseDecimalInput(line.unitPrice);
  if (priceRaw == null || priceRaw < 0) return null;
  const unitEx = line.priceIncludesVat
    ? unitPriceExVatFromIncl(priceRaw, line.vatRate)
    : roundPrice4(priceRaw);
  return computeInventoryVat({
    qty,
    unitPriceExVat: unitEx,
    vatRate: line.vatRate,
  });
}

function syncDerivedFields(line: LineDraft, b: ReturnType<typeof lineBreakdown>) {
  if (!b) return line;
  const next = { ...line };
  next.amountExVat = moneyToInput(b.amountExVat);
  next.amountInclVat = moneyToInput(b.amountInclVat);
  // Не перезаписуємо поле, яке зараз редагує користувач
  if (line.lastMoneyEdit === "amount" || line.lastMoneyEdit === "incl") {
    if (!line.priceIncludesVat) {
      next.unitPrice = priceToInput(b.unitPriceExVat);
    } else if (b.qty > 0) {
      next.unitPrice = priceToInput(roundPrice4(b.amountInclVat / b.qty));
    }
  }
  return next;
}

function recalcLine(
  line: LineDraft,
  patch: Partial<LineDraft>
): LineDraft {
  let next: LineDraft = { ...line, ...patch };

  // Перемикач «ціна включає ПДВ»: перерахувати відображувану ціну
  if (
    patch.priceIncludesVat != null &&
    patch.priceIncludesVat !== line.priceIncludesVat
  ) {
    const qty = parseDecimalInput(next.qty);
    const price = parseDecimalInput(next.unitPrice);
    if (qty != null && qty > 0 && price != null && price >= 0) {
      if (patch.priceIncludesVat) {
        // була без ПДВ → показати з ПДВ
        const b = computeInventoryVat({
          qty,
          unitPriceExVat: price,
          vatRate: next.vatRate,
        });
        next.unitPrice = priceToInput(
          qty > 0 ? roundPrice4(b.amountInclVat / qty) : price
        );
      } else {
        // була з ПДВ → показати без ПДВ
        next.unitPrice = priceToInput(
          unitPriceExVatFromIncl(price, next.vatRate)
        );
      }
      next.lastMoneyEdit = "price";
    }
  }

  // Зміна ставки ПДВ при зафіксованому «з ПДВ» — лишаємо incl
  if (patch.vatRate != null && patch.vatRate !== line.vatRate) {
    if (next.lastMoneyEdit === "incl" || next.priceIncludesVat) {
      next.lastMoneyEdit = next.priceIncludesVat ? "price" : "incl";
    }
  }

  const b = lineBreakdown(next);
  if (b) {
    next = syncDerivedFields(next, b);
    // Якщо редагуємо ціну без ПДВ — amount/incl оновлюємо, ціну лишаємо як ввів користувач
    if (next.lastMoneyEdit === "price" && !next.priceIncludesVat) {
      next.amountExVat = moneyToInput(b.amountExVat);
      next.amountInclVat = moneyToInput(b.amountInclVat);
    }
    if (next.lastMoneyEdit === "price" && next.priceIncludesVat) {
      next.amountExVat = moneyToInput(b.amountExVat);
      next.amountInclVat = moneyToInput(b.amountInclVat);
    }
  }
  return next;
}

export function InventoryInboundSheet({
  open,
  onOpenChange,
  presetCategory = null,
  /** Якщо задано — форма відкривається в режимі редагування накладної */
  editReceiptId = null,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetCategory?: Cat | null;
  editReceiptId?: string | null;
  onSuccess?: (meta: {
    category: Cat;
    itemRefKey: string;
    flowFilter: "purchase" | "harvest";
  }) => void;
}) {
  const formId = useId();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<QuickIssueItemOption[]>([]);
  const [fields, setFields] = useState<QuickIssueFieldOption[]>([]);
  const [mode, setMode] = useState<"purchase" | "harvest">("purchase");
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editLockedReason, setEditLockedReason] = useState<string | null>(null);

  // Purchase (multi-line)
  const [lines, setLines] = useState<LineDraft[]>(() => [
    emptyLine(presetCategory),
  ]);
  const [supplier, setSupplier] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");

  // Harvest (single)
  const [harvestItemKey, setHarvestItemKey] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [harvestQty, setHarvestQty] = useState("");
  const [harvestPrice, setHarvestPrice] = useState("");
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");

  const [note, setNote] = useState("");
  const [inboundDate, setInboundDate] = useState(todayYmd);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [creatingItemFor, setCreatingItemFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("л");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [itemOpenKey, setItemOpenKey] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const activeSeason = useSeasonStore((s) => s.activeSeason);

  const selectedHarvestItem = useMemo(
    () => items.find((i) => i.basRefKey === harvestItemKey) ?? null,
    [items, harvestItemKey]
  );
  const selectedField = useMemo(
    () => fields.find((f) => f.id === fieldId) ?? null,
    [fields, fieldId]
  );

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

  const filteredFields = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (field) =>
        field.name.toLowerCase().includes(q) ||
        field.crop.toLowerCase().includes(q)
    );
  }, [fields, fieldSearch]);

  const harvestQtyNum = parseDecimalInput(harvestQty);
  const harvestPriceNum = parseDecimalInput(harvestPrice);
  const harvestTotal =
    harvestQtyNum != null &&
    harvestQtyNum > 0 &&
    harvestPriceNum != null &&
    harvestPriceNum >= 0
      ? Math.round(harvestQtyNum * harvestPriceNum * 100) / 100
      : null;

  const lineTotals = useMemo(() => {
    let ex = 0;
    let vat = 0;
    let incl = 0;
    let valid = 0;
    for (const line of lines) {
      const b = lineBreakdown(line);
      if (!b || !line.itemKey) continue;
      ex += b.amountExVat;
      vat += b.vatAmount;
      incl += b.amountInclVat;
      valid += 1;
    }
    return {
      ex: Math.round(ex * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      incl: Math.round(incl * 100) / 100,
      valid,
    };
  }, [lines]);

  const isHarvest = mode === "harvest";

  const isSubmitDisabled = isHarvest
    ? pending ||
      loading ||
      Boolean(loadError) ||
      !harvestItemKey ||
      harvestQtyNum == null ||
      harvestQtyNum <= 0 ||
      harvestPriceNum == null ||
      harvestPriceNum < 0 ||
      !harvestPrice.trim() ||
      !fieldId
    : pending ||
      loading ||
      Boolean(loadError) ||
      Boolean(editLockedReason) ||
      lineTotals.valid === 0 ||
      lines.some((l) => {
        if (!l.itemKey) return true;
        const b = lineBreakdown(l);
        return !b;
      });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setFormError(null);
      setEditLockedReason(null);
      const [res, supplierRes] = await Promise.all([
        getQuickIssueOptions(),
        listSupplierSuggestions(),
      ]);
      if (cancelled) return;
      if (!res.ok) {
        setLoading(false);
        setLoadError(res.error);
        setItems([]);
        setFields([]);
        return;
      }
      setItems(res.items);
      setFields(res.fields);
      if (supplierRes.ok) setSuppliers(supplierRes.names);

      if (editReceiptId) {
        const draft = await loadManualInboundReceiptForEdit(editReceiptId);
        if (cancelled) return;
        setLoading(false);
        if (!draft.ok) {
          setLoadError(draft.error);
          return;
        }
        if (draft.lockedReason) {
          setEditLockedReason(draft.lockedReason);
        }
        setEditingReceiptId(draft.receiptId);
        setMode("purchase");
        setSupplier(draft.supplierName);
        setInvoiceNumber(draft.invoiceNumber ?? "");
        setInboundDate(draft.invoiceDate || todayYmd());
        setNote(draft.note ?? "");
        setLines(
          draft.lines.map((row) => {
            const base = emptyLine(row.category);
            const withVat: LineDraft = {
              ...base,
              moveId: row.moveId,
              category: row.category,
              itemKey: row.itemRefKey,
              qty: String(row.qty),
              unitPrice: priceToInput(row.unitPriceExVat),
              amountExVat: moneyToInput(row.amountExVat),
              amountInclVat: moneyToInput(row.amountInclVat),
              vatRate: row.vatRate,
              priceIncludesVat: false,
              lastMoneyEdit: "amount",
            };
            return syncDerivedFields(withVat, lineBreakdown(withVat));
          })
        );
        return;
      }

      setLoading(false);
      setEditingReceiptId(null);
      if (presetCategory === "harvest") {
        setMode("harvest");
      } else {
        setMode("purchase");
        setLines([emptyLine(presetCategory)]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, presetCategory, editReceiptId]);

  function resetForm() {
    setMode(presetCategory === "harvest" ? "harvest" : "purchase");
    setLines([emptyLine(presetCategory)]);
    setSupplier("");
    setInvoiceNumber("");
    setHarvestItemKey(null);
    setFieldId(null);
    setHarvestQty("");
    setHarvestPrice("");
    setNote("");
    setInboundDate(todayYmd());
    setPendingFiles([]);
    setCreatingItemFor(null);
    setNewName("");
    setNewUnit("л");
    setFormError(null);
    setEditingReceiptId(null);
    setEditLockedReason(null);
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key ? recalcLine(line, patch) : line
      )
    );
  }

  function handleCreateItem(lineKey: string | "harvest") {
    const line =
      lineKey === "harvest"
        ? null
        : lines.find((l) => l.key === lineKey) ?? null;
    const category =
      lineKey === "harvest" ? ("harvest" as Cat) : line?.category ?? null;
    if (!category) {
      setFormError("Спочатку оберіть категорію");
      return;
    }
    if (!newName.trim()) {
      setFormError("Вкажіть назву нової позиції");
      return;
    }
    const priceFromForm =
      lineKey === "harvest"
        ? parseDecimalInput(harvestPrice)
        : parseDecimalInput(line?.unitPrice ?? "");
    startTransition(async () => {
      const res = await createLocalInventoryItem({
        name: newName.trim(),
        category,
        unit: newUnit.trim() || (category === "harvest" ? "т" : "шт"),
        plannedPriceUah:
          priceFromForm != null && priceFromForm >= 0 ? priceFromForm : 0,
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      const opts = await getQuickIssueOptions();
      if (opts.ok) setItems(opts.items);
      if (lineKey === "harvest") {
        setHarvestItemKey(res.basRefKey);
      } else {
        updateLine(lineKey, { itemKey: res.basRefKey });
      }
      setCreatingItemFor(null);
      setNewName("");
      toast.success("Позицію додано");
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (isHarvest) {
      if (!harvestItemKey) {
        setFormError("Оберіть товар");
        return;
      }
      if (harvestQtyNum == null || harvestQtyNum <= 0) {
        setFormError("Вкажіть кількість більше нуля");
        return;
      }
      if (harvestPriceNum == null || harvestPriceNum < 0 || !harvestPrice.trim()) {
        setFormError("Вкажіть оцінку собівартості");
        return;
      }
      if (!fieldId) {
        setFormError("Оберіть поле, з якого зібрано врожай");
        return;
      }
      startTransition(async () => {
        const { suppressLocalInventoryMovesRealtimeToast } = await import(
          "@/lib/realtime-toast-guard"
        );
        suppressLocalInventoryMovesRealtimeToast();
        const res = await createLocalInboundMove({
          itemRefKey: harvestItemKey,
          qty: harvestQtyNum,
          unitPriceUah: harvestPriceNum,
          buyerName: null,
          fieldId,
          note: note.trim() || null,
          season: activeSeason,
          date: inboundDate,
          vatRate: "none",
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
          `Врожай ${harvestQtyNum}${selectedHarvestItem?.unit ? ` ${selectedHarvestItem.unit}` : ""} на склад`
        );
        resetForm();
        onSuccess?.({
          category: "harvest",
          itemRefKey: harvestItemKey,
          flowFilter: "harvest",
        });
        onOpenChange(false);
      });
      return;
    }

    const ready = lines
      .map((line) => {
        const b = lineBreakdown(line);
        if (!line.itemKey || !b) return null;
        return { line, b };
      })
      .filter(Boolean) as Array<{ line: LineDraft; b: NonNullable<ReturnType<typeof lineBreakdown>> }>;

    if (ready.length === 0) {
      setFormError("Додайте хоча б одну валідну позицію");
      return;
    }
    if (!supplier.trim()) {
      setFormError("Вкажіть постачальника");
      return;
    }

    startTransition(async () => {
      const { suppressLocalInventoryMovesRealtimeToast } = await import(
        "@/lib/realtime-toast-guard"
      );
      suppressLocalInventoryMovesRealtimeToast();
      const payloadLines = ready.map(({ line, b }) => ({
        moveId: line.moveId,
        itemRefKey: line.itemKey!,
        qty: b.qty,
        unitPriceUah: b.unitPriceExVat,
        vatRate: b.vatRate,
        amountExVat: b.amountExVat,
        vatAmount: b.vatAmount,
        amountInclVat: b.amountInclVat,
      }));

      const res = editingReceiptId
        ? await updateManualInboundReceipt({
            receiptId: editingReceiptId,
            supplierName: supplier.trim(),
            invoiceNumber: invoiceNumber.trim() || null,
            invoiceDate: inboundDate,
            note: note.trim() || null,
            season: activeSeason,
            lines: payloadLines,
          })
        : await createManualInboundReceipt({
            supplierName: supplier.trim(),
            invoiceNumber: invoiceNumber.trim() || null,
            invoiceDate: inboundDate,
            note: note.trim() || null,
            season: activeSeason,
            lines: payloadLines,
          });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      if (pendingFiles.length > 0 && res.moveIds[0]) {
        await flushPendingAttachments(
          "inventory_move",
          res.moveIds[0],
          pendingFiles
        );
      }
      if (res.basWarning) {
        toast.warning(res.basWarning);
      } else {
        toast.success(
          editingReceiptId
            ? `Прихід оновлено · ${ready.length} поз. · ${formatMoneyUa(lineTotals.incl)} ₴ з ПДВ`
            : `Прихід · ${ready.length} поз. · ${formatMoneyUa(lineTotals.incl)} ₴ з ПДВ`
        );
      }
      const first = ready[0];
      resetForm();
      onSuccess?.({
        category: (first.line.category ?? "zzr") as Cat,
        itemRefKey: first.line.itemKey!,
        flowFilter: "purchase",
      });
      onOpenChange(false);
    });
  }

  function renderItemPicker(opts: {
    lineKey: string;
    category: Cat | null;
    itemKey: string | null;
    onSelect: (item: QuickIssueItemOption) => void;
  }) {
    const categoryItems = opts.category
      ? items.filter((i) => i.category === opts.category)
      : [];
    const q = itemSearch.trim().toLowerCase();
    const filtered = !q
      ? categoryItems
      : categoryItems.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.unit.toLowerCase().includes(q)
        );
    const selected =
      items.find((i) => i.basRefKey === opts.itemKey) ?? null;
    const open = itemOpenKey === opts.lineKey;

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setItemOpenKey(next ? opts.lineKey : null);
          if (!next) setItemSearch("");
        }}
      >
        <PopoverTrigger
          disabled={!opts.category}
          className={comboboxTriggerClass}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            {selected ? (
              selected.name
            ) : (
              <span className="font-normal text-zinc-400">
                {opts.category ? "Оберіть товар…" : "Спочатку категорію"}
              </span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
        </PopoverTrigger>
        <PopoverContent
          sheetOnMobile={false}
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
                {filtered.map((item) => (
                  <CommandItem
                    key={item.basRefKey}
                    value={`${item.name} ${item.unit}`}
                    data-checked={
                      opts.itemKey === item.basRefKey || undefined
                    }
                    onSelect={() => {
                      opts.onSelect(item);
                      setItemOpenKey(null);
                      setItemSearch("");
                    }}
                    className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {formatQtyLabel(item.virtualBalance, item.unit)}
                    </span>
                    {opts.itemKey === item.basRefKey ? (
                      <Check className="h-4 w-4 text-sky-600" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  function renderVatBlock(line: LineDraft) {
    const b = lineBreakdown(line);
    const unitLabel =
      items.find((i) => i.basRefKey === line.itemKey)?.unit || "од.";
    const locked = Boolean(editLockedReason);

    return (
      <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/40 p-3.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <p className={fuelFieldLabelClass}>Кількість</p>
            <DecimalField
              value={line.qty}
              onChange={(next) => updateLine(line.key, { qty: next })}
              ariaLabel="Кількість"
              className={fuelInputClass}
              placeholder="0"
              disabled={locked}
              maxFractionDigits={4}
            />
            <p className="text-[11px] text-zinc-400">{unitLabel}</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className={fuelFieldLabelClass}>
                {line.priceIncludesVat ? "Ціна з ПДВ" : "Ціна без ПДВ"}
              </p>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  updateLine(line.key, {
                    priceIncludesVat: !line.priceIncludesVat,
                  })
                }
                className={cn(
                  "rounded-lg px-2 py-0.5 text-[10px] font-semibold transition",
                  line.priceIncludesVat
                    ? "bg-sky-700 text-white"
                    : "bg-white text-sky-800 ring-1 ring-sky-200"
                )}
              >
                {line.priceIncludesVat ? "З ПДВ" : "Без ПДВ"}
              </button>
            </div>
            <DecimalField
              value={line.unitPrice}
              onChange={(next) =>
                updateLine(line.key, {
                  unitPrice: next,
                  lastMoneyEdit: "price",
                })
              }
              ariaLabel={
                line.priceIncludesVat ? "Ціна з ПДВ" : "Ціна без ПДВ"
              }
              className={fuelInputClass}
              placeholder="0.0000"
              disabled={locked}
              maxFractionDigits={4}
            />
            <p className="text-[11px] text-zinc-400">
              ₴ / {unitLabel}
              {b && line.priceIncludesVat
                ? ` · без ПДВ ${formatMoneyUa(b.unitPriceExVat).replace(/,00$/, "") || priceToInput(b.unitPriceExVat)}`
                : " · до 4 знаків"}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className={fuelFieldLabelClass}>Сума без ПДВ</p>
          <DecimalField
            value={line.amountExVat}
            onChange={(next) =>
              updateLine(line.key, {
                amountExVat: next,
                lastMoneyEdit: "amount",
                priceIncludesVat: false,
              })
            }
            ariaLabel="Сума без ПДВ"
            className={fuelInputClass}
            placeholder="0.00"
            disabled={locked}
            maxFractionDigits={2}
          />
        </div>

        <div className="space-y-1.5">
          <p className={fuelFieldLabelClass}>Ставка ПДВ</p>
          <div className="flex flex-wrap gap-1.5">
            {INVENTORY_VAT_RATES.map((rate) => {
              const active = line.vatRate === rate.id;
              return (
                <button
                  key={rate.id}
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    updateLine(line.key, { vatRate: rate.id })
                  }
                  className={cn(
                    "rounded-xl px-2.5 py-1.5 text-xs font-semibold transition",
                    active
                      ? "bg-sky-700 text-white shadow-sm"
                      : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-sky-300"
                  )}
                >
                  {rate.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-sky-100">
            <p className="text-[11px] font-medium text-zinc-500">Сума ПДВ</p>
            <p className="mt-0.5 text-base font-bold tabular-nums text-zinc-900">
              {b ? `${formatMoneyUa(b.vatAmount)} ₴` : "—"}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className={fuelFieldLabelClass}>Усього з ПДВ</p>
            <DecimalField
              value={line.amountInclVat}
              onChange={(next) =>
                updateLine(line.key, {
                  amountInclVat: next,
                  lastMoneyEdit: "incl",
                })
              }
              ariaLabel="Усього з ПДВ"
              className={cn(fuelInputClass, "font-semibold text-sky-900")}
              placeholder="0.00"
              disabled={locked}
              maxFractionDigits={2}
            />
            <p className="text-[11px] text-zinc-400">
              зворотний перерахунок → сума / ціна без ПДВ
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <FuelPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={isHarvest ? "Прийом врожаю" : "Прихід на склад"}
    >
      <FuelSheetHeader
        icon={isHarvest ? Wheat : PackagePlus}
        title={
          isHarvest
            ? "Прийом врожаю"
            : editingReceiptId
              ? "Редагування приходу"
              : "Прихід на склад"
        }
        description={
          isHarvest
            ? "З поля на склад"
            : editingReceiptId
              ? "Можна додати позицію або змінити ПДВ (до проведення в BAS)"
              : "Закупівля · кілька товарів в одній накладній"
        }
        accent={isHarvest ? "amber" : "sky"}
      />

      <form
        id={formId}
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
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
              {!editingReceiptId ? (
                <section className="space-y-2.5">
                  <p className={fuelFieldLabelClass}>Тип приходу</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("purchase");
                        setFormError(null);
                      }}
                      className={cn(
                        "rounded-2xl px-3 py-3 text-sm font-semibold transition",
                        mode === "purchase"
                          ? "bg-sky-700 text-white shadow-sm"
                          : "bg-white text-zinc-700 ring-1 ring-zinc-200"
                      )}
                    >
                      Закупівля
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("harvest");
                        setFormError(null);
                      }}
                      className={cn(
                        "rounded-2xl px-3 py-3 text-sm font-semibold transition",
                        mode === "harvest"
                          ? "bg-amber-600 text-white shadow-sm"
                          : "bg-white text-zinc-700 ring-1 ring-zinc-200"
                      )}
                    >
                      Врожай
                    </button>
                  </div>
                </section>
              ) : null}

              {editLockedReason ? (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{editLockedReason}</p>
                </div>
              ) : null}

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

              {isHarvest ? (
                <>
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className={fuelFieldLabelClass}>Культура</p>
                      <button
                        type="button"
                        onClick={() =>
                          setCreatingItemFor((v) =>
                            v === "harvest" ? null : "harvest"
                          )
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Нова позиція
                      </button>
                    </div>
                    {creatingItemFor === "harvest" ? (
                      <div className="space-y-2 rounded-2xl border border-amber-200/80 bg-amber-50/50 p-3">
                        <input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Культура / сорт"
                          className={fuelInputClass}
                        />
                        <div className="flex gap-2">
                          <input
                            value={newUnit}
                            onChange={(e) => setNewUnit(e.target.value)}
                            placeholder="Од. (т, кг)"
                            className={cn(fuelInputClass, "flex-1")}
                          />
                          <Button
                            type="button"
                            disabled={pending}
                            onClick={() => handleCreateItem("harvest")}
                            className="h-12 rounded-2xl bg-amber-600 px-4 text-white hover:bg-amber-700"
                          >
                            Додати
                          </Button>
                        </div>
                      </div>
                    ) : (
                      renderItemPicker({
                        lineKey: "harvest",
                        category: "harvest",
                        itemKey: harvestItemKey,
                        onSelect: (item) => {
                          setHarvestItemKey(item.basRefKey);
                          if (
                            item.plannedPriceUah != null &&
                            item.plannedPriceUah > 0 &&
                            !harvestPrice.trim()
                          ) {
                            setHarvestPrice(String(item.plannedPriceUah));
                          }
                        },
                      })
                    )}
                  </section>

                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>Поле (звідки зібрано)</p>
                    <Popover
                      open={fieldOpen}
                      onOpenChange={(next) => {
                        setFieldOpen(next);
                        if (!next) setFieldSearch("");
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
                      <PopoverContent
                        sheetOnMobile={false}
                        align="start"
                        sideOffset={6}
                        className="w-[min(calc(100vw-2.5rem),22rem)] rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl"
                      >
                        <Command
                          className="rounded-2xl bg-white"
                          shouldFilter={false}
                        >
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

                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>Кількість</p>
                    <div className={fuelHeroAmountClass}>
                      <DecimalField
                        value={harvestQty}
                        onChange={setHarvestQty}
                        ariaLabel="Кількість врожаю"
                        placeholder="0"
                        className="w-full border-none bg-transparent py-6 text-center text-7xl font-light tabular-nums text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:ring-0"
                      />
                    </div>
                    <p className="text-center text-sm text-zinc-400">
                      {selectedHarvestItem?.unit || newUnit || "од."}
                    </p>
                  </section>

                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>
                      Оцінка собівартості ₴ /{" "}
                      {selectedHarvestItem?.unit || newUnit || "од."}
                    </p>
                    <DecimalField
                      value={harvestPrice}
                      onChange={setHarvestPrice}
                      ariaLabel="Оцінка собівартості"
                      className={fuelInputClass}
                      placeholder="0.00"
                    />
                    {harvestTotal != null ? (
                      <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-3.5 py-2.5 text-sm text-amber-950">
                        Оцінка партії:{" "}
                        <span className="font-bold tabular-nums">
                          {formatMoneyUa(harvestTotal)} ₴
                        </span>
                      </p>
                    ) : null}
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>Постачальник</p>
                    <Popover
                      open={supplierOpen}
                      onOpenChange={setSupplierOpen}
                    >
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
                      <PopoverContent
                        sheetOnMobile={false}
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

                  <section className="space-y-2">
                    <p className={fuelFieldLabelClass}>№ накладної</p>
                    <input
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="Спільний номер для всіх позицій"
                      className={fuelInputClass}
                    />
                  </section>

                  <div className="space-y-4">
                    {lines.map((line, index) => {
                      const selectedItem =
                        items.find((i) => i.basRefKey === line.itemKey) ??
                        null;
                      return (
                        <section
                          key={line.key}
                          className="space-y-3 rounded-2xl border border-zinc-200/90 bg-white p-3.5 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-zinc-800">
                              Позиція {index + 1}
                            </p>
                            {lines.length > 1 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setLines((prev) =>
                                    prev.filter((l) => l.key !== line.key)
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Видалити
                              </button>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <p className={fuelFieldLabelClass}>Категорія</p>
                            <div className="grid grid-cols-2 gap-2">
                              {PURCHASE_CATEGORIES.map((cat) => {
                                const count = categoryCounts[cat.id] ?? 0;
                                const Icon = cat.icon;
                                const active = line.category === cat.id;
                                return (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() =>
                                      updateLine(line.key, {
                                        category: cat.id,
                                        itemKey: null,
                                      })
                                    }
                                    className={cn(
                                      "flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition",
                                      active
                                        ? "bg-[#276749] text-white"
                                        : "bg-zinc-50 text-zinc-800 ring-1 ring-zinc-200"
                                    )}
                                  >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0">
                                      <span className="block text-xs font-bold leading-tight">
                                        {cat.label}
                                      </span>
                                      <span
                                        className={cn(
                                          "text-[10px] tabular-nums",
                                          active
                                            ? "text-white/70"
                                            : "text-zinc-400"
                                        )}
                                      >
                                        {count} поз.
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className={fuelFieldLabelClass}>Товар</p>
                              <button
                                type="button"
                                disabled={!line.category}
                                onClick={() => {
                                  setCreatingItemFor((v) =>
                                    v === line.key ? null : line.key
                                  );
                                  setNewUnit(
                                    line.category === "seed" ? "кг" : "л"
                                  );
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900 disabled:opacity-40"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Нова позиція
                              </button>
                            </div>
                            {creatingItemFor === line.key ? (
                              <div className="space-y-2 rounded-2xl border border-sky-200/80 bg-sky-50/50 p-3">
                                <input
                                  value={newName}
                                  onChange={(e) => setNewName(e.target.value)}
                                  placeholder="Назва товару"
                                  className={fuelInputClass}
                                />
                                <div className="flex gap-2">
                                  <input
                                    value={newUnit}
                                    onChange={(e) => setNewUnit(e.target.value)}
                                    placeholder="Од. (л, кг, шт)"
                                    className={cn(fuelInputClass, "flex-1")}
                                  />
                                  <Button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => handleCreateItem(line.key)}
                                    className="h-12 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700"
                                  >
                                    Додати
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              renderItemPicker({
                                lineKey: line.key,
                                category: line.category,
                                itemKey: line.itemKey,
                                onSelect: (item) => {
                                  updateLine(line.key, {
                                    itemKey: item.basRefKey,
                                    unitPrice:
                                      item.plannedPriceUah != null &&
                                      item.plannedPriceUah > 0
                                        ? String(item.plannedPriceUah)
                                        : line.unitPrice,
                                    lastMoneyEdit: "price",
                                  });
                                },
                              })
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
                          </div>

                          {renderVatBlock(line)}
                        </section>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() =>
                        setLines((prev) => [...prev, emptyLine(null)])
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-sky-300 bg-sky-50/60 px-4 py-3.5 text-sm font-semibold text-sky-800 transition hover:bg-sky-100/70"
                    >
                      <Plus className="h-4 w-4" />
                      Додати позицію
                    </button>
                  </div>

                  {lineTotals.valid > 0 ? (
                    <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white px-4 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                        Підсумок накладної
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Звірка з підвалом паперового рахунку
                      </p>
                      <div className="mt-2.5 space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-xs text-zinc-600">Разом без ПДВ</p>
                          <p className="text-sm font-bold tabular-nums text-zinc-900">
                            {formatMoneyUa(lineTotals.ex)} ₴
                          </p>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-xs text-zinc-600">Разом ПДВ</p>
                          <p className="text-sm font-bold tabular-nums text-zinc-900">
                            {formatMoneyUa(lineTotals.vat)} ₴
                          </p>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 border-t border-sky-100 pt-2">
                          <p className="text-xs font-semibold text-sky-900">
                            Усього з ПДВ по накладній
                          </p>
                          <p className="text-base font-extrabold tabular-nums text-sky-900">
                            {formatMoneyUa(lineTotals.incl)} ₴
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}
                </>
              )}

              <section className="space-y-2">
                <p className={fuelFieldLabelClass}>Примітка</p>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={isHarvest ? "Опційно…" : "Коментар (опційно)"}
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
                {isHarvest
                  ? "Зафіксувати випуск"
                  : editingReceiptId
                    ? `Зберегти зміни (${lines.length})`
                    : lines.length > 1
                      ? `Зафіксувати прихід (${lines.length})`
                      : "Зафіксувати прихід"}
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

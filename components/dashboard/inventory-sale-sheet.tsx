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
  Loader2,
  Plus,
  ShoppingCart,
  Wheat,
} from "lucide-react";

import {
  createLocalHarvestSale,
  getQuickIssueOptions,
  listBuyerSuggestions,
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

function formatMoney(n: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 2,
  }).format(n);
}

function todayInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function InventorySaleSheet({
  open,
  onOpenChange,
  presetItemRefKey = null,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetItemRefKey?: string | null;
  onSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<QuickIssueItemOption[]>([]);
  const [buyers, setBuyers] = useState<string[]>([]);

  const [itemKey, setItemKey] = useState<string | null>(null);
  const [buyer, setBuyer] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeSeason = useSeasonStore((s) => s.activeSeason);

  const harvestItems = useMemo(
    () => items.filter((i) => i.category === "harvest"),
    [items]
  );

  const selectedItem = useMemo(
    () => harvestItems.find((i) => i.basRefKey === itemKey) ?? null,
    [harvestItems, itemKey]
  );

  const qtyNum = Number(String(qty).replace(",", "."));
  const priceNum = Number(String(price).replace(",", "."));
  const total =
    Number.isFinite(qtyNum) && Number.isFinite(priceNum)
      ? qtyNum * priceNum
      : 0;

  const filteredBuyers = useMemo(() => {
    const q = buyerSearch.trim().toLowerCase();
    return buyers
      .filter((n) => !q || n.toLowerCase().includes(q))
      .slice(0, 40);
  }, [buyers, buyerSearch]);

  const canAddNewBuyer = useMemo(() => {
    const q = buyerSearch.trim();
    if (!q) return false;
    return !buyers.some((n) => n.toLowerCase() === q.toLowerCase());
  }, [buyers, buyerSearch]);

  function selectBuyer(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBuyer(trimmed);
    setBuyerSearch("");
    setBuyerOpen(false);
    if (!buyers.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setBuyers((prev) => [trimmed, ...prev]);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setFormError(null);
      const [optRes, buyerRes] = await Promise.all([
        getQuickIssueOptions(),
        listBuyerSuggestions(),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!optRes.ok) {
        setLoadError(optRes.error);
        setItems([]);
        return;
      }
      setItems(optRes.items);
      if (buyerRes.ok) setBuyers(buyerRes.names);

      const preset = presetItemRefKey?.trim().toLowerCase();
      if (preset) {
        const found = optRes.items.find(
          (i) =>
            i.category === "harvest" && i.basRefKey.toLowerCase() === preset
        );
        if (found) setItemKey(found.basRefKey);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, presetItemRefKey]);

  function resetForm() {
    setItemKey(null);
    setBuyer("");
    setQty("");
    setPrice("");
    setDate(todayInputValue());
    setNote("");
    setPendingFiles([]);
    setFormError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!itemKey) {
      setFormError("Оберіть товар");
      return;
    }
    if (!buyer.trim()) {
      setFormError("Вкажіть покупця");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setFormError("Вкажіть кількість більше нуля");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setFormError("Вкажіть ціну");
      return;
    }
    if (selectedItem && qtyNum > selectedItem.virtualBalance) {
      setFormError("Перевищення доступного залишку");
      return;
    }

    startTransition(async () => {
      suppressLocalInventoryMovesRealtimeToast();
      const res = await createLocalHarvestSale({
        itemRefKey: itemKey,
        qty: qtyNum,
        buyerName: buyer.trim(),
        unitPriceUah: priceNum,
        date,
        note: note.trim() || null,
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
      toast.success(
        `Продаж ${formatQtyLabel(qtyNum, selectedItem?.unit ?? "")} → ${buyer.trim()}`
      );
      resetForm();
      onSuccess?.();
      onOpenChange(false);
    });
  }

  return (
    <FuelPanelShell open={open} onOpenChange={onOpenChange} title="Продаж врожаю">
        <FuelSheetHeader
          icon={ShoppingCart}
          title="Продаж врожаю"
          description="Продаж зі складу"
          accent="amber"
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
                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Товар</p>
                  <Popover open={itemOpen} onOpenChange={setItemOpen}>
                    <PopoverTrigger className={comboboxTriggerClass}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                        {selectedItem ? (
                          selectedItem.name
                        ) : (
                          <span className="font-normal text-zinc-400">
                            Оберіть культуру…
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
                      <Command className="rounded-2xl bg-white">
                        <CommandInput placeholder="Пошук…" className="h-11" />
                        <CommandList className="max-h-64 bg-white">
                          <CommandEmpty>Немає врожаю в довіднику</CommandEmpty>
                          <CommandGroup>
                            {harvestItems.map((item) => {
                              const out = item.virtualBalance <= 0;
                              return (
                                <CommandItem
                                  key={item.basRefKey}
                                  value={`${item.name} ${item.unit}`}
                                  disabled={out}
                                  onSelect={() => {
                                    setItemKey(item.basRefKey);
                                    setItemOpen(false);
                                  }}
                                  className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100"
                                >
                                  <Wheat className="h-4 w-4 shrink-0 text-amber-700" />
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {item.name}
                                  </span>
                                  <span
                                    className={cn(
                                      "shrink-0 text-xs tabular-nums",
                                      out
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
                                    <Check className="h-4 w-4 text-emerald-600" />
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
                      На складі:{" "}
                      {formatQtyLabel(
                        selectedItem.virtualBalance,
                        selectedItem.unit
                      )}
                    </p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Покупець</p>
                  <Popover
                    open={buyerOpen}
                    onOpenChange={(open) => {
                      setBuyerOpen(open);
                      if (open) setBuyerSearch("");
                    }}
                  >
                    <PopoverTrigger className={comboboxTriggerClass}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                        {buyer || (
                          <span className="font-normal text-zinc-400">
                            Оберіть або додайте нового…
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
                          placeholder="Пошук або нова назва…"
                          value={buyerSearch}
                          onValueChange={setBuyerSearch}
                          className="h-11"
                        />
                        <CommandList className="max-h-56 bg-white">
                          {canAddNewBuyer ? (
                            <CommandGroup>
                              <CommandItem
                                value={`__new__${buyerSearch}`}
                                onSelect={() => selectBuyer(buyerSearch)}
                                className="cursor-pointer rounded-xl px-3 py-2.5 text-[#276749] data-[selected=true]:bg-zinc-100"
                              >
                                <Plus className="mr-2 h-4 w-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">
                                  Додати нового: «{buyerSearch.trim()}»
                                </span>
                              </CommandItem>
                            </CommandGroup>
                          ) : null}
                          <CommandEmpty>
                            {buyerSearch.trim()
                              ? "Немає збігів — введіть назву й додайте нового"
                              : "Поки немає покупців — введіть нову назву"}
                          </CommandEmpty>
                          <CommandGroup
                            heading={
                              filteredBuyers.length ? "З BAS і складу" : undefined
                            }
                          >
                            {filteredBuyers.map((name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={() => selectBuyer(name)}
                                className="cursor-pointer rounded-xl px-3 py-2.5 data-[selected=true]:bg-zinc-100"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {name}
                                </span>
                                {buyer === name ? (
                                  <Check className="h-4 w-4 text-amber-600" />
                                ) : null}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <input
                    value={buyer}
                    onChange={(e) => setBuyer(e.target.value)}
                    placeholder="Або введіть вручну"
                    className={fuelInputClass}
                  />
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className={fuelFieldLabelClass}>Дата</p>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={fuelInputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className={fuelFieldLabelClass}>Ціна ₴ / од.</p>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0"
                      className={fuelInputClass}
                    />
                  </div>
                </section>

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
                      className="w-full border-none bg-transparent py-6 text-center text-7xl font-light tabular-nums text-zinc-900 placeholder:text-zinc-300 focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                  <p className="text-center text-sm font-medium text-zinc-400">
                    {selectedItem?.unit || "од."}
                    {total > 0
                      ? ` · сума ${formatMoney(total)} ₴`
                      : ""}
                  </p>
                </section>

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Коментар</p>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Договір, номер…"
                    className={fuelInputClass}
                  />
                </section>

                <section className="space-y-2">
                  <p className={fuelFieldLabelClass}>Накладна</p>
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
              disabled={
                pending ||
                loading ||
                Boolean(loadError) ||
                !itemKey ||
                !buyer.trim() ||
                !Number.isFinite(qtyNum) ||
                qtyNum <= 0
              }
              className={fuelPrimaryBtnClass}
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Зберігаємо…
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4" />
                  Зафіксувати продаж
                </>
              )}
            </Button>
          </div>
        </form>
    </FuelPanelShell>
  );
}

export function InventorySaleButton({
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
        "inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50 px-3 text-xs font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100 sm:px-3.5",
        className
      )}
    >
      <ShoppingCart className="h-3.5 w-3.5" />
      Продаж
    </button>
  );
}

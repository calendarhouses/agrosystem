"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Package } from "lucide-react";

import {
  getQuickIssueOptions,
  type QuickIssueItemOption,
} from "@/app/admin/inventory/actions";
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
  estimateMaterialQty,
  materialCategoriesForWorkType,
  materialCategoryLabel,
  operationRequiresMaterial,
  type OperationMaterialCategory,
} from "@/lib/operation-material-categories";
import type { FieldOperationMaterial } from "@/lib/field-operation-materials";
import { cn } from "@/lib/utils";

export type OperationMaterialDraft = FieldOperationMaterial;

type OperationMaterialsPickerProps = {
  workType: string;
  areaHa: number;
  crop?: string | null;
  value: OperationMaterialDraft | null;
  onChange: (value: OperationMaterialDraft | null) => void;
  theme?: "light" | "dark";
  required?: boolean;
};

export function OperationMaterialsPicker({
  workType,
  areaHa,
  crop,
  value,
  onChange,
  theme = "light",
  required = true,
}: OperationMaterialsPickerProps) {
  const categories = useMemo(
    () => materialCategoriesForWorkType(workType),
    [workType]
  );
  const needsMaterial = operationRequiresMaterial(workType);
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QuickIssueItemOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!needsMaterial) return;
    let cancelled = false;
    setLoading(true);
    void getQuickIssueOptions().then((res) => {
      if (cancelled) return;
      if (res.ok) setItems(res.items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [needsMaterial]);

  const filteredItems = useMemo(() => {
    if (categories.length === 0) return [];
    return items.filter((item) =>
      categories.includes(item.category as OperationMaterialCategory)
    );
  }, [categories, items]);

  const category = categories[0] ?? null;

  useEffect(() => {
    if (!needsMaterial) {
      if (value) onChange(null);
      return;
    }
    if (
      value &&
      !categories.includes(value.category as OperationMaterialCategory)
    ) {
      onChange(null);
    }
  }, [categories, needsMaterial, onChange, value]);

  if (!needsMaterial) return null;

  const labelClass = cn(
    "text-[11px] font-semibold tracking-[0.08em] uppercase",
    isDark ? "text-zinc-500" : "text-zinc-500"
  );

  const fieldClass = cn(
    "box-border h-11 w-full rounded-xl border px-3 text-base md:text-sm",
    "transition-colors outline-none",
    isDark
      ? "border-white/10 bg-white/[0.06] text-zinc-50 placeholder:text-zinc-500 focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/15"
      : "border-[#E5DFD3] bg-white text-zinc-900 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] focus-visible:border-[#276749]/45 focus-visible:ring-2 focus-visible:ring-[#276749]/15"
  );

  const triggerClass = cn(
    fieldClass,
    "inline-flex items-center justify-between gap-2 text-left font-normal"
  );

  const selected = value?.basRefKey
    ? filteredItems.find((i) => i.basRefKey === value.basRefKey) ?? null
    : null;

  function selectItem(item: QuickIssueItemOption) {
    const estimated =
      estimateMaterialQty(workType, areaHa, crop) ??
      (value?.qty && value.qty > 0 ? value.qty : 1);
    onChange({
      basRefKey: item.basRefKey,
      itemName: item.name,
      category: item.category,
      unit: item.unit,
      qty: estimated,
    });
    setOpen(false);
  }

  const normHint = estimateMaterialQty(workType, areaHa, crop);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border",
        isDark
          ? "border-white/10 bg-white/[0.03]"
          : "border-[#E5DFD3] bg-white shadow-sm"
      )}
    >
      <div
        className={cn(
          "border-b px-4 py-2.5",
          isDark
            ? "border-white/10 bg-white/[0.02]"
            : "border-[#E5DFD3]/80 bg-[#FAFAF8]"
        )}
      >
        <p className={labelClass}>
          {category ? materialCategoryLabel(category) : "Матеріал"}
          {required ? " *" : ""}
        </p>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Завантаження складу…
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-amber-700">
            Немає позицій на складі для «{workType}». Додайте номенклатуру в
            Склад.
          </p>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              className={cn(triggerClass, !value?.basRefKey && "text-zinc-400")}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Package className="size-4 shrink-0 opacity-60" />
                <span className="truncate">
                  {selected?.name ??
                    value?.itemName ??
                    "Оберіть позицію зі складу"}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className={cn(
                "w-[min(calc(100vw-2rem),22rem)] p-0",
                isDark
                  ? "border-white/10 bg-zinc-900 text-zinc-50"
                  : "border-[#E5DFD3] bg-white"
              )}
            >
              <Command>
                <CommandInput placeholder="Пошук ТМЦ…" />
                <CommandList>
                  <CommandEmpty>Нічого не знайдено</CommandEmpty>
                  <CommandGroup>
                    {filteredItems.map((item) => (
                      <CommandItem
                        key={item.basRefKey}
                        value={item.name}
                        onSelect={() => selectItem(item)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            value?.basRefKey === item.basRefKey
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.name}
                        </span>
                        <span className="ml-2 shrink-0 text-xs text-zinc-500">
                          {item.virtualBalance > 0
                            ? `${item.virtualBalance} ${item.unit}`
                            : "0"}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {value?.basRefKey ? (
          <div className="space-y-1.5">
            <p className={labelClass}>
              Кількість{value.unit ? `, ${value.unit}` : ""}
            </p>
            <input
              inputMode="decimal"
              value={String(value.qty)}
              onChange={(e) => {
                const qty = Number(e.target.value.replace(",", "."));
                if (!Number.isFinite(qty)) return;
                onChange({ ...value, qty });
              }}
              className={cn(fieldClass, "tabular-nums font-semibold")}
            />
            {areaHa > 0 && normHint != null ? (
              <p className="text-[10px] text-zinc-400">
                Орієнтир за нормою на {areaHa} га: ≈ {normHint} {value.unit}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

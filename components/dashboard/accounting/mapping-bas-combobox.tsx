"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

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
import { UNMAPPED_VALUE, type BasSelectOption } from "@/lib/bas-mapping";
import { cn } from "@/lib/utils";

const LIST_CAP = 80;

type MappingBasComboboxProps = {
  options: BasSelectOption[];
  value: string;
  linked: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  onChange: (value: string) => void;
  onClear?: () => void;
};

export function MappingBasCombobox({
  options,
  value,
  linked,
  disabled,
  allowClear = true,
  onChange,
  onClear,
}: MappingBasComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => {
    const hit = options.find((o) => o.value === value) ?? null;
    if (hit) return hit;
    if (value && value !== UNMAPPED_VALUE) {
      return { value, label: `Ключ ${value.slice(0, 8)}…` };
    }
    return null;
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Без пошуку — лише обраний + невеликий превʼю, щоб не малювати 1500 рядків
      const head = options.slice(0, LIST_CAP);
      if (selected && !head.some((o) => o.value === selected.value)) {
        return [selected as BasSelectOption, ...head].slice(0, LIST_CAP);
      }
      return head;
    }
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.matchText ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, LIST_CAP);
  }, [options, query, selected]);

  const label = selected?.label ?? "Обрати в BAS AGRO…";

  function pickOption(nextValue: string) {
    setOpen(false);
    setQuery("");
    window.setTimeout(() => onChange(nextValue), 0);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Popover
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm font-medium transition",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            linked
              ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-950"
              : "border-border/70 bg-background/80 text-foreground hover:bg-background",
            disabled && "opacity-50"
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sheetOnMobile={false}
          className="z-[230] w-[min(calc(100vw-2rem),22rem)] rounded-2xl border border-border bg-popover p-0 shadow-xl"
        >
          <Command className="rounded-2xl bg-popover" shouldFilter={false}>
            <CommandInput
              placeholder="Почніть вводити назву…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>
                {query.trim()
                  ? "Нічого не знайдено"
                  : "Введіть назву для пошуку в довіднику"}
              </CommandEmpty>
              <CommandGroup>
                {filtered.map((option) => {
                  const active = option.value === value;
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      data-checked={active || undefined}
                      onSelect={(selectedValue) => {
                        const hit =
                          options.find((o) => o.value === selectedValue) ??
                          options.find(
                            (o) =>
                              o.value.toLowerCase() ===
                              selectedValue.toLowerCase()
                          ) ??
                          option;
                        pickOption(hit.value);
                      }}
                      className="cursor-pointer gap-2 rounded-xl data-[selected=true]:bg-muted"
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          active ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {allowClear && linked ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          onClick={() => onClear?.()}
          className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-red-50 hover:text-red-700"
          title="Відвʼязати"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

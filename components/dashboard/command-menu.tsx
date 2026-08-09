"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fuel,
  Map as MapIcon,
  Search,
  Tractor,
  TrendingUp,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { COMMAND_ITEMS } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const iconMap = {
  map: MapIcon,
  tractor: Tractor,
  chart: TrendingUp,
  fuel: Fuel,
} as const;

type CommandMenuProps = {
  className?: string;
};

/** Глобальний пошук по системі (⌘K / Ctrl+K) */
export function CommandMenu({ className }: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = Array.from(new Set(COMMAND_ITEMS.map((item) => item.group)));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex w-full max-w-md items-center gap-3 rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] px-3.5 py-2.5 text-left shadow-sm",
          "transition-all duration-200 hover:border-[#E5DFD3] hover:bg-[#E5DFD3]/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/30",
          className
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-zinc-500 transition-colors group-hover:text-[#276749]" />
        <span className="flex-1 truncate text-sm text-zinc-500">Пошук...</span>
        <kbd className="hidden items-center gap-0.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Пошук по AgroSystem"
        description="Швидка навігація по полях, техніці та звітах"
        className={cn(
          "overflow-hidden rounded-xl! border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm ring-0 sm:max-w-lg",
          "[&_[data-slot=dialog-close]]:hidden"
        )}
      >
        <Command className="rounded-xl! bg-transparent text-zinc-900 **:[[cmdk-group-heading]]:text-zinc-500">
          <CommandInput
            placeholder="Пошук..."
            className="text-zinc-900 placeholder:text-zinc-500"
          />
          <CommandList className="max-h-80 px-1 pb-2">
            <CommandEmpty className="text-zinc-500">
              Нічого не знайдено
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group} heading={group}>
                {COMMAND_ITEMS.filter((item) => item.group === group).map(
                  (item) => {
                    const Icon = iconMap[item.icon];
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${item.label} ${item.hint}`}
                        onSelect={() => {
                          setOpen(false);
                          router.push(item.href);
                        }}
                        className="cursor-pointer rounded-xl! px-3 py-2.5 data-selected:bg-[#276749]/10 data-selected:text-[#276749]"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#276749]/10 text-[#276749]">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-900">
                            {item.label}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {item.hint}
                          </p>
                        </div>
                      </CommandItem>
                    );
                  }
                )}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

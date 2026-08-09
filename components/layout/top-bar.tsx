"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  ClipboardList,
  Droplets,
  Plus,
  Wallet,
} from "lucide-react";

import { ActivityCenterSheet } from "@/components/dashboard/activity-center-sheet";
import { CommandMenu } from "@/components/dashboard/command-menu";
import { FuelWriteoffDialog } from "@/components/dashboard/fuel-writeoff-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Верхня панель: метал + кераміка */
export function TopBar() {
  const router = useRouter();
  const [activityOpen, setActivityOpen] = useState(false);
  const [fuelDialogOpen, setFuelDialogOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-zinc-100/90 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <CommandMenu className="min-w-[180px] max-w-xl flex-1" />

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-xl bg-[#276749] px-3.5 text-sm font-semibold text-white",
                  "shadow-sm transition-all duration-200",
                  "hover:bg-[#22543d]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276749]/40"
                )}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Швидка дія</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-52 rounded-xl border-[#E5DFD3] bg-[#F4F1EA] p-1.5 text-zinc-900 shadow-lg"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2.5 text-zinc-500">
                    Швидкі операції
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-[#E5DFD3]" />
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 focus:bg-[#E5DFD3] focus:text-zinc-900"
                    onClick={() => setFuelDialogOpen(true)}
                  >
                    <Droplets className="h-4 w-4 text-[#C05621]" />
                    Списати паливо
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 focus:bg-[#E5DFD3] focus:text-zinc-900"
                    onClick={() => router.push("/reports")}
                  >
                    <Wallet className="h-4 w-4 text-[#C05621]" />
                    Додати витрату
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 focus:bg-[#E5DFD3] focus:text-zinc-900"
                    onClick={() => setActivityOpen(true)}
                  >
                    <ClipboardList className="h-4 w-4 text-[#276749]" />
                    Нова задача
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => setActivityOpen(true)}
              aria-label="Центр подій"
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] text-zinc-600",
                "shadow-sm transition-all duration-200 hover:text-zinc-900",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C05621]/30"
              )}
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#C05621]" />
            </button>

            <div className="flex items-center gap-2.5 rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] py-1.5 pr-2 pl-1.5 shadow-sm sm:pl-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-zinc-900">Ігор</p>
                <p className="text-[11px] text-zinc-500">Керівник</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#276749]/25 bg-[#276749]/15 text-xs font-bold text-[#276749]">
                І
              </div>
            </div>
          </div>
        </div>
      </header>

      <ActivityCenterSheet open={activityOpen} onOpenChange={setActivityOpen} />
      <FuelWriteoffDialog
        hideTrigger
        open={fuelDialogOpen}
        onOpenChange={setFuelDialogOpen}
      />
    </>
  );
}

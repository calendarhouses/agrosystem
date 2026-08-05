"use client";

import {
  Banknote,
  Sprout,
  Tractor,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ACTIVITY_FEED,
  type ActivityItem,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const activityIcons = {
  tractor: Tractor,
  banknote: Banknote,
  sprout: Sprout,
} as const;

const accentIconStyles = {
  lime: "bg-[#276749]/10 text-[#276749]",
  amber: "bg-[#D69E2E]/10 text-[#D69E2E]",
  orange: "bg-[#C05621]/10 text-[#C05621]",
} as const;

type ActivityCenterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Центр подій: зміни та сповіщення Telegram */
export function ActivityCenterSheet({
  open,
  onOpenChange,
}: ActivityCenterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm sm:max-w-2xl",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-[#E5DFD3]/40"
        )}
      >
        <SheetHeader className="border-b border-[#E5DFD3] px-6 py-5">
          <SheetTitle className="text-xl font-extrabold tracking-tight text-zinc-900">
            Центр подій
          </SheetTitle>
          <SheetDescription className="text-zinc-500">
            Зміни та сповіщення Telegram
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Активність (Telegram)
                </p>
                <p className="text-xs text-zinc-500">Останні автоматичні події</p>
              </div>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#276749] opacity-40" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#276749]" />
              </span>
            </div>

            <ul className="flex flex-col gap-2.5">
              {ACTIVITY_FEED.map((item: ActivityItem) => {
                const Icon = activityIcons[item.icon];
                return (
                  <li
                    key={item.id}
                    className="flex gap-3 rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5 transition-colors hover:bg-[#E5DFD3]/40"
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        accentIconStyles[item.accent]
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{item.detail}</p>
                      <p className="mt-1 text-[11px] text-zinc-500/80">
                        {item.timeAgo}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

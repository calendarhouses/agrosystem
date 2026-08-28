"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { logoutAction } from "@/app/login/actions";
import { getMyProfileAction } from "@/app/team/actions";
import {
  BOTTOM_NAV_ITEMS,
  isNavItemActive,
  MORE_MENU_ITEMS,
  MORE_NAV_TRIGGER,
} from "@/lib/navigation";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LogOut } from "lucide-react";

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [me, setMe] = useState<AppActor | null>(null);

  useEffect(() => {
    void getMyProfileAction().then(setMe);
  }, []);

  const moreActive = MORE_MENU_ITEMS.some((item) =>
    isNavItemActive(pathname, item.href)
  );

  return (
    <>
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 md:hidden",
          "border-t border-zinc-700/80 bg-zinc-900 text-zinc-400",
          "pb-[env(safe-area-inset-bottom,0px)]"
        )}
        aria-label="Головна навігація"
      >
        <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-1">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors",
                  active
                    ? "text-[#E8A87C]"
                    : "text-zinc-500 active:text-zinc-200"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
                    active && "bg-[#C05621]/20 text-[#E8A87C]"
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                </span>
                <span className="max-w-full truncate text-[10px] font-semibold leading-none">
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            aria-label={MORE_NAV_TRIGGER.label}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors",
              moreActive || moreOpen
                ? "text-[#E8A87C]"
                : "text-zinc-500 active:text-zinc-200"
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
                (moreActive || moreOpen) && "bg-[#C05621]/20 text-[#E8A87C]"
              )}
            >
              <MORE_NAV_TRIGGER.icon
                className="h-5 w-5"
                strokeWidth={moreActive || moreOpen ? 2.25 : 1.75}
              />
            </span>
            <span className="max-w-full truncate text-[10px] font-semibold leading-none">
              {MORE_NAV_TRIGGER.label}
            </span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-zinc-700 bg-zinc-900 px-0 pb-[calc(1rem+env(safe-area-inset-bottom))] text-zinc-100"
        >
          <SheetHeader className="border-b border-zinc-700/80 px-5 pb-4 text-left">
            <SheetTitle className="text-zinc-100">Інші розділи</SheetTitle>
            <SheetDescription className="text-zinc-500">
              Агро-Радар, фінанси, бухгалтерія та профіль
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-1 px-3 py-3">
            {MORE_MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors",
                    active
                      ? "bg-[#C05621]/20 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800"
                  )}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-[#C05621]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {item.hint}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

          {me ? (
            <div className="mx-3 mt-1 rounded-2xl border border-zinc-700/80 bg-zinc-800/50 px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C05621]/35 bg-gradient-to-br from-[#C05621]/30 to-[#9c4221]/20 text-sm font-bold text-[#E8A87C]">
                  {me.fullName.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {me.fullName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {ROLE_LABEL_UK[me.role]}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <form action={logoutAction} className="px-3 pt-2">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800">
                <LogOut className="h-5 w-5" />
              </span>
              Вийти
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

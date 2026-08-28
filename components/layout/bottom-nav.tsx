"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import { getMyProfileAction } from "@/app/team/actions";
import { MobileBottomDrawer } from "@/components/layout/mobile-bottom-drawer";
import {
  BOTTOM_NAV_ITEMS,
  isNavItemActive,
  MORE_MENU_ITEMS,
  MORE_NAV_TRIGGER,
} from "@/lib/navigation";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

function BottomNavBar({
  pathname,
  moreOpen,
  onMoreOpen,
  moreActive,
}: {
  pathname: string;
  moreOpen: boolean;
  onMoreOpen: (open: boolean) => void;
  moreActive: boolean;
}) {
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[100] md:hidden",
        "border-t border-zinc-700/80 bg-zinc-900 text-zinc-400",
          "pb-[max(env(safe-area-inset-bottom),16px)]"
      )}
      aria-label="Головна навігація"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-0.5">
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
                "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 transition-colors",
                active
                  ? "text-[#E8A87C]"
                  : "text-zinc-500 active:text-zinc-200"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
                  active && "bg-[#C05621]/20 text-[#E8A87C]"
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} />
              </span>
              <span className="max-w-full truncate text-[11px] font-semibold leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          aria-label={MORE_NAV_TRIGGER.label}
          aria-expanded={moreOpen}
          onClick={() => onMoreOpen(true)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 transition-colors",
            moreActive || moreOpen
              ? "text-[#E8A87C]"
              : "text-zinc-500 active:text-zinc-200"
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
              (moreActive || moreOpen) && "bg-[#C05621]/20 text-[#E8A87C]"
            )}
          >
            <MORE_NAV_TRIGGER.icon
              className="h-6 w-6"
              strokeWidth={moreActive || moreOpen ? 2.25 : 1.75}
            />
          </span>
          <span className="max-w-full truncate text-[11px] font-semibold leading-none">
            {MORE_NAV_TRIGGER.label}
          </span>
        </button>
      </div>
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [me, setMe] = useState<AppActor | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void getMyProfileAction().then(setMe);
  }, []);

  const moreActive = MORE_MENU_ITEMS.some((item) =>
    isNavItemActive(pathname, item.href)
  );

  const chrome = (
    <>
      <BottomNavBar
        pathname={pathname}
        moreOpen={moreOpen}
        onMoreOpen={setMoreOpen}
        moreActive={moreActive}
      />

      <MobileBottomDrawer open={moreOpen} onOpenChange={setMoreOpen}>
        <div className="border-b border-zinc-800 px-5 pb-4 pt-1 text-left">
          <h2 className="text-lg font-bold text-zinc-50">Інші розділи</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Агро-Радар, фінанси, бухгалтерія та профіль
          </p>
        </div>

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
                    : "text-zinc-300 active:bg-zinc-800"
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
          <div className="mx-3 mt-1 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-3 py-3">
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

        <form action={logoutAction} className="px-3 pb-[max(1rem,max(env(safe-area-inset-bottom),16px))] pt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-zinc-400 transition-colors active:bg-zinc-800 active:text-zinc-100"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800">
              <LogOut className="h-5 w-5" />
            </span>
            Вийти
          </button>
        </form>
      </MobileBottomDrawer>
    </>
  );

  if (!mounted) return null;
  return createPortal(chrome, document.body);
}

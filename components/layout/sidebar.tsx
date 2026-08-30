"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { getMyProfileAction } from "@/app/team/actions";
import { logoutAction } from "@/app/login/actions";
import { MobileBottomDrawer } from "@/components/layout/mobile-bottom-drawer";
import { MobileProfilePanel } from "@/components/layout/mobile-profile-panel";
import { SidebarNavTooltip } from "@/components/layout/sidebar-nav-tooltip";
import { APP_NAV_ITEMS, isNavItemActive, type AppNavItem } from "@/lib/navigation";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

/** Сайдбар Gunmetal Iron зі згортанням (стиль azhunebi-platform) */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const expanded = !collapsed;
  const [me, setMe] = useState<AppActor | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    void getMyProfileAction().then(setMe);
  }, []);

  function renderNavItem(item: AppNavItem) {
    const Icon = item.icon;
    const active = isNavItemActive(pathname, item.href);

    const link = (
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          collapsed ? "justify-center px-0" : "justify-center md:justify-start",
          active
            ? "bg-gradient-to-r from-[#C05621]/25 to-transparent text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-700/30 hover:text-zinc-200"
        )}
      >
        {active && collapsed ? (
          <span
            className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#C05621]"
            aria-hidden
          />
        ) : null}
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-white/10 text-[#C05621]"
              : "text-zinc-500 group-hover:text-zinc-300"
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        {expanded ? (
          <span className="hidden truncate md:inline">{item.label}</span>
        ) : null}
      </Link>
    );

    if (!collapsed) return <div key={item.href}>{link}</div>;

    return (
      <SidebarNavTooltip key={item.href} title={item.label} hint={item.hint}>
        {(handlers) => (
          <span className="block w-full" {...handlers}>
            {link}
          </span>
        )}
      </SidebarNavTooltip>
    );
  }

  const collapseToggle = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={expanded}
      aria-label={collapsed ? "Розгорнути меню" : "Згорнути меню"}
      className={cn(
        "relative flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[10px]",
        "border border-white/[0.06] bg-white/[0.04] px-2.5",
        "text-xs font-semibold text-zinc-400",
        "transition-colors hover:border-white/[0.08] hover:bg-white/[0.08] hover:text-zinc-200",
        collapsed && "justify-center px-0"
      )}
    >
      {collapsed ? (
        <PanelLeftOpen
          className="h-[18px] w-[18px] shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <PanelLeftClose
          className="h-[18px] w-[18px] shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span
        className={cn(
          "truncate transition-opacity duration-200",
          collapsed && "sr-only"
        )}
      >
        {collapsed ? "Розгорнути" : "Згорнути"}
      </span>
    </button>
  );

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col md:flex",
        "border-r border-zinc-700 bg-zinc-800 text-zinc-400",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-[250px]"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-b border-zinc-700",
          "px-2 pt-2 pb-2.5 md:px-2"
        )}
      >
        <div
          className={cn(
            "flex h-14 w-full items-center",
            collapsed ? "justify-center" : "gap-3 px-1"
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#C05621]/40 bg-gradient-to-br from-[#C05621]/25 to-[#9c4221]/40 text-xs font-bold text-[#C05621]">
            LS
          </div>
          {expanded ? (
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-sm font-bold tracking-wide text-zinc-100 uppercase">
                LEVADA
              </p>
            </div>
          ) : null}
        </div>

        <div className="hidden md:block">
          {collapsed ? (
            <SidebarNavTooltip
              title="Розгорнути"
              hint="Показати повне меню"
            >
              {(handlers) => (
                <span className="block w-full" {...handlers}>
                  {collapseToggle}
                </span>
              )}
            </SidebarNavTooltip>
          ) : (
            collapseToggle
          )}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {APP_NAV_ITEMS.map((item) => renderNavItem(item))}
      </nav>

      <div className="shrink-0 border-t border-zinc-700 p-2">
        {me ? (
          collapsed ? (
            <SidebarNavTooltip
              title={me.fullName}
              hint={`${ROLE_LABEL_UK[me.role]} · профіль`}
            >
              {(handlers) => (
                <span className="mb-1.5 block w-full" {...handlers}>
                  <button
                    type="button"
                    onClick={() => setProfileOpen(true)}
                    aria-label="Профіль"
                    className="flex w-full items-center justify-center rounded-xl px-0 py-1.5"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#C05621]/35 bg-gradient-to-br from-[#C05621]/30 to-[#9c4221]/20 text-xs font-bold text-[#E8A87C] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                      {me.fullName.slice(0, 1).toUpperCase()}
                    </span>
                  </button>
                </span>
              )}
            </SidebarNavTooltip>
          ) : (
            <div className="mb-1.5 hidden md:block">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07]",
                  "bg-gradient-to-br from-white/[0.07] to-white/[0.02] px-2.5 py-2.5 text-left",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                  "transition-colors hover:border-white/[0.12] hover:bg-white/[0.08]"
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#C05621]/35 bg-gradient-to-br from-[#C05621]/30 to-[#9c4221]/20 text-xs font-bold text-[#E8A87C]">
                  {me.fullName.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold tracking-tight text-zinc-100">
                    {me.fullName}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {ROLE_LABEL_UK[me.role]} · профіль
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
              </button>
            </div>
          )
        ) : null}
        {collapsed ? (
          <SidebarNavTooltip title="Вийти" hint="Завершити сесію">
            {(handlers) => (
              <span className="block w-full" {...handlers}>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    aria-label="Вийти"
                    className="flex w-full items-center justify-center rounded-lg px-0 py-2.5 text-zinc-400 transition-colors hover:bg-zinc-700/30 hover:text-zinc-100"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg">
                      <LogOut className="h-5 w-5" />
                    </span>
                  </button>
                </form>
              </span>
            )}
          </SidebarNavTooltip>
        ) : (
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-700/30 hover:text-zinc-100"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <LogOut className="h-5 w-5" />
              </span>
              <span className="hidden truncate md:inline">Вийти</span>
            </button>
          </form>
        )}
      </div>

      {me ? (
        <MobileBottomDrawer
          open={profileOpen}
          onOpenChange={setProfileOpen}
          preserveNav={false}
        >
          <MobileProfilePanel
            me={me}
            onBack={() => setProfileOpen(false)}
            onUpdated={setMe}
            backLabel="Закрити"
          />
        </MobileBottomDrawer>
      ) : null}
    </aside>
  );
}

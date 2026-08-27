"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Fuel,
  Link2,
  LogOut,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Settings,
  Sprout,
  Tractor,
  Warehouse,
  Wrench,
} from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import { SidebarNavTooltip } from "@/components/layout/sidebar-nav-tooltip";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Поля",
    hint: "Поля, контури та погода",
    icon: MapIcon,
  },
  {
    href: "/equipment",
    label: "Техніка",
    hint: "Радар автопарку та статуси",
    icon: Tractor,
  },
  {
    href: "/fuel",
    label: "Паливо",
    hint: "Склади та логи списання",
    icon: Fuel,
  },
  {
    href: "/inventory",
    label: "Склад",
    hint: "ЗЗР, врожай, добрива, запчастини",
    icon: Warehouse,
  },
  {
    href: "/finance",
    label: "Фінанси",
    hint: "Витрати та підсумки",
    icon: PieChart,
  },
  {
    href: "/export",
    label: "Бухгалтерія",
    hint: "Excel для бухгалтера · чернетки списань",
    icon: FileSpreadsheet,
  },
  // Детокс: /reports тимчасово сховано — лише OPERATION_RECORDS mock
  // {
  //   href: "/reports",
  //   label: "Операції / Звіти",
  //   hint: "Журнал операцій",
  //   icon: FileText,
  // },
] as const;

const SETTINGS_ITEMS = [
  {
    href: "/admin/equipment",
    label: "Техніка BAS",
    hint: "Синхронізація техніки з 1С",
    icon: Wrench,
  },
  {
    href: "/admin/fields",
    label: "Реєстр полів",
    hint: "Назви й площі для BAS AGRO",
    icon: Sprout,
  },
  {
    href: "/admin/mapping",
    label: "Мапінг 1С",
    hint: "Зіставлення з BAS AGRO",
    icon: Link2,
  },
  {
    href: "/admin/bas-request",
    label: "Звірка полів",
    hint: "Заявка бухгалтеру по довіднику полів 1С",
    icon: FileText,
  },
] as const;

type NavItem = {
  href: string;
  label: string;
  hint: string;
  icon: typeof MapIcon;
};

function isSettingsPath(pathname: string): boolean {
  return SETTINGS_ITEMS.some((item) => pathname.startsWith(item.href));
}

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

/** Сайдбар Gunmetal Iron зі згортанням (стиль azhunebi-platform) */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const expanded = !collapsed;
  const [settingsOpen, setSettingsOpen] = useState(() => isSettingsPath(pathname));

  useEffect(() => {
    if (isSettingsPath(pathname)) {
      setSettingsOpen(true);
    }
  }, [pathname]);

  function renderNavItem(item: NavItem, nested = false) {
    const Icon = item.icon;
    const active =
      item.href === "/"
        ? pathname === "/" || pathname.startsWith("/fields")
        : pathname.startsWith(item.href);

    const link = (
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          collapsed ? "justify-center px-0" : "justify-center md:justify-start",
          nested && !collapsed && "md:pl-9",
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
        "fixed inset-y-0 left-0 z-40 flex flex-col",
        "border-r border-zinc-700 bg-zinc-800 text-zinc-400",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-16 md:w-[250px]"
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
            AS
          </div>
          {expanded ? (
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-sm font-bold tracking-wide text-zinc-100 uppercase">
                AgroSystem
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
        {NAV_ITEMS.map((item) => renderNavItem(item))}

        <div className={cn("mt-4", collapsed && "mt-3")}>
          {collapsed ? (
            <SidebarNavTooltip
              title="Налаштування"
              hint={settingsOpen ? "Згорнути" : "Розгорнути"}
            >
              {(handlers) => (
                <span className="block w-full" {...handlers}>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen((open) => !open)}
                    aria-expanded={settingsOpen}
                    aria-label="Налаштування"
                    className={cn(
                      "group relative flex w-full items-center justify-center rounded-lg px-0 py-2.5 text-sm font-medium transition-all duration-200",
                      isSettingsPath(pathname)
                        ? "bg-gradient-to-r from-[#C05621]/25 to-transparent text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-700/30 hover:text-zinc-200"
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors group-hover:text-zinc-300">
                      <Settings className="h-5 w-5" />
                    </span>
                  </button>
                </span>
              )}
            </SidebarNavTooltip>
          ) : (
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase transition-colors hover:bg-zinc-700/20 hover:text-zinc-300"
              )}
            >
              <Settings className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden flex-1 md:inline">Налаштування</span>
              <ChevronDown
                className={cn(
                  "hidden h-3.5 w-3.5 shrink-0 transition-transform md:inline",
                  settingsOpen && "rotate-180"
                )}
                aria-hidden
              />
            </button>
          )}

          {settingsOpen
            ? SETTINGS_ITEMS.map((item) => renderNavItem(item, true))
            : null}
        </div>
      </nav>

      <div className="shrink-0 border-t border-zinc-700 p-2">
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
    </aside>
  );
}

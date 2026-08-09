"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  Fuel,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Tractor,
  Warehouse,
} from "lucide-react";

import { SidebarNavTooltip } from "@/components/layout/sidebar-nav-tooltip";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Карта Полів",
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
    label: "Склад та Врожай",
    hint: "Залишки та партії",
    icon: Warehouse,
  },
  {
    href: "/finance",
    label: "Фінанси",
    hint: "Витрати та підсумки",
    icon: PieChart,
  },
  {
    href: "/reports",
    label: "Операції / Звіти",
    hint: "Журнал операцій",
    icon: FileText,
  },
] as const;

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

/** Сайдбар Gunmetal Iron зі згортанням (стиль azhunebi-platform) */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const expanded = !collapsed;

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
        {NAV_ITEMS.map((item) => {
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
                collapsed
                  ? "justify-center px-0"
                  : "justify-center md:justify-start",
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
            <SidebarNavTooltip
              key={item.href}
              title={item.label}
              hint={item.hint}
            >
              {(handlers) => (
                <span className="block w-full" {...handlers}>
                  {link}
                </span>
              )}
            </SidebarNavTooltip>
          );
        })}
      </nav>
    </aside>
  );
}

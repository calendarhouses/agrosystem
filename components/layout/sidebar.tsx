"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  Map as MapIcon,
  PieChart,
  Tractor,
  Warehouse,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Карта Полів",
    icon: MapIcon,
  },
  {
    href: "/fleet",
    label: "Техніка та Паливо",
    icon: Tractor,
  },
  {
    href: "/inventory",
    label: "Склад та Врожай",
    icon: Warehouse,
  },
  {
    href: "/finance",
    label: "Фінанси",
    icon: PieChart,
  },
  {
    href: "/reports",
    label: "Операції / Звіти",
    icon: FileText,
  },
] as const;

/** Сайдбар Gunmetal Iron */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col",
        "w-16 md:w-[250px]",
        "border-r border-zinc-700 bg-zinc-800 text-zinc-400"
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-zinc-700 px-3 md:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#C05621]/40 bg-[#C05621]/15 text-xs font-bold text-[#C05621]">
          AS
        </div>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-bold tracking-tight text-zinc-100">
            AgroSystem
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2 md:p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/fields")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                "justify-center md:justify-start",
                active
                  ? "border-l-4 border-[#C05621] bg-zinc-700/50 text-zinc-100"
                  : "border-l-4 border-transparent text-zinc-400 hover:bg-zinc-700/30 hover:text-zinc-200"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-colors",
                  active
                    ? "text-[#C05621]"
                    : "text-zinc-500 group-hover:text-zinc-300"
                )}
              />
              <span className="hidden truncate md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

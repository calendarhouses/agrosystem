import type { LucideIcon } from "lucide-react";
import {
  FileSpreadsheet,
  Fuel,
  Map as MapIcon,
  MoreHorizontal,
  PieChart,
  Radar,
  Tractor,
  Warehouse,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Показувати в нижній панелі на мобільному */
  bottomNav?: boolean;
  /** Показувати в меню «Ще» */
  moreMenu?: boolean;
};

/** Єдине джерело правди для навігації (sidebar + bottom nav). */
export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    href: "/",
    label: "Поля",
    hint: "Поля, контури та погода",
    icon: MapIcon,
    bottomNav: true,
  },
  {
    href: "/calendar",
    label: "Агро-Радар",
    hint: "Вікна можливостей і план робіт",
    icon: Radar,
    moreMenu: true,
  },
  {
    href: "/equipment",
    label: "Техніка",
    hint: "Радар автопарку та статуси",
    icon: Tractor,
    bottomNav: true,
  },
  {
    href: "/fuel",
    label: "Паливо",
    hint: "Склади та логи списання",
    icon: Fuel,
    bottomNav: true,
  },
  {
    href: "/inventory",
    label: "Склад",
    hint: "ЗЗР, врожай, добрива, запчастини",
    icon: Warehouse,
    bottomNav: true,
  },
  {
    href: "/finance",
    label: "Фінанси",
    hint: "Витрати та підсумки",
    icon: PieChart,
    moreMenu: true,
  },
  {
    href: "/accounting",
    label: "Бухгалтерія",
    hint: "Експорт · звірка · мапінг BAS AGRO",
    icon: FileSpreadsheet,
    moreMenu: true,
  },
];

export const BOTTOM_NAV_ITEMS = APP_NAV_ITEMS.filter((item) => item.bottomNav);

export const MORE_MENU_ITEMS = APP_NAV_ITEMS.filter((item) => item.moreMenu);

export const MORE_NAV_TRIGGER: AppNavItem = {
  href: "#more",
  label: "Ще",
  hint: "Інші розділи та профіль",
  icon: MoreHorizontal,
  bottomNav: true,
};

export function isNavItemActive(
  pathname: string | null,
  href: string
): boolean {
  if (!pathname) return false;
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/fields");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

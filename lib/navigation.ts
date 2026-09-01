import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileSpreadsheet,
  Fuel,
  History,
  Map as MapIcon,
  PieChart,
  Tractor,
  User,
  Warehouse,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Показувати в нижній панелі на мобільному */
  bottomNav?: boolean;
  /** Показувати в меню «Ще» / бізнес-dock */
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
    href: "/operations",
    label: "Операції",
    hint: "Хронологія робіт і списань ТМЦ по полях",
    icon: Activity,
    bottomNav: true,
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
  {
    href: "/journal",
    label: "Журнал",
    hint: "Журнал дій",
    icon: History,
    moreMenu: true,
  },
];

export const BOTTOM_NAV_ITEMS = APP_NAV_ITEMS.filter((item) => item.bottomNav);

/** Сторінка 0 каруселі: поля, хронологія, техніка */
export const BOTTOM_NAV_OPS_PRIMARY = BOTTOM_NAV_ITEMS.slice(0, 3);

/** Сторінка 1 каруселі: паливо та склад */
export const BOTTOM_NAV_OPS_SECONDARY = BOTTOM_NAV_ITEMS.slice(3);

export const MORE_MENU_ITEMS = APP_NAV_ITEMS.filter((item) => item.moreMenu);

/** Сторінка 1 sliding dock: Фінанси → Бухгалтерія → Журнал (Профіль окремо) */
export const DOCK_BUSINESS_ITEMS = APP_NAV_ITEMS.filter(
  (item) =>
    item.href === "/finance" ||
    item.href === "/accounting" ||
    item.href === "/journal"
);

export const PROFILE_DOCK_ITEM: AppNavItem = {
  href: "#profile",
  label: "Профіль",
  hint: "Обліковий запис",
  icon: User,
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

export function bottomNavPageForPath(pathname: string | null): 0 | 1 | 2 {
  if (!pathname) return 0;
  if (
    DOCK_BUSINESS_ITEMS.some((item) => isNavItemActive(pathname, item.href))
  ) {
    return 2;
  }
  if (
    BOTTOM_NAV_OPS_SECONDARY.some((item) => isNavItemActive(pathname, item.href))
  ) {
    return 1;
  }
  return 0;
}

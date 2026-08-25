/** Ліва glass-панель Command Center (desktop) */
export const COMMAND_CENTER_PANEL_WIDTH_PX = 400;
/** Права панель деталей поля — хаб, не вузька колонка */
export const COMMAND_CENTER_DETAIL_PANEL_WIDTH_PX = 580;
export const COMMAND_CENTER_PANEL_GAP_PX = 12;

export type CommandCenterPanelSide = "left" | "right" | "none";

/** Full-bleed карта: /equipment і головна «Карта полів» */
export function isCommandCenterPath(pathname: string | null): boolean {
  return pathname === "/" || pathname === "/equipment";
}

/** Tailwind: видима область карти праворуч від лівої панелі */
export const COMMAND_CENTER_MAP_AREA_CLASS =
  "absolute inset-y-0 left-0 right-0 md:left-[calc(0.75rem+min(400px,calc(100%-1.5rem)))]";

/** Видима область карти ліворуч від правої панелі деталей */
export const COMMAND_CENTER_MAP_AREA_RIGHT_CLASS =
  "absolute inset-y-0 left-0 right-0 md:right-[calc(0.75rem+min(580px,calc(100%-1.5rem)))]";

/** Floating chrome над картою, коли відкриті деталі */
export const COMMAND_CENTER_DETAIL_FLOAT_INSET_CLASS =
  "md:right-[calc(0.75rem+min(580px,calc(100%-1.5rem))+12px)]";

export const COMMAND_CENTER_GLASS_PANEL_CLASS =
  "pointer-events-auto absolute top-3 bottom-3 z-20 hidden flex-col overflow-hidden rounded-2xl border border-white/30 bg-background/80 shadow-2xl backdrop-blur-2xl md:flex";

export function commandCenterFitPadding(
  isDesktop: boolean,
  panel: CommandCenterPanelSide = "left"
): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (!isDesktop) {
    return { top: 40, bottom: 200, left: 32, right: 32 };
  }
  if (panel === "right") {
    return {
      top: 50,
      bottom: 80,
      left: 48,
      right:
        COMMAND_CENTER_PANEL_GAP_PX + COMMAND_CENTER_DETAIL_PANEL_WIDTH_PX + 36,
    };
  }
  if (panel === "none") {
    return { top: 50, bottom: 80, left: 48, right: 48 };
  }
  return {
    top: 50,
    bottom: 110,
    left: COMMAND_CENTER_PANEL_GAP_PX + COMMAND_CENTER_PANEL_WIDTH_PX + 36,
    right: 48,
  };
}

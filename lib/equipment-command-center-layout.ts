/** Ліва glass-панель Command Center (desktop) */
export const COMMAND_CENTER_PANEL_WIDTH_PX = 400;
export const COMMAND_CENTER_PANEL_GAP_PX = 12;

/** Tailwind: видима область карти праворуч від панелі */
export const COMMAND_CENTER_MAP_AREA_CLASS =
  "absolute inset-y-0 left-0 right-0 md:left-[calc(0.75rem+min(400px,calc(100%-1.5rem)))]";

export function commandCenterFitPadding(isDesktop: boolean): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (isDesktop) {
    return {
      top: 50,
      bottom: 110,
      left: COMMAND_CENTER_PANEL_GAP_PX + COMMAND_CENTER_PANEL_WIDTH_PX + 36,
      right: 48,
    };
  }
  return { top: 40, bottom: 200, left: 32, right: 32 };
}

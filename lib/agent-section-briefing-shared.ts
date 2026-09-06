/** Client-safe helpers для секційного ефіру (без server-only). */

export const SECTION_IDS = [
  "fields",
  "equipment",
  "fuel",
  "inventory",
  "operations",
  "accounting",
  "finance",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export function pathnameToSection(pathname: string): SectionId | null {
  const p = pathname.split("?")[0] || "/";
  if (p === "/" || p.startsWith("/fields")) return "fields";
  if (p.startsWith("/equipment")) return "equipment";
  if (p.startsWith("/fuel")) return "fuel";
  if (p.startsWith("/inventory")) return "inventory";
  if (p.startsWith("/operations")) return "operations";
  if (p.startsWith("/accounting")) return "accounting";
  if (p.startsWith("/finance")) return "finance";
  return null;
}

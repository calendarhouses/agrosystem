/**
 * «Паспорт поля» — мінімум для операцій: площа > 0 і культура.
 */

export type FieldPassportLike = {
  areaHa?: number | null;
  crop?: string | null;
};

/** Культура з паспорта вважається заповненою. */
export function hasFieldCrop(crop: string | null | undefined): boolean {
  const value = (crop ?? "").trim();
  if (!value) return false;
  if (value === "—" || value === "-" || value.toLowerCase() === "n/a") {
    return false;
  }
  return true;
}

export function hasFieldArea(areaHa: number | null | undefined): boolean {
  const n = Number(areaHa);
  return Number.isFinite(n) && n > 0;
}

/** Повне заповнення паспорта для списань / нарядів. */
export function isFieldPassportComplete(
  field: FieldPassportLike | null | undefined
): boolean {
  if (!field) return false;
  return hasFieldArea(field.areaHa) && hasFieldCrop(field.crop);
}

export const FIELD_PASSPORT_BLOCKED_MESSAGE =
  "⚠️ Операція заблокована. У цього поля не заповнений паспорт (не вказана площа або культура).";

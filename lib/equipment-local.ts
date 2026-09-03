/** Типи самохідної техніки для форми «Додати нову». */
export const LOCAL_EQUIPMENT_TYPE_OPTIONS = [
  { id: "tractor", label: "Трактор" },
  { id: "combine", label: "Комбайн" },
  { id: "sprayer", label: "Оприскувач" },
  { id: "loader", label: "Навантажувач" },
  { id: "truck", label: "Вантажівка / бензовоз" },
  { id: "car", label: "Автомобіль" },
  { id: "other", label: "Інше" },
] as const;

export type LocalEquipmentType =
  (typeof LOCAL_EQUIPMENT_TYPE_OPTIONS)[number]["id"];

/** Куди відноситься техніка для BAS / бухгалтера */
export const EQUIPMENT_WORK_SCOPE_OPTIONS = [
  { id: "field", label: "Поля" },
  { id: "base", label: "База" },
] as const;

export type EquipmentWorkScope =
  (typeof EQUIPMENT_WORK_SCOPE_OPTIONS)[number]["id"];

export function equipmentWorkScopeLabel(
  scope: string | null | undefined
): string | null {
  if (scope === "field") return "Поля";
  if (scope === "base") return "База";
  return null;
}

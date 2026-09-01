/**
 * Категорії списку ділянок на карті: Поля · Городи · Бази.
 */

export type FieldListCategoryId = "fields" | "gardens" | "bases";

export type FieldListCategory = {
  id: FieldListCategoryId;
  label: string;
  description: string;
  accent: string;
};

export const FIELD_LIST_CATEGORIES: FieldListCategory[] = [
  {
    id: "fields",
    label: "Поля",
    description: "Усі польові ділянки",
    accent: "#276749",
  },
  {
    id: "gardens",
    label: "Городи",
    description: "3 городи господарства",
    accent: "#D69E2E",
  },
  {
    id: "bases",
    label: "Бази",
    description: "База · Левада · Кафе",
    accent: "#64748B",
  },
];

/** Визначає категорію ділянки за назвою (Wialon або паспорт). */
export function fieldListCategory(name: string): FieldListCategoryId {
  const lower = name.trim().toLowerCase();

  if (/^город/.test(lower)) return "gardens";

  if (
    lower.includes("база") ||
    /\bлевада\b/.test(lower) ||
    lower.includes("кафе") ||
    lower.includes("магазин") ||
    lower.includes("чайна")
  ) {
    return "bases";
  }

  return "fields";
}

export function groupFieldsByListCategory<T extends { name: string }>(
  items: T[]
): Array<FieldListCategory & { items: T[] }> {
  const buckets: Record<FieldListCategoryId, T[]> = {
    fields: [],
    gardens: [],
    bases: [],
  };

  for (const item of items) {
    buckets[fieldListCategory(item.name)].push(item);
  }

  return FIELD_LIST_CATEGORIES.map((category) => ({
    ...category,
    items: buckets[category.id],
  })).filter((group) => group.items.length > 0);
}

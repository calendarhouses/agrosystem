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
    description: "База · Левада · магазин",
    accent: "#64748B",
  },
];

export type FieldListCategoryInput = {
  name: string;
  canonicalName?: string | null;
  isField?: boolean | null;
};

function nameHints(input: FieldListCategoryInput): string[] {
  return [input.canonicalName, input.name]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

function isGardenName(lower: string): boolean {
  return /^город/.test(lower);
}

function isBaseName(lower: string): boolean {
  return (
    lower.includes("база") ||
    /\bлевада\b/.test(lower) ||
    lower.includes("кафе") ||
    lower.includes("магазин") ||
    lower.includes("чайна")
  );
}

/** Визначає категорію ділянки за паспортом / назвою Wialon. */
export function resolveFieldListCategory(
  input: FieldListCategoryInput
): FieldListCategoryId {
  const hints = nameHints(input);

  if (input.isField === false) {
    if (hints.some(isGardenName)) return "gardens";
    return "bases";
  }

  for (const lower of hints) {
    if (isGardenName(lower)) return "gardens";
    if (isBaseName(lower)) return "bases";
  }

  return "fields";
}

/** @deprecated Використовуйте resolveFieldListCategory */
export function fieldListCategory(name: string): FieldListCategoryId {
  return resolveFieldListCategory({ name });
}

export function groupFieldsByListCategory<
  T extends FieldListCategoryInput,
>(items: T[]): Array<FieldListCategory & { items: T[] }> {
  const buckets: Record<FieldListCategoryId, T[]> = {
    fields: [],
    gardens: [],
    bases: [],
  };

  for (const item of items) {
    buckets[resolveFieldListCategory(item)].push(item);
  }

  return FIELD_LIST_CATEGORIES.map((category) => ({
    ...category,
    items: buckets[category.id],
  })).filter((group) => group.items.length > 0);
}

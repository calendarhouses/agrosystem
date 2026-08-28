import type {
  BasField,
  BasMachinery,
  BasNomenclature,
  BasStorage,
} from "@/lib/bas-api";

export const UNMAPPED_VALUE = "__none__";

export type BasSelectOption = {
  value: string;
  label: string;
  /** Текст для авто-мапінгу */
  matchText?: string;
  areaHa?: number | null;
  /** Номер поля з BAS AGRO: "6", "1.1", "10.1" */
  fieldNumberKey?: string | null;
};

export type MappingLocalRow = {
  id: string;
  title: string;
  subtitle?: string | null;
  basRefKey: string | null;
  areaHa?: number | null;
  /** Номер поля з Wialon / Supabase: "6", "1.1" */
  fieldNumberKey?: string | null;
  /** Для ТМЦ — локальна позиція без реального ключа BAS AGRO */
  isLocal?: boolean;
};

export type BasMappingTable =
  | "fuel_storages"
  | "farm_fields"
  | "wialon_bas_mapping"
  | "inventory_items_cache";

export type MappingCatalogKind = "tmc" | "machinery" | "storages" | "fields";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** Нормалізує Ref_Key з 1C до UUID або null */
export function normalizeBasRefKey(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;

  const wrapped = /^guid'([^']+)'$/i.exec(value);
  if (wrapped?.[1]) value = wrapped[1].trim();

  if (value.toLowerCase() === EMPTY_GUID) return null;
  if (!UUID_RE.test(value)) return null;
  return value.toLowerCase();
}

function sortByLabel(options: BasSelectOption[]): BasSelectOption[] {
  return [...options].sort((a, b) =>
    a.label.localeCompare(b.label, "uk", { sensitivity: "base" })
  );
}

function toOption(
  refKey: string | null | undefined,
  label: string
): BasSelectOption | null {
  const value = normalizeBasRefKey(refKey);
  if (!value) return null;
  const trimmed = label.trim();
  return {
    value,
    label: trimmed || value,
  };
}

export function storagesToOptions(items: BasStorage[]): BasSelectOption[] {
  return sortByLabel(
    items.flatMap((item) => {
      const name = nonEmpty(item.Description) ?? "Без назви";
      const folder = nonEmpty(item.folderName);
      const option = toOption(
        item.Ref_Key,
        folder ? `${name} · ${folder}` : name
      );
      return option ? [option] : [];
    })
  );
}

export function fieldsToOptions(items: BasField[]): BasSelectOption[] {
  return sortByLabel(
    items.flatMap((item) => {
      const option = toOption(item.Ref_Key, formatFieldLabel(item));
      if (!option) return [];
      option.matchText = fieldMatchText(item);
      option.areaHa = basFieldAreaHa(item);
      option.fieldNumberKey = basFieldNumberKey(item);
      return [option];
    })
  );
}

export function basFieldAreaHa(item: BasField): number | null {
  const area = item.ИНАГРО_Площадь;
  if (area != null && Number.isFinite(Number(area)) && Number(area) > 0) {
    return Number(Number(area).toFixed(2));
  }
  return null;
}

export function basFieldNumberKey(item: BasField): string | null {
  const fromProp = normalizeFieldNumberKey(item.ИНАГРО_НомерПоля);
  if (fromProp) return fromProp;
  return extractFieldNumberKey(item.Description ?? "");
}

export function formatFieldLabel(item: BasField): string {
  const name = nonEmpty(item.Description) ?? "Без назви";
  const extras: string[] = [];
  const num = basFieldNumberKey(item);
  const area = basFieldAreaHa(item);
  if (num) extras.push(`№${num}`);
  if (area != null) extras.push(`${area.toLocaleString("uk-UA")} га`);
  return extras.length ? `${name} (${extras.join(" | ")})` : name;
}

export function fieldMatchText(item: BasField): string {
  return [item.Description, item.ИНАГРО_НомерПоля, item.Code]
    .map((part) => nonEmpty(part))
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

export function normalizeFieldNumberKey(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const value = raw.trim().replace(",", ".");
  if (!value || value === "Загалом") return null;
  return value;
}

/** Номер поля з назви Wialon: «Поле №6 246,4 га» → "6", «Поле 1.1» → "1.1" */
export function extractFieldNumberKey(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const labeled = trimmed.match(
    /(?:поле|поля|участок|ділянка|уч\.?)\s*№?\s*([\d]+(?:[.,]\d+)?)/iu
  );
  if (labeled?.[1]) {
    return labeled[1].replace(",", ".");
  }

  const plain = trimmed.match(/^([\d]+(?:[.,]\d+)?)\s*$/);
  if (plain?.[1]) {
    return plain[1].replace(",", ".");
  }

  return null;
}

/** @deprecated використовуйте extractFieldNumberKey */
export function extractFieldNumber(name: string): number | null {
  const key = extractFieldNumberKey(name);
  if (!key) return null;
  const parsed = Number(key);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function areasClose(
  a: number,
  b: number,
  toleranceRatio = 0.08,
  minToleranceHa = 1.5
): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff <= minToleranceHa || diff / Math.max(a, b) <= toleranceRatio;
}

export function suggestFieldRefKey(
  row: MappingLocalRow,
  options: BasSelectOption[],
  takenRefKeys: Set<string>
): string | null {
  const candidates = options.filter(
    (option) =>
      option.value !== UNMAPPED_VALUE && !takenRefKeys.has(option.value)
  );
  if (candidates.length === 0) return null;

  const wialonArea = row.areaHa ?? null;
  const fieldKey =
    row.fieldNumberKey ?? extractFieldNumberKey(row.title);

  if (fieldKey) {
    const byNumber = candidates.filter(
      (option) => option.fieldNumberKey === fieldKey
    );
    if (byNumber.length === 1) return byNumber[0].value;
    if (byNumber.length > 1 && wialonArea != null) {
      const byNumberAndArea = byNumber.filter(
        (option) =>
          option.areaHa != null && areasClose(wialonArea, option.areaHa)
      );
      if (byNumberAndArea.length === 1) return byNumberAndArea[0].value;
    }
  }

  if (wialonArea != null) {
    const byArea = candidates.filter(
      (option) => option.areaHa != null && areasClose(wialonArea, option.areaHa)
    );
    if (byArea.length === 1) return byArea[0].value;
    if (byArea.length > 1 && fieldKey) {
      const refined = byArea.filter(
        (option) => option.fieldNumberKey === fieldKey
      );
      if (refined.length === 1) return refined[0].value;
    }
  }

  const normTitle = normalizeFieldName(row.title);
  if (normTitle) {
    const byName = candidates.filter((option) => {
      const base = option.label.split("(")[0] ?? option.label;
      const normLabel = normalizeFieldName(base);
      return normLabel === normTitle;
    });
    if (byName.length === 1) return byName[0].value;
  }

  return null;
}

export function autoMapFieldRows(
  rows: MappingLocalRow[],
  options: BasSelectOption[],
  currentValues: Record<string, string>
): Record<string, string> {
  const taken = new Set<string>();
  for (const row of rows) {
    const current = currentValues[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) taken.add(current);
  }

  const next = { ...currentValues };
  for (const row of rows) {
    const current = next[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) continue;

    const suggested = suggestFieldRefKey(row, options, taken);
    if (!suggested) continue;
    next[row.id] = suggested;
    taken.add(suggested);
  }
  return next;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function formatMachineryLabel(item: BasMachinery): string {
  const name = nonEmpty(item.Description) ?? nonEmpty(item.НаименованиеПолное) ?? "Без назви";
  const extras: string[] = [];
  const code = nonEmpty(item.Code);
  const passport = nonEmpty(item.НомерПаспорта);
  if (code) extras.push(`Код: ${code}`);
  if (passport) extras.push(`Паспорт: ${passport}`);
  return extras.length ? `${name} (${extras.join(" | ")})` : name;
}

export function machineryMatchText(item: BasMachinery): string {
  return [
    item.Code,
    item.НаименованиеПолное,
    item.НомерПаспорта,
    item.ЗаводскойНомер,
  ]
    .map((part) => nonEmpty(part))
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

export function machineryToOptions(items: BasMachinery[]): BasSelectOption[] {
  return sortByLabel(
    items.flatMap((item) => {
      const option = toOption(item.Ref_Key, formatMachineryLabel(item));
      if (!option) return [];
      option.matchText = machineryMatchText(item);
      return [option];
    })
  );
}

/** Цифри з назви Wialon: `Case Magnum 340 11644 AI` → `["11644"]` (від 4 знаків). */
export function extractWialonNumbers(name: string): string[] {
  const found = name.match(/\d+/g) ?? [];
  const longEnough = found.filter((token) => token.length >= 4);
  return [...new Set(longEnough)].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );
}

function optionMatchesNumber(option: BasSelectOption, digits: string): boolean {
  const haystack = option.matchText ?? "";
  if (!haystack || !digits) return false;
  if (haystack.includes(digits)) return true;
  return haystack.replace(/\D/g, "").includes(digits);
}

function isExactInventoryMatch(option: BasSelectOption, digits: string): boolean {
  const parts = (option.matchText ?? "").split("\n");
  return parts.some((part) => {
    const onlyDigits = part.replace(/\D/g, "").replace(/^0+/, "") || "0";
    const needle = digits.replace(/^0+/, "") || "0";
    return onlyDigits === needle;
  });
}

/** Підказка Ref_Key ОС для незіставленого юніта Wialon, або null якщо неоднозначно. */
export function suggestMachineryRefKey(
  wialonName: string,
  options: BasSelectOption[],
  takenRefKeys: Set<string>
): string | null {
  const numbers = extractWialonNumbers(wialonName);
  if (numbers.length === 0) return null;

  for (const digits of numbers) {
    const hits = options.filter((option) => {
      if (option.value === UNMAPPED_VALUE) return false;
      if (takenRefKeys.has(option.value)) return false;
      return optionMatchesNumber(option, digits);
    });

    if (hits.length === 1) return hits[0].value;
    if (hits.length > 1) {
      const exact = hits.filter((option) =>
        isExactInventoryMatch(option, digits)
      );
      if (exact.length === 1) return exact[0].value;
    }
  }

  return null;
}

export function autoMapMachineryRows(
  rows: MappingLocalRow[],
  options: BasSelectOption[],
  currentValues: Record<string, string>
): Record<string, string> {
  const taken = new Set<string>();
  for (const row of rows) {
    const current = currentValues[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) taken.add(current);
  }

  const next = { ...currentValues };
  for (const row of rows) {
    const current = next[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) continue;

    const suggested = suggestMachineryRefKey(row.title, options, taken);
    if (!suggested) continue;
    next[row.id] = suggested;
    taken.add(suggested);
  }
  return next;
}

export function withUnmappedOption(
  options: BasSelectOption[]
): BasSelectOption[] {
  return [{ value: UNMAPPED_VALUE, label: "Не зіставлено" }, ...options];
}

export function normalizeMatchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nomenclatureToOptions(
  items: BasNomenclature[]
): BasSelectOption[] {
  return sortByLabel(
    items.flatMap((item) => {
      if (item.IsFolder || item.DeletionMark) return [];
      const name = nonEmpty(item.Description) ?? "Без назви";
      const code = nonEmpty(item.Code);
      const option = toOption(
        item.Ref_Key,
        code ? `${name} · ${code}` : name
      );
      if (!option) return [];
      option.matchText = [item.Description, item.Code]
        .map((p) => nonEmpty(p))
        .filter((p): p is string => Boolean(p))
        .join("\n");
      return [option];
    })
  );
}

/**
 * 100% збіг назв (нормалізованих) між AgroSystem і BAS AGRO.
 * Не чіпає вже зіставлені рядки; один Ref_Key — максимум один рядок.
 */
export function autoMapByExactName(
  rows: MappingLocalRow[],
  options: BasSelectOption[],
  currentValues: Record<string, string>
): { next: Record<string, string>; filled: number } {
  const taken = new Set<string>();
  for (const row of rows) {
    const current = currentValues[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) taken.add(current);
  }

  const byName = new Map<string, BasSelectOption[]>();
  for (const option of options) {
    if (option.value === UNMAPPED_VALUE) continue;
    const base = (option.label.split("·")[0] ?? option.label).split("(")[0] ?? option.label;
    const key = normalizeMatchName(base);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(option);
    byName.set(key, list);
  }

  const next = { ...currentValues };
  let filled = 0;
  for (const row of rows) {
    const current = next[row.id] ?? row.basRefKey ?? UNMAPPED_VALUE;
    if (current && current !== UNMAPPED_VALUE) continue;

    const key = normalizeMatchName(row.title);
    if (!key) continue;
    const hits = (byName.get(key) ?? []).filter((o) => !taken.has(o.value));
    if (hits.length !== 1) continue;
    next[row.id] = hits[0].value;
    taken.add(hits[0].value);
    filled += 1;
  }
  return { next, filled };
}

import type { BasField } from "@/lib/bas-api";
import { basFieldAreaHa, basFieldNumberKey } from "@/lib/bas-mapping";
import type { BasFieldRef, RegistryInputRow } from "@/lib/bas-field-names";

/**
 * Стан заявки бухгалтеру по цьому полю. Лежить у `farm_fields.bas_sync_status`:
 * `none` — заявка ще не передана, `pending` — передана на розгляд,
 * `synced` — бухгалтер завів або виправив запис у BAS AGRO, `error` — відхилив
 * (причина в `bas_sync_error`). У самій BAS ми при цьому нічого не міняємо.
 */
export type BasRequestStatus = "none" | "pending" | "synced" | "error";

export type FieldRegistryRow = {
  id: string;
  /** Назва як вона приходить з Wialon */
  wialonName: string;
  wialonZoneId: string | null;
  areaHa: number | null;
  canonicalName: string;
  fieldNo: string;
  tract: string;
  isField: boolean;
  basRefKey: string | null;
  requestStatus: BasRequestStatus;
  requestedAt: string | null;
  requestNote: string | null;
};

export type BasFieldSummary = {
  refKey: string;
  description: string;
  code: string | null;
  fieldNo: string | null;
  areaHa: number | null;
};

export function basFieldsToSummaries(items: BasField[]): BasFieldSummary[] {
  return items
    .filter((item) => item.Ref_Key)
    .map((item) => ({
      refKey: String(item.Ref_Key).toLowerCase(),
      description: item.Description?.trim() ?? "",
      code: item.Code?.trim() || null,
      fieldNo: basFieldNumberKey(item),
      areaHa: basFieldAreaHa(item),
    }))
    .sort((a, b) => a.description.localeCompare(b.description, "uk"));
}

export function toBasFieldRefs(items: BasFieldSummary[]): BasFieldRef[] {
  return items.map((item) => ({
    refKey: item.refKey,
    description: item.description,
    fieldNo: item.fieldNo,
    areaHa: item.areaHa,
  }));
}

export function toRegistryInputRows(
  rows: FieldRegistryRow[]
): RegistryInputRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.wialonName,
    areaHa: row.areaHa,
  }));
}

export type RegistryIssue = "no-name" | "duplicate-name" | "no-area";

/** Чого бракує рядку, щоб вважатися готовим паспортом поля. */
export function registryIssue(
  row: FieldRegistryRow,
  nameCounts: Map<string, number>
): RegistryIssue | null {
  if (!row.isField) return null;

  const name = row.canonicalName.trim();
  if (!name) return "no-name";
  if ((nameCounts.get(name.toLowerCase()) ?? 0) > 1) return "duplicate-name";
  if (row.areaHa == null || row.areaHa <= 0) return "no-area";

  return null;
}

export function canonicalNameCounts(
  rows: FieldRegistryRow[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.isField) continue;
    const key = row.canonicalName.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function describeIssue(issue: RegistryIssue): string {
  switch (issue) {
    case "no-name":
      return "Порожня канонічна назва";
    case "duplicate-name":
      return "Така назва вже є в іншого рядка";
    case "no-area":
      return "Невідома площа";
  }
}

/** Наші поля, яких немає в довіднику BAS AGRO — саме під них потрібні чернетки. */
export function fieldsMissingInBas(
  rows: FieldRegistryRow[]
): FieldRegistryRow[] {
  return rows.filter((row) => row.isField && !row.basRefKey);
}

export type MergedBasRecord = {
  basField: BasFieldSummary;
  rows: FieldRegistryRow[];
  ourAreaHa: number;
};

/**
 * Записи BAS AGRO, на які вказує кілька наших полів. У BAS AGRO такі поля обліковуються
 * однією назвою зі спільними гектарами, хоча в Wialon вони обміряні окремо.
 * Поки бухгалтер не розділить запис, гектари з чернеток лягатимуть на нього
 * сумарно — тому агроном має бачити ці випадки явно.
 */
export function mergedBasRecords(
  rows: FieldRegistryRow[],
  basFields: BasFieldSummary[]
): MergedBasRecord[] {
  const byRef = new Map<string, FieldRegistryRow[]>();
  for (const row of rows) {
    if (!row.isField || !row.basRefKey) continue;
    const key = row.basRefKey.toLowerCase();
    const bucket = byRef.get(key);
    if (bucket) bucket.push(row);
    else byRef.set(key, [row]);
  }

  const basByRef = new Map(basFields.map((field) => [field.refKey, field]));

  return [...byRef.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([refKey, group]) => {
      const basField = basByRef.get(refKey);
      return {
        basField: basField ?? {
          refKey,
          description: "Невідомий запис BAS AGRO",
          code: null,
          fieldNo: null,
          areaHa: null,
        },
        rows: [...group].sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0)),
        ourAreaHa: group.reduce((sum, row) => sum + (row.areaHa ?? 0), 0),
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length);
}

export type RelinkChange = {
  row: FieldRegistryRow;
  from: BasFieldSummary | null;
  to: BasFieldSummary;
};

/**
 * Наскільки площі можуть розійтися, щоб збіг назви ще вважався тим самим полем.
 * Бухгалтер вносить наші ж гектари, тож розбіжність має бути мізерна; великий
 * розрив означає різні ділянки з однаковою назвою (як «Поле 13.2» на 105 га
 * в BAS AGRO проти нашого на 56.63 га).
 */
const RELINK_AREA_TOLERANCE = 0.25;

function areasPlausible(
  ourAreaHa: number | null,
  basAreaHa: number | null
): boolean {
  if (ourAreaHa == null || basAreaHa == null) return true;
  if (ourAreaHa <= 0 || basAreaHa <= 0) return true;
  return Math.abs(ourAreaHa - basAreaHa) / basAreaHa <= RELINK_AREA_TOLERANCE;
}

/**
 * Перезв'язування після того, як бухгалтер відпрацював заявку.
 *
 * Він заводить і розділяє поля під нашими ж канонічними назвами, тому після
 * його робіт назви в обох системах збігаються буквально — цього досить, щоб
 * підтягнути нові `Ref_Key` без ручного вибору. Звичайний авто-мапінг тут не
 * допомагає: він чіпає лише незв'язані рядки, а частини розділеного запису
 * висять на старому.
 */
export function relinkByExactName(
  rows: FieldRegistryRow[],
  basFields: BasFieldSummary[]
): RelinkChange[] {
  const seen = new Map<string, BasFieldSummary | null>();
  for (const field of basFields) {
    const key = field.description.trim().toLowerCase();
    if (!key) continue;
    // Назва, що трапилась двічі, нічого не доводить — такі пропускаємо.
    seen.set(key, seen.has(key) ? null : field);
  }

  const basByRef = new Map(basFields.map((field) => [field.refKey, field]));
  const changes: RelinkChange[] = [];

  for (const row of rows) {
    if (!row.isField) continue;
    const key = row.canonicalName.trim().toLowerCase();
    if (!key) continue;

    const target = seen.get(key);
    if (!target) continue;
    if (!areasPlausible(row.areaHa, target.areaHa)) continue;

    const current = row.basRefKey?.toLowerCase() ?? null;
    if (current === target.refKey) continue;

    changes.push({
      row,
      from: current ? (basByRef.get(current) ?? null) : null,
      to: target,
    });
  }

  return changes;
}

/** Поля BAS AGRO, на які не вказує жоден наш рядок. */
export function unmatchedBasFields(
  rows: FieldRegistryRow[],
  basFields: BasFieldSummary[]
): BasFieldSummary[] {
  const linked = new Set(
    rows
      .map((row) => row.basRefKey?.toLowerCase())
      .filter((value): value is string => Boolean(value))
  );
  return basFields.filter((field) => !linked.has(field.refKey));
}

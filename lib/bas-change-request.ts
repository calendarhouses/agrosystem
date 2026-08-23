import type {
  BasFieldSummary,
  BasRequestStatus,
  FieldRegistryRow,
} from "@/lib/field-registry";

/**
 * Заявка бухгалтеру: що саме треба доробити в 1С, щоб довідник збігся з
 * реальністю. Ми нічого не пишемо в BAS — це перелік на його підтвердження.
 *
 * Все виводиться з реєстру, окремої таблиці немає: статус кожної позиції
 * лежить у `bas_sync_status` тих полів, яких вона стосується.
 */

/** Площа розходиться настільки, що це вже не похибка обміру. */
const AREA_TOLERANCE_PCT = 5;
const AREA_TOLERANCE_HA = 1;

export type ChangeKind = "create" | "split" | "area";

export type CreateItem = {
  kind: "create";
  key: string;
  rows: FieldRegistryRow[];
  areaHa: number;
};

export type SplitItem = {
  kind: "split";
  key: string;
  basField: BasFieldSummary;
  rows: FieldRegistryRow[];
  areaHa: number;
};

export type AreaItem = {
  kind: "area";
  key: string;
  basField: BasFieldSummary;
  rows: FieldRegistryRow[];
  areaHa: number;
  deltaHa: number;
  deltaPct: number;
};

export type ChangeItem = CreateItem | SplitItem | AreaItem;

export type BasChangeRequest = {
  create: CreateItem[];
  split: SplitItem[];
  area: AreaItem[];
};

function sumArea(rows: FieldRegistryRow[]): number {
  return rows.reduce((sum, row) => sum + (row.areaHa ?? 0), 0);
}

function byAreaDesc(a: FieldRegistryRow, b: FieldRegistryRow): number {
  return (b.areaHa ?? 0) - (a.areaHa ?? 0);
}

export function buildBasChangeRequest(
  rows: FieldRegistryRow[],
  basFields: BasFieldSummary[]
): BasChangeRequest {
  const fields = rows.filter((row) => row.isField);
  const basByRef = new Map(basFields.map((field) => [field.refKey, field]));

  const create: CreateItem[] = fields
    .filter((row) => !row.basRefKey)
    .sort(byAreaDesc)
    .map((row) => ({
      kind: "create",
      key: `create:${row.id}`,
      rows: [row],
      areaHa: row.areaHa ?? 0,
    }));

  const grouped = new Map<string, FieldRegistryRow[]>();
  for (const row of fields) {
    if (!row.basRefKey) continue;
    const key = row.basRefKey.toLowerCase();
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const split: SplitItem[] = [];
  const area: AreaItem[] = [];

  for (const [refKey, group] of grouped) {
    const basField = basByRef.get(refKey);
    if (!basField) continue;

    const members = [...group].sort(byAreaDesc);
    const areaHa = sumArea(members);

    if (members.length > 1) {
      split.push({
        kind: "split",
        key: `split:${refKey}`,
        basField,
        rows: members,
        areaHa,
      });
      continue;
    }

    if (basField.areaHa == null || basField.areaHa <= 0) continue;
    const deltaHa = areaHa - basField.areaHa;
    const deltaPct = (deltaHa / basField.areaHa) * 100;
    if (
      Math.abs(deltaHa) >= AREA_TOLERANCE_HA &&
      Math.abs(deltaPct) >= AREA_TOLERANCE_PCT
    ) {
      area.push({
        kind: "area",
        key: `area:${refKey}`,
        basField,
        rows: members,
        areaHa,
        deltaHa,
        deltaPct,
      });
    }
  }

  split.sort((a, b) => b.rows.length - a.rows.length || b.areaHa - a.areaHa);
  area.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  return { create, split, area };
}

export function allChangeItems(request: BasChangeRequest): ChangeItem[] {
  return [...request.create, ...request.split, ...request.area];
}

/**
 * Запис 1С без нашого поля, назва якого збігається з уже зайнятою в нас.
 * Такий збіг найнебезпечніший: бухгалтер і агроном говорять «Поле 13.2», маючи
 * на увазі різні ділянки.
 */
export type OrphanCollision = {
  basField: BasFieldSummary;
  ourRow: FieldRegistryRow;
};

export function orphanCollisions(
  rows: FieldRegistryRow[],
  orphans: BasFieldSummary[]
): OrphanCollision[] {
  const byName = new Map<string, FieldRegistryRow>();
  for (const row of rows) {
    if (!row.isField) continue;
    const key = row.canonicalName.trim().toLowerCase();
    if (key) byName.set(key, row);
  }

  return orphans.flatMap((basField) => {
    const ourRow = byName.get(basField.description.trim().toLowerCase());
    return ourRow ? [{ basField, ourRow }] : [];
  });
}

/**
 * Статус позиції — найменш просунутий серед її полів: поки хоч одне поле
 * не оброблене, вся позиція вважається необробленою.
 */
const STATUS_ORDER: BasRequestStatus[] = ["none", "pending", "error", "synced"];

export function itemStatus(item: ChangeItem): BasRequestStatus {
  let worst: BasRequestStatus = "synced";
  for (const row of item.rows) {
    if (STATUS_ORDER.indexOf(row.requestStatus) < STATUS_ORDER.indexOf(worst)) {
      worst = row.requestStatus;
    }
  }
  return worst;
}

export function describeStatus(status: BasRequestStatus): string {
  switch (status) {
    case "none":
      return "Не передано";
    case "pending":
      return "У бухгалтера";
    case "synced":
      return "Заведено в 1С";
    case "error":
      return "Відхилено";
  }
}

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});

const ha = (value: number) => `${numberFormat.format(value)} га`;

function rowLabel(row: FieldRegistryRow): string {
  const name = row.canonicalName.trim() || row.wialonName.trim();
  const tract = row.tract.trim();
  return tract && !name.includes(tract) ? `${name} (${tract})` : name;
}

/** Один рядок заявки простою мовою — для тексту й для CSV. */
export function describeItem(item: ChangeItem): string {
  switch (item.kind) {
    case "create":
      return `Завести поле «${rowLabel(item.rows[0])}» на ${ha(item.areaHa)}`;
    case "split": {
      const parts = item.rows
        .map((row) => `«${rowLabel(row)}» ${ha(row.areaHa ?? 0)}`)
        .join(", ");
      const basArea = item.basField.areaHa;
      const head =
        basArea != null
          ? `Розділити «${item.basField.description}» (${ha(basArea)}) на ${item.rows.length}`
          : `Розділити «${item.basField.description}» на ${item.rows.length}`;
      // Сума частин майже ніколи не дорівнює тому, що записано в 1С —
      // бухгалтеру треба бачити підсумок, а не тільки перелік.
      const tail =
        basArea != null && Math.abs(item.areaHa - basArea) >= AREA_TOLERANCE_HA
          ? `. Разом ${ha(item.areaHa)} замість ${ha(basArea)}`
          : "";
      return `${head}: ${parts}${tail}`;
    }
    case "area":
      return `Уточнити площу «${item.basField.description}»: ${ha(
        item.basField.areaHa ?? 0
      )} → ${ha(item.areaHa)} (${item.deltaHa > 0 ? "+" : ""}${numberFormat.format(
        item.deltaHa
      )})`;
  }
}

const SECTION_TITLES: Record<ChangeKind, string> = {
  create: "Завести нові поля",
  split: "Розділити злиті записи",
  area: "Уточнити площі",
};

export function requestToText(
  request: BasChangeRequest,
  generatedAt = new Date()
): string {
  const date = generatedAt.toLocaleDateString("uk-UA");
  const lines: string[] = [
    `Заявка на оновлення довідника полів у BAS AGRO від ${date}`,
    "",
    "Джерело даних — обміряні геозони Wialon. Площі вважаємо фактичними.",
    "Зміни в 1С вносить бухгалтер; наша система нічого там не змінює.",
  ];

  for (const kind of ["create", "split", "area"] as const) {
    const items: ChangeItem[] = request[kind];
    if (items.length === 0) continue;
    const total = items.reduce((sum, item) => sum + item.areaHa, 0);
    lines.push("", `${SECTION_TITLES[kind]} — ${items.length} поз., ${ha(total)}`);
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${describeItem(item)}`);
    });
  }

  return lines.join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function requestToCsv(request: BasChangeRequest): string {
  const header = [
    "Дія",
    "Запис у 1С",
    "Площа в 1С, га",
    "Наше поле",
    "№ поля",
    "Урочище",
    "Наша площа, га",
    "Статус",
  ];

  const rows: string[][] = [];
  for (const item of allChangeItems(request)) {
    const status = describeStatus(itemStatus(item));
    const basName = item.kind === "create" ? "" : item.basField.description;
    const basArea =
      item.kind === "create" ? "" : (item.basField.areaHa ?? "").toString();
    const action = SECTION_TITLES[item.kind];

    for (const row of item.rows) {
      rows.push([
        action,
        basName,
        basArea,
        row.canonicalName.trim() || row.wialonName.trim(),
        row.fieldNo.trim(),
        row.tract.trim(),
        row.areaHa != null ? String(row.areaHa) : "",
        status,
      ]);
    }
  }

  return [header, ...rows]
    .map((line) => line.map(csvCell).join(";"))
    .join("\r\n");
}

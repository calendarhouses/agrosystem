import * as XLSX from "xlsx";

import type { BasChangeRequest } from "@/lib/bas-change-request";
import type { FieldRegistryRow } from "@/lib/field-registry";

/**
 * Книга Excel під штатне «Завантаження з табличного документа» в BAS AGRO.
 *
 * Чернетки для полів технічно неможливі: поля живуть у довіднику
 * `Catalog_ПодразделенияОрганизаций`, а в довідника немає ознаки проведення —
 * елемент або існує, або ні. Тому найближче до «перевірив і підтвердив» —
 * готовий файл, який бухгалтер завантажує у себе сам.
 */

/** Значення, однакові в усіх 24 заповнених полях BAS AGRO — беремо їх за замовчування. */
const DEFAULTS = {
  parentGroup: "Поля",
  fieldKind: "Пашня",
  territoryKind: "Общие",
  region: "Київська область",
  district: "Ставищенський район",
  purpose: "Для ведення фермерського господарства",
};

export type FieldContour = {
  fieldId: string;
  /** [довгота, широта] як приходить з Wialon */
  points: [number, number][];
};

export type BasImportWorkbookInput = {
  request: BasChangeRequest;
  contours: Map<string, FieldContour>;
  generatedAt?: Date;
};

type Cell = string | number;

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fieldLabel(row: FieldRegistryRow): string {
  return row.canonicalName.trim() || row.wialonName.trim();
}

function readmeSheet(
  input: BasImportWorkbookInput,
  generatedAt: Date
): XLSX.WorkSheet {
  const { request } = input;
  const rows: Cell[][] = [
    ["Зміни в довіднику полів BAS AGRO"],
    [`Сформовано ${generatedAt.toLocaleString("uk-UA")} з системи AgroSystem`],
    [],
    ["Звідки дані"],
    [
      "Площі й контури — це обміряні геозони Wialon. Сума 37 полів дає 2062.31 га,",
    ],
    [
      "а BAS у групі «Поля» декларує 2060 га, тож набір полів повний і площі коректні.",
    ],
    [],
    ["Що в цьому файлі"],
    ["Аркуш", "Що робити", "Позицій"],
    [
      "Нові поля",
      "Завантажити в довідник як нові елементи групи «Поля»",
      request.create.length,
    ],
    [
      "Розділити",
      "Наявний запис розбити на кілька — назви й площі готові",
      request.split.length,
    ],
    [
      "Уточнити площі",
      "Виправити гектари в наявних записах",
      request.area.length,
    ],
    [
      "Контури полів",
      "Заповнити таблицю «Координати поля» (зараз вона порожня в усіх 26 записах)",
      input.contours.size,
    ],
    [],
    ["Однакові для всіх нових полів"],
    ["Батьківська група", DEFAULTS.parentGroup],
    ["Вид поля", DEFAULTS.fieldKind],
    ["Вид території", DEFAULTS.territoryKind],
    ["Область", DEFAULTS.region],
    ["Район", DEFAULTS.district],
    ["Цільове призначення", DEFAULTS.purpose],
    ["Ознака поля", "Так"],
    [],
    ["Важливо"],
    [
      "AgroSystem нічого не змінює у вашій базі — тільки читає довідник.",
    ],
    [
      "Усі зміни вносите ви, перевіривши дані перед завантаженням.",
    ],
  ];

  return sheet(rows, [34, 62, 10]);
}

function createSheet(request: BasChangeRequest): XLSX.WorkSheet {
  const header: Cell[] = [
    "Найменування",
    "Батьківська група",
    "Номер поля",
    "Площа, га",
    "Ознака поля",
    "Вид поля",
    "Вид території",
    "Область",
    "Район",
    "Цільове призначення",
  ];

  const rows: Cell[][] = request.create.map((item) => {
    const row = item.rows[0];
    return [
      fieldLabel(row),
      DEFAULTS.parentGroup,
      row.fieldNo.trim(),
      round(item.areaHa),
      "Так",
      DEFAULTS.fieldKind,
      DEFAULTS.territoryKind,
      DEFAULTS.region,
      DEFAULTS.district,
      DEFAULTS.purpose,
    ];
  });

  return sheet([header, ...rows], [24, 18, 12, 12, 12, 12, 14, 18, 22, 34]);
}

function splitSheet(request: BasChangeRequest): XLSX.WorkSheet {
  const header: Cell[] = [
    "Запис у BAS AGRO",
    "Площа в BAS AGRO, га",
    "Нове поле",
    "Номер поля",
    "Площа за обміром, га",
    "Разом після поділу, га",
  ];

  const rows: Cell[][] = [];
  for (const item of request.split) {
    item.rows.forEach((row, index) => {
      rows.push([
        index === 0 ? item.basField.description : "",
        index === 0 ? round(item.basField.areaHa ?? 0) : "",
        fieldLabel(row),
        row.fieldNo.trim(),
        round(row.areaHa ?? 0),
        index === 0 ? round(item.areaHa) : "",
      ]);
    });
  }

  return sheet([header, ...rows], [24, 16, 24, 12, 20, 22]);
}

function areaSheet(request: BasChangeRequest): XLSX.WorkSheet {
  const header: Cell[] = [
    "Запис у BAS AGRO",
    "Площа зараз, га",
    "Площа за обміром, га",
    "Різниця, га",
    "Різниця, %",
  ];

  const rows: Cell[][] = request.area.map((item) => [
    item.basField.description,
    round(item.basField.areaHa ?? 0),
    round(item.areaHa),
    round(item.deltaHa),
    round(item.deltaPct, 1),
  ]);

  return sheet([header, ...rows], [28, 16, 20, 14, 12]);
}

function contourSheet(input: BasImportWorkbookInput): XLSX.WorkSheet {
  const header: Cell[] = [
    "Поле",
    "Номер поля",
    "№ точки",
    "Широта",
    "Довгота",
  ];

  const rows: Cell[][] = [];
  for (const contour of input.contours.values()) {
    const row = contourOwner(input, contour.fieldId);
    if (!row) continue;
    contour.points.forEach(([lon, lat], index) => {
      rows.push([
        fieldLabel(row),
        row.fieldNo.trim(),
        index + 1,
        round(lat, 7),
        round(lon, 7),
      ]);
    });
  }

  return sheet([header, ...rows], [24, 12, 10, 14, 14]);
}

function contourOwner(
  input: BasImportWorkbookInput,
  fieldId: string
): FieldRegistryRow | null {
  for (const item of [
    ...input.request.create,
    ...input.request.split,
    ...input.request.area,
  ]) {
    const hit = item.rows.find((row) => row.id === fieldId);
    if (hit) return hit;
  }
  return null;
}

/** Готова книга у base64 — щоб віддати з server action у браузер. */
export function buildBasImportWorkbook(input: BasImportWorkbookInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    readmeSheet(input, generatedAt),
    "Читайте перше"
  );

  if (input.request.create.length > 0) {
    XLSX.utils.book_append_sheet(book, createSheet(input.request), "Нові поля");
  }
  if (input.request.split.length > 0) {
    XLSX.utils.book_append_sheet(book, splitSheet(input.request), "Розділити");
  }
  if (input.request.area.length > 0) {
    XLSX.utils.book_append_sheet(
      book,
      areaSheet(input.request),
      "Уточнити площі"
    );
  }
  if (input.contours.size > 0) {
    XLSX.utils.book_append_sheet(
      book,
      contourSheet(input),
      "Контури полів"
    );
  }

  return XLSX.write(book, { bookType: "xlsx", type: "base64" });
}

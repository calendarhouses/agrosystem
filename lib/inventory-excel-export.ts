import { format } from "date-fns";
import * as XLSX from "xlsx";

import type {
  AccountantQueueItem,
  DraftExportMove,
} from "@/app/export/actions";

const CATEGORY_LABELS: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  parts: "Запчастини",
  harvest: "Врожай",
};

function typeLabel(t: DraftExportMove["type"]): string {
  if (t === "inbound") return "Прихід";
  if (t === "sale") return "Продаж";
  return "Списання";
}

function kindLabel(kind: AccountantQueueItem["kind"]): string {
  if (kind === "inbound") return "Прихід";
  if (kind === "sale") return "Продаж";
  if (kind === "fuel_inbound") return "Закупівля ДТ";
  if (kind === "fuel_transfer") return "Переміщення ДТ";
  return "Списання";
}

/** Той самий однолистовий Excel (зворотна сумісність). */
export function downloadDraftMovesExcel(moves: DraftExportMove[]): string {
  const rows = moves.map((m) => ({
    Тип: typeLabel(m.type),
    Категорія: m.category
      ? CATEGORY_LABELS[m.category] ?? m.category
      : "",
    Сезон: m.season ?? "",
    bas_ref_key: m.basRefKey,
    Назва: m.itemName,
    "Нова позиція": m.isLocalItem ? "так" : "",
    Кількість: m.qty,
    Одиниця: m.unit,
    Контрагент: m.buyerName ?? "",
    "Ціна ₴": m.unitPriceUah ?? "",
    "Сума ₴":
      m.unitPriceUah != null
        ? Math.round(m.qty * m.unitPriceUah * 100) / 100
        : "",
    Поле: m.fieldName ?? "—",
    Коментар: m.note ?? "",
    Накладна: m.hasAttachment ? "так" : "",
    Дата: m.date,
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
    { wch: 38 },
    { wch: 36 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 22 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Операції");

  const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
  const filename = `AgroSystem_1C_export_${stamp}.xlsx`;
  XLSX.writeFile(book, filename);
  return filename;
}

function inventorySheetRows(items: AccountantQueueItem[]) {
  return items.map((m) => ({
    Тип: kindLabel(m.kind),
    Категорія: m.category
      ? CATEGORY_LABELS[m.category] ?? m.category
      : "",
    Сезон: m.season ?? "",
    bas_ref_key: m.basRefKey ?? "",
    Назва: m.title,
    "Нова позиція": m.isLocalItem ? "так" : "",
    Кількість: m.qty,
    Одиниця: m.unit,
    Контрагент: m.buyerName ?? "",
    "Ціна ₴": m.unitPriceUah ?? "",
    "Сума ₴": m.amountUah ?? "",
    Поле: m.fieldName ?? "—",
    Коментар: m.note ?? "",
    Накладна: m.hasAttachment ? "так" : "",
    Дата: m.date,
  }));
}

function fuelSheetRows(items: AccountantQueueItem[]) {
  return items.map((m) => ({
    Тип: kindLabel(m.kind),
    Сезон: m.season ?? "",
    Літри: m.qty,
    "Ціна ₴/л": m.pricePerLiter ?? "",
    "Сума ₴": m.amountUah ?? "",
    "Склад звідки": m.fromStorageName ?? "",
    "Склад куди": m.toStorageName ?? "",
    Накладна: m.hasAttachment ? "так" : "",
    Дата: m.date,
  }));
}

function appendSheet(
  book: XLSX.WorkBook,
  name: string,
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0) return;
  const sheet = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0] ?? {});
  sheet["!cols"] = keys.map((k) => ({
    wch: Math.min(40, Math.max(10, k.length + 4)),
  }));
  XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
}

/**
 * Мульти-листовий пакет для бухгалтера.
 * Порожні типи пропускаються.
 */
export function downloadAccountantPackageExcel(
  items: AccountantQueueItem[]
): string {
  const outbound = items.filter((i) => i.kind === "outbound");
  const inbound = items.filter((i) => i.kind === "inbound");
  const sale = items.filter((i) => i.kind === "sale");
  const fuel = items.filter(
    (i) => i.kind === "fuel_inbound" || i.kind === "fuel_transfer"
  );

  const book = XLSX.utils.book_new();
  appendSheet(book, "Списання", inventorySheetRows(outbound));
  appendSheet(book, "Прихід", inventorySheetRows(inbound));
  appendSheet(book, "Продажі", inventorySheetRows(sale));
  appendSheet(book, "Паливо", fuelSheetRows(fuel));

  if ((book.SheetNames?.length ?? 0) === 0) {
    const sheet = XLSX.utils.aoa_to_sheet([["Немає рядків для експорту"]]);
    XLSX.utils.book_append_sheet(book, sheet, "Операції");
  }

  const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
  const filename = `AgroSystem_buhgalteriya_${stamp}.xlsx`;
  XLSX.writeFile(book, filename);
  return filename;
}

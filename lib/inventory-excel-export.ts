import { format } from "date-fns";
import * as XLSX from "xlsx";

import type { DraftExportMove } from "@/app/export/actions";

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

/** Той самий Excel, що на /export — без запису в BAS. */
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
    "Контрагент": m.buyerName ?? "",
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

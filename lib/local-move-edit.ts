import type { AccountantQueueItem } from "@/app/export/actions";
import type { LocalMoveRow, LocalOutboundRow } from "@/app/admin/inventory/actions";

/** Черга бухгалтера вже містить усі поля для inline-редагування. */
export function localMoveFromQueueItem(
  item: AccountantQueueItem
): LocalMoveRow {
  return {
    id: item.id,
    date: item.date.slice(0, 10),
    qty: item.qty,
    type: item.kind as "outbound" | "inbound" | "sale",
    status: "draft",
    season: item.season,
    itemRefKey: item.basRefKey ?? "",
    itemName: item.title,
    itemUnit: item.unit,
    itemCategory: item.category,
    fieldId: item.fieldId,
    fieldName: item.fieldName,
    equipmentId: item.equipmentId ?? null,
    equipmentName: item.equipmentName ?? null,
    note: item.note,
    buyerName: item.buyerName,
    unitPriceUah: item.unitPriceUah,
    actorName: null,
    attachmentCount: item.hasAttachment ? 1 : 0,
    receiptId: item.receiptId ?? null,
  };
}

/** Локальний рух зі складу — без зайвого round-trip до сервера. */
export function localMoveFromOutboundRow(
  row: LocalOutboundRow,
  item: { id: string; name: string; unit: string; category: string }
): LocalMoveRow {
  return {
    id: row.id,
    date: row.dateYmd,
    qty: row.qty,
    type: row.type,
    status: row.status,
    season: null,
    itemRefKey: row.ref || item.id,
    itemName: item.name,
    itemUnit: item.unit,
    itemCategory: item.category,
    fieldId: null,
    fieldName: row.fieldName,
    equipmentId: null,
    equipmentName: row.equipmentName,
    note: row.note,
    buyerName: row.buyerName,
    unitPriceUah: row.unitPriceUah,
    actorName: null,
    attachmentCount: row.attachmentCount,
    receiptId: null,
  };
}

/**
 * Статуси передачі в BAS vs Excel-черга бухгалтера.
 * sent_to_1c ≠ чернетка в BAS (див. bas_draft_ref_key).
 */

export type BasHandoffStatus =
  | "local_saved"
  | "awaiting_bas_mapping"
  | "bas_draft_posted"
  | "bas_draft_dry_run"
  | "bas_draft_failed";

export type ExcelQueueStatus = "sent_to_1c";

export function describeBasHandoff(status: BasHandoffStatus | string): string {
  switch (status) {
    case "local_saved":
      return "На складі LEVADA, у 1С ще не відправлено.";
    case "awaiting_bas_mapping":
      return "Товари ще не звʼязані з номенклатурою 1С.";
    case "bas_draft_posted":
      return "Уже є в 1С як непроведена чернетка.";
    case "bas_draft_dry_run":
      return "Підготовлено, але жива відправка в 1С вимкнена.";
    case "bas_draft_failed":
      return "Не вдалося відправити в 1С — спробуй ще раз.";
    default:
      return "Статус невідомий.";
  }
}

/** Коротка мітка для UI / агента. */
export function basHandoffLabel(status: BasHandoffStatus | string): string {
  switch (status) {
    case "local_saved":
      return "Ще не в 1С";
    case "awaiting_bas_mapping":
      return "Треба звʼязати товари";
    case "bas_draft_posted":
      return "Вже в 1С";
    case "bas_draft_dry_run":
      return "Тест — не відправлено";
    case "bas_draft_failed":
      return "Помилка відправки";
    default:
      return String(status);
  }
}

export function excelQueueLabel(): string {
  return "Знято з черги";
}

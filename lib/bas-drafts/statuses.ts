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
      return "Збережено на складі LEVADA (ще не в BAS).";
    case "awaiting_bas_mapping":
      return "Очікує мапінгу номенклатури/контрагента перед чернеткою BAS.";
    case "bas_draft_posted":
      return "Чернетка в BAS (непроведена) — бухгалтер може перевірити й провести.";
    case "bas_draft_dry_run":
      return "Підготовлено dry-run (жива відправка в BAS ще вимкнена).";
    case "bas_draft_failed":
      return "Помилка відправки чернетки в BAS — див. bas_draft_error.";
    default:
      return "Статус передачі невизначений.";
  }
}

/** Коротка мітка для UI / агента. */
export function basHandoffLabel(status: BasHandoffStatus | string): string {
  switch (status) {
    case "local_saved":
      return "На складі LEVADA";
    case "awaiting_bas_mapping":
      return "Очікує мапінгу BAS";
    case "bas_draft_posted":
      return "Чернетка в BAS";
    case "bas_draft_dry_run":
      return "Dry-run BAS";
    case "bas_draft_failed":
      return "Помилка BAS";
    default:
      return String(status);
  }
}

export function excelQueueLabel(): string {
  return "Excel · не BAS";
}

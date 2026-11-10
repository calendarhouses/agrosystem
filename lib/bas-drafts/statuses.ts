/**
 * Статуси передачі в BAS vs черга бухгалтера.
 * Після живої чернетки (bas_draft_ref_key) склад/паливо автоматично
 * йдуть у архів черги: inventory → sent_to_1c, fuel → synced.
 */

export type BasHandoffStatus =
  | "local_saved"
  | "awaiting_bas_mapping"
  | "bas_draft_posted"
  | "bas_draft_dry_run"
  | "bas_draft_failed"
  /** Сховано з «Накладні → 1С» (без відкату складу / BAS). */
  | "dismissed";

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
    case "dismissed":
      return "Прибрано зі списку «Накладні → 1С».";
    default:
      return "Статус невідомий.";
  }
}

/** Коротка мітка для UI / агента. */
export function basHandoffLabel(status: BasHandoffStatus | string): string {
  switch (status) {
    case "local_saved":
      return "Нова";
    case "awaiting_bas_mapping":
      return "Треба звʼязати";
    case "bas_draft_posted":
      return "В 1С";
    case "bas_draft_dry_run":
      return "Тест";
    case "bas_draft_failed":
      return "Помилка";
    case "dismissed":
      return "Прибрано";
    default:
      return String(status);
  }
}

export function excelQueueLabel(): string {
  return "Знято з черги";
}

/**
 * Реєстр усіх контурів «наша операція → чернетка BAS».
 * Джерело правди для go-live і для бухгалтера: що flipнеться з BAS_DRAFT_POST_ENABLED.
 */

export type BasDraftPipelineReadiness =
  /** Payload + POST через спільний шар; мапінг ключів достатній для спроби */
  | "ready"
  /** Builder є, але OData може відхилити без додаткових полів / env */
  | "partial"
  /** Лише місце в черзі / статус; документа ще немає */
  | "stub"
  /** Навмисно не пишемо в BAS (заявка людині / лише читання) */
  | "out_of_scope";

export type BasDraftPipeline = {
  id: string;
  /** Розділ UI */
  section: string;
  /** Тригер у AgroSystem */
  trigger: string;
  /** EntitySet OData */
  basDocument: string | null;
  readiness: BasDraftPipelineReadiness;
  /** Файл реалізації */
  module: string;
  notes: string;
};

/**
 * Повний список. Оновлюй при додаванні нового типу чернетки.
 */
export const BAS_DRAFT_PIPELINES: BasDraftPipeline[] = [
  {
    id: "inventory_outbound_lzk",
    section: "Виробництво / ЛЗК (насіння, добрива, ЗЗР)",
    trigger:
      "createLocalOutboundMove → syncLocalMovesToBas (група вид+поле+день)",
    basDocument: "Document_ИНАГРО_ЛимитноЗаборнаяКарта",
    readiness: "ready",
    module: "lib/inventory-bas-draft-sync.ts",
    notes:
      "Лише seed/fertilizer/zzr. ВидОперации: СписаниеСемян | СписаниеУдобренийИЯдохимикатов (НЕ молоко). Рядки: Од., К=1, рахунок, Опод. ПДВ.",
  },
  {
    id: "inventory_outbound_requirement",
    section: "Склад / Вимога-накладна (запчастини)",
    trigger:
      "createLocalOutboundMove(parts) → syncLocalMovesToBas (група техніка+день)",
    basDocument: "Document_ТребованиеНакладная",
    readiness: "ready",
    module: "lib/inventory-bas-draft-sync.ts",
    notes:
      "Таблична частина Материалы (не Товары). Счет_Key за категорією. Коментар: «AgroSystem · Списання запчастин · Техніка: …».",
  },
  {
    id: "inventory_inbound_receipt",
    section: "Склад / прихід ТМЦ",
    trigger:
      "executeWarehouseReceipt → enqueueWarehouseReceiptBasDraft (1 накл. = 1 doc); ручний прихід → enqueueInventoryInboundBasDraft",
    basDocument: "Document_ПоступлениеТоваровУслуг",
    readiness: "ready",
    module: "lib/bas-drafts/inventory-inbound.ts",
    notes:
      "1 накл.=1 doc. Контрагент обовʼязковий. Рахунок: СчетУчетаБУ_Key за категорією (207/208/203/271). Без Всего / НалоговоеНазначениеНДС_Key. Ідемпотентність receipt:UUID.",
  },
  {
    id: "inventory_sale",
    section: "Склад / продаж урожаю та ТМЦ",
    trigger: "createLocalSaleMove / createInventorySale → enqueueInventorySaleBasDraft",
    basDocument: "Document_РеализацияТоваровУслуг",
    readiness: "ready",
    module: "lib/bas-drafts/inventory-sale.ts",
    notes:
      "1 рядок Товары[]. Контрагент опційний (buyer_name → bas_counterparties). Без мапінгу — у коментарі.",
  },
  {
    id: "fuel_inbound",
    section: "Паливо / закупівля (надходження ДП)",
    trigger: "POST /api/fuel/transactions (inbound) / LEVADIUS → enqueueFuelBasDraft",
    basDocument: "Document_ПоступлениеТоваровУслуг",
    readiness: "ready",
    module: "lib/fuel-bas-sync.ts",
    notes:
      "Потрібні BAS_DIESEL_NOMENCLATURE_KEY + bas_ref_key складу-отримувача. Контрагент опційний у коментарі.",
  },
  {
    id: "fuel_transfer",
    section: "Паливо / переміщення",
    trigger: "POST /api/fuel/transactions (transfer) → enqueueFuelBasDraft",
    basDocument: "Document_ИНАГРО_СливТоплива",
    readiness: "ready",
    module: "lib/fuel-bas-sync.ts",
    notes: "Склад відправник/отримувач з fuel_storages.bas_ref_key + дизель-номенклатура.",
  },
  {
    id: "fuel_outbound_refuel",
    section: "Паливо / етап 2 · заправка (без витрат)",
    trigger:
      "POST /api/fuel/refuel | /api/fuel/transactions(outbound) → enqueueFuelBasDraft",
    basDocument: "Document_ИНАГРО_ПередачаТоплива",
    readiness: "ready",
    module: "lib/fuel-bas-sync.ts",
    notes:
      "НЕ списання на витрати. Шапка ($metadata): ТранспортноеСредство_Key + Получатель_Key — без Склад_Key. Рядок: Количество + КоличествоВОсновномТопливе/КоэффициентВОсновноеТопливо (=1) для здавача й отримувача.",
  },
  {
    id: "field_operation_waybill",
    section: "Паливо / етап 3 · використання (після підтвердження)",
    trigger: "POST /api/field-operations/close → enqueueFieldOperationBasDraft",
    basDocument: "Document_ИНАГРО_ПутевойЛистТрактористаМашиниста",
    readiness: "ready",
    module: "lib/bas-drafts/field-operation-waybill.ts",
    notes:
      "Списання на витрати лише тут (fuel_fact). Окремо від ПередачаТоплива — без подвійного списання.",
  },
  {
    id: "bas_catalog_change_request",
    section: "Звірка / заявка на довідники",
    trigger: "bas_sync_status на farm_fields, текст заявки",
    basDocument: null,
    readiness: "out_of_scope",
    module: "lib/bas-change-request.ts",
    notes:
      "НЕ чернетка документа. Catalog_* у BAS не створюємо — лише наша заявка бухгалтеру.",
  },
  {
    id: "accountant_excel_package",
    section: "Бухгалтерія / Експорт",
    trigger: "Excel + «Позначити як передані»",
    basDocument: null,
    readiness: "out_of_scope",
    module: "app/export/actions.ts",
    notes:
      "Окремий контур для людини. sent_to_1c / synced ≠ чернетка в BAS. Прапорець чернетки — bas_draft_ref_key.",
  },
];

export function listBasDraftPipelinesByReadiness(
  readiness: BasDraftPipelineReadiness
): BasDraftPipeline[] {
  return BAS_DRAFT_PIPELINES.filter((p) => p.readiness === readiness);
}

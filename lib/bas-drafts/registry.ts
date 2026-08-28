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
    section: "Склад / списання ТМЦ",
    trigger:
      "createLocalOutboundMove + batch syncLocalMovesToBas (група поле+день)",
    basDocument: "Document_ИНАГРО_ЛимитноЗаборнаяКарта",
    readiness: "ready",
    module: "lib/inventory-bas-draft-sync.ts",
    notes:
      "Потрібні bas_ref_key ТМЦ і (бажано) поля; BAS_ORGANIZATION_KEY, BAS_DEFAULT_WAREHOUSE_KEY.",
  },
  {
    id: "inventory_inbound_receipt",
    section: "Склад / прихід ТМЦ",
    trigger: "createLocalInboundMove → enqueueInventoryInboundBasDraft",
    basDocument: "Document_ПоступлениеТоваровУслуг",
    readiness: "partial",
    module: "lib/bas-drafts/inventory-inbound.ts",
    notes:
      "Спрощений payload. Повний документ у BAS часто вимагає контрагента, договору, рахунків — узгодити з бухгалтером.",
  },
  {
    id: "inventory_sale",
    section: "Склад / продаж",
    trigger: "createLocalSaleMove → enqueueInventorySaleBasDraft",
    basDocument: "Document_РеализацияТоваровУслуг",
    readiness: "partial",
    module: "lib/bas-drafts/inventory-sale.ts",
    notes: "Спрощений payload + buyer_name у коментарі. Контрагент_Key — окремий мапінг.",
  },
  {
    id: "fuel_inbound",
    section: "Паливо / закупівля",
    trigger: "POST /api/fuel/transactions (inbound) → enqueueFuelBasDraft",
    basDocument: "Document_ПоступлениеТоваровУслуг",
    readiness: "partial",
    module: "lib/fuel-bas-sync.ts",
    notes: "BAS_DIESEL_NOMENCLATURE_KEY + склад bas_ref_key. Контрагент — TBD.",
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
    section: "Паливо / заправка техніки",
    trigger: "POST /api/fuel/refuel → enqueueFuelBasDraft",
    basDocument: "Document_ИНАГРО_ПередачаТоплива",
    readiness: "partial",
    module: "lib/fuel-bas-sync.ts",
    notes:
      "Потрібен equipment.bas_ref_key (ТранспортноеСредствоПолучатель). Зараз у черзі Excel немає — лише бас-чернетка.",
  },
  {
    id: "field_operation_waybill",
    section: "Поля / закриття наряду",
    trigger: "POST /api/field-operations/close → enqueueFieldOperationBasDraft",
    basDocument: "Document_ИНАГРО_ПутевойЛистТрактористаМашиниста",
    readiness: "partial",
    module: "lib/bas-drafts/field-operation-waybill.ts",
    notes:
      "Мінімальний header (дата, техніка, паливо, коментар). Повні табличні частини — з бухгалтером.",
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

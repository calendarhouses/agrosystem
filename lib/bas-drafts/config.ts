/**
 * Живі POST чернеток у BAS AGRO (Posted: false).
 *
 * Потрібні ОБИДВА прапорці:
 *   BAS_DRAFT_POST_ENABLED=true
 *   BAS_DRAFT_PIPELINES_ENABLED=inventory_inbound_receipt,inventory_sale,...
 *     (або `*` / `all` — усі document-pipelines)
 *   Див. docs/bas-drafts-golive.md
 *
 * Див. .cursor/rules/bas-readonly.mdc і lib/bas-drafts/registry.ts.
 */

/** Fallback, якщо env не задано. Не вмикай true без явної задачі. */
const DEFAULT_ENABLED = false;

/**
 * Глобальний kill-switch реального OData POST.
 */
export function isBasDraftPostEnabled(): boolean {
  const raw = process.env.BAS_DRAFT_POST_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return DEFAULT_ENABLED;
}

/**
 * Чи дозволений живий POST саме для цього pipeline id з registry.
 * Без BAS_DRAFT_POST_ENABLED — завжди false.
 * Без BAS_DRAFT_PIPELINES_ENABLED (порожньо) — жоден pipeline не поститься (безпечно).
 */
export function isBasDraftPipelineEnabled(pipelineId: string): boolean {
  if (!isBasDraftPostEnabled()) return false;
  const raw = process.env.BAS_DRAFT_PIPELINES_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "*" || raw === "all") return true;
  const id = pipelineId.trim().toLowerCase();
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(id);
}

export function basOrganizationKey(): string | null {
  return process.env.BAS_ORGANIZATION_KEY?.trim().toLowerCase() || null;
}

export function basDefaultWarehouseKey(): string | null {
  return (
    process.env.BAS_DEFAULT_WAREHOUSE_KEY?.trim().toLowerCase() || null
  );
}

/** Ref_Key номенклатури «Дизель» у Catalog_Номенклатура (для паливних чернеток). */
export function basDieselNomenclatureKey(): string | null {
  return (
    process.env.BAS_DIESEL_NOMENCLATURE_KEY?.trim().toLowerCase() || null
  );
}

/**
 * Заглушка для НОВИХ товарів, яких ще немає в довіднику BAS.
 * Рядок усе одно летить у чернетку; справжня назва — у НаименованиеПоставщика.
 * За замовчуванням — картка «Товари» у вашій базі (можна перевизначити env).
 */
const DEFAULT_UNMAPPED_NOMENCLATURE_KEY =
  "a1f7dba4-426c-11f1-8c9e-9c6b0055d53a";

export function basUnmappedNomenclatureKey(): string {
  return (
    process.env.BAS_UNMAPPED_NOMENCLATURE_KEY?.trim().toLowerCase() ||
    DEFAULT_UNMAPPED_NOMENCLATURE_KEY
  );
}

/**
 * Єдиний перемикач живих POST чернеток у BAS AGRO (Posted: false).
 *
 * За замовчуванням ВИМКНЕНО. Коли бухгалтер підтвердить — увімкни
 * `BAS_DRAFT_POST_ENABLED=true` у env (або зміни DEFAULT нижче лише за задачею).
 *
 * Див. .cursor/rules/bas-readonly.mdc і lib/bas-drafts/registry.ts.
 */

/** Fallback, якщо env не задано. Не вмикай true без явної задачі. */
const DEFAULT_ENABLED = false;

/**
 * Чи дозволений реальний OData POST непроведеної чернетки.
 * Усі шляхи (ТМЦ, ДП, наряди) читають лише цю функцію.
 */
export function isBasDraftPostEnabled(): boolean {
  const raw = process.env.BAS_DRAFT_POST_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return DEFAULT_ENABLED;
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

/**
 * Allowlist полів табличних частин за $metadata BAS АГРО 2.1.
 * Невідомі ключі відкидаємо — інакше OData 400.
 */

export type BasTabularKind =
  | "receipt_goods"
  | "lzk_materials"
  | "requirement_materials";

/** Document_ПоступлениеТоваровУслуг_Товары */
const RECEIPT_GOODS = new Set([
  "LineNumber",
  "Номенклатура_Key",
  "ЕдиницаИзмерения_Key",
  "Коэффициент",
  "Количество",
  "Цена",
  "Сумма",
  "СтавкаНДС",
  "СуммаНДС",
  "СчетУчетаБУ_Key",
  "ЦенаВРознице",
  "СуммаВРознице",
  "НалоговоеНазначение_Key",
  "СтавкаНДСВРознице",
  "НаименованиеПоставщика",
  "ИНАГРО_Ордер_Key",
  "ИНАГРО_Склад_Key",
]);

/** Document_ИНАГРО_ЛимитноЗаборнаяКарта_Материалы */
const LZK_MATERIALS = new Set([
  "LineNumber",
  "Номенклатура_Key",
  "Счет_Key",
  "ЕдиницаИзмерения_Key",
  "Коэффициент",
  "Количество",
  "НалоговоеНазначение_Key",
  "СчетЗатрат_Key",
  "ДокументОприходования",
  "Себестоимость",
  "Субконто1",
  "Субконто2",
  "Субконто3",
  "НаправлениеДвижения_Key",
  "НалоговоеНазначениеДоходовИЗатрат_Key",
  "ПлощадьПоля",
  "ФактИспользованиеСемян",
  "НормаИспользованиеСемян",
  "ДокументОприходования_Type",
  "Субконто1_Type",
  "Субконто2_Type",
  "Субконто3_Type",
]);

/** Document_ТребованиеНакладная_Материалы */
const REQUIREMENT_MATERIALS = new Set([
  "LineNumber",
  "Номенклатура_Key",
  "ЕдиницаИзмерения_Key",
  "Коэффициент",
  "Количество",
  "Счет_Key",
  "НалоговоеНазначение_Key",
  "Себестоимость",
  "ДокументОприходования",
  "НоменклатурнаяГруппа_Key",
  "СчетЗатрат_Key",
  "СтатьяЗатрат_Key",
  "СебестоимостьНУ",
  "НалоговоеНазначениеДоходовИЗатрат_Key",
  "ИНАГРО_ОсновноеСредство_Key",
  "ДокументОприходования_Type",
]);

const BY_KIND: Record<BasTabularKind, Set<string>> = {
  receipt_goods: RECEIPT_GOODS,
  lzk_materials: LZK_MATERIALS,
  requirement_materials: REQUIREMENT_MATERIALS,
};

/** Синоніми застарілих імен → канонічні з $metadata. */
const FIELD_ALIASES: Record<BasTabularKind, Record<string, string>> = {
  receipt_goods: {
    СчетУчета_Key: "СчетУчетаБУ_Key",
  },
  lzk_materials: {
    СчетУчета_Key: "Счет_Key",
    СчетУчетаБУ_Key: "Счет_Key",
  },
  requirement_materials: {
    СчетУчета_Key: "Счет_Key",
    СчетУчетаБУ_Key: "Счет_Key",
  },
};

/**
 * Залишає лише дозволені властивості рядка; перейменовує відомі alias.
 * Невідомі поля (Всего, ЕдиницаИзмерения текст, НалоговоеНазначениеНДС_Key тощо) — drop.
 */
export function sanitizeBasTabularRow(
  kind: BasTabularKind,
  row: Record<string, unknown>
): Record<string, unknown> {
  const allow = BY_KIND[kind];
  const aliases = FIELD_ALIASES[kind];
  const out: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(row)) {
    if (value === undefined || value === null) continue;
    if (rawKey === "_meta") continue;
    const key = aliases[rawKey] ?? rawKey;
    if (!allow.has(key)) continue;
    if (out[key] !== undefined && aliases[rawKey]) continue;
    out[key] = value;
  }

  return out;
}

export function sanitizeBasTabularRows(
  kind: BasTabularKind,
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return rows.map((row) => sanitizeBasTabularRow(kind, row));
}

/** Санітизація тіла документа перед POST/PATCH. */
export function sanitizeBasDocumentBody(
  entitySet: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...body };
  delete next._meta;

  if (entitySet === "Document_ПоступлениеТоваровУслуг" && Array.isArray(next.Товары)) {
    next.Товары = sanitizeBasTabularRows(
      "receipt_goods",
      next.Товары as Array<Record<string, unknown>>
    );
  }

  if (
    entitySet === "Document_ИНАГРО_ЛимитноЗаборнаяКарта" &&
    Array.isArray(next.Материалы)
  ) {
    next.Материалы = sanitizeBasTabularRows(
      "lzk_materials",
      next.Материалы as Array<Record<string, unknown>>
    );
  }

  if (entitySet === "Document_ТребованиеНакладная") {
    if (Array.isArray(next.Товары) && !Array.isArray(next.Материалы)) {
      // Legacy payload: Товары → Материалы
      next.Материалы = next.Товары;
      delete next.Товары;
    }
    if (Array.isArray(next.Материалы)) {
      next.Материалы = sanitizeBasTabularRows(
        "requirement_materials",
        next.Материалы as Array<Record<string, unknown>>
      );
    }
  }

  return next;
}

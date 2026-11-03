/**
 * Оприбуткування за розпізнаною накладною (LEVADIUS Vision).
 * Використовує inventory_items_cache + inventory_local_moves (inbound).
 */

import {
  createLocalInboundMove,
  createLocalInventoryItem,
  deleteLocalMove,
} from "@/app/admin/inventory/actions";
import { loadAgentInventoryStock } from "@/lib/agent-warehouse-stock";
import {
  describeBasHandoff,
  type BasHandoffStatus,
} from "@/lib/bas-drafts/statuses";
import { enqueueWarehouseReceiptBasDraft } from "@/lib/bas-drafts/inventory-inbound";
import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON } from "@/lib/season";
import { todayKyivYmd } from "@/lib/kyiv-date";

export const INVOICE_CATEGORIES = [
  "ЗЗР",
  "Добрива",
  "Насіння",
  "Паливо",
  "Запчастини",
] as const;

export type InvoiceCategoryUk = (typeof INVOICE_CATEGORIES)[number];

export type InvoiceVatRateId = "20" | "14" | "7" | "0" | "none";

export type InvoiceLineInput = {
  name: string;
  category: InvoiceCategoryUk;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  /** Сума без ПДВ (якщо OCR її зчитав) */
  totalAmount?: number | null;
  /** Артикул / код постачальника або BAS */
  article?: string | null;
  /** Розмір / типорозмір з накладної (шина, різьба тощо) */
  size?: string | null;
  vatRate?: InvoiceVatRateId | null;
  vatAmount?: number | null;
  amountInclVat?: number | null;
  /**
   * Обраний користувачем bas_ref_key (кандидат).
   * Якщо задано — execute привʼяже до нього замість створення «нової».
   */
  selectedExistingItemId?: string | null;
  /** Явне підтвердження створення нової позиції (коли є схожі кандидати). */
  confirmCreateNew?: boolean | null;
};

export type InvoiceReceiptInput = {
  supplierName: string;
  supplierEdrpou?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  items: InvoiceLineInput[];
  /** Підсумок без ПДВ (або як OCR назвав «разом») */
  totalAmount?: number | null;
  vatRate?: InvoiceVatRateId | null;
  vatAmount?: number | null;
  /** Загальна сума з ПДВ з документа */
  totalInclVat?: number | null;
};

export type InvoiceMatchCandidate = {
  basRefKey: string;
  name: string;
  code: string | null;
  unit: string | null;
  score: number;
  reason: string;
};

export type InvoicePreviewLine = InvoiceLineInput & {
  lineId: string;
  totalAmount: number;
  computedAmount: number;
  lineMathOk: boolean;
  matchStatus: "existing" | "new" | "skipped_fuel";
  existingItemId: string | null;
  existingItemName: string | null;
  article: string | null;
  size: string | null;
  unitRaw: string;
  matchConfidence: number;
  unitConflict: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  candidates: InvoiceMatchCandidate[];
  vatRate: InvoiceVatRateId | null;
  vatAmount: number | null;
  amountInclVat: number | null;
};

export type InvoicePreviewResult = {
  status: "invoice_preview_ready";
  receiptId: string;
  supplierName: string;
  supplierEdrpou: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  items: InvoicePreviewLine[];
  totalAmount: number;
  linesSum: number;
  totalMismatch: boolean;
  vatRate: InvoiceVatRateId | null;
  vatAmount: number | null;
  totalInclVat: number | null;
  vatMismatch: boolean;
  needsReviewCount: number;
  newItemsCount: number;
  existingItemsCount: number;
  skippedFuelCount: number;
  lineMathMismatchCount: number;
};

const CATEGORY_TO_KEY: Record<
  InvoiceCategoryUk,
  "zzr" | "fertilizer" | "seed" | "parts" | null
> = {
  ЗЗР: "zzr",
  Добрива: "fertilizer",
  Насіння: "seed",
  Паливо: null,
  Запчастини: "parts",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
}

function normalizeArticle(value: string): string {
  return value.trim().toLocaleLowerCase("uk-UA").replace(/[\s\-_/]/g, "");
}

function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(/[^a-zа-яіїєґ0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Jaccard-подібний overlap токенів назви (0…1). */
function tokenOverlapRatio(a: string, b: string): number {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

/** Нормалізація од. вим. для порівняння (кг ≠ шт тощо). */
export function normalizeUnitKey(raw: string): string {
  const u = raw.trim().toLocaleLowerCase("uk-UA").replace(/\./g, "");
  if (!u) return "шт";
  if (/^(шт|штук|штука|pcs|pc)$/.test(u)) return "шт";
  if (/^(кг|kg|килограм|кілограм)/.test(u)) return "кг";
  if (/^(л|l|літр|литр)/.test(u)) return "л";
  if (/^(пар|пари|пара|pair)/.test(u)) return "пари";
  if (/^(м|m|метр)/.test(u) && !/^мл/.test(u)) return "м";
  if (/^(уп|упак|упаковка)/.test(u)) return "уп";
  if (/^(т|тонн)/.test(u)) return "т";
  if (/^(г|гр|грам)/.test(u)) return "г";
  return u;
}

export function mapInvoiceCategoryToDb(
  category: InvoiceCategoryUk
): "zzr" | "fertilizer" | "seed" | "parts" | null {
  return CATEGORY_TO_KEY[category] ?? null;
}

type CatalogRow = {
  bas_ref_key: string;
  name: string | null;
  custom_name: string | null;
  category: string | null;
  unit: string | null;
  is_hidden?: boolean | null;
  code?: string | null;
  is_local?: boolean | null;
};

function displayCatalogName(row: CatalogRow): string {
  return (
    (typeof row.custom_name === "string" && row.custom_name.trim()) ||
    String(row.name ?? "").trim() ||
    "ТМЦ"
  );
}

function parseInvoiceVatRate(
  raw: unknown
): InvoiceVatRateId | null {
  if (raw === "20" || raw === "14" || raw === "7" || raw === "0" || raw === "none") {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw === 20) return "20";
    if (raw === 14) return "14";
    if (raw === 7) return "7";
    if (raw === 0) return "0";
  }
  if (typeof raw === "string") {
    const t = raw.trim().toLowerCase();
    if (t === "без пдв" || t === "безпдв" || t === "none") return "none";
    const m = t.match(/(\d{1,2})/);
    if (m?.[1] === "20" || m?.[1] === "14" || m?.[1] === "7" || m?.[1] === "0") {
      return m[1] as InvoiceVatRateId;
    }
  }
  return null;
}

/** Типорозмір / розмір з назви (шини, різьби, олива 10W-40). */
export function extractSizeTokens(
  name: string,
  explicitSize?: string | null
): string[] {
  const out = new Set<string>();
  const push = (raw: string) => {
    const t = raw
      .trim()
      .toLocaleLowerCase("uk-UA")
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/х/g, "x")
      .replace(/р/g, "r");
    if (t.length >= 2) out.add(t);
  };
  if (explicitSize?.trim()) push(explicitSize);

  const hay = normalizeName(name);
  for (const m of hay.matchAll(/\d{2,3}\s*\/\s*\d{2}\s*[rр]\s*\d{2}/gi)) {
    push(m[0]!);
  }
  for (const m of hay.matchAll(/\bm\d{1,3}\s*[xх]\s*[\d.]+/gi)) {
    push(m[0]!);
  }
  for (const m of hay.matchAll(
    /\b\d+[.,]?\d*\s*[xх]\s*\d+[.,]?\d*(?:\s*[xх]\s*\d+[.,]?\d*)?\b/gi
  )) {
    push(m[0]!);
  }
  for (const m of hay.matchAll(/\b\d{1,2}\s*w[-\s]?\d{2}\b/gi)) {
    push(m[0]!);
  }
  return [...out];
}

function sizesCompatible(
  querySizes: string[],
  candidateName: string,
  candidateCode?: string | null
): boolean {
  if (querySizes.length === 0) return true;
  const cand = extractSizeTokens(
    `${candidateName} ${candidateCode ?? ""}`.trim()
  );
  if (cand.length === 0) return true; // у довіднику немає розміру — не блокуємо
  return querySizes.some((q) => cand.some((c) => c === q || c.includes(q) || q.includes(c)));
}

function unitsCompatible(a: string, b: string | null | undefined): boolean {
  if (!b?.trim()) return true;
  return normalizeUnitKey(a) === normalizeUnitKey(b);
}

type MatchHit = {
  row: CatalogRow;
  score: number;
  reason: string;
  exact: boolean;
};

/**
 * Точний матч лише за кодом/артикулом (+ од.вим./розмір) або
 * точною назвою + тією ж од.вим. без конфлікту артикула.
 * Усе інше — кандидати для ручного вибору (без авто-«нова» / авто-злиття).
 */
function findCatalogMatches(
  rows: CatalogRow[],
  input: {
    name: string;
    article: string | null;
    unit: string;
    size: string | null;
  }
): { exact: MatchHit | null; candidates: MatchHit[] } {
  const art = input.article ? normalizeArticle(input.article) : "";
  const needle = normalizeName(input.name);
  const querySizes = extractSizeTokens(input.name, input.size);
  const scored: MatchHit[] = [];

  const pushHit = (
    row: CatalogRow,
    score: number,
    reason: string,
    exact: boolean
  ) => {
    if (!sizesCompatible(querySizes, displayCatalogName(row), row.code)) {
      return;
    }
    if (!unitsCompatible(input.unit, row.unit) && exact) {
      // точний код/назва з іншою од.вим. — у кандидати, не в auto-bind
      scored.push({
        row,
        score: Math.min(score, 70),
        reason: `${reason}; од.вим. «${row.unit ?? "—"}» ≠ «${input.unit}»`,
        exact: false,
      });
      return;
    }
    scored.push({ row, score, reason, exact });
  };

  if (art) {
    for (const row of rows) {
      if (
        typeof row.code === "string" &&
        row.code.trim() &&
        normalizeArticle(row.code) === art
      ) {
        pushHit(row, 98, `код/артикул «${input.article}»`, true);
      }
    }
  }

  for (const row of rows) {
    const display = displayCatalogName(row);
    if (normalizeName(display) !== needle) continue;
    if (
      art &&
      typeof row.code === "string" &&
      row.code.trim() &&
      normalizeArticle(row.code) !== art
    ) {
      pushHit(
        row,
        45,
        `назва збігається, але артикул ≠ код «${row.code}»`,
        false
      );
      continue;
    }
    if (!unitsCompatible(input.unit, row.unit)) {
      pushHit(
        row,
        55,
        `точна назва, інша од.вим. («${row.unit ?? "—"}»)`,
        false
      );
      continue;
    }
    pushHit(row, 95, "точна назва + од.вим.", true);
  }

  // Fuzzy → лише кандидати (ніколи auto-existing)
  for (const row of rows) {
    const display = displayCatalogName(row);
    const n = normalizeName(display);
    if (n.length < 4 || needle.length < 4) continue;
    if (
      art &&
      typeof row.code === "string" &&
      row.code.trim() &&
      normalizeArticle(row.code) !== art
    ) {
      continue;
    }
    if (!sizesCompatible(querySizes, display, row.code)) continue;
    const overlap = tokenOverlapRatio(needle, display);
    const contains = n.includes(needle) || needle.includes(n);
    if (overlap < 0.45 && !contains) continue;
    if (overlap < 0.35) continue;
    const unitOk = unitsCompatible(input.unit, row.unit);
    const score = Math.round(
      (contains ? 50 : 35) + overlap * 40 + (unitOk ? 8 : 0)
    );
    pushHit(
      row,
      Math.min(score, 88),
      unitOk
        ? `схожа назва (${Math.round(overlap * 100)}%)`
        : `схожа назва, од.вим. «${row.unit ?? "—"}»`,
      false
    );
  }

  // Dedup by bas_ref_key — лишаємо найкращий score
  const byKey = new Map<string, MatchHit>();
  for (const hit of scored) {
    const key = String(hit.row.bas_ref_key);
    const prev = byKey.get(key);
    if (!prev || hit.score > prev.score || (hit.exact && !prev.exact)) {
      byKey.set(key, hit);
    }
  }
  const unique = [...byKey.values()].sort((a, b) => b.score - a.score);

  const exactHits = unique.filter((h) => h.exact && h.score >= 90);
  if (exactHits.length === 1) {
    return {
      exact: exactHits[0]!,
      candidates: unique
        .filter((h) => h.row.bas_ref_key !== exactHits[0]!.row.bas_ref_key)
        .slice(0, 5),
    };
  }
  // Кілька «точних» або лише fuzzy — усе в кандидати
  return { exact: null, candidates: unique.slice(0, 5) };
}

function toPublicCandidates(hits: MatchHit[]): InvoiceMatchCandidate[] {
  return hits.map((h) => ({
    basRefKey: String(h.row.bas_ref_key),
    name: displayCatalogName(h.row),
    code: h.row.code?.trim() || null,
    unit: h.row.unit?.trim() || null,
    score: h.score,
    reason: h.reason,
  }));
}

export async function buildInvoicePreview(
  input: InvoiceReceiptInput
): Promise<InvoicePreviewResult | { status: "error"; error: string }> {
  const supplierName = input.supplierName?.trim() || "Постачальник";
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    return { status: "error", error: "У накладній немає позицій." };
  }

  const supabase = createServiceSupabase();
  let catalogRows: CatalogRow[] = [];
  {
    const primary = await supabase
      .from("inventory_items_cache")
      .select(
        "bas_ref_key, name, custom_name, category, unit, is_hidden, code, is_local"
      )
      .limit(5_000);
    if (
      primary.error &&
      (primary.error.message?.includes("code") ||
        primary.error.message?.includes("is_local"))
    ) {
      const legacy = await supabase
        .from("inventory_items_cache")
        .select("bas_ref_key, name, custom_name, category, unit, is_hidden")
        .limit(5_000);
      if (
        legacy.error &&
        legacy.error.code !== "PGRST205" &&
        legacy.error.code !== "42P01"
      ) {
        return { status: "error", error: legacy.error.message };
      }
      catalogRows = (legacy.data ?? []) as CatalogRow[];
    } else if (
      primary.error &&
      primary.error.code !== "PGRST205" &&
      primary.error.code !== "42P01"
    ) {
      return { status: "error", error: primary.error.message };
    } else {
      catalogRows = (primary.data ?? []) as CatalogRow[];
    }
  }

  const rows = catalogRows.filter((row) => row.is_hidden !== true);

  const docVatRate = parseInvoiceVatRate(input.vatRate);
  const docVatAmount =
    input.vatAmount != null && Number.isFinite(Number(input.vatAmount))
      ? round2(Number(input.vatAmount))
      : null;
  const docTotalInclVat =
    input.totalInclVat != null && Number.isFinite(Number(input.totalInclVat))
      ? round2(Number(input.totalInclVat))
      : null;

  const previewItems: InvoicePreviewLine[] = items.map((raw, index) => {
    const name = String(raw.name ?? "").trim() || `Позиція ${index + 1}`;
    const category = (INVOICE_CATEGORIES.includes(
      raw.category as InvoiceCategoryUk
    )
      ? raw.category
      : "Запчастини") as InvoiceCategoryUk;
    const quantity = Number(raw.quantity);
    const pricePerUnit = Number(raw.pricePerUnit);
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const price =
      Number.isFinite(pricePerUnit) && pricePerUnit >= 0 ? pricePerUnit : 0;
    const computedAmount = round2(qty * price);
    const declaredTotal =
      raw.totalAmount != null && Number.isFinite(Number(raw.totalAmount))
        ? round2(Number(raw.totalAmount))
        : null;
    // Допуск 2 коп. на рядок (OCR/округлення)
    const lineMathOk =
      declaredTotal == null || Math.abs(declaredTotal - computedAmount) <= 0.02;
    const total = declaredTotal ?? computedAmount;
    const unitRaw = String(raw.unit ?? "шт").trim() || "шт";
    const article =
      typeof raw.article === "string" && raw.article.trim()
        ? raw.article.trim()
        : null;
    const size =
      typeof raw.size === "string" && raw.size.trim()
        ? raw.size.trim()
        : null;
    const lineVatRate = parseInvoiceVatRate(raw.vatRate) ?? docVatRate;
    const lineVatAmount =
      raw.vatAmount != null && Number.isFinite(Number(raw.vatAmount))
        ? round2(Number(raw.vatAmount))
        : null;
    const lineInclVat =
      raw.amountInclVat != null && Number.isFinite(Number(raw.amountInclVat))
        ? round2(Number(raw.amountInclVat))
        : null;
    const reviewReasons: string[] = [];
    if (!lineMathOk && declaredTotal != null) {
      reviewReasons.push(
        `к-сть×ціна ${computedAmount.toFixed(2)} ₴ ≠ сума ${declaredTotal.toFixed(2)} ₴`
      );
    }

    const selectedId =
      typeof raw.selectedExistingItemId === "string" &&
      raw.selectedExistingItemId.trim()
        ? raw.selectedExistingItemId.trim().toLowerCase()
        : null;
    const confirmCreateNew = raw.confirmCreateNew === true;

    const baseLine = {
      lineId: `line-${index + 1}`,
      name,
      category,
      quantity: qty,
      unit: unitRaw,
      unitRaw,
      article,
      size,
      pricePerUnit: price,
      totalAmount: total,
      computedAmount,
      lineMathOk,
      vatRate: lineVatRate,
      vatAmount: lineVatAmount,
      amountInclVat: lineInclVat,
      selectedExistingItemId: selectedId,
      confirmCreateNew,
    };

    if (category === "Паливо" || mapInvoiceCategoryToDb(category) == null) {
      return {
        ...baseLine,
        matchStatus: "skipped_fuel" as const,
        existingItemId: null,
        existingItemName: null,
        matchConfidence: 0,
        unitConflict: false,
        needsReview: !lineMathOk,
        reviewReasons,
        candidates: [],
      };
    }

    // Користувач уже обрав кандидата з превʼю
    if (selectedId) {
      const selected = rows.find(
        (r) => String(r.bas_ref_key).toLowerCase() === selectedId
      );
      if (selected) {
        const display = displayCatalogName(selected);
        const cacheUnit = String(selected.unit ?? "").trim() || unitRaw;
        const unitConflict = !unitsCompatible(unitRaw, cacheUnit);
        if (unitConflict) {
          reviewReasons.push(
            `од. вим.: у накладній «${unitRaw}», у довіднику «${cacheUnit}»`
          );
        }
        return {
          ...baseLine,
          unit: unitConflict ? unitRaw : cacheUnit,
          matchStatus: "existing" as const,
          existingItemId: String(selected.bas_ref_key),
          existingItemName: display,
          matchConfidence: 100,
          unitConflict,
          needsReview: reviewReasons.length > 0,
          reviewReasons,
          candidates: [],
        };
      }
    }

    const { exact, candidates: candHits } = findCatalogMatches(rows, {
      name,
      article,
      unit: unitRaw,
      size,
    });
    const candidates = toPublicCandidates(
      exact ? [exact, ...candHits].slice(0, 5) : candHits
    );

    if (exact) {
      const display = displayCatalogName(exact.row);
      const cacheUnit = String(exact.row.unit ?? "").trim() || unitRaw;
      const unitConflict = !unitsCompatible(unitRaw, cacheUnit);
      if (unitConflict) {
        reviewReasons.push(
          `од. вим.: у накладній «${unitRaw}», у довіднику «${cacheUnit}»`
        );
      }
      if (article && !exact.row.code?.trim()) {
        reviewReasons.push(
          `артикул накладної «${article}» — у довіднику немає code`
        );
      }
      return {
        ...baseLine,
        unit: unitConflict ? unitRaw : cacheUnit,
        matchStatus: "existing" as const,
        existingItemId: String(exact.row.bas_ref_key),
        existingItemName: display,
        matchConfidence: exact.score,
        unitConflict,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        candidates: candidates.filter(
          (c) => c.basRefKey !== String(exact.row.bas_ref_key)
        ),
      };
    }

    // Є схожі в довіднику — забороняємо мовчки створювати «нову»
    if (candidates.length > 0) {
      if (confirmCreateNew) {
        reviewReasons.push(
          "підтверджено створення нової попри схожі позиції в довіднику"
        );
        return {
          ...baseLine,
          matchStatus: "new" as const,
          existingItemId: null,
          existingItemName: null,
          matchConfidence: candidates[0]?.score ?? 0,
          unitConflict: false,
          needsReview: true,
          reviewReasons,
          candidates,
        };
      }
      reviewReasons.push(
        `знайдено ${candidates.length} схож.${candidates.length === 1 ? "у" : "их"} у довіднику — оберіть або підтвердіть «створити нову»`
      );
      return {
        ...baseLine,
        matchStatus: "new" as const,
        existingItemId: null,
        existingItemName: null,
        matchConfidence: candidates[0]?.score ?? 0,
        unitConflict: false,
        needsReview: true,
        reviewReasons,
        candidates,
      };
    }

    const newReasons = [
      ...reviewReasons,
      "немає точного збігу — підтвердіть нову номенклатуру",
    ];
    if (article) {
      newReasons.push(`артикул «${article}» відсутній у довіднику`);
    }
    return {
      ...baseLine,
      matchStatus: "new" as const,
      existingItemId: null,
      existingItemName: null,
      matchConfidence: 0,
      unitConflict: false,
      needsReview: true,
      reviewReasons: newReasons,
      candidates: [],
    };
  });

  const linesSum = round2(
    previewItems
      .filter((i) => i.matchStatus !== "skipped_fuel")
      .reduce((sum, line) => sum + line.totalAmount, 0)
  );
  const hasExplicitTotal =
    input.totalAmount != null && Number.isFinite(Number(input.totalAmount));
  const totalAmount = hasExplicitTotal
    ? round2(Number(input.totalAmount))
    : linesSum;
  const totalMismatch =
    hasExplicitTotal && Math.abs(totalAmount - linesSum) > 0.05;

  // ПДВ: якщо є ставка й сума без ПДВ — звіряємо суму ПДВ / з ПДВ
  let vatMismatch = false;
  if (docVatRate && docVatRate !== "none" && hasExplicitTotal) {
    const pct = Number(docVatRate);
    if (Number.isFinite(pct) && pct > 0) {
      const expectedVat = round2((totalAmount * pct) / 100);
      const expectedIncl = round2(totalAmount + expectedVat);
      if (docVatAmount != null && Math.abs(docVatAmount - expectedVat) > 0.05) {
        vatMismatch = true;
      }
      if (
        docTotalInclVat != null &&
        Math.abs(docTotalInclVat - expectedIncl) > 0.05
      ) {
        vatMismatch = true;
      }
    }
  } else if (
    docTotalInclVat != null &&
    hasExplicitTotal &&
    Math.abs(docTotalInclVat - totalAmount) > 0.05 &&
    docVatRate === "none"
  ) {
    vatMismatch = true;
  } else if (
    docTotalInclVat != null &&
    docVatAmount != null &&
    hasExplicitTotal &&
    Math.abs(docTotalInclVat - round2(totalAmount + docVatAmount)) > 0.05
  ) {
    vatMismatch = true;
  }

  if (totalMismatch || vatMismatch) {
    for (const line of previewItems) {
      if (line.matchStatus === "skipped_fuel") continue;
      if (totalMismatch && !line.reviewReasons.some((r) => r.includes("підсумок"))) {
        line.needsReview = true;
        line.reviewReasons = [
          ...line.reviewReasons,
          `сума рядків ${linesSum} ₴ ≠ підсумок накладної ${totalAmount} ₴`,
        ];
      }
      if (vatMismatch && !line.reviewReasons.some((r) => r.includes("ПДВ"))) {
        line.needsReview = true;
        line.reviewReasons = [
          ...line.reviewReasons,
          "розбіжність ПДВ / суми з ПДВ у шапці документа",
        ];
      }
    }
  }

  return {
    status: "invoice_preview_ready",
    receiptId: crypto.randomUUID(),
    supplierName,
    supplierEdrpou: input.supplierEdrpou?.trim() || null,
    invoiceNumber: input.invoiceNumber?.trim() || null,
    invoiceDate: (input.invoiceDate?.trim() || todayKyivYmd()).slice(0, 10),
    items: previewItems,
    totalAmount,
    linesSum,
    totalMismatch,
    vatRate: docVatRate,
    vatAmount: docVatAmount,
    totalInclVat: docTotalInclVat,
    vatMismatch,
    needsReviewCount: previewItems.filter((i) => i.needsReview).length,
    newItemsCount: previewItems.filter((i) => i.matchStatus === "new").length,
    existingItemsCount: previewItems.filter((i) => i.matchStatus === "existing")
      .length,
    skippedFuelCount: previewItems.filter(
      (i) => i.matchStatus === "skipped_fuel"
    ).length,
    lineMathMismatchCount: previewItems.filter((i) => !i.lineMathOk).length,
  };
}

export async function executeWarehouseReceipt(
  input: InvoiceReceiptInput & { receiptId?: string | null }
): Promise<
  | {
      success: true;
      status: "posted";
      receiptId: string;
      invoiceNumber: string | null;
      supplier: string;
      supplierName: string;
      itemsCount: number;
      moveIds: string[];
      createdItemIds: string[];
      postedLines: number;
      skippedFuelLines: number;
      totalAmount: number;
      basHandoffStatus: BasHandoffStatus;
      basDraftRefKey: string | null;
      basLinesInDraft: number;
      basLinesSkippedLocal: number;
      message: string;
    }
  | { success: false; status: "error"; error: string }
> {
  const preview = await buildInvoicePreview(input);
  if (preview.status === "error") {
    return { success: false, status: "error", error: preview.error };
  }

  const receiptId = input.receiptId?.trim() || preview.receiptId;
  const supabase = createServiceSupabase();

  const { error: receiptInsertError } = await supabase
    .from("warehouse_receipts")
    .insert({
      id: receiptId,
      supplier_name: preview.supplierName,
      supplier_edrpou: preview.supplierEdrpou,
      invoice_number: preview.invoiceNumber,
      invoice_date: preview.invoiceDate,
      total_amount: preview.totalAmount,
      status: "posted",
      source: "levadius",
      bas_handoff_status: "local_saved",
    });

  const receiptTableMissing =
    Boolean(receiptInsertError) &&
    (receiptInsertError!.code === "PGRST205" ||
      receiptInsertError!.code === "42P01" ||
      receiptInsertError!.message?.includes("warehouse_receipts"));

  if (receiptInsertError && !receiptTableMissing) {
    // bas_handoff_status може ще не існувати
    if (receiptInsertError.message?.includes("bas_handoff_status")) {
      const retry = await supabase.from("warehouse_receipts").insert({
        id: receiptId,
        supplier_name: preview.supplierName,
        supplier_edrpou: preview.supplierEdrpou,
        invoice_number: preview.invoiceNumber,
        invoice_date: preview.invoiceDate,
        total_amount: preview.totalAmount,
        status: "posted",
        source: "levadius",
      });
      if (retry.error) {
        return {
          success: false,
          status: "error",
          error: `Не вдалося зберегти накладну: ${retry.error.message}`,
        };
      }
    } else {
      return {
        success: false,
        status: "error",
        error: `Не вдалося зберегти накладну: ${receiptInsertError.message}`,
      };
    }
  }

  const moveIds: string[] = [];
  const createdItemIds: string[] = [];
  let postedLines = 0;
  let skippedFuelLines = 0;

  const noteBase = [
    preview.supplierName,
    preview.invoiceNumber ? `№${preview.invoiceNumber}` : null,
    preview.invoiceDate ? `від ${preview.invoiceDate}` : null,
    "LEVADIUS накладна",
  ]
    .filter(Boolean)
    .join(" · ");

  for (const line of preview.items) {
    if (line.matchStatus === "skipped_fuel") {
      skippedFuelLines += 1;
      continue;
    }
    if (!(line.quantity > 0)) continue;

    const categoryKey = mapInvoiceCategoryToDb(line.category);
    if (!categoryKey) {
      skippedFuelLines += 1;
      continue;
    }

    let itemRef = line.existingItemId;
    if (!itemRef) {
      // Захист від дублів: є кандидати, але немає явного confirmCreateNew
      if (
        line.candidates.length > 0 &&
        line.confirmCreateNew !== true &&
        !line.selectedExistingItemId
      ) {
        return {
          success: false,
          status: "error",
          error: `«${line.name}»: оберіть позицію з довідника або підтвердіть створення нової (є ${line.candidates.length} схож.).`,
        };
      }
      const created = await createLocalInventoryItem({
        name: line.name,
        category: categoryKey,
        unit: line.unit,
        plannedPriceUah: line.pricePerUnit,
        article: line.article,
        allowDuplicate: line.confirmCreateNew === true,
      });
      if (!created.ok) {
        return {
          success: false,
          status: "error",
          error: `Не вдалося створити «${line.name}»: ${created.error}`,
        };
      }
      itemRef = created.basRefKey;
      if (created.created) createdItemIds.push(itemRef);
    }

    const inbound = await createLocalInboundMove({
      itemRefKey: itemRef,
      qty: line.quantity,
      unitPriceUah: line.pricePerUnit,
      buyerName: preview.supplierName,
      note: noteBase,
      season: DEFAULT_SEASON,
      date: preview.invoiceDate,
      receiptId: receiptTableMissing ? null : receiptId,
      skipBasDraft: !receiptTableMissing,
    });

    if (!inbound.ok) {
      return {
        success: false,
        status: "error",
        error: `Не вдалося оприбуткувати «${line.name}»: ${inbound.error}`,
      };
    }

    moveIds.push(inbound.id);
    postedLines += 1;
  }

  if (postedLines === 0) {
    return {
      success: false,
      status: "error",
      error:
        skippedFuelLines > 0
          ? "Усі рядки — паливо/непідтримувані. Паливо оприбутковується через /fuel."
          : "Немає валідних рядків для оприбуткування.",
    };
  }

  let basHandoffStatus: BasHandoffStatus = "local_saved";
  let basDraftRefKey: string | null = null;
  let basLinesInDraft = 0;
  let basLinesSkippedLocal = 0;

  if (!receiptTableMissing) {
    const bas = await enqueueWarehouseReceiptBasDraft(receiptId);
    basHandoffStatus = bas.handoffStatus;
    basDraftRefKey = bas.refKey ?? null;
    basLinesInDraft = bas.linesInDraft ?? 0;
    basLinesSkippedLocal = bas.linesSkippedLocal ?? 0;
  }

  return {
    success: true,
    status: "posted",
    receiptId,
    invoiceNumber: preview.invoiceNumber,
    supplier: preview.supplierName,
    supplierName: preview.supplierName,
    itemsCount: postedLines,
    moveIds,
    createdItemIds,
    postedLines,
    skippedFuelLines,
    totalAmount: preview.totalAmount,
    basHandoffStatus,
    basDraftRefKey,
    basLinesInDraft,
    basLinesSkippedLocal,
    message: [
      `Оприбутковано ${postedLines} позицій${
        preview.invoiceNumber ? ` (накл. №${preview.invoiceNumber})` : ""
      } на склад LEVADA.`,
      describeBasHandoff(basHandoffStatus),
      basHandoffStatus === "bas_draft_posted" && basDraftRefKey
        ? `Ref_Key ${basDraftRefKey}. У BAS: непроведені «Надходження товарів і послуг» (1 документ на всю накладну).`
        : null,
      basLinesInDraft > 0 && basHandoffStatus !== "bas_draft_posted"
        ? `Підготовлено ${basLinesInDraft} змаплених рядків для однієї чернетки BAS.`
        : basLinesInDraft > 0
          ? `У чернетці BAS: ${basLinesInDraft} рядків.`
          : null,
      basLinesSkippedLocal > 0
        ? `${basLinesSkippedLocal} нових позицій у чернетці з назвою з накладної (заглушка «Товари»).`
        : null,
      basHandoffStatus !== "bas_draft_posted"
        ? "Якщо треба дослати: sendWarehouseReceiptBasDraft. Excel «Передати» ≠ BAS."
        : "Excel «Передати» / sent_to_1c ≠ ця чернетка.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export type ReceiptRollbackItem = {
  moveId: string;
  itemRef: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPriceUah: number | null;
  currentStock: number;
  stockAfterRollback: number;
  shortage: boolean;
  moveStatus: string;
};

const CONFIRM_ROLLBACK_CHOICE = "Так, анулювати накладну та списати залишки";
const CANCEL_ROLLBACK_CHOICE = "Залишити накладну";

async function resolveReceiptRecord(input: {
  receiptId?: string | null;
  invoiceNumber?: string | null;
}): Promise<
  | {
      ok: true;
      receipt: {
        id: string;
        supplier_name: string;
        invoice_number: string | null;
        invoice_date: string | null;
        status: string;
        total_amount: number | null;
      };
      tableMissing: false;
    }
  | { ok: true; receipt: null; tableMissing: true }
  | { ok: false; error: string }
> {
  const supabase = createServiceSupabase();
  const receiptId = input.receiptId?.trim() || null;
  const invoiceNumber = input.invoiceNumber?.trim() || null;

  if (receiptId) {
    const { data, error } = await supabase
      .from("warehouse_receipts")
      .select(
        "id, supplier_name, invoice_number, invoice_date, status, total_amount"
      )
      .eq("id", receiptId)
      .maybeSingle();
    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("warehouse_receipts")
      ) {
        return { ok: true, receipt: null, tableMissing: true };
      }
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: "Накладну з таким ID не знайдено." };
    return {
      ok: true,
      tableMissing: false,
      receipt: {
        id: String(data.id),
        supplier_name: String(data.supplier_name ?? ""),
        invoice_number:
          typeof data.invoice_number === "string" ? data.invoice_number : null,
        invoice_date:
          typeof data.invoice_date === "string" ? data.invoice_date : null,
        status: String(data.status ?? "posted"),
        total_amount:
          data.total_amount != null && Number.isFinite(Number(data.total_amount))
            ? Number(data.total_amount)
            : null,
      },
    };
  }

  if (invoiceNumber) {
    const { data, error } = await supabase
      .from("warehouse_receipts")
      .select(
        "id, supplier_name, invoice_number, invoice_date, status, total_amount"
      )
      .eq("invoice_number", invoiceNumber)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("warehouse_receipts")
      ) {
        return { ok: true, receipt: null, tableMissing: true };
      }
      return { ok: false, error: error.message };
    }
    if (!data) {
      return {
        ok: false,
        error: `Накладну №${invoiceNumber} не знайдено в журналі надходжень.`,
      };
    }
    return {
      ok: true,
      tableMissing: false,
      receipt: {
        id: String(data.id),
        supplier_name: String(data.supplier_name ?? ""),
        invoice_number:
          typeof data.invoice_number === "string" ? data.invoice_number : null,
        invoice_date:
          typeof data.invoice_date === "string" ? data.invoice_date : null,
        status: String(data.status ?? "posted"),
        total_amount:
          data.total_amount != null && Number.isFinite(Number(data.total_amount))
            ? Number(data.total_amount)
            : null,
      },
    };
  }

  // Останній проведений прихід
  const { data, error } = await supabase
    .from("warehouse_receipts")
    .select(
      "id, supplier_name, invoice_number, invoice_date, status, total_amount"
    )
    .eq("status", "posted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("warehouse_receipts")
    ) {
      return { ok: true, receipt: null, tableMissing: true };
    }
    return { ok: false, error: error.message };
  }
  if (!data) {
    return {
      ok: false,
      error: "Немає проведених накладних для скасування.",
    };
  }
  return {
    ok: true,
    tableMissing: false,
    receipt: {
      id: String(data.id),
      supplier_name: String(data.supplier_name ?? ""),
      invoice_number:
        typeof data.invoice_number === "string" ? data.invoice_number : null,
      invoice_date:
        typeof data.invoice_date === "string" ? data.invoice_date : null,
      status: String(data.status ?? "posted"),
      total_amount:
        data.total_amount != null && Number.isFinite(Number(data.total_amount))
          ? Number(data.total_amount)
          : null,
    },
  };
}

async function loadReceiptInboundLines(input: {
  receiptId?: string | null;
  invoiceNumber?: string | null;
  supplierName?: string | null;
}): Promise<
  | { ok: true; lines: ReceiptRollbackItem[] }
  | { ok: false; error: string }
> {
  const supabase = createServiceSupabase();
  const receiptId = input.receiptId?.trim() || null;
  const invoiceNumber = input.invoiceNumber?.trim() || null;

  let movesQuery = supabase
    .from("inventory_local_moves")
    .select(
      "id, item_ref_key, qty, unit_price_uah, status, type, note, buyer_name"
    )
    .eq("type", "inbound")
    .order("date", { ascending: true })
    .limit(500);

  if (receiptId) {
    movesQuery = movesQuery.eq("receipt_id", receiptId);
  } else if (invoiceNumber) {
    movesQuery = movesQuery.ilike("note", `%№${invoiceNumber}%`);
  } else {
    return { ok: false, error: "Немає критерію для пошуку рухів накладної." };
  }

  const { data, error } = await movesQuery;
  if (error) {
    if (
      error.message?.includes("receipt_id") ||
      error.code === "PGRST205" ||
      error.code === "42P01"
    ) {
      // Fallback без receipt_id — шукаємо по нотатці
      if (!invoiceNumber) {
        return {
          ok: false,
          error:
            "Міграція 062 не застосована і немає номера накладної для пошуку рухів.",
        };
      }
      const legacy = await supabase
        .from("inventory_local_moves")
        .select(
          "id, item_ref_key, qty, unit_price_uah, status, type, note, buyer_name"
        )
        .eq("type", "inbound")
        .ilike("note", `%№${invoiceNumber}%`)
        .limit(500);
      if (legacy.error) return { ok: false, error: legacy.error.message };
      return buildRollbackLines(legacy.data ?? []);
    }
    return { ok: false, error: error.message };
  }

  return buildRollbackLines(data ?? []);
}

async function buildRollbackLines(
  rows: Record<string, unknown>[]
): Promise<
  | { ok: true; lines: ReceiptRollbackItem[] }
  | { ok: false; error: string }
> {
  if (rows.length === 0) {
    return { ok: false, error: "До накладної не знайдено прихідних рухів." };
  }

  const stock = await loadAgentInventoryStock({
    includeZero: true,
    limit: 3_000,
  });
  if (stock.error && stock.items.length === 0) {
    return { ok: false, error: stock.error };
  }

  const byRef = new Map(
    stock.items.map((item) => [item.ref.toLowerCase(), item])
  );
  const nameCache = new Map<string, string>();

  // Добираємо назви для позицій, яких немає в stock (нульові / приховані)
  const missingRefs = rows
    .map((row) => String(row.item_ref_key ?? "").toLowerCase())
    .filter((ref) => ref && !byRef.has(ref));
  if (missingRefs.length > 0) {
    const supabase = createServiceSupabase();
    const { data: names } = await supabase
      .from("inventory_items_cache")
      .select("bas_ref_key, name, custom_name, unit")
      .in("bas_ref_key", [...new Set(missingRefs)]);
    for (const row of names ?? []) {
      const key = String(row.bas_ref_key).toLowerCase();
      nameCache.set(
        key,
        (typeof row.custom_name === "string" && row.custom_name.trim()) ||
          String(row.name ?? "ТМЦ")
      );
      if (!byRef.has(key)) {
        byRef.set(key, {
          kind: "inventory",
          ref: key,
          name: nameCache.get(key) || "ТМЦ",
          categoryKey: "",
          category: "",
          unit: String(row.unit ?? "од."),
          quantity: 0,
        });
      }
    }
  }

  const lines: ReceiptRollbackItem[] = [];
  for (const row of rows) {
    const itemRef = String(row.item_ref_key ?? "").toLowerCase();
    if (!itemRef) continue;
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const stockLine = byRef.get(itemRef);
    const currentStock = stockLine?.quantity ?? 0;
    const stockAfter = Math.round((currentStock - qty) * 1000) / 1000;
    const priceRaw = row.unit_price_uah;
    lines.push({
      moveId: String(row.id ?? ""),
      itemRef,
      itemName: stockLine?.name || nameCache.get(itemRef) || "ТМЦ",
      quantity: qty,
      unit: stockLine?.unit || "од.",
      unitPriceUah:
        priceRaw != null && Number.isFinite(Number(priceRaw))
          ? Number(priceRaw)
          : null,
      currentStock,
      stockAfterRollback: stockAfter,
      shortage: stockAfter < -0.0005,
      moveStatus: String(row.status ?? "draft"),
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: "Немає валідних позицій для сторно." };
  }
  return { ok: true, lines };
}

export async function rollbackWarehouseReceipt(input: {
  receiptId?: string | null;
  invoiceNumber?: string | null;
  confirmed?: boolean;
}): Promise<
  | {
      success: false;
      status: "requires_confirmation";
      receiptId: string;
      invoiceNumber: string | null;
      supplier: string;
      invoiceDate: string | null;
      items: ReceiptRollbackItem[];
      itemsSummary: string;
      shortageWarnings: string[];
      warning: string;
      userHint: string;
      confirmChoice: string;
      cancelChoice: string;
    }
  | {
      success: true;
      status: "rolled_back";
      receiptId: string;
      invoiceNumber: string | null;
      supplier: string;
      rolledBackItems: ReceiptRollbackItem[];
      deletedMoveIds: string[];
      shortageWarnings: string[];
      message: string;
    }
  | { success: false; status: "error"; error: string }
> {
  const confirmed = input.confirmed === true;
  const resolved = await resolveReceiptRecord({
    receiptId: input.receiptId,
    invoiceNumber: input.invoiceNumber,
  });
  if (!resolved.ok) {
    return { success: false, status: "error", error: resolved.error };
  }

  let receiptId = resolved.receipt?.id ?? input.receiptId?.trim() ?? null;
  let invoiceNumber =
    resolved.receipt?.invoice_number ?? input.invoiceNumber?.trim() ?? null;
  let supplier = resolved.receipt?.supplier_name ?? "";
  let invoiceDate = resolved.receipt?.invoice_date ?? null;

  if (resolved.tableMissing) {
    // Без журналу — шукаємо останній LEVADIUS-inbound за номером / останній з нотаткою
    const supabase = createServiceSupabase();
    let q = supabase
      .from("inventory_local_moves")
      .select("id, note, buyer_name, date")
      .eq("type", "inbound")
      .ilike("note", "%LEVADIUS%")
      .order("date", { ascending: false })
      .limit(1);
    if (invoiceNumber) {
      q = supabase
        .from("inventory_local_moves")
        .select("id, note, buyer_name, date")
        .eq("type", "inbound")
        .ilike("note", `%№${invoiceNumber}%`)
        .order("date", { ascending: false })
        .limit(1);
    }
    const { data: tip, error: tipErr } = await q.maybeSingle();
    if (tipErr) {
      return { success: false, status: "error", error: tipErr.message };
    }
    if (!tip) {
      return {
        success: false,
        status: "error",
        error:
          "Журнал warehouse_receipts відсутній і немає LEVADIUS-приходів для сторно.",
      };
    }
    const note = typeof tip.note === "string" ? tip.note : "";
    invoiceNumber =
      invoiceNumber || note.match(/№\s*([^\s·]+)/)?.[1]?.trim() || null;
    supplier =
      (typeof tip.buyer_name === "string" && tip.buyer_name.trim()) ||
      note.split("·")[0]?.trim() ||
      "Постачальник";
    receiptId = receiptId || `legacy:${String(tip.id)}`;
  }

  if (resolved.receipt?.status === "cancelled") {
    return {
      success: false,
      status: "error",
      error: `Накладна${invoiceNumber ? ` №${invoiceNumber}` : ""} уже скасована.`,
    };
  }

  if (!receiptId && !invoiceNumber) {
    return {
      success: false,
      status: "error",
      error: "Не вдалося визначити накладну для скасування.",
    };
  }

  const linesRes = await loadReceiptInboundLines({
    receiptId: receiptId?.startsWith("legacy:") ? null : receiptId,
    invoiceNumber,
    supplierName: supplier,
  });
  if (!linesRes.ok) {
    return { success: false, status: "error", error: linesRes.error };
  }

  const items = linesRes.lines;
  const shortageWarnings = items
    .filter((line) => line.shortage)
    .map(
      (line) =>
        `«${line.itemName}»: після сторно залишок ${line.stockAfterRollback} ${line.unit} (зараз ${line.currentStock}). Частину вже списано.`
    );
  const blocked = items.filter((line) => line.moveStatus !== "draft");
  const itemsSummary = items
    .map((line) => `${line.itemName} — ${line.quantity} ${line.unit}`)
    .join("; ");

  const userHint = `Скасувати накладну${
    invoiceNumber ? ` №${invoiceNumber}` : ""
  } від ${supplier || "постачальника"}? Це спише назад зі складу: ${itemsSummary}.`;

  if (!confirmed) {
    return {
      success: false,
      status: "requires_confirmation",
      receiptId: receiptId || "",
      invoiceNumber,
      supplier: supplier || "Постачальник",
      invoiceDate,
      items,
      itemsSummary,
      shortageWarnings,
      warning:
        shortageWarnings.length > 0
          ? `Увага: по частині позицій залишку вже не вистачає (списано на поле). Сторно все одно можна провести — баланс стане від’ємним / потребуватиме корекції. ${shortageWarnings.join(" ")}`
          : blocked.length > 0
            ? "Деякі рухи вже передано бухгалтеру (sent_to_1c) — їх не можна видалити автоматично."
            : "Анулювання видалить прихідні рухи цієї накладної і зменшить віртуальний залишок складу.",
      userHint,
      confirmChoice: CONFIRM_ROLLBACK_CHOICE,
      cancelChoice: CANCEL_ROLLBACK_CHOICE,
    };
  }

  if (blocked.length > 0) {
    return {
      success: false,
      status: "error",
      error: `Не можна скасувати: ${blocked.length} рух(ів) уже передано бухгалтеру. Скасування лише для draft.`,
    };
  }

  const deletedMoveIds: string[] = [];
  const rolledBackItems: ReceiptRollbackItem[] = [];
  for (const line of items) {
    const del = await deleteLocalMove(line.moveId);
    if (!del.ok) {
      return {
        success: false,
        status: "error",
        error: `Не вдалося видалити рух «${line.itemName}»: ${del.error}`,
      };
    }
    deletedMoveIds.push(line.moveId);
    rolledBackItems.push(line);
  }

  if (receiptId && !receiptId.startsWith("legacy:")) {
    const supabase = createServiceSupabase();
    const { error: cancelErr } = await supabase
      .from("warehouse_receipts")
      .update({ status: "cancelled" })
      .eq("id", receiptId);
    if (
      cancelErr &&
      cancelErr.code !== "PGRST205" &&
      cancelErr.code !== "42P01" &&
      !cancelErr.message?.includes("warehouse_receipts")
    ) {
      return {
        success: false,
        status: "error",
        error: `Рухи видалено, але статус накладної не оновлено: ${cancelErr.message}`,
      };
    }
  }

  return {
    success: true,
    status: "rolled_back",
    receiptId: receiptId || "",
    invoiceNumber,
    supplier: supplier || "Постачальник",
    rolledBackItems,
    deletedMoveIds,
    shortageWarnings,
    message: `Скасовано накладну${
      invoiceNumber ? ` №${invoiceNumber}` : ""
    }: повернуто ${rolledBackItems.length} позицій зі складу.`,
  };
}

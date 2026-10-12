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

export type InvoiceLineInput = {
  name: string;
  category: InvoiceCategoryUk;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalAmount?: number | null;
  /** Артикул / код постачальника або BAS */
  article?: string | null;
};

export type InvoiceReceiptInput = {
  supplierName: string;
  supplierEdrpou?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  items: InvoiceLineInput[];
  totalAmount?: number | null;
};

export type InvoicePreviewLine = InvoiceLineInput & {
  lineId: string;
  totalAmount: number;
  matchStatus: "existing" | "new" | "skipped_fuel";
  existingItemId: string | null;
  existingItemName: string | null;
  article: string | null;
  unitRaw: string;
  matchConfidence: number;
  unitConflict: boolean;
  needsReview: boolean;
  reviewReasons: string[];
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
  needsReviewCount: number;
  newItemsCount: number;
  existingItemsCount: number;
  skippedFuelCount: number;
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

function matchCatalogItem(
  rows: CatalogRow[],
  name: string,
  article: string | null
): { row: CatalogRow; confidence: number; weakFuzzy: boolean } | null {
  if (article) {
    const art = normalizeArticle(article);
    const byCode = rows.find(
      (row) =>
        typeof row.code === "string" &&
        row.code.trim() &&
        normalizeArticle(row.code) === art
    );
    if (byCode) return { row: byCode, confidence: 98, weakFuzzy: false };
  }

  const needle = normalizeName(name);
  const exact = rows.find((row) => {
    const display = displayCatalogName(row);
    return normalizeName(display) === needle;
  });
  if (exact) return { row: exact, confidence: 95, weakFuzzy: false };

  // Сильний fuzzy: один рядок містить інший і довжина ≥ 4
  const strong = rows.filter((row) => {
    const n = normalizeName(displayCatalogName(row));
    if (n.length < 4 || needle.length < 4) return false;
    return n.includes(needle) || needle.includes(n);
  });
  if (strong.length === 1) {
    return { row: strong[0]!, confidence: 72, weakFuzzy: true };
  }
  if (strong.length > 1) {
    // найкоротша різниця довжин
    const ranked = [...strong].sort(
      (a, b) =>
        Math.abs(normalizeName(displayCatalogName(a)).length - needle.length) -
        Math.abs(normalizeName(displayCatalogName(b)).length - needle.length)
    );
    return { row: ranked[0]!, confidence: 55, weakFuzzy: true };
  }
  return null;
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
    const total =
      raw.totalAmount != null && Number.isFinite(Number(raw.totalAmount))
        ? round2(Number(raw.totalAmount))
        : round2(qty * price);
    const unitRaw = String(raw.unit ?? "шт").trim() || "шт";
    const article =
      typeof raw.article === "string" && raw.article.trim()
        ? raw.article.trim()
        : null;
    const reviewReasons: string[] = [];

    if (category === "Паливо" || mapInvoiceCategoryToDb(category) == null) {
      return {
        lineId: `line-${index + 1}`,
        name,
        category,
        quantity: qty,
        unit: unitRaw,
        unitRaw,
        article,
        pricePerUnit: price,
        totalAmount: total,
        matchStatus: "skipped_fuel" as const,
        existingItemId: null,
        existingItemName: null,
        matchConfidence: 0,
        unitConflict: false,
        needsReview: false,
        reviewReasons: [],
      };
    }

    const matched = matchCatalogItem(rows, name, article);
    if (matched) {
      const display = displayCatalogName(matched.row);
      const cacheUnit = String(matched.row.unit ?? "").trim() || unitRaw;
      const unitConflict =
        normalizeUnitKey(unitRaw) !== normalizeUnitKey(cacheUnit);
      if (unitConflict) {
        reviewReasons.push(
          `од. вим.: у накладній «${unitRaw}», у довіднику «${cacheUnit}»`
        );
      }
      if (matched.weakFuzzy || matched.confidence < 80) {
        reviewReasons.push(`слабкий збіг назви → «${display}»`);
      }
      const needsReview = reviewReasons.length > 0;
      return {
        lineId: `line-${index + 1}`,
        name,
        category,
        quantity: qty,
        // Не підміняємо од. вим. мовчки при конфлікті
        unit: unitConflict ? unitRaw : cacheUnit,
        unitRaw,
        article,
        pricePerUnit: price,
        totalAmount: total,
        matchStatus: "existing" as const,
        existingItemId: String(matched.row.bas_ref_key),
        existingItemName: display,
        matchConfidence: matched.confidence,
        unitConflict,
        needsReview,
        reviewReasons,
      };
    }

    return {
      lineId: `line-${index + 1}`,
      name,
      category,
      quantity: qty,
      unit: unitRaw,
      unitRaw,
      article,
      pricePerUnit: price,
      totalAmount: total,
      matchStatus: "new" as const,
      existingItemId: null,
      existingItemName: null,
      matchConfidence: 0,
      unitConflict: false,
      needsReview: true,
      reviewReasons: ["нова номенклатура — перевірити назву й од. вим."],
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

  if (totalMismatch) {
    for (const line of previewItems) {
      if (line.matchStatus === "skipped_fuel") continue;
      if (!line.needsReview) {
        line.needsReview = true;
        line.reviewReasons = [
          ...line.reviewReasons,
          `сума рядків ${linesSum} ₴ ≠ підсумок накладної ${totalAmount} ₴`,
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
    needsReviewCount: previewItems.filter((i) => i.needsReview).length,
    newItemsCount: previewItems.filter((i) => i.matchStatus === "new").length,
    existingItemsCount: previewItems.filter((i) => i.matchStatus === "existing")
      .length,
    skippedFuelCount: previewItems.filter(
      (i) => i.matchStatus === "skipped_fuel"
    ).length,
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
      const created = await createLocalInventoryItem({
        name: line.name,
        category: categoryKey,
        unit: line.unit,
        plannedPriceUah: line.pricePerUnit,
      });
      if (!created.ok) {
        return {
          success: false,
          status: "error",
          error: `Не вдалося створити «${line.name}»: ${created.error}`,
        };
      }
      itemRef = created.basRefKey;
      createdItemIds.push(itemRef);
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
      basLinesInDraft > 0
        ? `У чернетку BAS потрапить ${basLinesInDraft} змаплених рядків.`
        : null,
      basLinesSkippedLocal > 0
        ? `${basLinesSkippedLocal} локальних (без BAS-ключа) лишаються лише в LEVADA.`
        : null,
      "Excel-статус sent_to_1c ≠ чернетка в BAS.",
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

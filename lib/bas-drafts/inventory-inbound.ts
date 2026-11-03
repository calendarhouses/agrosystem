/**
 * Прихід ТМЦ → чернетка Document_ПоступлениеТоваровУслуг (Posted: false).
 *
 * Основний шлях: enqueueWarehouseReceiptBasDraft(receiptId) —
 * 1 накладна = 1 документ з Товары[].
 * Per-move enqueueInventoryInboundBasDraft — лише для ручних приходів без receipt.
 */

import {
  resolveBasInventoryAccountKey,
  resolveBasTaxPurposeVatKey,
} from "@/lib/bas-drafts/accounts";
import {
  basDefaultWarehouseKey,
  basOrganizationKey,
  basUnmappedNomenclatureKey,
  isBasDraftPipelineEnabled,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { resolveBasMainContractKey } from "@/lib/bas-drafts/contract";
import { resolveBasCounterpartyKey } from "@/lib/bas-drafts/counterparty";
import { resolveBasNomenclatureKey } from "@/lib/bas-drafts/nomenclature";
import {
  patchBasDocumentDraft,
  postBasDocumentDraft,
  toIsoDateTime,
} from "@/lib/bas-drafts/post";
import type { BasHandoffStatus } from "@/lib/bas-drafts/statuses";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
  markWarehouseHandoffStatus,
} from "@/lib/bas-drafts/track";
import { resolveBasUnitKey } from "@/lib/bas-drafts/units";
import {
  basVatRateLabel,
  computeInventoryVat,
  isInventoryVatRateId,
  type InventoryVatRateId,
} from "@/lib/inventory-vat";
import { createServiceSupabase } from "@/lib/supabase/server";

const ENTITY = "Document_ПоступлениеТоваровУслуг";
const PIPELINE_ID = "inventory_inbound_receipt";

export type WarehouseReceiptBasDraftResult = {
  ok: boolean;
  dryRun: boolean;
  handoffStatus: BasHandoffStatus;
  refKey?: string;
  linesInDraft?: number;
  linesSkippedLocal?: number;
  error?: string;
};

/**
 * 1 накладна → 1 непроведена Поступление з усіма змапленими рядками.
 * `forceUpdateRefKey` — оновити існуючу чернетку PATCH (без нового документа).
 */
export async function enqueueWarehouseReceiptBasDraft(
  receiptId: string,
  options?: {
    forceUpdateRefKey?: string | null;
    /** Код Catalog_Контрагенты (не ЄДРПОУ) — якщо бухгалтер ввів вручну */
    basCounterpartyCode?: string | null;
  }
): Promise<WarehouseReceiptBasDraftResult> {
  const supabase = createServiceSupabase();
  let forceUpdateRefKey =
    options?.forceUpdateRefKey?.trim().toLowerCase() || null;
  const basCounterpartyCode =
    options?.basCounterpartyCode?.trim() || null;

  const { data: receipt, error: receiptError } = await supabase
    .from("warehouse_receipts")
    .select(
      "id, supplier_name, supplier_edrpou, invoice_number, invoice_date, total_amount, bas_draft_ref_key, status"
    )
    .eq("id", receiptId)
    .maybeSingle();

  if (receiptError || !receipt) {
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      handoffStatus: "bas_draft_failed",
      error: "накладну не знайдено",
    };
  }

  // Якщо чернетка вже є — завжди PATCH (не silent success). Інакше
  // «Зберегти й надіслати» / retry після правки ПДВ·ЄДРПОУ нічого не оновлювали.
  if (receipt.bas_draft_ref_key && !forceUpdateRefKey) {
    forceUpdateRefKey = String(receipt.bas_draft_ref_key).toLowerCase();
  }

  type MoveRow = {
    id: string;
    qty: number | string | null;
    date: string | null;
    note: string | null;
    buyer_name: string | null;
    unit_price_uah: number | string | null;
    bas_draft_ref_key: string | null;
    item_ref_key: string | null;
    amount_ex_vat?: number | string | null;
    vat_rate?: string | null;
    vat_amount?: number | string | null;
    amount_incl_vat?: number | string | null;
    inventory_items_cache:
      | {
          bas_ref_key: string | null;
          name: string | null;
          unit: string | null;
          is_local: boolean | null;
          code: string | null;
          category?: string | null;
        }
      | Array<{
          bas_ref_key: string | null;
          name: string | null;
          unit: string | null;
          is_local: boolean | null;
          code: string | null;
          category?: string | null;
        }>
      | null;
  };

  let moves: MoveRow[] | null = null;
  let movesError: { message: string } | null = null;

  {
    const first = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id, qty, date, note, buyer_name, unit_price_uah, bas_draft_ref_key, item_ref_key,
        amount_ex_vat, vat_rate, vat_amount, amount_incl_vat,
        inventory_items_cache ( bas_ref_key, name, unit, is_local, code, category )
      `
      )
      .eq("receipt_id", receiptId)
      .eq("type", "inbound")
      .neq("status", "cancelled");
    moves = (first.data as MoveRow[] | null) ?? null;
    movesError = first.error;
  }

  if (
    movesError &&
    (movesError.message?.includes("amount_ex_vat") ||
      movesError.message?.includes("vat_rate") ||
      movesError.message?.includes("vat_amount") ||
      movesError.message?.includes("amount_incl_vat") ||
      movesError.message?.includes("category"))
  ) {
    const retry = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id, qty, date, note, buyer_name, unit_price_uah, bas_draft_ref_key, item_ref_key,
        inventory_items_cache ( bas_ref_key, name, unit, is_local, code, category )
      `
      )
      .eq("receipt_id", receiptId)
      .eq("type", "inbound")
      .neq("status", "cancelled");
    moves = (retry.data as MoveRow[] | null) ?? null;
    movesError = retry.error;
  }

  if (movesError) {
    await markWarehouseHandoffStatus({
      receiptId,
      status: "bas_draft_failed",
      error: movesError.message,
    });
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      handoffStatus: "bas_draft_failed",
      error: movesError.message,
    };
  }

  const rows = moves ?? [];
  type Line = {
    moveId: string;
    itemKey: string;
    name: string;
    qty: number;
    price: number;
    amountExVat: number;
    vatAmount: number;
    amountInclVat: number;
    vatRate: InventoryVatRateId | null;
    unitLabel: string;
    category: string | null;
    /** true = нової номенклатури ще немає в BAS — назва в НаименованиеПоставщика */
    unmapped: boolean;
  };
  const mapped: Line[] = [];
  let linesSkippedLocal = 0;
  let linesResolvedLive = 0;
  let linesUnmappedPlaceholder = 0;
  const unmappedKey = basUnmappedNomenclatureKey();

  for (const row of rows) {
    const cache = Array.isArray(row.inventory_items_cache)
      ? row.inventory_items_cache[0]
      : row.inventory_items_cache;
    const isLocal = cache?.is_local === true;
    const rawKey = cache?.bas_ref_key
      ? String(cache.bas_ref_key).toLowerCase()
      : row.item_ref_key
        ? String(row.item_ref_key).toLowerCase()
        : null;
    const looksLocalKey = !rawKey || rawKey.startsWith("local:");
    const displayName = cache?.name ? String(cache.name) : "ТМЦ";
    const unitLabel =
      typeof cache?.unit === "string" && cache.unit.trim()
        ? cache.unit.trim()
        : "шт";
    const category =
      typeof cache?.category === "string" && cache.category.trim()
        ? cache.category.trim()
        : null;
    const code =
      typeof cache?.code === "string" && cache.code.trim()
        ? cache.code.trim()
        : null;

    let itemKey =
      !isLocal && rawKey && !looksLocalKey ? rawKey : null;
    let unmapped = false;

    // Локальні / без ключа — спочатку шукаємо в Catalog_Номенклатура
    if (!itemKey) {
      const live = await resolveBasNomenclatureKey({
        name: displayName,
        code,
        article: code,
      });
      if (live.key) {
        itemKey = live.key;
        linesResolvedLive += 1;
        try {
          if (rawKey?.startsWith("local:")) {
            await supabase
              .from("inventory_items_cache")
              .update({
                bas_ref_key: live.key,
                is_local: false,
                code: code,
                name: live.matchedName || displayName,
              })
              .eq("bas_ref_key", rawKey);
          } else if (rawKey) {
            await supabase
              .from("inventory_items_cache")
              .update({ is_local: false, bas_ref_key: live.key })
              .eq("bas_ref_key", rawKey);
          }
          await supabase
            .from("inventory_local_moves")
            .update({ item_ref_key: live.key })
            .eq("id", row.id);
        } catch (linkErr) {
          console.warn("[bas-drafts] link nomenclature cache", linkErr);
        }
      }
    }

    // Новий товар: усе одно в чернетку — заглушка «Товари» + назва з накладної
    if (!itemKey) {
      itemKey = unmappedKey;
      unmapped = true;
      linesUnmappedPlaceholder += 1;
    }

    const qty = Number(row.qty) || 0;
    const price = Number(row.unit_price_uah) || 0;
    const vatRateRaw =
      "vat_rate" in row && isInventoryVatRateId(row.vat_rate)
        ? row.vat_rate
        : ("20" as InventoryVatRateId);
    const amountExVatHint =
      "amount_ex_vat" in row &&
      row.amount_ex_vat != null &&
      Number.isFinite(Number(row.amount_ex_vat))
        ? Number(row.amount_ex_vat)
        : null;
    // Завжди серверна трійка — не довіряємо старим vat_amount / amount_incl_vat у БД.
    const vat = computeInventoryVat({
      qty,
      unitPriceExVat: price,
      vatRate: vatRateRaw,
      amountExVat: amountExVatHint,
    });

    mapped.push({
      moveId: String(row.id),
      itemKey,
      name: displayName,
      qty,
      price: vat.unitPriceExVat,
      amountExVat: vat.amountExVat,
      vatAmount: vat.vatAmount,
      amountInclVat: vat.amountInclVat,
      vatRate: vatRateRaw,
      unitLabel,
      category,
      unmapped,
    });
  }

  if (linesResolvedLive > 0 || linesUnmappedPlaceholder > 0) {
    console.log("[bas-drafts] nomenclature resolve", receiptId, {
      live: linesResolvedLive,
      unmappedPlaceholder: linesUnmappedPlaceholder,
    });
  }

  if (mapped.length === 0) {
    await markWarehouseHandoffStatus({
      receiptId,
      status: "awaiting_bas_mapping",
      error: "немає рядків для чернетки",
    });
    return {
      ok: true,
      dryRun: !isBasDraftPostEnabled(),
      handoffStatus: "awaiting_bas_mapping",
      linesInDraft: 0,
      linesSkippedLocal,
      error: "немає рядків для чернетки",
    };
  }

  const edrpou =
    typeof receipt.supplier_edrpou === "string"
      ? receipt.supplier_edrpou.trim()
      : "";

  const live = isBasDraftPipelineEnabled(PIPELINE_ID);
  if (!live) {
    console.log(
      "[bas-drafts] receipt skip auto-post (pipeline off)",
      receiptId,
      { mapped: mapped.length, skippedLocal: linesSkippedLocal }
    );
    await markWarehouseHandoffStatus({
      receiptId,
      status: "bas_draft_dry_run",
    });
    return {
      ok: true,
      dryRun: true,
      handoffStatus: "bas_draft_dry_run",
      linesInDraft: mapped.length,
      linesSkippedLocal,
    };
  }

  const counterparty = await resolveBasCounterpartyKey({
    edrpou: receipt.supplier_edrpou,
    name: receipt.supplier_name,
    basCode: basCounterpartyCode,
  });

  // Без контрагента документ у BAS не створюємо — попередження бухгалтеру.
  if (!counterparty.key) {
    const warn =
      counterparty.reason ||
      (edrpou
        ? `контрагента з ЄДРПОУ ${edrpou} не знайдено в BAS`
        : `контрагента «${String(receipt.supplier_name || "").trim() || "—"}» не знайдено в BAS`);
    await markWarehouseHandoffStatus({
      receiptId,
      status: "awaiting_bas_mapping",
      error: warn,
    });
    return {
      ok: false,
      dryRun: false,
      handoffStatus: "awaiting_bas_mapping",
      linesInDraft: mapped.length,
      linesSkippedLocal,
      error: warn,
    };
  }

  // Ідемпотентність: якщо в BAS уже є чернетка з цим receiptId — PATCH, не POST.
  let reuseRefKey = forceUpdateRefKey;
  if (!reuseRefKey) {
    const existing = await findExistingReceiptDraftRefKey(receiptId);
    if (existing) {
      reuseRefKey = existing;
      console.log(
        "[bas-drafts] idempotent reuse existing draft",
        receiptId,
        existing
      );
    }
  }

  const [contract, taxPurposeKey] = await Promise.all([
    resolveBasMainContractKey(counterparty.key),
    resolveBasTaxPurposeVatKey(),
  ]);

  const org = basOrganizationKey();
  const warehouse = basDefaultWarehouseKey();
  const dateRaw =
    String(receipt.invoice_date ?? "").slice(0, 10) ||
    String(rows[0]?.date ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  // linesSkippedLocal у результаті = скільки пішло через заглушку «нові товари»
  linesSkippedLocal = linesUnmappedPlaceholder;

  const totalEx = mapped.reduce((s, l) => s + l.amountExVat, 0);
  const totalVat = mapped.reduce((s, l) => s + l.vatAmount, 0);
  const totalIncl = mapped.reduce((s, l) => s + l.amountInclVat, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const goodsLines: Record<string, unknown>[] = [];
  for (let index = 0; index < mapped.length; index += 1) {
    const line = mapped[index]!;
    const unit = await resolveBasUnitKey(line.unitLabel);
    const accountKey = await resolveBasInventoryAccountKey(line.category);
    const vatRate = isInventoryVatRateId(line.vatRate)
      ? line.vatRate
      : ("20" as InventoryVatRateId);
    // Поля за $metadata Document_ПоступлениеТоваровУслуг_Товары
    // (СчетУчетаБУ_Key; немає Всего / НалоговоеНазначениеНДС_Key / текст ЕдиницаИзмерения).
    const row: Record<string, unknown> = {
      LineNumber: index + 1,
      Номенклатура_Key: line.itemKey,
      Количество: line.qty,
      Коэффициент: 1,
      Цена: line.price,
      Сумма: line.amountExVat,
      СтавкаНДС: basVatRateLabel(vatRate),
      СуммаНДС: line.vatAmount,
      НаименованиеПоставщика: line.name.slice(0, 250),
    };
    if (unit.key) {
      row.ЕдиницаИзмерения_Key = unit.key;
    }
    if (accountKey) {
      row.СчетУчетаБУ_Key = accountKey;
    } else if (line.category) {
      console.warn(
        "[bas-drafts] немає СчетУчетаБУ_Key для категорії",
        line.category,
        "— задайте BAS_ACCOUNT_MAP / BAS_ACCOUNT_*_KEY"
      );
    }
    if (taxPurposeKey) {
      row.НалоговоеНазначение_Key = taxPurposeKey;
    }
    goodsLines.push(row);
  }

  const body: Record<string, unknown> = {
    Date: toIsoDateTime(dateRaw),
    Posted: false,
    DeletionMark: false,
    ВидОперации: "ПокупкаКомиссия",
    СуммаВключаетНДС: false,
    СуммаДокумента: round2(totalIncl),
    Комментарий: [
      "AgroSystem · прихід ТМЦ (чернетка)",
      `receipt:${receiptId}`,
      receipt.supplier_name ? String(receipt.supplier_name) : null,
      edrpou ? `ЄДРПОУ ${edrpou}` : null,
      receipt.invoice_number ? `№${receipt.invoice_number}` : null,
      receipt.invoice_date ? `від ${receipt.invoice_date}` : null,
      counterparty.matchedName
        ? `контрагент: ${counterparty.matchedName}`
        : null,
      contract.matchedName ? `договір: ${contract.matchedName}` : null,
      !contract.key ? "договір не знайдено — оберіть у BAS" : null,
      linesUnmappedPlaceholder > 0
        ? `нових позицій (заглушка «Товари» + назва постачальника): ${linesUnmappedPlaceholder}`
        : null,
      `без ПДВ ${round2(totalEx)} · ПДВ ${round2(totalVat)} · всього ${round2(totalIncl)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    Товары: goodsLines,
    _meta: { receiptId, pipeline: PIPELINE_ID },
  };
  if (org) body.Организация_Key = org;
  // У Document_ПоступлениеТоваровУслуг поле складу — «Склад», не Склад_Key
  if (warehouse) {
    body.Склад = warehouse;
    body.Склад_Type = "StandardODATA.Catalog_Склады";
  }
  body.Контрагент_Key = counterparty.key;
  if (contract.key) {
    body.ДоговорКонтрагента_Key = contract.key;
  }

  const result = reuseRefKey
    ? await patchBasDocumentDraft(ENTITY, reuseRefKey, body)
    : await postBasDocumentDraft(ENTITY, body);
  const moveIds = mapped.map((m) => m.moveId);

  if (!result.ok) {
    await markBasDraftFailure({
      table: "warehouse_receipts",
      ids: [receiptId],
      error: result.error,
      handoffStatus: "bas_draft_failed",
    });
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: moveIds,
      error: result.error,
    });
    return {
      ok: false,
      dryRun: result.dryRun,
      handoffStatus: "bas_draft_failed",
      linesInDraft: mapped.length,
      linesSkippedLocal,
      error: result.error,
    };
  }

  if (!result.dryRun) {
    await markBasDraftSuccess({
      table: "warehouse_receipts",
      ids: [receiptId],
      refKey: result.refKey,
      entitySet: ENTITY,
      handoffStatus: "bas_draft_posted",
    });
    await markBasDraftSuccess({
      table: "inventory_local_moves",
      ids: moveIds,
      refKey: result.refKey,
      entitySet: ENTITY,
    });
    return {
      ok: true,
      dryRun: false,
      handoffStatus: "bas_draft_posted",
      refKey: result.refKey,
      linesInDraft: mapped.length,
      linesSkippedLocal,
    };
  }

  await markWarehouseHandoffStatus({
    receiptId,
    status: "bas_draft_dry_run",
  });
  return {
    ok: true,
    dryRun: true,
    handoffStatus: "bas_draft_dry_run",
    linesInDraft: mapped.length,
    linesSkippedLocal,
  };
}

/**
 * Ручний одиночний прихід без receipt_id → однорядкова чернетка.
 * Якщо у move вже є receipt_id — делегуємо multi-line шляху.
 */
export async function enqueueInventoryInboundBasDraft(
  moveId: string
): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id, qty, date, note, buyer_name, unit_price_uah, bas_draft_ref_key, receipt_id,
      inventory_items_cache ( bas_ref_key, name, unit, is_local, category )
    `
    )
    .eq("id", moveId)
    .eq("type", "inbound")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, dryRun: !isBasDraftPostEnabled(), error: "рух не знайдено" };
  }
  if (data.bas_draft_ref_key) {
    return { ok: true, dryRun: false };
  }

  const receiptId =
    typeof data.receipt_id === "string" && data.receipt_id.trim()
      ? data.receipt_id.trim()
      : null;
  if (receiptId) {
    // Multi-line: не плодимо однорядкові документи
    const aggregated = await enqueueWarehouseReceiptBasDraft(receiptId);
    return {
      ok: aggregated.ok,
      dryRun: aggregated.dryRun,
      error: aggregated.error,
    };
  }

  if (!isBasDraftPipelineEnabled(PIPELINE_ID)) {
    console.log(
      "[bas-drafts] inbound skip auto-post (pipeline off)",
      moveId
    );
    return { ok: true, dryRun: true };
  }

  const cache = Array.isArray(data.inventory_items_cache)
    ? data.inventory_items_cache[0]
    : data.inventory_items_cache;
  if (cache?.is_local === true) {
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: [moveId],
      error: "локальна номенклатура без BAS bas_ref_key",
    });
    return {
      ok: false,
      dryRun: false,
      error: "локальна номенклатура — очікує мапінгу",
    };
  }
  const itemKey = cache?.bas_ref_key
    ? String(cache.bas_ref_key).toLowerCase()
    : null;
  if (!itemKey) {
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: [moveId],
      error: "немає bas_ref_key номенклатури",
    });
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      error: "немає bas_ref_key номенклатури",
    };
  }

  const qty = Number(data.qty) || 0;
  const price = Number(data.unit_price_uah) || 0;
  const org = basOrganizationKey();
  const warehouse = basDefaultWarehouseKey();
  const supplier =
    typeof data.buyer_name === "string" ? data.buyer_name.trim() : "";
  const counterparty = await resolveBasCounterpartyKey({
    name: supplier || null,
  });

  if (!counterparty.key) {
    const warn =
      counterparty.reason ||
      `контрагента «${supplier || "—"}» не знайдено в BAS — документ не створено`;
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: [moveId],
      error: warn,
    });
    return { ok: false, dryRun: !isBasDraftPostEnabled(), error: warn };
  }

  const unitLabel =
    typeof cache?.unit === "string" && cache.unit.trim()
      ? cache.unit.trim()
      : "шт";
  const category =
    typeof cache?.category === "string" ? cache.category : null;
  const [contract, taxPurposeKey, unit, accountKey] = await Promise.all([
    resolveBasMainContractKey(counterparty.key),
    resolveBasTaxPurposeVatKey(),
    resolveBasUnitKey(unitLabel),
    resolveBasInventoryAccountKey(category),
  ]);
  const amountEx = Math.round(qty * price * 100) / 100;
  const vat = computeInventoryVat({
    qty,
    unitPriceExVat: price,
    vatRate: "20",
    amountExVat: amountEx,
  });

  const line: Record<string, unknown> = {
    LineNumber: 1,
    Номенклатура_Key: itemKey,
    Количество: qty,
    Коэффициент: 1,
    Цена: price,
    Сумма: vat.amountExVat,
    СтавкаНДС: basVatRateLabel("20"),
    СуммаНДС: vat.vatAmount,
  };
  if (unit.key) line.ЕдиницаИзмерения_Key = unit.key;
  if (accountKey) line.СчетУчетаБУ_Key = accountKey;
  if (taxPurposeKey) {
    line.НалоговоеНазначение_Key = taxPurposeKey;
  }

  const body: Record<string, unknown> = {
    Date: toIsoDateTime(String(data.date)),
    Posted: false,
    DeletionMark: false,
    ВидОперации: "ПокупкаКомиссия",
    СуммаВключаетНДС: false,
    СуммаДокумента: vat.amountInclVat,
    Комментарий: [
      "AgroSystem · прихід ТМЦ (чернетка, 1 рядок)",
      `move:${moveId}`,
      cache?.name ? String(cache.name) : null,
      supplier ? `постачальник: ${supplier}` : null,
      counterparty.matchedName
        ? `контрагент: ${counterparty.matchedName}`
        : null,
      contract.matchedName ? `договір: ${contract.matchedName}` : null,
      data.note ? String(data.note) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    Товары: [line],
    _meta: { moveId, pipeline: PIPELINE_ID },
  };
  if (org) body.Организация_Key = org;
  if (warehouse) {
    body.Склад = warehouse;
    body.Склад_Type = "StandardODATA.Catalog_Склады";
  }
  body.Контрагент_Key = counterparty.key;
  if (contract.key) body.ДоговорКонтрагента_Key = contract.key;

  const result = await postBasDocumentDraft(ENTITY, body);
  if (!result.ok) {
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: [moveId],
      error: result.error,
    });
    return { ok: false, dryRun: result.dryRun, error: result.error };
  }

  if (!result.dryRun) {
    await markBasDraftSuccess({
      table: "inventory_local_moves",
      ids: [moveId],
      refKey: result.refKey,
      entitySet: ENTITY,
    });
  }

  return { ok: true, dryRun: result.dryRun };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} не задано в env`);
  return value;
}

function basicAuthHeader(): string {
  const token = Buffer.from(
    `${requiredEnv("BAS_USER")}:${requiredEnv("BAS_PASS")}`,
    "utf8"
  ).toString("base64");
  return `Basic ${token}`;
}

function odataBaseUrl(): string {
  return requiredEnv("BAS_ODATA_URL").replace(/\/+$/, "");
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Ідемпотентність: шукаємо вже створену чернетку за маркером receipt:UUID у коментарі.
 */
async function findExistingReceiptDraftRefKey(
  receiptId: string
): Promise<string | null> {
  const marker = `receipt:${receiptId.trim().toLowerCase()}`;
  if (!marker.startsWith("receipt:") || marker.length < 16) return null;
  try {
    const filter = `DeletionMark eq false and Posted eq false and substringof('${escapeODataString(marker)}', Комментарий)`;
    const params = [
      "$format=json",
      "$top=5",
      `$select=${encodeURIComponent("Ref_Key,Number,Posted,DeletionMark,Комментарий")}`,
      `$filter=${encodeURIComponent(filter)}`,
      `$orderby=${encodeURIComponent("Date desc")}`,
    ];
    const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(ENTITY)}?${params.join("&")}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as {
      value?: Array<{ Ref_Key?: string }>;
    };
    const key = parsed.value?.[0]?.Ref_Key
      ? String(parsed.value[0].Ref_Key).toLowerCase()
      : null;
    return key;
  } catch (err) {
    console.warn("[bas-drafts] idempotent lookup", err);
    return null;
  }
}

/**
 * Повторна відправка вже існуючої чернетки: PATCH того самого Ref_Key
 * (оновлює Товары / шапку). Не створює другий документ у BAS.
 * Без Ref_Key — звичайний enqueue (POST).
 */
export async function recreateWarehouseReceiptBasDraft(
  receiptId: string
): Promise<WarehouseReceiptBasDraftResult & { oldRefKey?: string }> {
  const supabase = createServiceSupabase();
  const { data: receipt, error } = await supabase
    .from("warehouse_receipts")
    .select("id, bas_draft_ref_key")
    .eq("id", receiptId)
    .maybeSingle();

  if (error || !receipt) {
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      handoffStatus: "bas_draft_failed",
      error: "накладну не знайдено",
    };
  }

  const oldRef =
    receipt.bas_draft_ref_key != null
      ? String(receipt.bas_draft_ref_key).toLowerCase()
      : null;

  if (!oldRef) {
    const result = await enqueueWarehouseReceiptBasDraft(receiptId);
    return { ...result, oldRefKey: undefined };
  }

  if (isBasDraftPipelineEnabled(PIPELINE_ID) && isBasDraftPostEnabled()) {
    try {
      const path = `${ENTITY}(guid'${oldRef}')`;
      const getUrl = `${odataBaseUrl()}/odata/standard.odata/${path}?$format=json&$select=Posted,DeletionMark,Number`;
      const getRes = await fetch(getUrl, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
        headers: {
          Authorization: basicAuthHeader(),
          Accept: "application/json",
        },
      });
      if (getRes.ok) {
        const doc = (await getRes.json()) as {
          Posted?: boolean;
          DeletionMark?: boolean;
        };
        if (doc.Posted === true) {
          return {
            ok: false,
            dryRun: false,
            handoffStatus: "bas_draft_failed",
            error:
              "Чернетка вже проведена в BAS — оновлення заборонено. Звернись до бухгалтера.",
            oldRefKey: oldRef,
          };
        }
        if (doc.DeletionMark === true) {
          return {
            ok: false,
            dryRun: false,
            handoffStatus: "bas_draft_failed",
            error:
              "Документ позначено на видалення в BAS — віднови його в 1С або створи нову накладну.",
            oldRefKey: oldRef,
          };
        }
      }
    } catch (checkErr) {
      console.warn("[bas-drafts] check existing draft", checkErr);
    }
  }

  await supabase
    .from("inventory_local_moves")
    .update({ bas_draft_ref_key: null, bas_draft_error: null })
    .eq("receipt_id", receiptId)
    .eq("type", "inbound");

  const result = await enqueueWarehouseReceiptBasDraft(receiptId, {
    forceUpdateRefKey: oldRef,
  });
  return { ...result, oldRefKey: oldRef };
}

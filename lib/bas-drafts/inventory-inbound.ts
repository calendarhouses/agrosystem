/**
 * Прихід ТМЦ → чернетка Document_ПоступлениеТоваровУслуг (Posted: false).
 *
 * Основний шлях: enqueueWarehouseReceiptBasDraft(receiptId) —
 * 1 накладна = 1 документ з Товары[].
 * Per-move enqueueInventoryInboundBasDraft — лише для ручних приходів без receipt.
 */

import {
  basDefaultWarehouseKey,
  basOrganizationKey,
  basUnmappedNomenclatureKey,
  isBasDraftPipelineEnabled,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { resolveBasCounterpartyKey } from "@/lib/bas-drafts/counterparty";
import { resolveBasNomenclatureKey } from "@/lib/bas-drafts/nomenclature";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import type { BasHandoffStatus } from "@/lib/bas-drafts/statuses";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
  markWarehouseHandoffStatus,
} from "@/lib/bas-drafts/track";
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
 */
export async function enqueueWarehouseReceiptBasDraft(
  receiptId: string
): Promise<WarehouseReceiptBasDraftResult> {
  const supabase = createServiceSupabase();

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

  if (receipt.bas_draft_ref_key) {
    return {
      ok: true,
      dryRun: false,
      handoffStatus: "bas_draft_posted",
      refKey: String(receipt.bas_draft_ref_key),
    };
  }

  const { data: moves, error: movesError } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id, qty, date, note, buyer_name, unit_price_uah, bas_draft_ref_key, item_ref_key,
      inventory_items_cache ( bas_ref_key, name, unit, is_local, code )
    `
    )
    .eq("receipt_id", receiptId)
    .eq("type", "inbound")
    .neq("status", "cancelled");

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

    mapped.push({
      moveId: String(row.id),
      itemKey,
      name: displayName,
      qty: Number(row.qty) || 0,
      price: Number(row.unit_price_uah) || 0,
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

  const counterparty = await resolveBasCounterpartyKey({
    edrpou: receipt.supplier_edrpou,
    name: receipt.supplier_name,
  });

  // Контрагент опційний: без мапінгу все одно шлемо чернетку з Товары[].
  // Бухгалтер у BAS обере контрагента сам; у коментарі — назва/ЄДРПОУ.

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

  const org = basOrganizationKey();
  const warehouse = basDefaultWarehouseKey();
  const dateRaw =
    String(receipt.invoice_date ?? "").slice(0, 10) ||
    String(rows[0]?.date ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  const edrpou =
    typeof receipt.supplier_edrpou === "string"
      ? receipt.supplier_edrpou.trim()
      : "";

  // linesSkippedLocal у результаті = скільки пішло через заглушку «нові товари»
  linesSkippedLocal = linesUnmappedPlaceholder;

  const body: Record<string, unknown> = {
    Date: toIsoDateTime(dateRaw),
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · прихід ТМЦ (чернетка)",
      receipt.supplier_name ? String(receipt.supplier_name) : null,
      edrpou ? `ЄДРПОУ ${edrpou}` : null,
      receipt.invoice_number ? `№${receipt.invoice_number}` : null,
      receipt.invoice_date ? `від ${receipt.invoice_date}` : null,
      !counterparty.key
        ? "контрагент не змаплений — оберіть у BAS"
        : null,
      linesUnmappedPlaceholder > 0
        ? `нових позицій (заглушка «Товари» + назва постачальника): ${linesUnmappedPlaceholder}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    Товары: mapped.map((line, index) => ({
      LineNumber: index + 1,
      Номенклатура_Key: line.itemKey,
      Количество: line.qty,
      Цена: line.price,
      Сумма: Math.round(line.qty * line.price * 100) / 100,
      // Справжня назва з накладної — бухгалтер бачить і може завести номенклатуру
      НаименованиеПоставщика: line.name.slice(0, 250),
    })),
    _meta: { receiptId, pipeline: PIPELINE_ID },
  };
  if (org) body.Организация_Key = org;
  // У Document_ПоступлениеТоваровУслуг поле складу — «Склад», не Склад_Key
  if (warehouse) {
    body.Склад = warehouse;
    body.Склад_Type = "StandardODATA.Catalog_Склады";
  }
  if (counterparty.key) body.Контрагент_Key = counterparty.key;

  const result = await postBasDocumentDraft(ENTITY, body);
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
      inventory_items_cache ( bas_ref_key, name, unit, is_local )
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

  const body: Record<string, unknown> = {
    Date: toIsoDateTime(String(data.date)),
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · прихід ТМЦ (чернетка, 1 рядок)",
      cache?.name ? String(cache.name) : null,
      supplier ? `постачальник: ${supplier}` : null,
      !counterparty.key ? "контрагент не змаплений — оберіть у BAS" : null,
      data.note ? String(data.note) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    Товары: [
      {
        LineNumber: 1,
        Номенклатура_Key: itemKey,
        Количество: qty,
        Цена: price,
        Сумма: Math.round(qty * price * 100) / 100,
      },
    ],
    _meta: { moveId, pipeline: PIPELINE_ID },
  };
  if (org) body.Организация_Key = org;
  if (warehouse) {
    body.Склад = warehouse;
    body.Склад_Type = "StandardODATA.Catalog_Склады";
  }
  if (counterparty.key) body.Контрагент_Key = counterparty.key;

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

/**
 * Позначає стару непроведену чернетку на видалення в BAS, скидає Ref_Key у нас
 * і створює нову з усіма знайденими рядками (включно з live-resolve локальних).
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

  if (oldRef && isBasDraftPipelineEnabled(PIPELINE_ID) && isBasDraftPostEnabled()) {
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
              "Стара чернетка вже проведена в BAS — не можна перестворити. Звернись до бухгалтера.",
            oldRefKey: oldRef,
          };
        }
        if (doc.DeletionMark !== true) {
          await fetch(`${odataBaseUrl()}/odata/standard.odata/${path}?$format=json`, {
            method: "PATCH",
            cache: "no-store",
            signal: AbortSignal.timeout(45_000),
            headers: {
              Authorization: basicAuthHeader(),
              Accept: "application/json",
              "Content-Type": "application/json",
              "IF-MATCH": "*",
            },
            body: JSON.stringify({ DeletionMark: true }),
          });
        }
      }
    } catch (markErr) {
      console.warn("[bas-drafts] mark old draft deleted", markErr);
    }
  }

  // Скидаємо Ref_Key, щоб enqueue створив новий повний документ
  await supabase
    .from("warehouse_receipts")
    .update({
      bas_draft_ref_key: null,
      bas_draft_error: null,
      bas_handoff_status: "local_saved",
    })
    .eq("id", receiptId);

  await supabase
    .from("inventory_local_moves")
    .update({ bas_draft_ref_key: null, bas_draft_error: null })
    .eq("receipt_id", receiptId)
    .eq("type", "inbound");

  const result = await enqueueWarehouseReceiptBasDraft(receiptId);
  return { ...result, oldRefKey: oldRef ?? undefined };
}

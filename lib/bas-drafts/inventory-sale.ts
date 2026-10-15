/**
 * Продаж ТМЦ / урожаю → чернетка Document_РеализацияТоваровУслуг (Posted: false).
 * Контрагент опційний: без мапінгу — покупець у коментарі, бухгалтер обере в BAS.
 */

import {
  basDefaultWarehouseKey,
  basOrganizationKey,
  isBasDraftPipelineEnabled,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { resolveBasCounterpartyKey } from "@/lib/bas-drafts/counterparty";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import { createServiceSupabase } from "@/lib/supabase/server";

const ENTITY = "Document_РеализацияТоваровУслуг";
const PIPELINE_ID = "inventory_sale";

export async function enqueueInventorySaleBasDraft(
  moveId: string
): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  if (!isBasDraftPipelineEnabled(PIPELINE_ID)) {
    console.log(
      "[bas-drafts] sale skip auto-post (pipeline off)",
      moveId
    );
    return { ok: true, dryRun: true };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id, qty, date, note, buyer_name, unit_price_uah, bas_draft_ref_key,
      inventory_items_cache ( bas_ref_key, name, unit, is_local )
    `
    )
    .eq("id", moveId)
    .eq("type", "sale")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, dryRun: !isBasDraftPostEnabled(), error: "рух не знайдено" };
  }
  if (data.bas_draft_ref_key) {
    return { ok: true, dryRun: false };
  }

  const cache = Array.isArray(data.inventory_items_cache)
    ? data.inventory_items_cache[0]
    : data.inventory_items_cache;
  const rawKey =
    cache?.bas_ref_key != null ? String(cache.bas_ref_key) : "";
  const isLocal =
    cache?.is_local === true || rawKey.toLowerCase().startsWith("local:");
  const itemKey =
    !isLocal && rawKey.trim() ? rawKey.trim().toLowerCase() : null;
  if (!itemKey) {
    await markBasDraftFailure({
      table: "inventory_local_moves",
      ids: [moveId],
      error: "немає bas_ref_key номенклатури (локальна / без мапінгу)",
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
  const buyer =
    typeof data.buyer_name === "string" ? data.buyer_name.trim() : "";
  const counterparty = await resolveBasCounterpartyKey({ name: buyer || null });

  const body: Record<string, unknown> = {
    Date: toIsoDateTime(String(data.date)),
    Posted: false,
    DeletionMark: false,
    Комментарий: [
      "AgroSystem · продаж (чернетка)",
      cache?.name ? String(cache.name) : null,
      buyer ? `покупець: ${buyer}` : null,
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
    _meta: { moveId, pipeline: "inventory_sale" },
  };
  if (org) body.Организация_Key = org;
  if (warehouse) body.Склад_Key = warehouse;
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

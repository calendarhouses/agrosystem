/**
 * Паливні операції → чернетки BAS (Posted: false).
 * Усі POST лише через lib/bas-drafts/post + isBasDraftPostEnabled().
 *
 * Мапінг документів:
 * - transfer → Document_ИНАГРО_СливТоплива (склади)
 * - outbound → Document_ИНАГРО_ПередачаТоплива (техніка)
 * - inbound  → Document_ПоступлениеТоваровУслуг (partial)
 */

import {
  basDieselNomenclatureKey,
  basOrganizationKey,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { postBasDocumentDraft, toIsoDateTime } from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import type { FuelSyncStatus, FuelTransaction } from "@/lib/fuel-transactions";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
} from "@/lib/fuel-transactions";
import { createServiceSupabase } from "@/lib/supabase/server";

export type FuelBasDraftLine = {
  nomenclatureHint: "diesel";
  quantityLiters: number;
  pricePerLiter: number | null;
  amountUah: number | null;
  fromStorageName: string | null;
  toStorageName: string | null;
  wialonUnitId: number | null;
  equipmentHint: string | null;
};

export type FuelBasDraftDocument = {
  sourceTransactionId: string;
  operationKind: "inbound" | "transfer" | "outbound";
  documentDate: string;
  posted: false;
  comment: string;
  lines: FuelBasDraftLine[];
  meta: {
    pricePerLiter: number | null;
    totalCost: number | null;
    operatorName: string | null;
    fieldOperationId: string | null;
    syncStatus: FuelSyncStatus;
  };
};

export type FuelBasEnqueueResult = {
  ok: true;
  status: FuelSyncStatus;
  draft: FuelBasDraftDocument;
  sentToBas: boolean;
  dryRun: boolean;
  message: string;
  basRefKey?: string;
};

export function buildFuelBasDraftDocument(
  tx: FuelTransaction,
  options?: { equipmentHint?: string | null }
): FuelBasDraftDocument {
  const kind =
    tx.type === "inbound" || tx.type === "transfer" || tx.type === "outbound"
      ? tx.type
      : "outbound";

  const commentParts = [
    kind === "inbound"
      ? "Закупівля дизеля"
      : kind === "transfer"
        ? "Внутрішнє переміщення палива"
        : "Заправка техніки",
    tx.fromName ? `з «${tx.fromName}»` : null,
    tx.toName ? `на «${tx.toName}»` : null,
    options?.equipmentHint ? `техніка: ${options.equipmentHint}` : null,
  ].filter(Boolean);

  return {
    sourceTransactionId: tx.id,
    operationKind: kind,
    documentDate: tx.transactionDate,
    posted: false,
    comment: commentParts.join(" · "),
    lines: [
      {
        nomenclatureHint: "diesel",
        quantityLiters: tx.amountLiters,
        pricePerLiter: tx.pricePerLiter,
        amountUah: tx.totalCost,
        fromStorageName: tx.fromName,
        toStorageName: tx.toName,
        wialonUnitId: tx.wialonUnitId,
        equipmentHint: options?.equipmentHint ?? null,
      },
    ],
    meta: {
      pricePerLiter: tx.pricePerLiter,
      totalCost: tx.totalCost,
      operatorName: tx.operatorName,
      fieldOperationId: null,
      syncStatus: tx.syncStatus,
    },
  };
}

function entityForKind(
  kind: FuelBasDraftDocument["operationKind"]
): string {
  if (kind === "transfer") return "Document_ИНАГРО_СливТоплива";
  if (kind === "outbound") return "Document_ИНАГРО_ПередачаТоплива";
  return "Document_ПоступлениеТоваровУслуг";
}

async function resolveFuelBasKeys(tx: FuelTransaction): Promise<{
  fromStorageBas: string | null;
  toStorageBas: string | null;
  equipmentBas: string | null;
  dieselKey: string | null;
  orgKey: string | null;
}> {
  const supabase = createServiceSupabase();
  const storageIds = [tx.fromStorageId, tx.toStorageId].filter(
    (id): id is string => Boolean(id)
  );

  const storageBas = new Map<string, string>();
  if (storageIds.length > 0) {
    const { data } = await supabase
      .from("fuel_storages")
      .select("id, bas_ref_key")
      .in("id", storageIds);
    for (const row of data ?? []) {
      if (row.bas_ref_key) {
        storageBas.set(String(row.id), String(row.bas_ref_key).toLowerCase());
      }
    }
  }

  let equipmentBas: string | null = null;
  if (tx.equipmentId) {
    const { data } = await supabase
      .from("equipment")
      .select("bas_ref_key")
      .eq("id", tx.equipmentId)
      .maybeSingle();
    if (data?.bas_ref_key) {
      equipmentBas = String(data.bas_ref_key).toLowerCase();
    }
  }

  return {
    fromStorageBas: tx.fromStorageId
      ? storageBas.get(tx.fromStorageId) ?? null
      : null,
    toStorageBas: tx.toStorageId
      ? storageBas.get(tx.toStorageId) ?? null
      : null,
    equipmentBas,
    dieselKey: basDieselNomenclatureKey(),
    orgKey: basOrganizationKey(),
  };
}

function buildODataBody(
  draft: FuelBasDraftDocument,
  keys: Awaited<ReturnType<typeof resolveFuelBasKeys>>
): { entity: string; body: Record<string, unknown> } | { error: string } {
  const liters = draft.lines[0]?.quantityLiters ?? 0;
  const entity = entityForKind(draft.operationKind);
  const date = toIsoDateTime(draft.documentDate);

  if (draft.operationKind === "transfer") {
    if (!keys.fromStorageBas || !keys.toStorageBas) {
      return {
        error: "для переміщення потрібні bas_ref_key складів відправника й отримувача",
      };
    }
    if (!keys.dieselKey) {
      return { error: "задайте BAS_DIESEL_NOMENCLATURE_KEY у env" };
    }
    const body: Record<string, unknown> = {
      Date: date,
      Posted: false,
      DeletionMark: false,
      Комментарий: `AgroSystem · ${draft.comment}`,
      СкладОтправитель_Key: keys.fromStorageBas,
      СкладПолучатель_Key: keys.toStorageBas,
      Товары: [
        {
          LineNumber: 1,
          Номенклатура_Key: keys.dieselKey,
          Количество: liters,
        },
      ],
      _meta: { pipeline: "fuel_transfer", txId: draft.sourceTransactionId },
    };
    if (keys.orgKey) body.Организация_Key = keys.orgKey;
    return { entity, body };
  }

  if (draft.operationKind === "outbound") {
    if (!keys.dieselKey) {
      return { error: "задайте BAS_DIESEL_NOMENCLATURE_KEY у env" };
    }
    if (!keys.equipmentBas) {
      return {
        error: "для заправки потрібен bas_ref_key техніки (мапінг equipment)",
      };
    }
    const body: Record<string, unknown> = {
      Date: date,
      Posted: false,
      DeletionMark: false,
      Комментарий: `AgroSystem · ${draft.comment}`,
      ТранспортноеСредствоПолучатель_Key: keys.equipmentBas,
      Товары: [
        {
          LineNumber: 1,
          Номенклатура_Key: keys.dieselKey,
          Количество: liters,
          КоличествоВОсновномТопливеПолучатель: liters,
          КоэффициентВОсновноеТопливоПолучатель: 1,
        },
      ],
      _meta: { pipeline: "fuel_outbound_refuel", txId: draft.sourceTransactionId },
    };
    if (keys.orgKey) body.Организация_Key = keys.orgKey;
    if (keys.fromStorageBas) {
      // деякі бази тримають склад через інші поля — коментар уже є
    }
    return { entity, body };
  }

  // inbound
  if (!keys.dieselKey) {
    return { error: "задайте BAS_DIESEL_NOMENCLATURE_KEY у env" };
  }
  if (!keys.toStorageBas) {
    return { error: "для закупівлі потрібен bas_ref_key складу-отримувача" };
  }
  const price = draft.meta.pricePerLiter ?? 0;
  const body: Record<string, unknown> = {
    Date: date,
    Posted: false,
    DeletionMark: false,
    Комментарий: `AgroSystem · ${draft.comment}`,
    Склад_Key: keys.toStorageBas,
    Товары: [
      {
        LineNumber: 1,
        Номенклатура_Key: keys.dieselKey,
        Количество: liters,
        Цена: price,
        Сумма: draft.meta.totalCost ?? Math.round(liters * price * 100) / 100,
      },
    ],
    _meta: { pipeline: "fuel_inbound", txId: draft.sourceTransactionId },
  };
  if (keys.orgKey) body.Организация_Key = keys.orgKey;
  return { entity, body };
}

/**
 * Після створення транзакції.
 * Live POST лише якщо isBasDraftPostEnabled(); інакше лишаємо pending_1c.
 */
export async function enqueueFuelBasDraft(input: {
  draft?: FuelBasDraftDocument;
  transactionId?: string;
  transactionType?: "inbound" | "transfer" | "outbound";
  amountLiters?: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  fromStorageId?: string | null;
  toStorageId?: string | null;
}): Promise<FuelSyncStatus> {
  const txId = input.draft?.sourceTransactionId || input.transactionId;
  if (!txId) return "pending_1c";

  if (!isBasDraftPostEnabled()) {
    console.log(
      "[bas-drafts] fuel skip auto-post (BAS_DRAFT_POST_ENABLED=false)",
      txId,
      input.transactionType ?? input.draft?.operationKind
    );
    return "pending_1c";
  }

  try {
    const result = await requestFuelBasDraftSync(txId);
    return result.status;
  } catch (err) {
    console.error("[fuel-bas-sync]", err);
    return "error";
  }
}

/**
 * Ручний / автоматичний POST чернетки.
 */
export async function requestFuelBasDraftSync(
  transactionId: string,
  options?: { equipmentHint?: string | null }
): Promise<FuelBasEnqueueResult> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(`${FUEL_TRANSACTIONS_SELECT}, bas_draft_ref_key`)
    .eq("id", transactionId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Транзакцію не знайдено");
  }

  const row = data as Record<string, unknown>;
  const tx = mapFuelTransactionRow(row);
  const existingRef =
    row.bas_draft_ref_key != null ? String(row.bas_draft_ref_key) : null;

  if (existingRef) {
    const draft = buildFuelBasDraftDocument(tx, options);
    return {
      ok: true,
      status: tx.syncStatus,
      draft,
      sentToBas: true,
      dryRun: false,
      basRefKey: existingRef,
      message: "Чернетка вже є в BAS",
    };
  }

  const draft = buildFuelBasDraftDocument(tx, options);
  const keys = await resolveFuelBasKeys(tx);
  const built = buildODataBody(draft, keys);
  const live = isBasDraftPostEnabled();

  if ("error" in built) {
    // Без мапінгу/env — у dry-run лишаємо pending; у live — error.
    await markBasDraftFailure({
      table: "fuel_transactions",
      ids: [transactionId],
      error: built.error,
    });
    if (live) {
      await supabase
        .from("fuel_transactions")
        .update({ sync_status: "error" })
        .eq("id", transactionId);
      throw new Error(built.error);
    }
    return {
      ok: true,
      status: "pending_1c",
      draft,
      sentToBas: false,
      dryRun: true,
      message: `Чернетка не готова: ${built.error}`,
    };
  }

  const result = await postBasDocumentDraft(built.entity, built.body);
  if (!result.ok) {
    await markBasDraftFailure({
      table: "fuel_transactions",
      ids: [transactionId],
      error: result.error,
    });
    if (live) {
      await supabase
        .from("fuel_transactions")
        .update({ sync_status: "error" })
        .eq("id", transactionId);
      throw new Error(result.error);
    }
    return {
      ok: true,
      status: "pending_1c",
      draft,
      sentToBas: false,
      dryRun: true,
      message: result.error,
    };
  }

  if (!result.dryRun) {
    await markBasDraftSuccess({
      table: "fuel_transactions",
      ids: [transactionId],
      refKey: result.refKey,
      entitySet: built.entity,
    });
  }

  return {
    ok: true,
    status: "pending_1c",
    draft,
    sentToBas: !result.dryRun,
    dryRun: result.dryRun,
    basRefKey: result.dryRun ? undefined : result.refKey,
    message: result.dryRun
      ? "Чернетку підготовлено (dry-run). Увімкніть BAS_DRAFT_POST_ENABLED для живої відправки."
      : "Чернетку створено в BAS (Posted: false).",
  };
}

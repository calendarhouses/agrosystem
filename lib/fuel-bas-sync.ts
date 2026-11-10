/**
 * Паливні операції → чернетки BAS (Posted: false).
 * Усі POST лише через lib/bas-drafts/post + isBasDraftPostEnabled().
 *
 * 3-етапна логіка:
 *  1) Наявне пальне — локальні залишки fuel_storages (цистерни / бензовоз)
 *  2) Заправка — Document_ИНАГРО_ПередачаТоплива (без списання на витрати)
 *  3) Використання — Document_ИНАГРО_ПутевойЛист… після закриття наряду (окремий pipeline)
 *
 * Мапінг документів:
 * - transfer → Document_ИНАГРО_СливТоплива (склади)
 * - outbound → Document_ИНАГРО_ПередачаТоплива (техніка)
 * - inbound  → Document_ПоступлениеТоваровУслуг (partial)
 */

import {
  basDieselNomenclatureKey,
  basOrganizationKey,
  isBasDraftPipelineEnabled,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import {
  patchBasDocumentDraft,
  postBasDocumentDraft,
  toIsoDateTime,
} from "@/lib/bas-drafts/post";
import {
  markBasDraftFailure,
  markBasDraftSuccess,
} from "@/lib/bas-drafts/track";
import { resolveBasUnitKey } from "@/lib/bas-drafts/units";
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

type FuelStorageBasRow = {
  id: string;
  bas_ref_key: string | null;
  type: string | null;
  equipment_id: string | null;
  name: string | null;
};

async function resolveFuelBasKeys(tx: FuelTransaction): Promise<{
  fromStorageBas: string | null;
  toStorageBas: string | null;
  fromStorageType: "stationary" | "mobile" | "other" | null;
  fromStorageName: string | null;
  /** ТЗ який здає (цистерна/бензовоз) → шапка ТранспортноеСредство_Key */
  donorEquipmentBas: string | null;
  equipmentBas: string | null;
  dieselKey: string | null;
  orgKey: string | null;
  literUnitKey: string | null;
  literUnitLabel: string;
}> {
  const supabase = createServiceSupabase();
  const storageIds = [tx.fromStorageId, tx.toStorageId].filter(
    (id): id is string => Boolean(id)
  );

  const storageById = new Map<string, FuelStorageBasRow>();
  if (storageIds.length > 0) {
    let { data, error } = await supabase
      .from("fuel_storages")
      .select("id, bas_ref_key, type, equipment_id, name")
      .in("id", storageIds);
    if (error && (error.message?.includes("equipment_id") || error.code === "42703")) {
      const legacy = await supabase
        .from("fuel_storages")
        .select("id, bas_ref_key, type, name")
        .in("id", storageIds);
      data = (legacy.data ?? []).map((row) => ({
        ...row,
        equipment_id: null,
      })) as typeof data;
      error = legacy.error;
    }
    if (!error) {
      for (const row of data ?? []) {
        storageById.set(String(row.id), {
          id: String(row.id),
          bas_ref_key: row.bas_ref_key
            ? String(row.bas_ref_key).toLowerCase()
            : null,
          type: row.type != null ? String(row.type) : null,
          equipment_id:
            "equipment_id" in row && row.equipment_id != null
              ? String(row.equipment_id)
              : null,
          name: row.name != null ? String(row.name) : null,
        });
      }
    }
  }

  const fromStorage = tx.fromStorageId
    ? storageById.get(tx.fromStorageId) ?? null
    : null;
  const toStorage = tx.toStorageId
    ? storageById.get(tx.toStorageId) ?? null
    : null;

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

  // ПередачаТоплива: шапка має лише ТЗ (здає) + ТЗ (отримує) — без Склад_Key.
  // Цистерна / бензовоз → ТранспортноеСредство_Key через equipment_id або env.
  let donorEquipmentBas: string | null = null;
  const envBowser = process.env.BAS_BOWSER_EQUIPMENT_KEY?.trim().toLowerCase();
  const envCistern = process.env.BAS_CISTERN_EQUIPMENT_KEY?.trim().toLowerCase();

  if (fromStorage?.equipment_id) {
    const { data } = await supabase
      .from("equipment")
      .select("bas_ref_key")
      .eq("id", fromStorage.equipment_id)
      .maybeSingle();
    if (data?.bas_ref_key) {
      donorEquipmentBas = String(data.bas_ref_key).toLowerCase();
    }
  }

  if (!donorEquipmentBas && fromStorage?.type === "mobile") {
    if (envBowser) donorEquipmentBas = envBowser;
    if (!donorEquipmentBas) {
      const { data: bowser } = await supabase
        .from("equipment")
        .select("bas_ref_key, name")
        .ilike("name", "%бензовоз%")
        .not("bas_ref_key", "is", null)
        .limit(1)
        .maybeSingle();
      if (bowser?.bas_ref_key) {
        donorEquipmentBas = String(bowser.bas_ref_key).toLowerCase();
      }
    }
  }

  if (!donorEquipmentBas && fromStorage?.type === "stationary" && envCistern) {
    donorEquipmentBas = envCistern;
  }
  // Не беремо fuel_storages.bas_ref_key як ТЗ — часто це Catalog_Склады → OData 400.

  const literUnit = await resolveBasUnitKey("л");
  const fromType = fromStorage?.type;
  const normalizedFromType: "stationary" | "mobile" | "other" | null =
    fromType === "stationary" || fromType === "mobile"
      ? fromType
      : fromType
        ? "other"
        : null;

  return {
    fromStorageBas: fromStorage?.bas_ref_key ?? null,
    toStorageBas: toStorage?.bas_ref_key ?? null,
    fromStorageType: normalizedFromType,
    fromStorageName: fromStorage?.name ?? tx.fromName,
    donorEquipmentBas,
    equipmentBas,
    dieselKey: basDieselNomenclatureKey(),
    orgKey: basOrganizationKey(),
    literUnitKey: literUnit.key,
    literUnitLabel: literUnit.label,
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
          Коэффициент: 1,
          ЕдиницаИзмерения: keys.literUnitLabel,
          ...(keys.literUnitKey
            ? { ЕдиницаИзмерения_Key: keys.literUnitKey }
            : {}),
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
    if (!keys.donorEquipmentBas) {
      return {
        error:
          "для ПередачаТоплива потрібен ТЗ який здає (fuel_storages.equipment_id, BAS_BOWSER_EQUIPMENT_KEY / BAS_CISTERN_EQUIPMENT_KEY) — поле Склад у шапці відсутнє",
      };
    }

    // $metadata Document_ИНАГРО_ПередачаТоплива_Товары:
    // Количество + од.вим. + перерахунок здавача/отримувача (без окремого Коэффициент).
    const line: Record<string, unknown> = {
      LineNumber: 1,
      Номенклатура_Key: keys.dieselKey,
      Количество: liters,
      КоличествоВОсновномТопливе: liters,
      КоэффициентВОсновноеТопливо: 1,
      КоличествоВОсновномТопливеПолучатель: liters,
      КоэффициентВОсновноеТопливоПолучатель: 1,
    };
    if (keys.literUnitKey) {
      line.ЕдиницаИзмерения_Key = keys.literUnitKey;
    }

    // Stage 2: Передача палива — НЕ списання на витрати.
    // Шапка ($metadata): ТранспортноеСредство_Key + ТранспортноеСредствоПолучатель_Key.
    // Склад_Key у документі немає — не передаємо (OData 400).
    const body: Record<string, unknown> = {
      Date: date,
      Posted: false,
      DeletionMark: false,
      Комментарий: `AgroSystem · ${draft.comment}`,
      ТранспортноеСредство_Key: keys.donorEquipmentBas,
      ТранспортноеСредствоПолучатель_Key: keys.equipmentBas,
      Товары: [line],
      _meta: {
        pipeline: "fuel_outbound_refuel",
        txId: draft.sourceTransactionId,
        stage: 2,
        expense: false,
        fromStorageType: keys.fromStorageType,
        fromStorageName: keys.fromStorageName,
      },
    };
    if (keys.orgKey) body.Организация_Key = keys.orgKey;

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
    // Поступление: поле «Склад», не Склад_Key
    Склад: keys.toStorageBas,
    Склад_Type: "StandardODATA.Catalog_Склады",
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

  const kind = input.transactionType ?? input.draft?.operationKind;
  const pipelineId =
    kind === "transfer"
      ? "fuel_transfer"
      : kind === "outbound"
        ? "fuel_outbound_refuel"
        : "fuel_inbound";
  if (!isBasDraftPipelineEnabled(pipelineId)) {
    console.log(
      "[bas-drafts] fuel skip auto-post (pipeline off)",
      txId,
      kind
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
    row.bas_draft_ref_key != null
      ? String(row.bas_draft_ref_key).toLowerCase()
      : null;

  const draft = buildFuelBasDraftDocument(tx, options);
  const fuelPipeline =
    draft.operationKind === "transfer"
      ? "fuel_transfer"
      : draft.operationKind === "outbound"
        ? "fuel_outbound_refuel"
        : "fuel_inbound";
  if (!isBasDraftPipelineEnabled(fuelPipeline)) {
    return {
      ok: true,
      status: "pending_1c" as FuelSyncStatus,
      draft,
      sentToBas: false,
      dryRun: true,
      message: `Pipeline ${fuelPipeline} вимкнено (BAS_DRAFT_PIPELINES_ENABLED)`,
    };
  }
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

  // Якщо чернетка вже є — PATCH, не silent success і не другий документ.
  const result = existingRef
    ? await patchBasDocumentDraft(built.entity, existingRef, built.body)
    : await postBasDocumentDraft(built.entity, built.body);
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

  const refOut = result.dryRun
    ? undefined
    : (result.refKey || existingRef || undefined);

  if (!result.dryRun && refOut) {
    await markBasDraftSuccess({
      table: "fuel_transactions",
      ids: [transactionId],
      refKey: refOut,
      entitySet: built.entity,
      number: result.number ?? null,
    });
  }

  return {
    ok: true,
    status: result.dryRun ? "pending_1c" : "synced",
    draft,
    sentToBas: !result.dryRun,
    dryRun: result.dryRun,
    basRefKey: refOut,
    message: result.dryRun
      ? "Чернетку підготовлено (dry-run). Увімкніть BAS_DRAFT_POST_ENABLED для живої відправки."
      : existingRef
        ? result.number
          ? `Чернетку BAS №${result.number} оновлено (Posted: false).`
          : "Чернетку в BAS оновлено (Posted: false)."
        : result.number
          ? `Чернетка BAS №${result.number} (Posted: false).`
          : "Чернетку створено в BAS (Posted: false).",
  };
}

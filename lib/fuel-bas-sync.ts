/**
 * Stub інтеграції паливних операцій з BAS (1С).
 *
 * ВАЖЛИВО (bas-readonly): живий POST/PATCH у odata/standard.odata ЗАБОРОНЕНО
 * без явного підтвердження на чернетки (Posted: false).
 * Нижче — повний payload чернетки + enqueue; OData WRITE закоментовано.
 */

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

/** Документ-чернетка для бухгалтера (готовий до OData, Posted: false) */
export type FuelBasDraftDocument = {
  /** Ід нашої транзакції */
  sourceTransactionId: string;
  /** Тип операції у нашій системі */
  operationKind: "inbound" | "transfer" | "outbound";
  /** Дата документа (ISO) */
  documentDate: string;
  /** Завжди false — непроведена чернетка */
  posted: false;
  comment: string;
  lines: FuelBasDraftLine[];
  /** Розширені поля для маппінгу в Document_* BAS */
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
  /** true лише коли реально пішов POST у BAS (зараз завжди false) */
  sentToBas: boolean;
  message: string;
};

/**
 * Зібрати повну чернетку з рядка fuel_transactions (+ імена складів).
 */
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

/**
 * Після створення inbound/transfer у нашій БД.
 * Повертає цільовий sync_status (зараз завжди pending_1c).
 */
export async function enqueueFuelBasDraft(input: {
  draft?: FuelBasDraftDocument;
  /** @deprecated legacy call from POST /transactions — зібрати мінімальну чернетку */
  transactionId?: string;
  transactionType?: "inbound" | "transfer" | "outbound";
  amountLiters?: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  fromStorageId?: string | null;
  toStorageId?: string | null;
}): Promise<FuelSyncStatus> {
  const draft =
    input.draft ??
    ({
      sourceTransactionId: input.transactionId ?? "",
      operationKind: input.transactionType ?? "inbound",
      documentDate: new Date().toISOString(),
      posted: false as const,
      comment:
        input.transactionType === "transfer"
          ? "Внутрішнє переміщення палива"
          : "Закупівля дизеля",
      lines: [
        {
          nomenclatureHint: "diesel" as const,
          quantityLiters: input.amountLiters ?? 0,
          pricePerLiter: input.pricePerLiter ?? null,
          amountUah: input.totalCost ?? null,
          fromStorageName: null,
          toStorageName: null,
          wialonUnitId: null,
          equipmentHint: null,
        },
      ],
      meta: {
        pricePerLiter: input.pricePerLiter ?? null,
        totalCost: input.totalCost ?? null,
        operatorName: null,
        fieldOperationId: null,
        syncStatus: "pending_1c" as const,
      },
    } satisfies FuelBasDraftDocument);

  // --- STUB: OData WRITE вимкнено ---
  // Увімкнути лише за явним підтвердженням (Posted: false):
  //
  // const base = process.env.BAS_ODATA_URL;
  // await fetch(`${base}/odata/standard.odata/Document_...`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json", Authorization: ... },
  //   body: JSON.stringify({
  //     Posted: false,
  //     Date: draft.documentDate,
  //     Comment: draft.comment,
  //     ...mapLines(draft.lines),
  //   }),
  // });
  //
  void draft;
  return "pending_1c";
}

/**
 * Ручний «Відправити в 1С» з журналу: збирає payload, викликає stub,
 * оновлює sync_status у БД (лишається pending_1c поки WRITE вимкнено).
 */
export async function requestFuelBasDraftSync(
  transactionId: string,
  options?: { equipmentHint?: string | null }
): Promise<FuelBasEnqueueResult> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(FUEL_TRANSACTIONS_SELECT)
    .eq("id", transactionId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Транзакцію не знайдено");
  }

  const tx = mapFuelTransactionRow(data as Record<string, unknown>);

  if (tx.type !== "inbound" && tx.type !== "transfer") {
    throw new Error("У 1С чернетку зараз готуємо лише для закупівлі та переміщення");
  }

  const draft = buildFuelBasDraftDocument(tx, options);
  const status = await enqueueFuelBasDraft({ draft });

  await supabase
    .from("fuel_transactions")
    .update({ sync_status: status })
    .eq("id", transactionId);

  return {
    ok: true,
    status,
    draft,
    sentToBas: false,
    message:
      "Чернетку підготовлено. Відправка в BAS вимкнена (read-only) — увімкнемо після підтвердження.",
  };
}

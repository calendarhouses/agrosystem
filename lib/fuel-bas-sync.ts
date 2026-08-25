/**
 * Stub інтеграції паливних операцій з BAS (1С).
 *
 * ВАЖЛИВО (bas-readonly): живий POST/PATCH у odata/standard.odata ЗАБОРОНЕНО
 * без явного підтвердження на чернетки (Posted: false).
 * Нижче — лише заготовка під майбутнє увімкнення.
 */

import type { FuelTransactionType } from "@/lib/fuel-transactions";

export type FuelSyncStatus = "pending_1c" | "synced" | "error";

export type FuelBasSyncPayload = {
  transactionId: string;
  transactionType: FuelTransactionType;
  amountLiters: number;
  pricePerLiter: number | null;
  totalCost: number | null;
  fromStorageId: string | null;
  toStorageId: string | null;
};

/**
 * Після створення inbound/transfer у нашій БД.
 * Повертає цільовий sync_status (зараз завжди pending_1c).
 */
export async function enqueueFuelBasDraft(
  payload: FuelBasSyncPayload
): Promise<FuelSyncStatus> {
  // --- STUB: OData WRITE вимкнено до тестування ---
  // Заборонено: POST до odata/standard.odata/... (Catalog / Document з Posted: true).
  // Майбутній виняток лише за підтвердженням: непроведена чернетка (Posted: false),
  // наприклад Document_... з паливом, на узгодження бухгалтеру.
  //
  // const base = process.env.BAS_ODATA_URL;
  // await fetch(`${base}/odata/standard.odata/Document_...`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json", Authorization: ... },
  //   body: JSON.stringify({ Posted: false, ...mapFuelToBas(payload) }),
  // });
  //
  void payload;
  return "pending_1c";
}

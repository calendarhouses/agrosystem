export type FuelTransactionType = "inbound" | "transfer" | "outbound";

export type FuelTransactionInput = {
  transactionType: FuelTransactionType;
  amountLiters: number;
  fromStorageId?: string | null;
  toStorageId?: string | null;
  wialonUnitId?: number | null;
  operatorName?: string | null;
};

export type FuelTransactionRow = {
  id: string;
  transaction_type: FuelTransactionType | string;
  amount_liters: number;
  from_storage_id: string | null;
  to_storage_id: string | null;
  wialon_unit_id: number | null;
  operator_name: string | null;
  transaction_date: string;
  wialon_verified: boolean;
  /** null = техніка без ДУТ */
  wialon_variance: number | null;
  from?: { name: string } | null;
  to?: { name: string } | null;
};

export type FuelTransaction = {
  id: string;
  type: FuelTransactionType;
  amountLiters: number;
  fromStorageId: string | null;
  toStorageId: string | null;
  fromName: string | null;
  toName: string | null;
  wialonUnitId: number | null;
  operatorName: string | null;
  transactionDate: string;
  wialonVerified: boolean;
  /** null = немає датчика палива (ручний облік) */
  wialonVariance: number | null;
};

function asType(raw: unknown): FuelTransactionType {
  if (raw === "inbound" || raw === "transfer" || raw === "outbound") {
    return raw;
  }
  return "outbound";
}

function relationName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return name != null ? String(name) : null;
  }
  return null;
}

export function mapFuelTransactionRow(
  row: Record<string, unknown>
): FuelTransaction {
  return {
    id: String(row.id),
    type: asType(row.transaction_type),
    amountLiters: Number(row.amount_liters) || 0,
    fromStorageId:
      row.from_storage_id != null ? String(row.from_storage_id) : null,
    toStorageId: row.to_storage_id != null ? String(row.to_storage_id) : null,
    fromName: relationName(row.from),
    toName: relationName(row.to),
    wialonUnitId:
      row.wialon_unit_id != null && Number.isFinite(Number(row.wialon_unit_id))
        ? Number(row.wialon_unit_id)
        : null,
    operatorName:
      row.operator_name != null ? String(row.operator_name) : null,
    transactionDate: String(row.transaction_date ?? ""),
    wialonVerified: Boolean(row.wialon_verified),
    wialonVariance: (() => {
      if (row.wialon_variance == null || row.wialon_variance === "") return null;
      const n = Number(row.wialon_variance);
      return Number.isFinite(n) ? n : null;
    })(),
  };
}

/** Select з join назв складів — для Supabase query builder */
export const FUEL_TRANSACTIONS_SELECT =
  "*, from:from_storage_id(name), to:to_storage_id(name)";

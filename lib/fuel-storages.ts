/** Рядок таблиці fuel_storages (Supabase) */
export type FuelStorageRow = {
  id: string;
  name: string;
  type: string | null;
  capacity: number;
  current_volume: number;
  price_per_liter: number;
  created_at?: string;
};

export type FuelStorage = {
  id: string;
  name: string;
  type: "stationary" | "mobile" | "other";
  capacity: number;
  currentVolume: number;
  pricePerLiter: number;
  createdAt: string | null;
};

export function mapFuelStorageRow(row: Record<string, unknown>): FuelStorage {
  const rawType = String(row.type ?? "other");
  const type: FuelStorage["type"] =
    rawType === "stationary" || rawType === "mobile" ? rawType : "other";

  return {
    id: String(row.id),
    name: String(row.name ?? "Резервуар"),
    type,
    capacity: Number(row.capacity) || 0,
    currentVolume: Number(row.current_volume) || 0,
    pricePerLiter: Number(row.price_per_liter) || 0,
    createdAt: row.created_at != null ? String(row.created_at) : null,
  };
}

export function storageFillPercent(storage: FuelStorage): number {
  if (storage.capacity <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (storage.currentVolume / storage.capacity) * 100)
  );
}

export function storageValueUah(storage: FuelStorage): number {
  return storage.currentVolume * storage.pricePerLiter;
}

export function totalFuelVolume(storages: FuelStorage[]): number {
  return storages.reduce((sum, s) => sum + s.currentVolume, 0);
}

export function totalFuelValue(storages: FuelStorage[]): number {
  return storages.reduce(
    (sum, s) => sum + s.currentVolume * s.pricePerLiter,
    0
  );
}

export function storageSubtitle(storage: FuelStorage): string {
  if (storage.type === "stationary") return "Стаціонарний склад · дизель";
  if (storage.type === "mobile")
    return "Резервуар на колесах · заправка техніки";
  return "Дизельний резервуар";
}

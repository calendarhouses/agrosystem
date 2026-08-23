/**
 * Динамічна ціна дизеля ₴/л: fuel_storages → inventory → fallback.
 */

import { createServiceSupabase } from "@/lib/supabase/server";

/** Останній resort, якщо в БД немає жодної ціни */
export const DEFAULT_DIESEL_PRICE_UAH = 50;

export type DieselPriceSource =
  | "fuel_inbound"
  | "fuel_storage_avg"
  | "inventory"
  | "fallback";

export type DieselPriceResult = {
  priceUah: number;
  source: DieselPriceSource;
};

const uahFormatter = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

const uahFormatterPrecise = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Форматування суми в гривнях (цілі ₴ за замовчуванням). */
export function formatUahCurrency(
  value: number,
  options?: { precise?: boolean }
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return options?.precise
    ? uahFormatterPrecise.format(n)
    : uahFormatter.format(n);
}

function pickInventoryPrice(row: {
  unit_cost?: number | string | null;
  planned_price_uah?: number | string | null;
}): number | null {
  for (const raw of [row.unit_cost, row.planned_price_uah]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Актуальна ціна дизеля ₴/л:
 * 1) price_per_liter складу останньої inbound-транзакції
 * 2) середня по fuel_storages
 * 3) inventory_items_cache (назва містить «дизел» / «гсм»)
 * 4) fallback
 */
export async function resolveDieselPriceUah(
  fallback = DEFAULT_DIESEL_PRICE_UAH
): Promise<DieselPriceResult> {
  const supabase = createServiceSupabase();

  const { data: lastInbound } = await supabase
    .from("fuel_transactions")
    .select("to_storage_id, transaction_date")
    .eq("transaction_type", "inbound")
    .not("to_storage_id", "is", null)
    .order("transaction_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastInbound?.to_storage_id) {
    const { data: storage } = await supabase
      .from("fuel_storages")
      .select("price_per_liter")
      .eq("id", lastInbound.to_storage_id)
      .maybeSingle();
    const price = Number(storage?.price_per_liter);
    if (Number.isFinite(price) && price > 0) {
      return { priceUah: price, source: "fuel_inbound" };
    }
  }

  const { data: storages } = await supabase
    .from("fuel_storages")
    .select("price_per_liter")
    .gt("price_per_liter", 0)
    .limit(20);

  const storagePrices = (storages ?? [])
    .map((s) => Number(s.price_per_liter))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (storagePrices.length > 0) {
    const avg =
      Math.round(
        (storagePrices.reduce((a, b) => a + b, 0) / storagePrices.length) * 100
      ) / 100;
    return { priceUah: avg, source: "fuel_storage_avg" };
  }

  const { data: inventoryRows, error: invError } = await supabase
    .from("inventory_items_cache")
    .select("name, unit_cost, planned_price_uah")
    .or("name.ilike.%дизел%,name.ilike.%diesel%,name.ilike.%гсм%")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!invError && inventoryRows?.length) {
    for (const row of inventoryRows) {
      const price = pickInventoryPrice(row);
      if (price != null) {
        return { priceUah: price, source: "inventory" };
      }
    }
  }

  const fb = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_DIESEL_PRICE_UAH;
  return { priceUah: fb, source: "fallback" };
}

/** @deprecated Використовуйте resolveDieselPriceUah */
export async function getLatestFuelPurchasePriceUah(
  defaultPrice = DEFAULT_DIESEL_PRICE_UAH
): Promise<number> {
  const { priceUah } = await resolveDieselPriceUah(defaultPrice);
  return priceUah;
}

import type { Metadata } from "next";

import { FuelView } from "@/components/dashboard/fuel-view";
import { mapFuelStorageRow, type FuelStorage } from "@/lib/fuel-storages";
import {
  FUEL_TRANSACTIONS_SELECT,
  mapFuelTransactionRow,
  type FuelTransaction,
} from "@/lib/fuel-transactions";
import { createServiceSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Паливо",
};

export const dynamic = "force-dynamic";

async function loadFuelStorages(): Promise<FuelStorage[]> {
  try {
    const supabase = createServiceSupabase();
    const { data: storages, error } = await supabase
      .from("fuel_storages")
      .select("*")
      .order("capacity", { ascending: false });

    if (error || !storages) {
      console.error("[fuel] loadFuelStorages:", error?.message);
      return [];
    }

    return storages.map((row) =>
      mapFuelStorageRow(row as Record<string, unknown>)
    );
  } catch (error) {
    console.error("[fuel] loadFuelStorages:", error);
    return [];
  }
}

async function loadFuelTransactions(): Promise<FuelTransaction[]> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("fuel_transactions")
      .select(FUEL_TRANSACTIONS_SELECT)
      .order("transaction_date", { ascending: false })
      .limit(20);

    if (error || !data) {
      console.error("[fuel] loadFuelTransactions:", error?.message);
      return [];
    }

    return data.map((row) =>
      mapFuelTransactionRow(row as Record<string, unknown>)
    );
  } catch (error) {
    console.error("[fuel] loadFuelTransactions:", error);
    return [];
  }
}

export default async function FuelPage() {
  const [storages, transactions] = await Promise.all([
    loadFuelStorages(),
    loadFuelTransactions(),
  ]);
  return (
    <FuelView initialStorages={storages} initialTransactions={transactions} />
  );
}

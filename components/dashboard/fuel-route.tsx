"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { FuelView } from "@/components/dashboard/fuel-view";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import type { FuelStorage } from "@/lib/fuel-storages";
import type { FuelTransaction } from "@/lib/fuel-transactions";

type StoragesResponse = {
  ok?: boolean;
  storages?: FuelStorage[];
  error?: string;
};

type TransactionsResponse = {
  ok?: boolean;
  transactions?: FuelTransaction[];
  error?: string;
};

function BootScreen() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-[#F4F1EA] px-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
      <p className="text-sm font-semibold text-zinc-800">Завантаження палива</p>
      <p className="text-xs text-zinc-500">Дані вже можуть бути в кеші…</p>
    </div>
  );
}

/** Клієнтський вхід у Паливо — миттєво з кеша після прогріву */
export function FuelRoute() {
  const storagesFresh = peekAppCache<StoragesResponse>("api:fuel:storages");
  const storagesStale = peekAppCacheStale<StoragesResponse>("api:fuel:storages");
  const txFresh = peekAppCache<TransactionsResponse>("api:fuel:transactions");
  const txStale = peekAppCacheStale<TransactionsResponse>(
    "api:fuel:transactions"
  );

  const seedStorages =
    storagesFresh?.storages ?? storagesStale?.storages ?? null;
  const seedTx = txFresh?.transactions ?? txStale?.transactions ?? null;

  const [storages, setStorages] = useState<FuelStorage[]>(seedStorages ?? []);
  const [transactions, setTransactions] = useState<FuelTransaction[]>(
    seedTx ?? []
  );
  const [loading, setLoading] = useState(!seedStorages);

  useEffect(() => {
    const controller = new AbortController();
    const hadSeed = Boolean(seedStorages);

    Promise.all([
      cachedFetchJson<StoragesResponse>(
        "api:fuel:storages",
        "/api/fuel/storages",
        undefined,
        { signal: controller.signal, force: !hadSeed }
      ),
      cachedFetchJson<TransactionsResponse>(
        "api:fuel:transactions",
        "/api/fuel/transactions?limit=200",
        undefined,
        { signal: controller.signal, force: !seedTx }
      ),
      // KPI (спалено/заправлено) — той самий ключ, що й прогрів з карти
      cachedFetchJson(
        "api:fuel:kpis:today",
        "/api/fuel/kpis?period=today",
        undefined,
        { signal: controller.signal }
      ).catch(() => null),
    ])
      .then(([storagesRes, txRes]) => {
        if (storagesRes.data.storages) {
          setStorages(storagesRes.data.storages);
        }
        if (txRes.data.transactions) {
          setTransactions(txRes.data.transactions);
        }
      })
      .catch(() => {
        /* seed вже на екрані */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  if (loading && storages.length === 0) {
    return <BootScreen />;
  }

  return (
    <FuelView
      initialStorages={storages}
      initialTransactions={transactions}
    />
  );
}

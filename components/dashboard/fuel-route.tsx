"use client";

import { useEffect, useState } from "react";

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

/** Клієнтський вхід у Паливо — одразу сторінка; дані дотягуються на місці. */
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
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  return (
    <FuelView
      initialStorages={storages}
      initialTransactions={transactions}
    />
  );
}

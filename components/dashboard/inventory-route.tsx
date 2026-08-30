"use client";

import { useEffect, useState } from "react";

import { InventoryView } from "@/components/dashboard/inventory-view";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import {
  emptyInventoryDashboard,
  type InventoryFullDashboard,
} from "@/lib/inventory-bas";

type DashboardResponse = {
  ok?: boolean;
  dashboard?: InventoryFullDashboard | null;
  error?: string;
};

/** Клієнтський вхід у Склад — одразу повна сторінка; дані дотягуються на місці. */
export function InventoryRoute() {
  const fresh = peekAppCache<DashboardResponse>("api:inventory:dashboard");
  const stale = peekAppCacheStale<DashboardResponse>("api:inventory:dashboard");
  const seed = fresh?.dashboard ?? stale?.dashboard ?? null;

  const [dashboard, setDashboard] = useState<InventoryFullDashboard>(
    seed ?? emptyInventoryDashboard()
  );
  const [isLoading, setIsLoading] = useState(!seed);
  const [error, setError] = useState<string | null>(
    seed ? null : (fresh?.error ?? stale?.error ?? null)
  );

  useEffect(() => {
    const controller = new AbortController();
    const hadSeed = Boolean(seed);
    if (!hadSeed) setIsLoading(true);

    cachedFetchJson<DashboardResponse>(
      "api:inventory:dashboard",
      "/api/inventory/dashboard",
      undefined,
      { signal: controller.signal, force: !hadSeed }
    )
      .then(({ data }) => {
        if (data.ok === false || !data.dashboard) {
          throw new Error(data.error || "Не вдалося завантажити склад");
        }
        setDashboard(data.dashboard);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (hadSeed) return;
        setError(
          err instanceof Error ? err.message : "Не вдалося завантажити склад"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  return (
    <InventoryView
      dashboard={dashboard}
      error={error}
      isLoading={isLoading}
    />
  );
}

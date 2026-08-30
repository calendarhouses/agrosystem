"use client";

import { useEffect, useState } from "react";

import { InventoryView } from "@/components/dashboard/inventory-view";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import type { InventoryFullDashboard } from "@/lib/inventory-bas";

type DashboardResponse = {
  ok?: boolean;
  dashboard?: InventoryFullDashboard | null;
  error?: string;
};

/** Клієнтський вхід у Склад — одразу сторінка; дані дотягуються на місці. */
export function InventoryRoute() {
  const fresh = peekAppCache<DashboardResponse>("api:inventory:dashboard");
  const stale = peekAppCacheStale<DashboardResponse>("api:inventory:dashboard");
  const seed = fresh?.dashboard ?? stale?.dashboard ?? null;

  const [dashboard, setDashboard] = useState<InventoryFullDashboard | null>(
    seed
  );
  const [error, setError] = useState<string | null>(
    seed ? null : (fresh?.error ?? stale?.error ?? null)
  );

  useEffect(() => {
    const controller = new AbortController();
    const hadSeed = Boolean(seed);

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
        if (dashboard) return;
        setError(
          err instanceof Error ? err.message : "Не вдалося завантажити склад"
        );
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  return <InventoryView dashboard={dashboard} error={error} />;
}

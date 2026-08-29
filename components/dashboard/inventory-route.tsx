"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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

function BootScreen({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-[#F4F1EA] px-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
      <p className="text-sm font-semibold text-zinc-800">{label}</p>
      <p className="text-xs text-zinc-500">Дані вже можуть бути в кеші…</p>
    </div>
  );
}

/** Клієнтський вхід у Склад — миттєво з кеша після прогріву з карти */
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
  const [loading, setLoading] = useState(!seed);

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
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  if (loading && !dashboard) {
    return <BootScreen label="Завантаження складу" />;
  }

  return <InventoryView dashboard={dashboard} error={error} />;
}

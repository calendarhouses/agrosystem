"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { FinanceView } from "@/components/dashboard/finance-view";
import {
  cachedFetchJson,
  peekAppCache,
  peekAppCacheStale,
} from "@/lib/client-data-cache";
import type { CompanyFinancialOverview } from "@/lib/company-finance";
import { defaultFinanceSeasonYear } from "@/lib/finance-period";
import type { InventoryFullDashboard } from "@/lib/inventory-bas";

type FinanceBootResponse = {
  ok?: boolean;
  seasonYear?: number;
  overview?: CompanyFinancialOverview | null;
  bas?: InventoryFullDashboard | null;
  error?: string;
};

function BootScreen() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-[#F4F1EA] px-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
      <p className="text-sm font-semibold text-zinc-800">Завантаження фінансів</p>
      <p className="text-xs text-zinc-500">Дані вже можуть бути в кеші…</p>
    </div>
  );
}

/** Клієнтський вхід у Фінанси — миттєво з кеша після прогріву */
export function FinanceRoute() {
  const fresh = peekAppCache<FinanceBootResponse>("api:finance:boot");
  const stale = peekAppCacheStale<FinanceBootResponse>("api:finance:boot");
  const seed = fresh ?? stale;

  const [seasonYear] = useState(
    () => seed?.seasonYear ?? defaultFinanceSeasonYear()
  );
  const [overview, setOverview] = useState<CompanyFinancialOverview | null>(
    seed?.overview ?? null
  );
  const [bas, setBas] = useState<InventoryFullDashboard | null>(
    seed?.bas ?? null
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [basError, setBasError] = useState<string | null>(
    seed?.overview || seed?.bas ? null : (seed?.error ?? null)
  );
  const [loading, setLoading] = useState(!(seed?.overview || seed?.bas));

  useEffect(() => {
    const controller = new AbortController();
    const hadSeed = Boolean(seed?.overview || seed?.bas);

    cachedFetchJson<FinanceBootResponse>(
      "api:finance:boot",
      "/api/finance/boot",
      undefined,
      { signal: controller.signal, force: !hadSeed }
    )
      .then(({ data }) => {
        if (data.ok === false) {
          throw new Error(data.error || "Не вдалося завантажити фінанси");
        }
        setOverview(data.overview ?? null);
        setBas(data.bas ?? null);
        setOverviewError(null);
        setBasError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (overview || bas) return;
        const message =
          err instanceof Error ? err.message : "Не вдалося завантажити фінанси";
        setOverviewError(message);
        setBasError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  if (loading && !overview && !bas) {
    return <BootScreen />;
  }

  return (
    <FinanceView
      initialSeasonYear={seasonYear}
      overview={overview}
      overviewError={overviewError}
      bas={bas}
      basError={basError}
    />
  );
}

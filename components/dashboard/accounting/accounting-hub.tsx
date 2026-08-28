"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, History, Link2, Loader2, Scale } from "lucide-react";

import {
  loadAccountingReconciliation,
  type AccountingReconciliationData,
  type ActionResult,
} from "@/app/accounting/actions";
import { AccountantHubView } from "@/components/dashboard/accountant-hub-view";
import { ActivityJournalPanel } from "@/components/dashboard/activity-journal-panel";
import { MappingStudioLazy } from "@/components/dashboard/accounting/mapping-studio-lazy";
import { ReconciliationStudio } from "@/components/dashboard/accounting/reconciliation-studio";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MappingCatalogKind } from "@/lib/bas-mapping";
import { cn } from "@/lib/utils";

export function AccountingHub() {
  const [tab, setTab] = useState("export");
  const [recon, setRecon] = useState<AccountingReconciliationData | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [mappingCatalog, setMappingCatalog] =
    useState<MappingCatalogKind>("storages");

  const refreshRecon = useCallback(async () => {
    setReconLoading(true);
    setReconError(null);
    const res: ActionResult<AccountingReconciliationData> =
      await loadAccountingReconciliation();
    setReconLoading(false);
    if (!res.ok) {
      setReconError(res.error);
      return;
    }
    setRecon(res.data);
  }, []);

  useEffect(() => {
    if (tab !== "reconcile") return;
    if (recon || reconLoading || reconError) return;
    void refreshRecon();
  }, [tab, recon, reconLoading, reconError, refreshRecon]);

  function openMapping(catalog: MappingCatalogKind) {
    setMappingCatalog(catalog);
    setTab("mapping");
  }

  const badgeCount = recon?.counts.totalOpen ?? 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div
          className={cn(
            "sticky top-0 z-50 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/90",
            "px-4 py-3 backdrop-blur-2xl sm:px-6"
          )}
        >
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
                Бухгалтерія
              </h1>
            </div>
            <TabsList
              className={cn(
                "h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-white/70 p-1",
                "group-data-horizontal/tabs:h-auto sm:w-auto"
              )}
            >
              <TabsTrigger
                value="export"
                className={cn(
                  "gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                  "data-active:bg-[#276749] data-active:text-white data-active:shadow-sm"
                )}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Експорт
              </TabsTrigger>
              <TabsTrigger
                value="reconcile"
                className={cn(
                  "gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                  "data-active:bg-[#276749] data-active:text-white data-active:shadow-sm"
                )}
              >
                <Scale className="h-3.5 w-3.5" />
                Звірка
                {badgeCount > 0 ? (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                      tab === "reconcile"
                        ? "bg-white text-[#276749]"
                        : "bg-amber-500 text-white"
                    )}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger
                value="mapping"
                className={cn(
                  "gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                  "data-active:bg-[#276749] data-active:text-white data-active:shadow-sm"
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                Мапінг
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className={cn(
                  "gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                  "data-active:bg-[#276749] data-active:text-white data-active:shadow-sm"
                )}
              >
                <History className="h-3.5 w-3.5" />
                Журнал
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent
          value="export"
          className="mt-0 min-h-0 flex-1 overflow-hidden outline-none data-[hidden]:hidden"
        >
          {tab === "export" ? <AccountantHubView embedded /> : null}
        </TabsContent>

        <TabsContent
          value="reconcile"
          className="mt-0 min-h-0 flex-1 overflow-hidden outline-none data-[hidden]:hidden"
        >
          {tab === "reconcile" ? (
            reconLoading && !recon ? (
              <div className="flex h-full min-h-0 items-center justify-center gap-2 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Завантаження звірки…
              </div>
            ) : reconError && !recon ? (
              <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] px-4">
                <p className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {reconError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setReconError(null);
                    void refreshRecon();
                  }}
                  className="rounded-xl bg-[#276749] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f5339]"
                >
                  Спробувати знову
                </button>
              </div>
            ) : recon ? (
              <ReconciliationStudio
                request={recon.request}
                orphans={recon.orphans}
                collisions={recon.collisions}
                basError={recon.basError}
                gaps={recon.gaps}
                counts={recon.counts}
                onRefresh={refreshRecon}
                onOpenMapping={openMapping}
              />
            ) : null
          ) : null}
        </TabsContent>

        <TabsContent
          value="mapping"
          className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-none outline-none data-[hidden]:hidden"
        >
          {tab === "mapping" ? (
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              <div
                className={cn(
                  "rounded-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA]/75 p-6",
                  "shadow-[0_8px_30px_rgb(39,33,24,0.06)] backdrop-blur-2xl"
                )}
              >
                <div className="mb-5">
                  <h2 className="text-lg font-bold text-zinc-900">
                    Мапінг
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Зіставте наші поля, техніку, склади ДП і товари з довідниками
                    BAS AGRO. Нові позиції зʼявляються самі; точні збіги
                    пропонуються автоматично. У BAS AGRO нічого не пишемо —
                    лише зберігаємо звʼязок у нас.
                  </p>
                </div>
                <MappingStudioLazy initialCatalog={mappingCatalog} />
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent
          value="activity"
          className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-none bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] outline-none data-[hidden]:hidden"
        >
          {tab === "activity" ? <ActivityJournalPanel /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

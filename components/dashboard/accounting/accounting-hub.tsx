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
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

const HUB_TABS = [
  { id: "export", label: "Експорт", short: "Експорт", icon: FileSpreadsheet },
  { id: "reconcile", label: "Звірка", short: "Звірка", icon: Scale },
  { id: "mapping", label: "Мапінг", short: "Мапінг", icon: Link2 },
  { id: "activity", label: "Журнал", short: "Журнал", icon: History },
] as const;

export function AccountingHub() {
  const isMobile = useIsMobile();
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
        {isMobile ? (
          <div className="sticky top-0 z-50 border-b border-[#E5DFD3]/80 bg-[#F4F1EA]/92 px-3 pt-[max(0.5rem,var(--safe-top))] pb-2 backdrop-blur-xl">
            <TabsList
              className={cn(
                "inline-flex h-auto w-full rounded-2xl border border-[#E5DFD3]/90 bg-white/85 p-1 shadow-sm",
                "group-data-horizontal/tabs:h-auto"
              )}
              aria-label="Розділ бухгалтерії"
            >
              {HUB_TABS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className={cn(
                      "relative min-h-10 flex-1 gap-0 rounded-xl px-1 text-[11px] font-bold transition-all",
                      "data-active:bg-[#276749] data-active:text-white",
                      "data-active:shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]",
                      "data-[state=inactive]:text-zinc-500",
                      "hover:text-inherit"
                    )}
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                      <span className="leading-none">{item.short}</span>
                    </span>
                    {item.id === "reconcile" && badgeCount > 0 ? (
                      <span
                        className={cn(
                          "absolute -top-0.5 -right-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 py-px text-[9px] font-bold tabular-nums",
                          active
                            ? "bg-white text-[#276749]"
                            : "bg-amber-500 text-white"
                        )}
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        ) : (
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
                {HUB_TABS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className={cn(
                        "gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                        "data-active:bg-[#276749] data-active:text-white data-active:shadow-sm"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                      {item.id === "reconcile" && badgeCount > 0 ? (
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
                  );
                })}
              </TabsList>
            </div>
          </div>
        )}

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
            <div
              className={cn(
                "mx-auto w-full max-w-7xl",
                isMobile ? "px-3 py-3 pb-[calc(var(--app-bottom-inset)+1rem)]" : "px-4 py-6 sm:px-6 lg:px-8"
              )}
            >
              <div
                className={cn(
                  "border border-[#E5DFD3]/80 bg-[#F4F1EA]/75",
                  "shadow-[0_8px_30px_rgb(39,33,24,0.06)] backdrop-blur-2xl",
                  isMobile
                    ? "rounded-2xl p-3.5"
                    : "rounded-3xl p-6"
                )}
              >
                {!isMobile ? (
                  <div className="mb-5">
                    <h2 className="text-lg font-bold text-zinc-900">Мапінг</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Зіставте наші поля, техніку, склади ДП і товари з
                      довідниками BAS AGRO. Нові позиції зʼявляються самі; точні
                      збіги пропонуються автоматично. У BAS AGRO нічого не
                      пишемо — лише зберігаємо звʼязок у нас.
                    </p>
                  </div>
                ) : (
                  <p className="mb-3 text-[11px] leading-snug text-zinc-500">
                    Звʼязок з BAS AGRO — лише у нашій базі, без запису в 1С.
                  </p>
                )}
                <MappingStudioLazy initialCatalog={mappingCatalog} />
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent
          value="activity"
          className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-none bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] outline-none data-[hidden]:hidden"
        >
          {tab === "activity" ? <ActivityJournalPanel compact={isMobile} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

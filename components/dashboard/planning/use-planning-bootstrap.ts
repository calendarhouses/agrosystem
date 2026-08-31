"use client";

import { useEffect } from "react";

import { getAgroRadarStockContext } from "@/app/calendar/actions";
import {
  buildSeasonMonths,
  insightsToBlocks,
  mergeAgroplanBlocks,
} from "@/lib/agroplan/blocks";
import { seasonOperationsToBlocks } from "@/lib/agroplan/season-ops";
import type { AgroplanSeasonOperation } from "@/lib/agroplan/season-ops";
import { generateAgroInsights } from "@/lib/agronomy-engine";
import type { PlanningField, PlanningTask } from "@/lib/planning/types";
import { usePlanningStore } from "@/lib/planning/usePlanningStore";
import { cachedFetchJson } from "@/lib/client-data-cache";
import type { FarmField } from "@/lib/farm-fields";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";
import type { AgroplanBlock } from "@/lib/agroplan/blocks";

function completionFromBlock(block: AgroplanBlock): number {
  if (block.operationStatus === "completed") return 100;
  if (block.operationStatus === "in_progress") return 50;
  return 0;
}

function toPlanningTask(block: AgroplanBlock, scheduled: boolean): PlanningTask {
  return {
    id: block.id,
    operationName: block.insight.operationName,
    fieldId: block.fieldId,
    fieldName: block.fieldName,
    crop: block.insight.crop,
    source: block.source === "operation" ? "operation" : "insight",
    operationType: block.insight.operationType,
    scheduledYmd: scheduled
      ? toKyivDayKey(new Date(block.startMs))
      : undefined,
    durationDays: Math.max(1, Math.ceil(block.durationHours / 8)),
    operationClientKey: block.operationClientKey,
    priority: block.insight.isCriticalPriority ? "high" : "normal",
    completionPct: completionFromBlock(block),
    resourceDeficit: block.insight.resourceStatus.status === "DEFICIT",
  };
}

export function usePlanningBootstrap() {
  const hydrateTasks = usePlanningStore((s) => s.hydrateTasks);
  const setFields = usePlanningStore((s) => s.setFields);
  const setLoading = usePlanningStore((s) => s.setLoading);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const seasonId = currentAgroSeason();
        const [{ data: fieldsData }, { data: opsData }, stock] = await Promise.all([
          cachedFetchJson<{ fields?: FarmField[] }>("api:fields", "/api/fields"),
          cachedFetchJson<{ operations?: AgroplanSeasonOperation[] }>(
            "api:agroplan:season-ops",
            `/api/agroplan/season-ops?season=${seasonId}`
          ),
          getAgroRadarStockContext().catch(() => null),
        ]);

        if (cancelled) return;

        const fields: FarmField[] = fieldsData.fields ?? [];
        const operations = opsData.operations ?? [];
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const activeFields = fields.map((f) => ({
          id: f.id,
          name: f.name,
          crop: f.crop,
          areaHa: f.areaHa,
        }));
        const months = buildSeasonMonths(now);
        const insights = months.flatMap(({ year, month }) =>
          generateAgroInsights({
            activeFields,
            targetMonth: month,
            targetYear: year,
            currentWeather: null,
            now,
            inventory: stock?.inventory ?? [],
            fuelPriceUah: stock?.fuelPriceUah ?? 50,
            fleet: stock?.fleet ?? [],
            forecastHours: null,
            ndviAlerts:
              month === currentMonth && year === currentYear
                ? (stock?.ndviAlerts ?? [])
                : null,
          })
        );

        const insightBlocks = insightsToBlocks(insights, now);
        const operationBlocks = seasonOperationsToBlocks(operations, fields);
        const merged = mergeAgroplanBlocks({
          insightBlocks,
          operationBlocks,
          hiddenIds: new Set(),
          operations,
        });

        const draft: PlanningTask[] = [];
        const scheduled: PlanningTask[] = [];

        for (const block of merged) {
          if (block.source === "operation") {
            scheduled.push(toPlanningTask(block, true));
          } else {
            draft.push(toPlanningTask(block, false));
          }
        }

        setFields(
          fields.map((f) => ({
            id: f.id,
            name: f.name,
            crop: f.crop ?? undefined,
          }))
        );
        hydrateTasks(draft, scheduled);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [hydrateTasks, setFields, setLoading]);
}

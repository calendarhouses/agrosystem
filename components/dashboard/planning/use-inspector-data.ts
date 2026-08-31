"use client";

import { useEffect, useMemo, useState } from "react";

import type { AgroRadarStockContext } from "@/app/calendar/actions";
import type { AgroplanSeasonOperation } from "@/lib/agroplan/season-ops";
import {
  resolveCropDictionaryEntry,
  type CropOperationKind,
} from "@/lib/agronomy-dictionary";
import {
  evaluateFleetStatus,
  fleetNeedForOperation,
  type AgroFleetUnit,
  type FleetStatus,
} from "@/lib/agronomy-fleet";
import {
  evaluateResourceStatus,
  type ResourceStatus,
} from "@/lib/agronomy-resources";
import type { PlanningTask } from "@/lib/planning/types";
import { cachedFetchJson } from "@/lib/client-data-cache";
import type { FarmField } from "@/lib/farm-fields";
import { currentAgroSeason } from "@/lib/season";

export type InspectorOperationDetails = {
  machinery: string;
  implement: string;
  status: AgroplanSeasonOperation["status"];
};

export type InspectorPanelData = {
  loading: boolean;
  areaHa: number;
  resource: ResourceStatus;
  fleet: FleetStatus;
  matchingFleet: AgroFleetUnit[];
  operation: InspectorOperationDetails | null;
};

function toOperationType(task: PlanningTask): CropOperationKind {
  const raw = task.operationType?.trim();
  if (raw === "Збір" || raw === "ТМЦ" || raw === "Робота") return raw;
  return "Робота";
}

export function useInspectorData(task: PlanningTask | null): InspectorPanelData {
  const [loading, setLoading] = useState(false);
  const [stock, setStock] = useState<AgroRadarStockContext | null>(null);
  const [areaHa, setAreaHa] = useState(0);
  const [operation, setOperation] = useState<InspectorOperationDetails | null>(
    null
  );

  useEffect(() => {
    if (!task) {
      setStock(null);
      setAreaHa(0);
      setOperation(null);
      return;
    }

    const activeTask = task;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const season = currentAgroSeason();
        const [stockRes, fieldsRes, opsRes] = await Promise.all([
          cachedFetchJson<{ ok?: boolean; stock?: AgroRadarStockContext }>(
            "api:agro-radar:stock",
            "/api/agro-radar/stock"
          ),
          cachedFetchJson<{ fields?: FarmField[] }>("api:fields", "/api/fields"),
          activeTask.operationClientKey
            ? cachedFetchJson<{ operations?: AgroplanSeasonOperation[] }>(
                `api:agroplan:season-ops:${season}`,
                `/api/agroplan/season-ops?season=${season}`
              )
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        setStock(stockRes.data.stock ?? null);

        const field = fieldsRes.data.fields?.find(
          (f: FarmField) => f.id === activeTask.fieldId
        );
        setAreaHa(field?.areaHa ?? 0);

        if (activeTask.operationClientKey && opsRes?.data.operations) {
          const op = opsRes.data.operations.find(
            (row: AgroplanSeasonOperation) =>
              row.clientKey === activeTask.operationClientKey
          );
          setOperation(
            op
              ? {
                  machinery: op.machinery,
                  implement: op.implement,
                  status: op.status,
                }
              : null
          );
        } else {
          setOperation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [task]);

  const computed = useMemo(() => {
    if (!task) {
      return {
        resource: {
          status: "OK" as const,
          requiredQty: 0,
          availableQty: 0,
          item: null,
          itemRefKey: null,
          unit: "",
          unitPriceUah: 0,
          deficitQty: 0,
        },
        fleet: {
          status: "AVAILABLE" as const,
          availableCount: 0,
          requiredCount: 0,
          unitLabel: "",
          totalMatching: 0,
        },
        matchingFleet: [] as AgroFleetUnit[],
      };
    }

    const cropKey = resolveCropDictionaryEntry(task.crop)?.key;
    const operationType = toOperationType(task);
    const inventory = stock?.inventory ?? [];
    const fleetUnits = stock?.fleet ?? [];

    const resource = evaluateResourceStatus(
      areaHa,
      task.operationName,
      operationType,
      inventory,
      cropKey
    );
    const fleet = evaluateFleetStatus(
      areaHa,
      task.operationName,
      operationType,
      fleetUnits
    );

    const need = fleetNeedForOperation(task.operationName, operationType);
    const matchingFleet = fleetUnits
      .filter((unit) =>
        need.matchTypes.includes(unit.type as (typeof need.matchTypes)[number])
      )
      .slice(0, 6);

    return { resource, fleet, matchingFleet };
  }, [task, stock, areaHa]);

  return {
    loading,
    areaHa,
    operation,
    ...computed,
  };
}

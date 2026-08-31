"use client";

import { useEffect, useMemo, useState } from "react";

import type { AgroRadarStockContext } from "@/app/calendar/actions";
import {
  resolveCropDictionaryEntry,
  type CropOperationKind,
} from "@/lib/agronomy-dictionary";
import { evaluateResourceStatus } from "@/lib/agronomy-resources";
import type { PlanningField, PlanningTask } from "@/lib/planning/types";
import { cachedFetchJson } from "@/lib/client-data-cache";
import type { FarmField } from "@/lib/farm-fields";

function toOperationType(task: PlanningTask): CropOperationKind {
  const raw = task.operationType?.trim();
  if (raw === "Збір" || raw === "ТМЦ" || raw === "Робота") return raw;
  return "Робота";
}

/** Дефіцит ТМЦ per task (live stock + field area) */
export function useTaskResourceDeficits(
  tasks: readonly PlanningTask[],
  fields: readonly PlanningField[]
): ReadonlyMap<string, boolean> {
  const [stock, setStock] = useState<AgroRadarStockContext | null>(null);
  const [areaByFieldId, setAreaByFieldId] = useState<Map<string, number>>(
    () => new Map()
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stockRes, fieldsRes] = await Promise.all([
          cachedFetchJson<{ ok?: boolean; stock?: AgroRadarStockContext }>(
            "api:agro-radar:stock",
            "/api/agro-radar/stock"
          ),
          cachedFetchJson<{ fields?: FarmField[] }>("api:fields", "/api/fields"),
        ]);
        if (cancelled) return;
        setStock(stockRes.data.stock ?? null);
        const map = new Map<string, number>();
        for (const field of fieldsRes.data.fields ?? []) {
          map.set(field.id, field.areaHa ?? 0);
        }
        setAreaByFieldId(map);
      } catch {
        /* offline */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const map = new Map<string, boolean>();
    const inventory = stock?.inventory ?? [];

    for (const task of tasks) {
      if (task.resourceDeficit === true) {
        map.set(task.id, true);
        continue;
      }

      const areaHa = areaByFieldId.get(task.fieldId) ?? 0;
      const cropKey = resolveCropDictionaryEntry(task.crop)?.key;
      const resource = evaluateResourceStatus(
        areaHa,
        task.operationName,
        toOperationType(task),
        inventory,
        cropKey
      );
      map.set(task.id, resource.status === "DEFICIT");
    }

    return map;
  }, [tasks, stock, areaByFieldId]);
}

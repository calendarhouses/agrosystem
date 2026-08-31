import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import type { InsightCardData } from "@/lib/agronomy-engine";
import type { FieldOperationStatus } from "@/lib/field-operations";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";
import type { FarmField } from "@/lib/farm-fields";

export type AgroplanSeasonOperation = {
  clientKey: string;
  fieldId: string | null;
  fieldKey: string;
  fieldName: string;
  workType: string;
  crop: string;
  status: FieldOperationStatus;
  occurredAt: string;
  machinery: string;
  implement: string;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function msOnYmd(ymd: string, hour = 8): number {
  const { fromUnix } = kyivDayBoundsUnix(ymd);
  return fromUnix * 1000 + hour * 3_600_000;
}

function statusToInsightStatus(
  status: FieldOperationStatus
): InsightCardData["status"] {
  if (status === "in_progress") return "PERFECT_CONDITIONS";
  if (status === "completed") return "PLANNING";
  return "WAITING_WEATHER";
}

function syntheticInsight(
  op: AgroplanSeasonOperation,
  field: FarmField | undefined
): InsightCardData {
  const month = Number(op.occurredAt.slice(5, 7)) || 1;
  const year = Number(op.occurredAt.slice(0, 4)) || new Date().getFullYear();
  return {
    id: `op:${op.clientKey}`,
    kind: "operation",
    operationId: op.clientKey,
    operationName: op.workType,
    operationType: "Робота",
    crop: op.crop || field?.crop || "—",
    cropKey: "corn",
    fields: [
      {
        id: op.fieldId ?? field?.id ?? "unknown",
        name: op.fieldName,
        areaHa: field?.areaHa,
      },
    ],
    status: statusToInsightStatus(op.status),
    explanation:
      op.status === "in_progress"
        ? "Наряд у роботі — телематика активна"
        : op.status === "completed"
          ? "Виконано"
          : "Запланований наряд",
    targetMonth: month,
    targetYear: year,
    resourceStatus: emptyResourceStatus(),
    estimatedCost: emptyEstimatedCost(),
    fleetStatus: {
      status: "AVAILABLE",
      availableCount: 1,
      requiredCount: 1,
      unitLabel: "од.",
      totalMatching: 1,
    },
    riskScore: 0,
    isCriticalPriority: op.status === "in_progress",
  };
}

/** empty helpers - need to check if they exist */
function emptyResourceStatus(): InsightCardData["resourceStatus"] {
  return {
    status: "OK",
    requiredQty: 0,
    availableQty: 0,
    item: null,
    itemRefKey: null,
    unit: "",
    unitPriceUah: 0,
    deficitQty: 0,
  };
}

function emptyEstimatedCost(): InsightCardData["estimatedCost"] {
  return { totalUah: 0, tmcUah: 0, fuelUah: 0, fuelLiters: 0, areaHa: 0 };
}

export function seasonOperationsToBlocks(
  ops: readonly AgroplanSeasonOperation[],
  fields: readonly FarmField[]
): AgroplanBlock[] {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  return ops
    .filter((op) => op.status !== "cancelled")
    .map((op) => {
      const field = op.fieldId ? fieldById.get(op.fieldId) : undefined;
      const fieldId = op.fieldId ?? field?.id ?? "unknown";
      return {
        id: `op:${op.clientKey}`,
        source: "operation" as const,
        insight: syntheticInsight(op, field),
        fieldId,
        fieldName: op.fieldName || field?.name || "Поле",
        startMs: msOnYmd(op.occurredAt.slice(0, 10), 8),
        durationHours: 8,
        operationClientKey: op.clientKey,
        operationFieldKey: op.fieldKey,
        operationStatus: op.status,
      };
    });
}

import type { AgroplanBlock } from "@/lib/agroplan/blocks";
import type { AgroInsightStatus } from "@/lib/agronomy-engine";
import type { FarmField } from "@/lib/farm-fields";

export type AgroplanFilters = {
  query: string;
  statuses: Set<AgroInsightStatus>;
  showInsights: boolean;
  showOperations: boolean;
  showAnomalies: boolean;
};

export const DEFAULT_AGROPLAN_FILTERS: AgroplanFilters = {
  query: "",
  statuses: new Set<AgroInsightStatus>([
    "PERFECT_CONDITIONS",
    "WAITING_WEATHER",
    "PLANNING",
  ]),
  showInsights: true,
  showOperations: true,
  showAnomalies: true,
};

export function filterFields(
  fields: readonly FarmField[],
  blocksByField: Map<string, AgroplanBlock[]>,
  filters: AgroplanFilters
): FarmField[] {
  const q = filters.query.trim().toLowerCase();
  return fields.filter((field) => {
    if (q) {
      const hay = `${field.name} ${field.crop ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const blocks = blocksByField.get(field.id) ?? [];
    if (blocks.length === 0) return !q;
    return blocks.some((b) => blockMatchesFilters(b, filters));
  });
}

export function filterBlocks(
  blocks: readonly AgroplanBlock[],
  filters: AgroplanFilters
): AgroplanBlock[] {
  return blocks.filter((b) => blockMatchesFilters(b, filters));
}

function blockMatchesFilters(block: AgroplanBlock, filters: AgroplanFilters): boolean {
  if (block.insight.kind === "anomaly" && !filters.showAnomalies) return false;
  if (block.source === "insight" && block.insight.kind !== "anomaly" && !filters.showInsights) {
    return false;
  }
  if (block.source === "operation" && !filters.showOperations) return false;
  if (!filters.statuses.has(block.insight.status)) return false;
  if (filters.query.trim()) {
    const q = filters.query.trim().toLowerCase();
    const hay = `${block.fieldName} ${block.insight.operationName} ${block.insight.crop}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

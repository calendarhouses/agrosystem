export type ParsedTimelineEventId =
  | { kind: "equipment"; clientKey: string }
  | { kind: "inventory"; moveId: string }
  | { kind: "scouting"; reportId: string };

export function equipmentTimelineId(clientKey: string): string {
  return `equipment:${clientKey}`;
}

export function inventoryTimelineId(moveId: string): string {
  return `inventory:${moveId}`;
}

export function scoutingTimelineId(reportId: string): string {
  return `scouting:${reportId}`;
}

export function parseTimelineEventId(id: string): ParsedTimelineEventId | null {
  if (id.startsWith("equipment:")) {
    const clientKey = id.slice("equipment:".length).trim();
    return clientKey ? { kind: "equipment", clientKey } : null;
  }
  if (id.startsWith("inventory:")) {
    const moveId = id.slice("inventory:".length).trim();
    return moveId ? { kind: "inventory", moveId } : null;
  }
  if (id.startsWith("scouting:")) {
    const reportId = id.slice("scouting:".length).trim();
    return reportId ? { kind: "scouting", reportId } : null;
  }
  return null;
}

export function fieldOperationsKeyFromFarmId(fieldId: string): string {
  return `farm:${fieldId}`;
}

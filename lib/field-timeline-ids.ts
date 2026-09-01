export type ParsedTimelineEventId =
  | { kind: "equipment"; clientKey: string }
  | { kind: "inventory"; moveId: string };

export function equipmentTimelineId(clientKey: string): string {
  return `equipment:${clientKey}`;
}

export function inventoryTimelineId(moveId: string): string {
  return `inventory:${moveId}`;
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
  return null;
}

export function fieldOperationsKeyFromFarmId(fieldId: string): string {
  return `farm:${fieldId}`;
}

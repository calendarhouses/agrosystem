/**
 * Єдиний список техніки для нарядів / заправок:
 * активний довідник equipment + live Wialon (незамаплені юніти).
 */

export type EquipmentForOpsRow = {
  id: string;
  name: string;
  type: string;
  wialonId: number | null;
  hasTracker: boolean;
};

export type EquipmentOpsOption = {
  /** Select value: `eq:{uuid}` або `w:{wialonId}` */
  key: string;
  label: string;
  equipmentId: string | null;
  wialonUnitId: number | null;
  hasTracker: boolean;
  group: "tracked" | "non_tracked";
};

export function equipmentOpsKey(input: {
  equipmentId?: string | null;
  wialonUnitId?: number | null;
}): string | null {
  if (input.equipmentId) return `eq:${input.equipmentId}`;
  if (
    input.wialonUnitId != null &&
    Number.isFinite(input.wialonUnitId) &&
    input.wialonUnitId > 0
  ) {
    return `w:${input.wialonUnitId}`;
  }
  return null;
}

export function parseEquipmentOpsKey(key: string): {
  equipmentId: string | null;
  wialonUnitId: number | null;
} {
  if (key.startsWith("eq:")) {
    return { equipmentId: key.slice(3), wialonUnitId: null };
  }
  if (key.startsWith("w:")) {
    const n = Number(key.slice(2));
    return {
      equipmentId: null,
      wialonUnitId: Number.isFinite(n) && n > 0 ? n : null,
    };
  }
  // Legacy: чистий числовий Wialon id
  const n = Number(key);
  if (Number.isFinite(n) && n > 0) {
    return { equipmentId: null, wialonUnitId: n };
  }
  return { equipmentId: null, wialonUnitId: null };
}

export function mergeEquipmentOpsOptions(
  equipment: EquipmentForOpsRow[],
  wialonUnits: Array<{ id: number; nm?: string; name?: string }>
): EquipmentOpsOption[] {
  const byWialon = new Map<number, EquipmentForOpsRow>();
  for (const row of equipment) {
    if (row.wialonId != null && Number.isFinite(row.wialonId) && row.wialonId > 0) {
      byWialon.set(row.wialonId, row);
    }
  }

  const options: EquipmentOpsOption[] = [];
  const seenWialon = new Set<number>();

  for (const row of equipment) {
    const wialonUnitId =
      row.wialonId != null && Number.isFinite(row.wialonId) && row.wialonId > 0
        ? row.wialonId
        : null;
    const hasTracker = Boolean(row.hasTracker && wialonUnitId != null);
    if (wialonUnitId != null) seenWialon.add(wialonUnitId);
    options.push({
      key: `eq:${row.id}`,
      label: row.name.trim() || "Техніка",
      equipmentId: row.id,
      wialonUnitId,
      hasTracker,
      group: hasTracker ? "tracked" : "non_tracked",
    });
  }

  for (const unit of wialonUnits) {
    const id = Number(unit.id);
    if (!Number.isFinite(id) || id <= 0 || seenWialon.has(id)) continue;
    if (byWialon.has(id)) continue;
    const name =
      (unit.nm ?? unit.name)?.trim() || `Техніка ${id}`;
    options.push({
      key: `w:${id}`,
      label: name,
      equipmentId: null,
      wialonUnitId: id,
      hasTracker: true,
      group: "tracked",
    });
  }

  const sortUk = (a: EquipmentOpsOption, b: EquipmentOpsOption) =>
    a.label.localeCompare(b.label, "uk");

  return [
    ...options.filter((o) => o.group === "tracked").sort(sortUk),
    ...options.filter((o) => o.group === "non_tracked").sort(sortUk),
  ];
}

export function findEquipmentOpsOption(
  options: EquipmentOpsOption[],
  input: {
    key?: string | null;
    equipmentId?: string | null;
    wialonUnitId?: number | null;
  }
): EquipmentOpsOption | null {
  if (input.key) {
    const byKey = options.find((o) => o.key === input.key);
    if (byKey) return byKey;
  }
  if (input.equipmentId) {
    const byEq = options.find((o) => o.equipmentId === input.equipmentId);
    if (byEq) return byEq;
  }
  if (input.wialonUnitId != null) {
    const byW = options.find((o) => o.wialonUnitId === input.wialonUnitId);
    if (byW) return byW;
  }
  return null;
}

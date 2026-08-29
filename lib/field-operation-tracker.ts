import type { FieldGeometry } from "@/lib/farm-fields";
import {
  listAllLocalFieldOperations,
  todayIsoLocal,
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import { calculateTechInField } from "@/lib/field-tech-history";
import type { WialonUnit } from "@/lib/wialon";

export type FieldPresenceInput = {
  fieldKey: string;
  geometry: FieldGeometry | null | undefined;
  farmFieldId?: string | null;
};

/**
 * Юніти всередині кожного поля → sync planned→in_progress (API + local).
 */
export async function syncPlannedOpsFromTrackerPresence(args: {
  fields: FieldPresenceInput[];
  units: WialonUnit[];
}): Promise<FieldOperation[]> {
  const { fields, units } = args;
  if (fields.length === 0 || units.length === 0) return [];

  const today = todayIsoLocal();
  const presence: Array<{ fieldKey: string; unitIds: number[] }> = [];

  for (const field of fields) {
    if (!field.geometry) continue;
    const inside = calculateTechInField({ geometry: field.geometry }, units);
    const unitIds = inside
      .map((entry) => Number(entry.id))
      .filter((id) => Number.isFinite(id));
    if (unitIds.length > 0) {
      presence.push({ fieldKey: field.fieldKey, unitIds });
    }
  }

  if (presence.length === 0) return [];

  const localUpdated: FieldOperation[] = [];
  const localOps = listAllLocalFieldOperations();
  for (const entry of presence) {
    const insideSet = new Set(entry.unitIds);
    for (const op of localOps) {
      if (op.fieldKey !== entry.fieldKey) continue;
      if (op.status !== "planned") continue;
      if (op.occurredAt !== today) continue;
      if (op.wialonUnitId == null || !insideSet.has(op.wialonUnitId)) continue;

      const next = await upsertFieldOperation({
        ...op,
        status: "in_progress",
        fieldKey: op.fieldKey,
      });
      localUpdated.push(next);
    }
  }

  try {
    const res = await fetch("/api/field-operations/sync-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presence, date: today }),
    });
    if (res.ok) {
      const data = (await res.json()) as { updated?: FieldOperation[] };
      if (data.updated?.length) return data.updated;
    }
  } catch (err) {
    console.error("[sync-planned-ops-tracker]", err);
    /* local already updated */
  }

  return localUpdated;
}

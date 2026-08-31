import type { PlanningField } from "@/lib/planning/types";

/** Урочище: «Василиха №1» → «Василиха» */
export function fieldClusterLabel(name: string): string {
  const trimmed = name.trim();
  const numbered = trimmed.match(/^(.*?)(?:\s*[№#N]\s*\d+)$/i);
  if (numbered && numbered[1].trim().length >= 2) {
    return numbered[1].trim();
  }
  const trailingDigits = trimmed.match(/^(.*?)(\d+)$/);
  if (
    trailingDigits &&
    trailingDigits[1].trim().length >= 3 &&
    trailingDigits[2].length <= 3
  ) {
    return trailingDigits[1].trim();
  }
  return trimmed;
}

export type FieldClusterGroup = {
  label: string;
  fields: PlanningField[];
  isAccordion: boolean;
};

export function groupFieldsByCluster(
  fields: PlanningField[]
): FieldClusterGroup[] {
  const order: string[] = [];
  const map = new Map<string, PlanningField[]>();

  for (const field of fields) {
    const label = fieldClusterLabel(field.name);
    if (!map.has(label)) {
      order.push(label);
      map.set(label, []);
    }
    map.get(label)!.push(field);
  }

  return order.map((label) => {
    const clusterFields = [...(map.get(label) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, "uk")
    );
    return {
      label,
      fields: clusterFields,
      isAccordion: clusterFields.length >= 2,
    };
  });
}

export type MatrixFlatRow =
  | { type: "cluster"; id: string; label: string; fieldIds: string[] }
  | { type: "field"; id: string; field: PlanningField; clusterLabel: string };

export function buildMatrixFlatRows(input: {
  fields: PlanningField[];
  scheduledTasks: { fieldId: string; fieldName: string; crop?: string }[];
  collapsedClusters: ReadonlySet<string>;
}): MatrixFlatRow[] {
  const fieldById = new Map<string, PlanningField>();

  for (const field of input.fields) {
    fieldById.set(field.id, field);
  }

  for (const task of input.scheduledTasks) {
    if (fieldById.has(task.fieldId)) continue;
    fieldById.set(task.fieldId, {
      id: task.fieldId,
      name: task.fieldName,
      crop: task.crop,
    });
  }

  const allFields = Array.from(fieldById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "uk")
  );

  const groups = groupFieldsByCluster(allFields);
  const rows: MatrixFlatRow[] = [];

  for (const group of groups) {
    if (group.isAccordion) {
      rows.push({
        type: "cluster",
        id: `cluster:${group.label}`,
        label: group.label,
        fieldIds: group.fields.map((f) => f.id),
      });
      if (!input.collapsedClusters.has(group.label)) {
        for (const field of group.fields) {
          rows.push({
            type: "field",
            id: field.id,
            field,
            clusterLabel: group.label,
          });
        }
      }
      continue;
    }

    for (const field of group.fields) {
      rows.push({
        type: "field",
        id: field.id,
        field,
        clusterLabel: group.label,
      });
    }
  }

  return rows;
}

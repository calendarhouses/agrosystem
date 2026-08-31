const CELL_PREFIX = "matrix-cell:";

export function matrixCellDropId(fieldId: string, dateYmd: string): string {
  return `${CELL_PREFIX}${fieldId}:${dateYmd}`;
}

export function parseMatrixCellDropId(
  id: string | number | undefined
): { fieldId: string; dateYmd: string } | null {
  if (typeof id !== "string" || !id.startsWith(CELL_PREFIX)) return null;
  const rest = id.slice(CELL_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const fieldId = rest.slice(0, sep);
  const dateYmd = rest.slice(sep + 1);
  if (!fieldId || !dateYmd) return null;
  return { fieldId, dateYmd };
}

export type PlanningDragData = {
  taskId: string;
};

export function planningDragData(taskId: string): PlanningDragData {
  return { taskId };
}

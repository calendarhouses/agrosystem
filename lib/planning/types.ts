export type PlanningTaskSource = "insight" | "operation" | "manual";

export type PlanningOperationType = "Збір" | "ТМЦ" | "Робота" | string;

export type PlanningTask = {
  id: string;
  operationName: string;
  fieldId: string;
  fieldName: string;
  crop?: string;
  source: PlanningTaskSource;
  operationType?: PlanningOperationType;
  scheduledYmd?: string;
  durationDays: number;
  operationClientKey?: string;
  priority: "normal" | "high";
  /** 0–100, телематика / статус наряду */
  completionPct?: number;
  /** Дефіцит ТМЦ на складі */
  resourceDeficit?: boolean;
};

export type PlanningField = {
  id: string;
  name: string;
  crop?: string;
};

export type MatrixWeekColumn = {
  ymd: string;
  label: string;
  shortLabel: string;
};

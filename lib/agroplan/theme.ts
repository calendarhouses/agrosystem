import type { CropOperationKind } from "@/lib/agronomy-dictionary";
import type { AgroInsightStatus } from "@/lib/agronomy-engine";

/** Tech-Noir палітра Агроплану */
export const AGROPLAN_SURFACE = "#0a0c10";
export const AGROPLAN_GRID = "rgba(148, 163, 184, 0.08)";
export const AGROPLAN_GRID_STRONG = "rgba(148, 163, 184, 0.14)";

export type OperationAccent = {
  border: string;
  glow: string;
  text: string;
  label: string;
};

export function operationAccent(
  operationType: CropOperationKind,
  kind: "operation" | "anomaly" = "operation"
): OperationAccent {
  if (kind === "anomaly") {
    return {
      border: "border-rose-400/50",
      glow: "shadow-[0_0_24px_rgba(244,63,94,0.18)]",
      text: "text-rose-200",
      label: "Аномалія",
    };
  }
  if (operationType === "Збір") {
    return {
      border: "border-amber-400/55",
      glow: "shadow-[0_0_22px_rgba(251,191,36,0.16)]",
      text: "text-amber-100",
      label: "Збір",
    };
  }
  if (operationType === "ТМЦ") {
    return {
      border: "border-emerald-400/55",
      glow: "shadow-[0_0_22px_rgba(52,211,153,0.18)]",
      text: "text-emerald-100",
      label: "Посів / ЗЗР",
    };
  }
  return {
    border: "border-cyan-400/40",
    glow: "shadow-[0_0_18px_rgba(34,211,238,0.12)]",
    text: "text-cyan-50",
    label: "Робота",
  };
}

export function statusDotClass(status: AgroInsightStatus): string {
  if (status === "PERFECT_CONDITIONS") return "bg-emerald-400";
  if (status === "WAITING_WEATHER") return "bg-amber-400";
  return "bg-slate-500";
}

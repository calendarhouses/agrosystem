import type { CropOperationKind } from "@/lib/agronomy-dictionary";
import type { AgroInsightStatus } from "@/lib/agronomy-engine";

/** Палітра Агроплану — узгоджено з globals (--card, --border, --primary) */
export type OperationAccent = {
  border: string;
  glow: string;
  text: string;
  label: string;
  chip: string;
};

export function operationAccent(
  operationType: CropOperationKind,
  kind: "operation" | "anomaly" = "operation"
): OperationAccent {
  if (kind === "anomaly") {
    return {
      border: "border-rose-500/35",
      glow: "shadow-sm ring-1 ring-rose-500/10",
      text: "text-foreground",
      label: "Аномалія",
      chip: "bg-rose-500/10 text-rose-800",
    };
  }
  if (operationType === "Збір") {
    return {
      border: "border-[#D69E2E]/45",
      glow: "shadow-sm ring-1 ring-[#D69E2E]/10",
      text: "text-foreground",
      label: "Збір",
      chip: "bg-[#D69E2E]/12 text-[#9C4221]",
    };
  }
  if (operationType === "ТМЦ") {
    return {
      border: "border-primary/40",
      glow: "shadow-sm ring-1 ring-primary/10",
      text: "text-foreground",
      label: "Посів / ЗЗР",
      chip: "bg-primary/10 text-primary",
    };
  }
  return {
    border: "border-cyan-700/25",
    glow: "shadow-sm ring-1 ring-cyan-700/8",
    text: "text-foreground",
    label: "Робота",
    chip: "bg-cyan-900/8 text-cyan-900",
  };
}

export function statusDotClass(status: AgroInsightStatus): string {
  if (status === "PERFECT_CONDITIONS") return "bg-primary";
  if (status === "WAITING_WEATHER") return "bg-[#D69E2E]";
  return "bg-muted-foreground/50";
}

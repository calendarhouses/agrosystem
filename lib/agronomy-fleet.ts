/**
 * Норми / перевірка парку техніки для Агро-Радара.
 */

import type { CropOperationKind } from "@/lib/agronomy-dictionary";
import { mapDictionaryOpToWorkType } from "@/lib/agronomy-dictionary";

export type FleetUnitKind =
  | "sprayer"
  | "seeder"
  | "combine"
  | "spreader"
  | "tractor"
  | "other";

export type AgroFleetUnit = {
  id: string;
  name: string;
  /** sprayer | tractor | combine | … */
  type: string;
  /** false = ремонт / деактивовано */
  isActive: boolean;
  wialonId: number | null;
  /** Зайнятий активним нарядом */
  isBusy: boolean;
};

export type FleetStatus = {
  status: "AVAILABLE" | "BUSY";
  availableCount: number;
  requiredCount: number;
  /** Підпис для UI: «обприскувачі» */
  unitLabel: string;
  totalMatching: number;
};

export type FleetNeed = {
  /** Типи equipment / implements, що підходять */
  matchTypes: readonly FleetUnitKind[];
  unitLabel: string;
  /** га на 1 агрегат за зміну — для requiredCount */
  haPerUnit: number;
};

export function fleetNeedForOperation(
  operationName: string,
  operationType: CropOperationKind
): FleetNeed {
  const n = operationName.toLowerCase();
  const work = mapDictionaryOpToWorkType(operationName).toLowerCase();

  if (
    n.includes("гербіцид") ||
    n.includes("ззр") ||
    n.includes("десик") ||
    work.includes("ззр") ||
    (operationType === "ТМЦ" && n.includes("внесен"))
  ) {
    return {
      matchTypes: ["sprayer"],
      unitLabel: "обприскувачі",
      haPerUnit: 120,
    };
  }

  if (n.includes("посів") || work === "посів") {
    return {
      matchTypes: ["seeder", "tractor"],
      unitLabel: "посівні агрегати",
      haPerUnit: 80,
    };
  }

  if (n.includes("піджив") || n.includes("добрив") || work.includes("добрив")) {
    return {
      matchTypes: ["spreader", "tractor"],
      unitLabel: "розкидачі / трактори",
      haPerUnit: 100,
    };
  }

  if (n.includes("збір") || n.includes("збиран") || work.includes("збиран")) {
    return {
      matchTypes: ["combine"],
      unitLabel: "комбайни",
      haPerUnit: 60,
    };
  }

  return {
    matchTypes: ["tractor"],
    unitLabel: "трактори",
    haPerUnit: 70,
  };
}

function unitMatchesNeed(unit: AgroFleetUnit, need: FleetNeed): boolean {
  const t = unit.type.toLowerCase() as FleetUnitKind;
  return need.matchTypes.includes(t) || need.matchTypes.includes(unit.type as FleetUnitKind);
}

/**
 * Скільки агрегатів доступні vs потрібно для площі.
 * Ремонт = !isActive; зайнятість = isBusy.
 */
export function evaluateFleetStatus(
  totalAreaHa: number,
  operationName: string,
  operationType: CropOperationKind,
  fleet: readonly AgroFleetUnit[]
): FleetStatus {
  const need = fleetNeedForOperation(operationName, operationType);
  const matching = fleet.filter((u) => unitMatchesNeed(u, need));
  const available = matching.filter((u) => u.isActive && !u.isBusy);

  const area = Math.max(0, totalAreaHa);
  const requiredCount = Math.max(
    1,
    Math.ceil(area / Math.max(need.haPerUnit, 1))
  );

  // Для посіву: якщо є сівалки — рахуємо їх; інакше трактори
  let availableCount = available.length;
  if (need.matchTypes.includes("seeder")) {
    const seeders = available.filter((u) => u.type === "seeder");
    if (seeders.length > 0) availableCount = seeders.length;
  }
  if (need.matchTypes.includes("sprayer")) {
    const sprayers = available.filter((u) => u.type === "sprayer");
    availableCount = sprayers.length;
  }
  if (need.matchTypes.includes("combine")) {
    availableCount = available.filter((u) => u.type === "combine").length;
  }

  const status: FleetStatus["status"] =
    availableCount >= requiredCount ? "AVAILABLE" : "BUSY";

  return {
    status,
    availableCount,
    requiredCount,
    unitLabel: need.unitLabel,
    totalMatching: matching.length,
  };
}

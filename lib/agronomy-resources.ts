/**
 * Норми витрат ТМЦ / палива для Агро-Радара + матчинг зі складом.
 */

import {
  mapDictionaryOpToWorkType,
  type CropOperationKind,
} from "@/lib/agronomy-dictionary";
import { fuelLitersPerHa } from "@/lib/field-operation-norms";

export type InventoryCategoryHint =
  | "zzr"
  | "fertilizer"
  | "seed"
  | "none";

/** Позиція віртуального складу для engine */
export type AgroInventoryItem = {
  basRefKey: string;
  name: string;
  category: string;
  unit: string;
  /** Віртуальний залишок (inbound − outbound − sale) */
  availableQty: number;
  /** Планова / собівартість ₴ за од. */
  unitPriceUah: number;
};

export type AgroResourceNeed = {
  category: InventoryCategoryHint;
  /** Норма витрати на 1 га */
  ratePerHa: number;
  unit: string;
  /** Ключові слова для пріоритетного матчу назви */
  nameHints: readonly string[];
};

export type ResourceStatus = {
  status: "OK" | "DEFICIT";
  requiredQty: number;
  availableQty: number;
  item: string | null;
  itemRefKey: string | null;
  unit: string;
  unitPriceUah: number;
  /** Скільки бракує (0 якщо OK) */
  deficitQty: number;
};

export type EstimatedCostBreakdown = {
  totalUah: number;
  tmcUah: number;
  fuelUah: number;
  fuelLiters: number;
  areaHa: number;
};

/** Середні норми витрат ТМЦ за типом операції словника */
export function resourceNeedForOperation(
  operationName: string,
  operationType: CropOperationKind,
  cropKey?: string
): AgroResourceNeed | null {
  const n = operationName.toLowerCase();

  if (
    n.includes("гербіцид") ||
    n.includes("ззр") ||
    n.includes("десик") ||
    (operationType === "ТМЦ" &&
      (n.includes("внесен") || n.includes("оброб")))
  ) {
    return {
      category: "zzr",
      ratePerHa: 2,
      unit: "л",
      nameHints: n.includes("десик")
        ? ["десик", "раундап", "гліфосат", "реглон"]
        : ["гербіцид", "амістар", "фунгіцид", "ззр"],
    };
  }

  if (n.includes("піджив") || n.includes("добрив")) {
    return {
      category: "fertilizer",
      ratePerHa: 150,
      unit: "кг",
      nameHints: ["карбамід", "селітр", "аміач", "npk", "касу", "добрив"],
    };
  }

  if (n.includes("посів")) {
    if (cropKey === "corn") {
      return {
        category: "seed",
        ratePerHa: 25,
        unit: "кг",
        nameHints: ["кукурудз", "corn", "насін"],
      };
    }
    if (cropKey === "sunflower") {
      return {
        category: "seed",
        ratePerHa: 5,
        unit: "кг",
        nameHints: ["соняш", "насін"],
      };
    }
    if (cropKey === "winter_wheat") {
      return {
        category: "seed",
        ratePerHa: 200,
        unit: "кг",
        nameHints: ["пшениц", "озим", "насін"],
      };
    }
    return {
      category: "seed",
      ratePerHa: 30,
      unit: "кг",
      nameHints: ["насін", "посів"],
    };
  }

  // Збір / чиста робота без ТМЦ
  return null;
}

function scoreItem(
  item: AgroInventoryItem,
  need: AgroResourceNeed
): number {
  if (item.category !== need.category) return -1;
  const name = item.name.toLowerCase();
  let score = 10;
  for (const hint of need.nameHints) {
    if (name.includes(hint)) score += 50;
  }
  // Більший залишок — кращий кандидат при однаковому матчі
  score += Math.min(20, Math.log10(Math.max(item.availableQty, 1)) * 5);
  return score;
}

/** Обрати найкращу позицію складу під потребу */
export function pickInventoryItem(
  items: readonly AgroInventoryItem[],
  need: AgroResourceNeed
): AgroInventoryItem | null {
  let best: AgroInventoryItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    const s = scoreItem(item, need);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return bestScore >= 0 ? best : null;
}

export function evaluateResourceStatus(
  totalAreaHa: number,
  operationName: string,
  operationType: CropOperationKind,
  inventory: readonly AgroInventoryItem[],
  cropKey?: string
): ResourceStatus {
  const need = resourceNeedForOperation(operationName, operationType, cropKey);
  if (!need || totalAreaHa <= 0) {
    return {
      status: "OK",
      requiredQty: 0,
      availableQty: 0,
      item: null,
      itemRefKey: null,
      unit: "",
      unitPriceUah: 0,
      deficitQty: 0,
    };
  }

  const requiredQty = Math.round(totalAreaHa * need.ratePerHa * 100) / 100;
  const picked = pickInventoryItem(inventory, need);
  const availableQty = picked?.availableQty ?? 0;
  const deficitQty = Math.max(0, Math.round((requiredQty - availableQty) * 100) / 100);

  return {
    status: deficitQty > 0.001 ? "DEFICIT" : "OK",
    requiredQty,
    availableQty: Math.round(availableQty * 100) / 100,
    item: picked?.name ?? `ТМЦ (${need.category})`,
    itemRefKey: picked?.basRefKey ?? null,
    unit: picked?.unit || need.unit,
    unitPriceUah: picked?.unitPriceUah ?? 0,
    deficitQty,
  };
}

export function estimateOperationCost(input: {
  totalAreaHa: number;
  operationName: string;
  resource: ResourceStatus;
  fuelPriceUah: number;
}): EstimatedCostBreakdown {
  const areaHa = Math.max(0, input.totalAreaHa);
  const workType = mapDictionaryOpToWorkType(input.operationName);
  const litersPerHa = fuelLitersPerHa(workType);
  const fuelLiters = Math.round(areaHa * litersPerHa * 10) / 10;
  const fuelUah = Math.round(fuelLiters * input.fuelPriceUah);
  const tmcUah = Math.round(
    input.resource.requiredQty * Math.max(0, input.resource.unitPriceUah)
  );

  return {
    totalUah: tmcUah + fuelUah,
    tmcUah,
    fuelUah,
    fuelLiters,
    areaHa,
  };
}

export function formatApproxUah(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "≈ 0 ₴";
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `≈ ${formatted} ₴`;
}

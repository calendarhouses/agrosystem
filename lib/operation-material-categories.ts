import { resourceNeedForOperation } from "@/lib/agronomy-resources";

export type OperationMaterialCategory = "zzr" | "fertilizer" | "seed";

const CATEGORY_LABELS: Record<OperationMaterialCategory, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
};

export function materialCategoryLabel(
  category: OperationMaterialCategory
): string {
  return CATEGORY_LABELS[category];
}

/** Які категорії складу релевантні для типу робіт */
export function materialCategoriesForWorkType(
  workType: string
): OperationMaterialCategory[] {
  const t = workType.trim().toLowerCase();
  if (t.includes("ззр") || t.includes("обприск")) return ["zzr"];
  if (t.includes("добрив") || t.includes("піджив")) return ["fertilizer"];
  if (t.includes("посів")) return ["seed"];
  return [];
}

export function operationRequiresMaterial(workType: string): boolean {
  return materialCategoriesForWorkType(workType).length > 0;
}

function cropKeyFromLabel(crop: string | null | undefined): string | undefined {
  const key = (crop ?? "").trim().toLowerCase();
  if (!key || key === "—" || key === "-") return undefined;
  if (key.includes("кукурудз")) return "corn";
  if (key.includes("соняш")) return "sunflower";
  if (key.includes("пшениц") || key.includes("озим")) return "winter_wheat";
  if (key.includes("ріпак") || key.includes("рапс")) return "rapeseed";
  if (key.includes("соя") || key.includes("соє")) return "soy";
  return undefined;
}

/** Орієнтовна кількість ТМЦ за площею (норма × га) */
export function estimateMaterialQty(
  workType: string,
  areaHa: number,
  crop?: string | null
): number | null {
  if (!(areaHa > 0)) return null;
  const need = resourceNeedForOperation(
    workType,
    "Робота",
    cropKeyFromLabel(crop)
  );
  if (!need) return null;
  const qty = need.ratePerHa * areaHa;
  return Math.round(qty * 100) / 100;
}

export function formatMaterialQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: qty >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${n} ${unit}` : n;
}

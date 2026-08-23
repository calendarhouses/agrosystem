/**
 * Operational Inventory — синк довідника ТМЦ з BAS → Supabase.
 * BAS лишається read-only; у 1С нічого не пишемо.
 */

import {
  getBasNomenclature,
  getBasUnits,
  type BasNomenclature,
} from "@/lib/bas-api";
import { isFertilizerName } from "@/lib/inventory-bas";
import { normalizeBasRefKey } from "@/lib/bas-mapping";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Папки BAS Catalog_Номенклатура для тіньового складу */
const FOLDER_ZZR_FERT = "ЗЗР, мін.добриво";
/** У BAS немає окремої «Насіння» — це «Посівні матеріали» */
const FOLDER_SEEDS = "Посівні матеріали";

export type CacheCategory = "zzr" | "fertilizer" | "seed" | "harvest" | "parts";

export type InventoryCacheRow = {
  bas_ref_key: string;
  name: string;
  category: CacheCategory;
  unit: string;
  updated_at: string;
};

export type SyncNomenclatureResult = {
  upserted: number;
  byCategory: Record<CacheCategory, number>;
  folders: { zzrFert: number; seeds: number };
};

function itemsInFolders(
  all: BasNomenclature[],
  folderNames: string[]
): BasNomenclature[] {
  const folders = all.filter(
    (row) =>
      row.IsFolder &&
      !row.DeletionMark &&
      folderNames.includes(row.Description?.trim() ?? "")
  );
  const parentKeys = new Set(folders.map((f) => f.Ref_Key.toLowerCase()));
  return all.filter(
    (row) =>
      !row.IsFolder &&
      !row.DeletionMark &&
      parentKeys.has((row.Parent_Key ?? "").toLowerCase())
  );
}

/**
 * Витягує з OData Catalog_Номенклатура (ЗЗР/добрива + посівні матеріали)
 * і робить upsert у inventory_items_cache.
 */
export async function syncNomenclatureToSupabase(): Promise<SyncNomenclatureResult> {
  const [nomenclature, units] = await Promise.all([
    getBasNomenclature(),
    getBasUnits(),
  ]);

  const unitMap = new Map(
    units.map((u) => [
      u.Ref_Key.toLowerCase(),
      u.Description?.trim() || u.Code?.trim() || "",
    ])
  );

  const zzrFertRaw = itemsInFolders(nomenclature, [FOLDER_ZZR_FERT]);
  const seedsRaw = itemsInFolders(nomenclature, [FOLDER_SEEDS]);

  const now = new Date().toISOString();
  const rows: InventoryCacheRow[] = [];
  const byCategory: Record<CacheCategory, number> = {
    zzr: 0,
    fertilizer: 0,
    seed: 0,
    harvest: 0,
    parts: 0,
  };

  for (const row of zzrFertRaw) {
    const basRef = normalizeBasRefKey(row.Ref_Key);
    if (!basRef) continue;
    const name = row.Description?.trim() || "Без назви";
    const category: CacheCategory = isFertilizerName(name)
      ? "fertilizer"
      : "zzr";
    rows.push({
      bas_ref_key: basRef,
      name,
      category,
      unit:
        unitMap.get((row.БазоваяЕдиницаИзмерения_Key ?? "").toLowerCase()) ||
        "",
      updated_at: now,
    });
    byCategory[category] += 1;
  }

  for (const row of seedsRaw) {
    const basRef = normalizeBasRefKey(row.Ref_Key);
    if (!basRef) continue;
    rows.push({
      bas_ref_key: basRef,
      name: row.Description?.trim() || "Без назви",
      category: "seed",
      unit:
        unitMap.get((row.БазоваяЕдиницаИзмерения_Key ?? "").toLowerCase()) ||
        "",
      updated_at: now,
    });
    byCategory.seed += 1;
  }

  if (rows.length === 0) {
    return {
      upserted: 0,
      byCategory,
      folders: { zzrFert: 0, seeds: 0 },
    };
  }

  const supabase = createServiceSupabase();
  const chunkSize = 200;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, data } = await supabase
      .from("inventory_items_cache")
      .upsert(chunk, { onConflict: "bas_ref_key" })
      .select("bas_ref_key");

    if (error) {
      throw new Error(`inventory_items_cache upsert: ${error.message}`);
    }
    upserted += data?.length ?? chunk.length;
  }

  return {
    upserted,
    byCategory,
    folders: {
      zzrFert: zzrFertRaw.length,
      seeds: seedsRaw.length,
    },
  };
}

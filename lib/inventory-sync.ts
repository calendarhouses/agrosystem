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
const FOLDER_PARTS = "Запчастини";
const FOLDER_HARVEST = ["Продукція С/Г рослиництво", "Продукція"];

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
  folders: {
    zzrFert: number;
    seeds: number;
    parts: number;
    harvest: number;
  };
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

function pushRows(
  rows: InventoryCacheRow[],
  byCategory: Record<CacheCategory, number>,
  raw: BasNomenclature[],
  unitMap: Map<string, string>,
  now: string,
  resolveCategory: (name: string) => CacheCategory
) {
  for (const row of raw) {
    const basRef = normalizeBasRefKey(row.Ref_Key);
    if (!basRef) continue;
    const name = row.Description?.trim() || "Без назви";
    const category = resolveCategory(name);
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
}

/**
 * Витягує з OData Catalog_Номенклатура (ЗЗР/добрива, насіння, запчастини, врожай)
 * і робить upsert у inventory_items_cache.
 * Локальні позиції (is_local) не чіпає — інший bas_ref_key (UUID).
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
  const partsRaw = itemsInFolders(nomenclature, [FOLDER_PARTS]);
  const harvestRaw = itemsInFolders(nomenclature, FOLDER_HARVEST);

  const now = new Date().toISOString();
  const rows: InventoryCacheRow[] = [];
  const byCategory: Record<CacheCategory, number> = {
    zzr: 0,
    fertilizer: 0,
    seed: 0,
    harvest: 0,
    parts: 0,
  };

  pushRows(rows, byCategory, zzrFertRaw, unitMap, now, (name) =>
    isFertilizerName(name) ? "fertilizer" : "zzr"
  );
  pushRows(rows, byCategory, seedsRaw, unitMap, now, () => "seed");
  pushRows(rows, byCategory, partsRaw, unitMap, now, () => "parts");
  pushRows(rows, byCategory, harvestRaw, unitMap, now, () => "harvest");

  if (rows.length === 0) {
    return {
      upserted: 0,
      byCategory,
      folders: { zzrFert: 0, seeds: 0, parts: 0, harvest: 0 },
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
      parts: partsRaw.length,
      harvest: harvestRaw.length,
    },
  };
}

import type { Metadata } from "next";

import { MappingView } from "@/components/admin/mapping-view";
import {
  getBasFields,
  getBasMachinery,
  getBasNomenclature,
  getBasStorages,
} from "@/lib/bas-api";
import {
  extractFieldNumberKey,
  fieldsToOptions,
  machineryToOptions,
  nomenclatureToOptions,
  normalizeBasRefKey,
  storagesToOptions,
  type MappingLocalRow,
} from "@/lib/bas-mapping";
import { createServiceSupabase } from "@/lib/supabase/server";
import { syncWialonGeofencesToFarmFields } from "@/lib/wialon-farm-sync";
import { getWialonUnits, wialonLogin } from "@/lib/wialon";

export const metadata: Metadata = {
  title: "Мапінг BAS AGRO",
};

export const dynamic = "force-dynamic";

async function loadBasCatalog<T>(
  loader: () => Promise<T[]>
): Promise<{ items: T[]; error: string | null }> {
  try {
    return { items: await loader(), error: null };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "Помилка BAS OData",
    };
  }
}

async function syncWialonMappingRows() {
  try {
    const eid = await wialonLogin();
    const units = await getWialonUnits(eid);
    if (units.length === 0) return;

    const supabase = createServiceSupabase();
    const { error } = await supabase.from("wialon_bas_mapping").upsert(
      units.map((unit) => ({
        wialon_id: unit.id,
        wialon_name: unit.nm,
      })),
      { onConflict: "wialon_id" }
    );

    if (error) {
      console.error("[bas-mapping] sync Wialon units:", error.message);
    }
  } catch (error) {
    console.error("[bas-mapping] sync Wialon units:", error);
  }
}

async function syncWialonFieldRows() {
  try {
    const result = await syncWialonGeofencesToFarmFields();
    console.info(
      `[bas-mapping] Wialon fields: ${result.total} geofences, +${result.inserted} new, ${result.updated} updated`
    );
  } catch (error) {
    console.error("[bas-mapping] sync Wialon fields:", error);
  }
}

async function loadStorageRows(): Promise<MappingLocalRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("fuel_storages")
    .select("id, name, type, capacity, current_volume, bas_ref_key")
    .order("name", { ascending: true });

  if (error) {
    console.error("[bas-mapping] fuel_storages:", error.message);
    return [];
  }

  const litres = new Intl.NumberFormat("uk-UA");

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.name ?? "Склад"),
    subtitle: [
      row.type === "mobile"
        ? "Мобільний резервуар"
        : row.type === "stationary"
          ? "Стаціонарний склад"
          : null,
      Number.isFinite(Number(row.capacity))
        ? `${litres.format(Number(row.current_volume ?? 0))} / ${litres.format(Number(row.capacity))} л`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || null,
    basRefKey: normalizeBasRefKey(
      row.bas_ref_key != null ? String(row.bas_ref_key) : null
    ),
  }));
}

/**
 * Мапляться лише записи, позначені як поля в реєстрі. Заголовок беремо з
 * канонічної назви — саме її веде агроном, назва з Wialon іде в підпис.
 */
async function loadFieldRows(): Promise<MappingLocalRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("farm_fields")
    .select(
      "id, name, canonical_name, field_no, area_ha, wialon_zone_id, is_field, bas_ref_key"
    )
    .not("is_field", "is", false)
    .order("canonical_name", { ascending: true });

  if (error) {
    console.error("[bas-mapping] farm_fields:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const areaHa =
      row.area_ha != null && Number.isFinite(Number(row.area_ha))
        ? Number(row.area_ha)
        : null;
    const wialonName = String(row.name ?? "Поле");
    const title = String(row.canonical_name ?? "").trim() || wialonName;
    const fieldNumberKey =
      String(row.field_no ?? "").trim() || extractFieldNumberKey(title);
    const subtitleParts = [
      title === wialonName ? null : `Wialon: ${wialonName}`,
      areaHa != null ? `${areaHa.toLocaleString("uk-UA")} га` : null,
    ].filter(Boolean);

    return {
      id: String(row.id),
      title,
      subtitle: subtitleParts.join(" · ") || null,
      areaHa,
      fieldNumberKey,
      basRefKey: normalizeBasRefKey(
        row.bas_ref_key != null ? String(row.bas_ref_key) : null
      ),
    };
  });
}

async function loadMachineryRows(): Promise<MappingLocalRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("wialon_bas_mapping")
    .select("id, wialon_id, wialon_name, bas_ref_key")
    .order("wialon_name", { ascending: true });

  if (error) {
    console.error("[bas-mapping] wialon_bas_mapping:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.wialon_name || `Wialon #${row.wialon_id}`),
    subtitle: row.wialon_id != null ? `ID ${row.wialon_id}` : null,
    basRefKey: normalizeBasRefKey(
      row.bas_ref_key != null ? String(row.bas_ref_key) : null
    ),
  }));
}

async function loadTmcRows(): Promise<MappingLocalRow[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("inventory_items_cache")
    .select(
      "id, bas_ref_key, name, custom_name, category, unit, is_local, is_hidden"
    )
    .or("is_hidden.is.null,is_hidden.eq.false")
    .order("name", { ascending: true })
    .limit(800);

  if (error) {
    console.error("[bas-mapping] inventory_items_cache:", error.message);
    return [];
  }

  const categoryLabel: Record<string, string> = {
    zzr: "ЗЗР",
    fertilizer: "Добрива",
    harvest: "Врожай",
    parts: "Запчастини",
    seed: "Насіння",
  };

  return (data ?? []).map((row) => {
    const title = String(row.custom_name?.trim() || row.name || "ТМЦ");
    const isLocal = row.is_local === true;
    const basRefKey = normalizeBasRefKey(
      row.bas_ref_key != null ? String(row.bas_ref_key) : null
    );
    return {
      id: String(row.id),
      title,
      subtitle: [
        categoryLabel[String(row.category)] ?? row.category,
        row.unit ? String(row.unit) : null,
        isLocal ? "локальна" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      basRefKey: isLocal ? null : basRefKey,
      isLocal,
    };
  });
}

export default async function BasMappingPage() {
  const props = await loadBasMappingViewProps();
  return <MappingView {...props} />;
}

export async function loadBasMappingViewProps() {
  await Promise.all([syncWialonFieldRows(), syncWialonMappingRows()]);

  const [
    storages,
    fields,
    machinery,
    tmc,
    basStorages,
    basFields,
    basMachinery,
    basNomenclature,
  ] = await Promise.all([
    loadStorageRows(),
    loadFieldRows(),
    loadMachineryRows(),
    loadTmcRows(),
    loadBasCatalog(getBasStorages),
    loadBasCatalog(getBasFields),
    loadBasCatalog(getBasMachinery),
    loadBasCatalog(getBasNomenclature),
  ]);

  return {
    storages,
    fields,
    machinery,
    tmc,
    storageOptions: storagesToOptions(basStorages.items),
    fieldOptions: fieldsToOptions(basFields.items),
    machineryOptions: machineryToOptions(basMachinery.items),
    tmcOptions: nomenclatureToOptions(basNomenclature.items),
    storageError: basStorages.error,
    fieldError: basFields.error,
    machineryError: basMachinery.error,
    tmcError: basNomenclature.error,
  };
}

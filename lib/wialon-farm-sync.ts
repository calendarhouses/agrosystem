import type { Feature, Polygon } from "geojson";

import { areaHaFromFeature } from "@/lib/map-fields";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  getWialonGeofences,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
  type WialonGeofenceProperties,
} from "@/lib/wialon";

const DEFAULT_CROP = "—";
const DEFAULT_COLOR = "#276749";

function extractCadastralFromText(text: string): string | null {
  const match = text.match(/\d{10}:\d{2}:\d{3}:\d{4}/);
  return match?.[0] ?? null;
}

export type WialonFarmSyncResult = {
  total: number;
  inserted: number;
  updated: number;
};

/**
 * Імпортує геозони Wialon у farm_fields: оновлює лише межі, площу й вихідну
 * назву зони. Те, що веде агроном (canonical_name, field_no, tract, is_field)
 * і зв'язок з BAS AGRO (bas_ref_key), а також crop / color лишаються недоторканими.
 */
export async function syncWialonGeofencesToFarmFields(): Promise<WialonFarmSyncResult> {
  const empty: WialonFarmSyncResult = { total: 0, inserted: 0, updated: 0 };

  const eid = await wialonLogin();
  const resources = await getWialonGeofences(eid);
  const geofences = wialonResourcesToGeofenceGeoJSON(resources);
  const features = geofences.features as Feature<
    Polygon,
    WialonGeofenceProperties
  >[];

  if (features.length === 0) return empty;

  const supabase = createServiceSupabase();
  const { data: existingRows, error: loadError } = await supabase
    .from("farm_fields")
    .select("id, wialon_zone_id")
    .not("wialon_zone_id", "is", null);

  if (loadError) {
    throw new Error(`farm_fields: ${loadError.message}`);
  }

  const existingByZone = new Map<string, string>();
  for (const row of existingRows ?? []) {
    const zoneId = row.wialon_zone_id != null ? String(row.wialon_zone_id) : "";
    if (zoneId) existingByZone.set(zoneId, String(row.id));
  }

  let inserted = 0;
  let updated = 0;

  for (const feature of features) {
    const props = feature.properties;
    const zoneId = props?.id?.trim();
    if (!zoneId || feature.geometry?.type !== "Polygon") continue;

    const cadastral = extractCadastralFromText(
      `${props.name ?? ""} ${props.description ?? ""}`
    );
    let name = (props.name || zoneId).trim();
    if (cadastral && !name.includes(cadastral)) {
      name = `${name} · ${cadastral}`;
    }

    const payload = {
      name,
      geometry: feature.geometry,
      area_ha: areaHaFromFeature(feature),
      wialon_zone_id: zoneId,
    };

    const existingId = existingByZone.get(zoneId);
    if (existingId) {
      const { error } = await supabase
        .from("farm_fields")
        .update({
          name: payload.name,
          geometry: payload.geometry,
          area_ha: payload.area_ha,
        })
        .eq("id", existingId);

      if (error) {
        console.error("[wialon-farm-sync] update:", zoneId, error.message);
        continue;
      }
      updated += 1;
      continue;
    }

    const { error } = await supabase.from("farm_fields").insert({
      ...payload,
      crop: DEFAULT_CROP,
      color: props.color?.trim() || DEFAULT_COLOR,
    });

    if (error) {
      console.error("[wialon-farm-sync] insert:", zoneId, error.message);
      continue;
    }
    inserted += 1;
  }

  return {
    total: features.length,
    inserted,
    updated,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldCentroid } from "@/lib/field-centroid";
import type { FieldGeometry } from "@/lib/farm-fields";
import type { WeatherContext } from "@/lib/field-timeline-types";
import { fetchWeather, type WeatherSnapshot } from "@/lib/weather";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/** Ідентифікатор поля з field_id або field_key (`farm:uuid`). */
export function resolveFieldId(
  fieldId: string | null | undefined,
  fieldKey?: string | null
): string | null {
  const direct = fieldId?.trim().toLowerCase();
  if (direct && isUuid(direct)) return direct;

  const key = fieldKey?.trim();
  if (!key?.startsWith("farm:")) return null;
  const parsed = key.slice(5).trim().toLowerCase();
  return isUuid(parsed) ? parsed : null;
}

/** Lucide-назва іконки за WMO weather code (для weather_context.icon). */
export function weatherIconFromCode(code: number): string {
  if (code >= 95) return "cloud-lightning";
  if ((code >= 51 && code < 70) || code >= 80) return "cloud-rain";
  if (code === 0) return "sun";
  if (code <= 2) return "cloud-sun";
  return "cloud";
}

export function weatherSnapshotToContext(
  snapshot: WeatherSnapshot
): WeatherContext {
  return {
    temp: snapshot.tempC,
    humidity: snapshot.humidityPercent,
    condition: snapshot.condition,
    icon: weatherIconFromCode(snapshot.weatherCode),
  };
}

/** Координати центру поля з farm_fields.geometry. */
export async function resolveFieldCoordinates(
  supabase: SupabaseClient,
  fieldId: string
): Promise<{ latitude: number; longitude: number } | null> {
  const { data, error } = await supabase
    .from("farm_fields")
    .select("geometry")
    .eq("id", fieldId)
    .maybeSingle();

  if (error || !data?.geometry) return null;

  const centroid = fieldCentroid(data.geometry as FieldGeometry);
  if (!centroid) return null;

  return {
    latitude: centroid.latitude,
    longitude: centroid.longitude,
  };
}

/**
 * Поточна погода для поля. Помилки API не прокидаються — повертає null.
 */
export async function captureWeatherContextForField(
  supabase: SupabaseClient,
  fieldId: string | null | undefined,
  fieldKey?: string | null
): Promise<WeatherContext | null> {
  const resolvedId = resolveFieldId(fieldId, fieldKey);
  if (!resolvedId) return null;

  try {
    const coords = await resolveFieldCoordinates(supabase, resolvedId);
    if (!coords) return null;

    const snapshot = await fetchWeather(coords.latitude, coords.longitude);
    return weatherSnapshotToContext(snapshot);
  } catch (error) {
    console.error("[weather-context] capture failed", error);
    return null;
  }
}

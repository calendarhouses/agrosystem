import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export type FieldGeometry = Polygon | MultiPolygon;

export type FarmField = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
  color: string;
  geometry: FieldGeometry;
  createdAt: string;
  /** id геозони Wialon, якщо паспорт привʼязаний до неї */
  wialonZoneId?: string | null;
};

export type FarmFieldInput = {
  name: string;
  crop: string;
  areaHa: number;
  color: string;
  geometry: FieldGeometry;
  wialonZoneId?: string | null;
};

export const FIELD_COLOR_OPTIONS = [
  { id: "green", value: "#276749", label: "Смарагд" },
  { id: "teal", value: "#0F766E", label: "Бірюза" },
  { id: "blue", value: "#2B6CB0", label: "Синій" },
  { id: "sky", value: "#0284C7", label: "Небесний" },
  { id: "violet", value: "#6B46C1", label: "Фіолет" },
  { id: "rose", value: "#BE185D", label: "Малиновий" },
  { id: "rust", value: "#C05621", label: "Теракота" },
  { id: "gold", value: "#D69E2E", label: "Золото" },
  { id: "olive", value: "#4D7C0F", label: "Олива" },
  { id: "slate", value: "#475569", label: "Сланець" },
] as const;

const LOCAL_KEY = "agrosystem.farm_fields.v1";

function mapRow(row: Record<string, unknown>): FarmField {
  return {
    id: String(row.id),
    name: String(row.name),
    crop: String(row.crop),
    areaHa: Number(row.area_ha),
    color: String(row.color),
    geometry: row.geometry as FieldGeometry,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    wialonZoneId:
      row.wialon_zone_id != null && String(row.wialon_zone_id).trim()
        ? String(row.wialon_zone_id)
        : null,
  };
}

function readLocal(): FarmField[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FarmField[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(fields: FarmField[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(fields));
}

/** GeoJSON для карти зі збережених полів */
export function farmFieldsToGeoJson(fields: FarmField[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fields.map((field) => ({
      type: "Feature",
      id: field.id,
      properties: {
        id: field.id,
        name: field.name,
        crop: field.crop,
        color: field.color,
        areaHa: field.areaHa,
        source: "saved",
      },
      geometry: field.geometry,
    })),
  };
}

/** Завантажити поля: Supabase → fallback localStorage */
export async function listFarmFields(): Promise<FarmField[]> {
  try {
    const response = await fetch("/api/fields", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { fields: FarmField[] };
      writeLocal(data.fields);
      return data.fields;
    }
  } catch {
    // мережа / таблиця ще не готова
  }
  return readLocal();
}

/** Створити поле в БД (+ локальний кеш після успіху). Без тихого local-*. */
export async function createFarmField(
  input: FarmFieldInput
): Promise<FarmField> {
  let response: Response;
  try {
    response = await fetch("/api/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Немає звʼязку із сервером: ${error.message}`
        : "Немає звʼязку із сервером"
    );
  }

  if (response.ok) {
    const data = (await response.json()) as { field: FarmField };
    const local = readLocal();
    writeLocal([data.field, ...local.filter((f) => f.id !== data.field.id)]);
    return data.field;
  }

  const errorBody = await response.text().catch(() => "");
  throw new Error(
    errorBody || `Не вдалося зберегти поле (HTTP ${response.status})`
  );
}

/** Оновити поле в БД (+ локальний кеш після успіху). */
export async function updateFarmField(
  id: string,
  patch: Partial<FarmFieldInput>
): Promise<FarmField> {
  if (id.startsWith("local-")) {
    throw new Error(
      "Це поле збережене лише локально й не синхронізоване. Створіть його знову через карту."
    );
  }

  let response: Response;
  try {
    response = await fetch(`/api/fields/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Немає звʼязку із сервером: ${error.message}`
        : "Немає звʼязку із сервером"
    );
  }

  if (response.ok) {
    const data = (await response.json()) as { field: FarmField };
    const local = readLocal();
    writeLocal(local.map((field) => (field.id === id ? data.field : field)));
    return data.field;
  }

  const errorBody = await response.text().catch(() => "");
  throw new Error(
    errorBody || `Не вдалося оновити поле (HTTP ${response.status})`
  );
}

/** Видалити поле з БД (+ локальний кеш після успіху). */
export async function deleteFarmField(id: string): Promise<void> {
  if (id.startsWith("local-")) {
    writeLocal(readLocal().filter((field) => field.id !== id));
    return;
  }

  let response: Response;
  try {
    response = await fetch(`/api/fields/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Немає звʼязку із сервером: ${error.message}`
        : "Немає звʼязку із сервером"
    );
  }

  if (response.ok || response.status === 404) {
    writeLocal(readLocal().filter((field) => field.id !== id));
    return;
  }

  const errorBody = await response.text().catch(() => "");
  throw new Error(
    errorBody || `Не вдалося видалити поле (HTTP ${response.status})`
  );
}

export function isPolygonGeometry(
  geometry: Feature["geometry"] | null | undefined
): geometry is FieldGeometry {
  return (
    !!geometry &&
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
  );
}

export { mapRow };

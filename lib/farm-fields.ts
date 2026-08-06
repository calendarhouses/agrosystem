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
};

export type FarmFieldInput = {
  name: string;
  crop: string;
  areaHa: number;
  color: string;
  geometry: FieldGeometry;
};

export const FIELD_COLOR_OPTIONS = [
  { id: "green", value: "#276749", label: "Смарагд" },
  { id: "rust", value: "#C05621", label: "Теракота" },
  { id: "gold", value: "#D69E2E", label: "Золото" },
  { id: "blue", value: "#2B6CB0", label: "Синій" },
  { id: "violet", value: "#6B46C1", label: "Фіолет" },
  { id: "teal", value: "#0F766E", label: "Бірюза" },
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

/** Створити поле в БД (+ локальний кеш) */
export async function createFarmField(
  input: FarmFieldInput
): Promise<FarmField> {
  const toLocal = (reason: string) => {
    const localField: FarmField = {
      id: `local-${
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Date.now()
      }`,
      name: input.name,
      crop: input.crop,
      areaHa: input.areaHa,
      color: input.color,
      geometry: input.geometry,
      createdAt: new Date().toISOString(),
    };
    writeLocal([localField, ...readLocal()]);
    console.warn("[farm_fields] Збережено локально:", reason);
    return localField;
  };

  let response: Response;
  try {
    response = await fetch("/api/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    return toLocal(error instanceof Error ? error.message : "network");
  }

  if (response.ok) {
    const data = (await response.json()) as { field: FarmField };
    const local = readLocal();
    writeLocal([data.field, ...local.filter((f) => f.id !== data.field.id)]);
    return data.field;
  }

  const errorBody = await response.text().catch(() => "");
  if (response.status === 503 || response.status === 500) {
    return toLocal(errorBody || `HTTP ${response.status}`);
  }

  throw new Error(errorBody || `HTTP ${response.status}`);
}

/** Оновити поле в БД (+ локальний кеш) */
export async function updateFarmField(
  id: string,
  patch: Partial<FarmFieldInput>
): Promise<FarmField> {
  const applyLocal = () => {
    const local = readLocal();
    const existing = local.find((field) => field.id === id);
    if (!existing) {
      throw new Error("Поле не знайдено локально");
    }
    const updated: FarmField = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.crop !== undefined ? { crop: patch.crop } : {}),
      ...(patch.areaHa !== undefined ? { areaHa: patch.areaHa } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.geometry !== undefined ? { geometry: patch.geometry } : {}),
    };
    writeLocal(local.map((field) => (field.id === id ? updated : field)));
    return updated;
  };

  // Локальні id ніколи не були в Supabase
  if (id.startsWith("local-")) {
    return applyLocal();
  }

  let response: Response;
  try {
    response = await fetch(`/api/fields/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    return applyLocal();
  }

  if (response.ok) {
    const data = (await response.json()) as { field: FarmField };
    const local = readLocal();
    writeLocal(local.map((field) => (field.id === id ? data.field : field)));
    return data.field;
  }

  if (response.status === 503 || response.status === 500) {
    return applyLocal();
  }

  const errorBody = await response.text().catch(() => "");
  throw new Error(errorBody || `HTTP ${response.status}`);
}

/** Видалити поле з БД (+ локальний кеш) */
export async function deleteFarmField(id: string): Promise<void> {
  const removeLocal = () => {
    writeLocal(readLocal().filter((field) => field.id !== id));
  };

  if (id.startsWith("local-")) {
    removeLocal();
    return;
  }

  try {
    const response = await fetch(`/api/fields/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok || response.status === 503 || response.status === 500) {
      removeLocal();
      return;
    }
    const errorBody = await response.text().catch(() => "");
    throw new Error(errorBody || `HTTP ${response.status}`);
  } catch (error) {
    removeLocal();
    if (error instanceof Error && error.message.startsWith("HTTP")) {
      throw error;
    }
  }
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

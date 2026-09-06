/**
 * Фактична площа з GPS-треку Wialon у геозоні поля (як у модалці закриття наряду).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldGeometry } from "@/lib/farm-fields";
import { estimateAreaHaFromTrack } from "@/lib/field-operations";
import {
  analyzeTrackVisitsInField,
  type FieldTechVisit,
} from "@/lib/field-tech-history";
import { IMPLEMENT_WIDTH_DEFAULTS } from "@/lib/field-operation-norms";
import { getWialonUnitTrack, wialonLogin } from "@/lib/wialon";

export type WialonTrackAreaResult =
  | {
      ok: true;
      areaHa: number;
      distanceKm: number;
      workHours: number;
      unitId: number;
      widthM: number;
    }
  | { ok: false; error: string };

function dayUnixRange(occurredAt?: string | null): {
  from: number;
  to: number;
} {
  const base = occurredAt
    ? new Date(`${String(occurredAt).slice(0, 10)}T12:00:00`)
    : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  const now = Date.now();
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(Math.min(end.getTime(), now) / 1000),
  };
}

function resolveWidthM(
  workType: string | null | undefined,
  implementWidthM: number | null | undefined
): number {
  if (
    implementWidthM != null &&
    Number.isFinite(implementWidthM) &&
    implementWidthM > 0
  ) {
    return implementWidthM;
  }
  const key = String(workType ?? "").trim();
  if (key && IMPLEMENT_WIDTH_DEFAULTS[key] != null) {
    return IMPLEMENT_WIDTH_DEFAULTS[key]!;
  }
  // Спроба часткового збігу
  const lower = key.toLowerCase();
  for (const [name, width] of Object.entries(IMPLEMENT_WIDTH_DEFAULTS)) {
    if (lower.includes(name.toLowerCase())) return width;
  }
  return 6;
}

export async function resolveWialonTrackAreaForOperation(
  supabase: SupabaseClient,
  params: {
    fieldId: string;
    fieldGeometry: FieldGeometry | null | undefined;
    equipmentId?: string | null;
    machinery?: string | null;
    workType?: string | null;
    implementWidthM?: number | null;
    occurredAt?: string | null;
    areaCapHa?: number | null;
  }
): Promise<WialonTrackAreaResult> {
  const geometry = params.fieldGeometry;
  if (
    !geometry ||
    (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
  ) {
    return {
      ok: false,
      error: "У поля немає геометрії — не можу обмежити трек геозоною.",
    };
  }

  let unitId: number | null = null;
  if (params.equipmentId) {
    const { data: eq } = await supabase
      .from("equipment")
      .select("id, wialon_id, name")
      .eq("id", params.equipmentId)
      .maybeSingle();
    const wid = Number(eq?.wialon_id);
    if (Number.isFinite(wid) && wid > 0) unitId = wid;
  }

  if (unitId == null && params.machinery?.trim()) {
    const needle = params.machinery.trim().toLowerCase();
    const { data: list } = await supabase
      .from("equipment")
      .select("id, wialon_id, name")
      .not("wialon_id", "is", null)
      .limit(200);
    const match = (list ?? []).find((row) => {
      const name = String(row.name ?? "").toLowerCase();
      return name.includes(needle) || needle.includes(name);
    });
    const wid = Number(match?.wialon_id);
    if (Number.isFinite(wid) && wid > 0) unitId = wid;
  }

  if (unitId == null || unitId <= 0) {
    return {
      ok: false,
      error:
        "Не знайдено Wialon unit для техніки наряду. Привʼяжіть wialon_id в обладнанні.",
    };
  }

  const { from, to } = dayUnixRange(params.occurredAt);
  const widthM = resolveWidthM(params.workType, params.implementWidthM);

  try {
    const eid = await wialonLogin();
    const track = await getWialonUnitTrack(eid, unitId, from, to);
    const visits: FieldTechVisit[] = analyzeTrackVisitsInField(
      track,
      geometry,
      params.machinery || String(unitId)
    );

    let distanceKm = 0;
    let workHours = 0;
    for (const visit of visits) {
      distanceKm += visit.distanceKm ?? 0;
      workHours += Math.max(0, (visit.endUnix - visit.startUnix) / 3600);
    }

    distanceKm = Math.round(distanceKm * 10) / 10;
    workHours = Math.round(workHours * 10) / 10;

    if (distanceKm <= 0) {
      return {
        ok: false,
        error:
          "У геозоні поля за день наряду немає пробігу Wialon (0 км). Вкажіть площу вручну.",
      };
    }

    const areaHa = estimateAreaHaFromTrack(
      distanceKm,
      widthM,
      params.areaCapHa
    );
    if (!areaHa || areaHa <= 0) {
      return {
        ok: false,
        error: "Не вдалося оцінити площу з треку (перевірте ширину знаряддя).",
      };
    }

    return {
      ok: true,
      areaHa,
      distanceKm,
      workHours,
      unitId,
      widthM,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Помилка запиту треку Wialon",
    };
  }
}

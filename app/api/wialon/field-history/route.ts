import { NextRequest, NextResponse } from "next/server";

import type { FieldGeometry } from "@/lib/farm-fields";
import {
  analyzeTrackVisitsInField,
  type FieldTechVisit,
} from "@/lib/field-tech-history";
import { toKyivDayKey } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getWialonUnitTrack, wialonLogin } from "@/lib/wialon";

export const runtime = "nodejs";
export const maxDuration = 30;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

/** Жорсткий ліміт: довгі сезони вбивають Wialon і UI */
const MAX_RANGE_SEC = 14 * 24 * 60 * 60;
const MAX_UNITS = 24;
const SOFT_DEADLINE_MS = 12_000;

type UnitRef = { id: number; name: string };

type Body = {
  geometry?: FieldGeometry | null;
  units?: UnitRef[];
  from?: number;
  to?: number;
  /** З ним повернемо ще й спалені літри по цьому полю за інтервал */
  fieldId?: string | null;
};

/**
 * Спалено на полі за ДУТ — та сама цифра, що в розділі Паливо.
 * Наряд не повинен пропонувати інші літри, ніж бачить бухгалтерія.
 */
async function loadFieldFuelLiters(
  fieldId: string,
  unitIds: number[],
  timeFrom: number,
  timeTo: number
): Promise<number | null> {
  if (unitIds.length === 0) return null;
  const fromDate = toKyivDayKey(new Date(timeFrom * 1000));
  const toDate = toKyivDayKey(new Date(timeTo * 1000));

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select("fuel_consumed")
    .eq("field_id", fieldId)
    .in("wialon_unit_id", unitIds)
    .gte("date", fromDate)
    .lte("date", toDate);

  if (error || !data || data.length === 0) return null;
  const liters = data.reduce(
    (acc, row) => acc + (Number(row.fuel_consumed) || 0),
    0
  );
  return liters > 0 ? Math.round(liters * 10) / 10 : null;
}

/**
 * POST /api/wialon/field-history
 * READ-ONLY: короткий інтервал (≤14 днів) → візити в полі.
 * Повний сезон вантажити чанками з клієнта.
 */
export async function POST(request: NextRequest) {
  try {
    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Порожній запит", visits: [] as FieldTechVisit[] },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    const geometry = body.geometry;
    const units = (Array.isArray(body.units) ? body.units : []).slice(
      0,
      MAX_UNITS
    );
    let timeFrom = Number(body.from);
    let timeTo = Number(body.to);

    if (
      !geometry ||
      (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Потрібен geometry поля",
          visits: [] as FieldTechVisit[],
        },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    if (units.length === 0) {
      return NextResponse.json(
        { ok: true, visits: [] as FieldTechVisit[], partial: false },
        { headers: JSON_UTF8 }
      );
    }

    if (
      !Number.isFinite(timeFrom) ||
      !Number.isFinite(timeTo) ||
      timeTo < timeFrom
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Потрібні коректні from/to (UNIX sec)",
          visits: [] as FieldTechVisit[],
        },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    if (timeTo - timeFrom > MAX_RANGE_SEC) {
      timeFrom = timeTo - MAX_RANGE_SEC;
    }

    if (request.signal.aborted) {
      return NextResponse.json(
        { ok: false, error: "Скасовано", visits: [] as FieldTechVisit[] },
        { status: 499, headers: JSON_UTF8 }
      );
    }

    const eid = await wialonLogin();
    const started = Date.now();
    const visits: FieldTechVisit[] = [];
    let partial = false;

    // Послідовно по 1 юніту — не душимо Wialon паралеллю
    for (const unit of units) {
      if (request.signal.aborted) {
        partial = true;
        break;
      }
      if (Date.now() - started > SOFT_DEADLINE_MS) {
        partial = true;
        break;
      }

      try {
        const track = await getWialonUnitTrack(
          eid,
          unit.id,
          timeFrom,
          timeTo
        );
        visits.push(...analyzeTrackVisitsInField(track, geometry, unit.name));
      } catch (error) {
        console.error("[field-history] unit track failed", {
          unitId: unit.id,
          error,
        });
      }
    }

    visits.sort((a, b) => b.startUnix - a.startUnix);

    const fieldId = body.fieldId?.trim() || null;
    const fieldFuelLiters = fieldId
      ? await loadFieldFuelLiters(
          fieldId,
          units.map((u) => u.id),
          timeFrom,
          timeTo
        ).catch(() => null)
      : null;

    return NextResponse.json(
      {
        ok: true,
        visits,
        visitCount: visits.length,
        fieldFuelLiters,
        partial,
        from: timeFrom,
        to: timeTo,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    console.error("[field-history]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити історію з Wialon",
        visits: [] as FieldTechVisit[],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

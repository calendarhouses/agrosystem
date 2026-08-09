import { NextRequest, NextResponse } from "next/server";

import type { FieldGeometry } from "@/lib/farm-fields";
import {
  analyzeTrackVisitsInField,
  type FieldTechVisit,
} from "@/lib/field-tech-history";
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
};

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

    return NextResponse.json(
      {
        ok: true,
        visits,
        visitCount: visits.length,
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

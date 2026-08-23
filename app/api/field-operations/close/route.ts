import { NextResponse } from "next/server";

import { upsertFieldOperationRow } from "@/lib/field-operations-db";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CloseBody = {
  clientKey?: string;
  fieldKey?: string;
  fieldId?: string | null;
  workType?: string;
  crop?: string;
  areaPlan?: number;
  areaFact?: number;
  fuelPlan?: number;
  fuelFact?: number;
  wagePlan?: number;
  wageFact?: number;
  agronomistComment?: string;
  machinery?: string;
  implement?: string;
  occurredAt?: string;
  timeLabel?: string;
  seasonYear?: number;
  areaTotal?: number;
  wialonUnitId?: number | null;
  implementWidthM?: number | null;
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
  correctOnly?: boolean;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * POST /api/field-operations/close — підтвердити факт і закрити наряд.
 * export_status = pending — заготовка під майбутній чорновик 1С.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CloseBody;
    const clientKey = body.clientKey?.trim();
    const workType = body.workType?.trim();
    const crop = body.crop?.trim();

    if (!clientKey || !workType || !crop) {
      return NextResponse.json(
        { error: "Немає clientKey / типу робіт / культури" },
        { status: 400 }
      );
    }

    if (
      typeof body.areaFact !== "number" ||
      !Number.isFinite(body.areaFact) ||
      body.areaFact <= 0
    ) {
      return NextResponse.json(
        { error: "Некоректна фактична площа" },
        { status: 400 }
      );
    }

    const fieldId =
      typeof body.fieldId === "string" && isUuid(body.fieldId)
        ? body.fieldId
        : null;

    const fieldKey =
      body.fieldKey?.trim() || (fieldId ? `farm:${fieldId}` : null);

    const row: Record<string, unknown> = {
      client_key: clientKey,
      field_id: fieldId,
      work_type: workType,
      crop,
      status: "completed",
      // Майбутній експорт у чорновик 1С
      export_status: "pending",
      area_plan: body.areaPlan ?? null,
      area_fact: body.areaFact,
      fuel_plan: body.fuelPlan ?? null,
      fuel_fact: body.fuelFact ?? null,
      wage_plan: body.wagePlan ?? null,
      wage_fact: body.wageFact ?? null,
      agronomist_comment: body.agronomistComment?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (!body.correctOnly) {
      row.closed_at = new Date().toISOString();
    }

    if (fieldKey) row.field_key = fieldKey;
    if (body.machinery != null) row.machinery = body.machinery;
    if (body.implement != null) row.implement = body.implement;
    if (body.occurredAt) row.occurred_at = body.occurredAt.slice(0, 10);
    if (body.timeLabel != null) row.time_label = body.timeLabel;
    if (typeof body.seasonYear === "number") {
      row.season_year = body.seasonYear;
      row.season = String(body.seasonYear);
    }
    if (body.areaTotal != null) row.area_total = body.areaTotal;
    if (typeof body.wialonUnitId === "number") {
      row.wialon_unit_id = body.wialonUnitId;
    }
    if (typeof body.implementWidthM === "number") {
      row.implement_width_m = body.implementWidthM;
    }
    if (typeof body.trackerDistanceKm === "number") {
      row.tracker_distance_km = body.trackerDistanceKm;
    }
    if (typeof body.trackerWorkHours === "number") {
      row.tracker_work_hours = body.trackerWorkHours;
    }
    if (typeof body.trackerFuelL === "number") {
      row.tracker_fuel_l = body.trackerFuelL;
    }

    const supabase = createServiceSupabase();
    const result = await upsertFieldOperationRow(supabase, row);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        {
          status:
            result.code === "PGRST205" || result.code === "42P01" ? 503 : 500,
        }
      );
    }

    return NextResponse.json({
      operation: result.operation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка закриття наряду",
      },
      { status: 500 }
    );
  }
}

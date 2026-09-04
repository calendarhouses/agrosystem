import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity-log";
import { actorCloseColumns, actorCreateColumns, getCurrentActor } from "@/lib/app-actor";
import {
  fetchMaterialsByClientKeys,
  replaceOperationMaterials,
  type FieldOperationMaterialInput,
} from "@/lib/field-operation-materials";
import { mapOperationRow } from "@/lib/field-operations";
import { upsertFieldOperationRow } from "@/lib/field-operations-db";
import { normalizeWorkTypeKey } from "@/lib/field-operation-wage";
import { captureWeatherContextForField } from "@/lib/field-weather-context";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type UpsertBody = {
  clientKey?: string;
  fieldKey?: string;
  fieldId?: string | null;
  workType?: string;
  crop?: string;
  status?: string;
  machinery?: string;
  implement?: string;
  occurredAt?: string;
  timeLabel?: string;
  seasonYear?: number;
  season?: string;
  areaTotal?: number | null;
  areaPlan?: number | null;
  areaFact?: number | null;
  fuelPlan?: number | null;
  fuelFact?: number | null;
  wagePlan?: number | null;
  wageFact?: number | null;
  wageRateUahPerHa?: number | null;
  mechanicName?: string | null;
  agronomistComment?: string | null;
  equipmentId?: string | null;
  implementId?: string | null;
  wialonUnitId?: number | null;
  implementWidthM?: number | null;
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
  exportStatus?: string | null;
  materials?: FieldOperationMaterialInput[];
};

/** GET /api/field-operations?fieldKey=…&also=wialon:1,wialon:2 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fieldKey = searchParams.get("fieldKey")?.trim();
    if (!fieldKey) {
      return NextResponse.json(
        { error: "Потрібен fieldKey", operations: [] },
        { status: 400 }
      );
    }

    const also = (searchParams.get("also") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const keys = Array.from(new Set([fieldKey, ...also]));

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("field_operations")
      .select("*")
      .in("field_key", keys)
      .order("occurred_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code, operations: [] },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
        }
      );
    }

    const byKey = new Map<string, ReturnType<typeof mapOperationRow>>();
    for (const row of data ?? []) {
      const op = mapOperationRow(row as Record<string, unknown>);
      byKey.set(op.id, op);
    }

    const materialsMap = await fetchMaterialsByClientKeys(
      supabase,
      [...byKey.keys()]
    );
    for (const [key, op] of byKey.entries()) {
      const materials = materialsMap.get(key);
      if (materials?.length) {
        byKey.set(key, { ...op, materials });
      }
    }

    // Якщо є legacy keys — переносимо на primary fieldKey
    const legacyRows = (data ?? []).filter(
      (row) => String((row as { field_key?: string }).field_key) !== fieldKey
    );
    if (legacyRows.length > 0) {
      await supabase
        .from("field_operations")
        .update({
          field_key: fieldKey,
          updated_at: new Date().toISOString(),
        })
        .in(
          "client_key",
          legacyRows.map((row) => String((row as { client_key: string }).client_key))
        );
    }

    const operations = Array.from(byKey.values()).sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt)
    );

    return NextResponse.json({ operations });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка читання операцій",
        operations: [],
      },
      { status: 500 }
    );
  }
}

/** POST /api/field-operations — створити / оновити наряд */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpsertBody;
    const clientKey = body.clientKey?.trim();
    const fieldKey = body.fieldKey?.trim();
    const workType = body.workType?.trim();
    const crop = body.crop?.trim();

    if (!clientKey || !fieldKey || !workType || !crop) {
      return NextResponse.json(
        { error: "Потрібні clientKey, fieldKey, тип робіт і культура" },
        { status: 400 }
      );
    }

    const status = body.status?.trim() || "planned";
    if (
      !["planned", "in_progress", "completed", "cancelled"].includes(status)
    ) {
      return NextResponse.json({ error: "Некоректний статус" }, { status: 400 });
    }

    const fieldId =
      typeof body.fieldId === "string" && isUuid(body.fieldId)
        ? body.fieldId
        : null;

    const supabase = createServiceSupabase();
    const actor = await getCurrentActor();

    const { data: existing } = await supabase
      .from("field_operations")
      .select("client_key, actor_name")
      .eq("client_key", clientKey)
      .maybeSingle();

    const isNew = !existing;
    const hasAuthor =
      existing != null &&
      typeof (existing as { actor_name?: unknown }).actor_name === "string" &&
      String((existing as { actor_name: string }).actor_name).trim().length > 0;

    const row: Record<string, unknown> = {
      client_key: clientKey,
      field_key: fieldKey,
      field_id: fieldId,
      work_type: workType,
      crop,
      status,
      machinery: body.machinery?.trim() || null,
      implement: body.implement?.trim() || null,
      occurred_at: body.occurredAt?.slice(0, 10) || null,
      time_label: body.timeLabel?.trim() || null,
      season_year:
        typeof body.seasonYear === "number" && Number.isFinite(body.seasonYear)
          ? body.seasonYear
          : null,
      season:
        typeof body.seasonYear === "number" && Number.isFinite(body.seasonYear)
          ? String(body.seasonYear)
          : typeof body.season === "string" && /^\d{4}$/.test(body.season.trim())
            ? body.season.trim()
            : "2026",
      area_total: body.areaTotal ?? null,
      area_plan: body.areaPlan ?? null,
      area_fact: body.areaFact ?? null,
      fuel_plan: body.fuelPlan ?? null,
      fuel_fact: body.fuelFact ?? null,
      wage_plan: body.wagePlan ?? null,
      wage_fact: body.wageFact ?? null,
      wage_rate_uah_per_ha:
        typeof body.wageRateUahPerHa === "number" &&
        Number.isFinite(body.wageRateUahPerHa) &&
        body.wageRateUahPerHa >= 0
          ? Math.round(body.wageRateUahPerHa * 100) / 100
          : null,
      mechanic_name: body.mechanicName?.trim() || null,
      agronomist_comment: body.agronomistComment?.trim() || null,
      equipment_id:
        typeof body.equipmentId === "string" && isUuid(body.equipmentId)
          ? body.equipmentId
          : null,
      implement_id:
        typeof body.implementId === "string" && isUuid(body.implementId)
          ? body.implementId
          : null,
      wialon_unit_id:
        typeof body.wialonUnitId === "number" && Number.isFinite(body.wialonUnitId)
          ? body.wialonUnitId
          : null,
      implement_width_m:
        typeof body.implementWidthM === "number" &&
        Number.isFinite(body.implementWidthM)
          ? body.implementWidthM
          : null,
      tracker_distance_km:
        typeof body.trackerDistanceKm === "number" &&
        Number.isFinite(body.trackerDistanceKm)
          ? body.trackerDistanceKm
          : null,
      tracker_work_hours:
        typeof body.trackerWorkHours === "number" &&
        Number.isFinite(body.trackerWorkHours)
          ? body.trackerWorkHours
          : null,
      tracker_fuel_l:
        typeof body.trackerFuelL === "number" &&
        Number.isFinite(body.trackerFuelL)
          ? body.trackerFuelL
          : null,
      export_status:
        body.exportStatus === "pending" || body.exportStatus === "synced"
          ? body.exportStatus
          : "none",
      closed_at: status === "completed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      // Автор лише при створенні / якщо ще порожній (не перезаписуємо)
      ...(!hasAuthor ? actorCreateColumns(actor) : {}),
      ...(status === "completed" ? actorCloseColumns(actor) : {}),
    };

    if (isNew) {
      row.weather_context = await captureWeatherContextForField(
        supabase,
        fieldId,
        fieldKey
      );
    }

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

    if (Array.isArray(body.materials)) {
      try {
        await replaceOperationMaterials(supabase, clientKey, body.materials);
      } catch (materialError) {
        return NextResponse.json(
          {
            error:
              materialError instanceof Error
                ? materialError.message
                : "Наряд збережено, але ТМЦ не привʼязано",
          },
          { status: 500 }
        );
      }
    }

    const rate =
      typeof body.wageRateUahPerHa === "number" &&
      Number.isFinite(body.wageRateUahPerHa) &&
      body.wageRateUahPerHa >= 0
        ? Math.round(body.wageRateUahPerHa * 100) / 100
        : null;
    if (rate != null) {
      const rateKey = normalizeWorkTypeKey(workType);
      if (rateKey) {
        await supabase.from("work_type_wage_rates").upsert(
          {
            work_type: rateKey,
            rate_uah_per_ha: rate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "work_type" }
        );
        // таблиця може ще не існувати — ігноруємо
      }
    }

    const materialsMap = await fetchMaterialsByClientKeys(supabase, [clientKey]);
    const operation = {
      ...result.operation,
      materials: materialsMap.get(clientKey) ?? [],
    };

    if (isNew) {
      void logActivity({
        actor,
        action: "create",
        entityType: "field_operation",
        entityId: result.operation.id,
        summary: `${actor.label} створив наряд «${workType} · ${crop}»`,
        meta: { fieldKey, status },
      });
    }

    return NextResponse.json({
      operation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка збереження наряду",
      },
      { status: 500 }
    );
  }
}

/** DELETE /api/field-operations?clientKey=… */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientKey = searchParams.get("clientKey")?.trim();
    if (!clientKey) {
      return NextResponse.json({ error: "Потрібен clientKey" }, { status: 400 });
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("field_operations")
      .delete()
      .eq("client_key", clientKey);

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
        }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка видалення наряду",
      },
      { status: 500 }
    );
  }
}

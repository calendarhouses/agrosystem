import { NextResponse } from "next/server";

import { mapRow, type FarmFieldInput } from "@/lib/farm-fields";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/fields — список збережених полів */
export async function GET() {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("farm_fields")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code, fields: [] },
        { status: error.code === "PGRST205" || error.code === "42P01" ? 503 : 500 }
      );
    }

    return NextResponse.json({
      fields: (data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Помилка читання",
        fields: [],
      },
      { status: 500 }
    );
  }
}

/** POST /api/fields — зберегти нове поле */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FarmFieldInput;

    if (!body?.name?.trim() || !body?.crop?.trim() || !body?.geometry) {
      return NextResponse.json(
        { error: "Потрібні name, crop і geometry" },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("farm_fields")
      .insert({
        name: body.name.trim(),
        crop: body.crop.trim(),
        area_ha: body.areaHa,
        color: body.color || "#276749",
        geometry: body.geometry,
        ...(body.wialonZoneId
          ? { wialon_zone_id: body.wialonZoneId }
          : {}),
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "PGRST205" || error.code === "42P01" ? 503 : 500 }
      );
    }

    return NextResponse.json({
      field: mapRow(data as Record<string, unknown>),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Помилка збереження",
      },
      { status: 500 }
    );
  }
}

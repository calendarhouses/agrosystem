import { NextResponse } from "next/server";

import { mapRow, type FarmFieldInput } from "@/lib/farm-fields";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** PATCH /api/fields/:id — оновити паспорт / геометрію */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Немає id" }, { status: 400 });
    }

    const body = (await request.json()) as Partial<FarmFieldInput>;
    const patch: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim();
    }
    if (typeof body.crop === "string" && body.crop.trim()) {
      patch.crop = body.crop.trim();
    }
    if (typeof body.areaHa === "number" && Number.isFinite(body.areaHa)) {
      patch.area_ha = body.areaHa;
    }
    if (typeof body.color === "string" && body.color.trim()) {
      patch.color = body.color.trim();
    }
    if (body.geometry) {
      patch.geometry = body.geometry;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Немає полів для оновлення" }, { status: 400 });
    }

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("farm_fields")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
        }
      );
    }

    return NextResponse.json({
      field: mapRow(data as Record<string, unknown>),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Помилка оновлення",
      },
      { status: 500 }
    );
  }
}

/** DELETE /api/fields/:id — видалити поле */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Немає id" }, { status: 400 });
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase.from("farm_fields").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
        }
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Помилка видалення",
      },
      { status: 500 }
    );
  }
}

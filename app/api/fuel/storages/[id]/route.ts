import { NextResponse } from "next/server";

import { mapFuelStorageRow } from "@/lib/fuel-storages";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type PatchBody = {
  name?: string;
  type?: string;
  capacity?: number;
  pricePerLiter?: number;
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

/** PATCH /api/fuel/storages/:id — редагувати паспорт складу */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) return badRequest("Немає id");

    const body = (await request.json()) as PatchBody;
    const name = String(body.name ?? "").trim();
    const type = body.type === "mobile" ? "mobile" : "stationary";
    const capacity = Number(body.capacity);
    const pricePerLiter = Number(body.pricePerLiter);

    if (!name) return badRequest("Вкажіть назву складу");
    if (!Number.isFinite(capacity) || capacity <= 0) {
      return badRequest("Місткість має бути більше 0");
    }
    if (!Number.isFinite(pricePerLiter) || pricePerLiter < 0) {
      return badRequest("Ціна за літр некоректна");
    }

    const supabase = createServiceSupabase();
    const { data: existing, error: loadError } = await supabase
      .from("fuel_storages")
      .select("id, current_volume")
      .eq("id", id)
      .maybeSingle();

    if (loadError || !existing) {
      return NextResponse.json(
        { ok: false, error: "Склад не знайдено" },
        { status: 404, headers: JSON_UTF8 }
      );
    }

    const currentVolume = Number(
      (existing as { current_volume: number }).current_volume
    );
    if (capacity + 0.001 < currentVolume) {
      return badRequest(
        `Місткість не може бути меншою за поточний залишок (${Math.round(currentVolume).toLocaleString("uk-UA")} л)`
      );
    }

    const { data, error } = await supabase
      .from("fuel_storages")
      .update({
        name,
        type,
        capacity: Math.round(capacity * 100) / 100,
        price_per_liter: Math.round(pricePerLiter * 100) / 100,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Не вдалося оновити склад" },
        { status: 500, headers: JSON_UTF8 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        storage: mapFuelStorageRow(data as Record<string, unknown>),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка оновлення",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

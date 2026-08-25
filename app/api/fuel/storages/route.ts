import { NextResponse } from "next/server";

import { mapFuelStorageRow } from "@/lib/fuel-storages";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type CreateBody = {
  name?: string;
  type?: string;
  capacity?: number;
  pricePerLiter?: number;
  currentVolume?: number;
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: JSON_UTF8 }
  );
}

/** GET /api/fuel/storages — склади палива з Supabase */
export async function GET() {
  try {
    const supabase = createServiceSupabase();
    const { data: storages, error } = await supabase
      .from("fuel_storages")
      .select("*")
      .order("capacity", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, storages: [] },
        {
          status:
            error.code === "PGRST205" || error.code === "42P01" ? 503 : 500,
          headers: JSON_UTF8,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        storages: (storages ?? []).map((row) =>
          mapFuelStorageRow(row as Record<string, unknown>)
        ),
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка читання",
        storages: [],
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

/** POST /api/fuel/storages — створити склад */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBody;
    const name = String(body.name ?? "").trim();
    const type = body.type === "mobile" ? "mobile" : "stationary";
    const capacity = Number(body.capacity);
    const pricePerLiter = Number(body.pricePerLiter);
    const currentVolume =
      body.currentVolume != null ? Number(body.currentVolume) : 0;

    if (!name) return badRequest("Вкажіть назву складу");
    if (!Number.isFinite(capacity) || capacity <= 0) {
      return badRequest("Місткість має бути більше 0");
    }
    if (!Number.isFinite(pricePerLiter) || pricePerLiter < 0) {
      return badRequest("Ціна за літр некоректна");
    }
    if (!Number.isFinite(currentVolume) || currentVolume < 0) {
      return badRequest("Поточний обʼєм некоректний");
    }
    if (currentVolume > capacity + 0.001) {
      return badRequest("Поточний обʼєм не може перевищувати місткість");
    }

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("fuel_storages")
      .insert({
        name,
        type,
        capacity: Math.round(capacity * 100) / 100,
        current_volume: Math.round(currentVolume * 100) / 100,
        price_per_liter: Math.round(pricePerLiter * 100) / 100,
      })
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Не вдалося створити склад" },
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
        error: error instanceof Error ? error.message : "Помилка створення",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

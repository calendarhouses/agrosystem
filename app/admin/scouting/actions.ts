"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { captureWeatherContextForField } from "@/lib/field-weather-context";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function createScoutingReport(input: {
  fieldId: string;
  notes?: string | null;
  imageUrl?: string | null;
  /** ISO або YYYY-MM-DD; за замовчуванням — зараз */
  date?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const fieldId = input.fieldId?.trim().toLowerCase();
  const notes = input.notes?.trim() ?? "";
  const imageUrl = input.imageUrl?.trim() || null;
  const dateIso = (() => {
    const raw = input.date?.trim();
    if (!raw) return new Date().toISOString();
    const d =
      raw.length <= 10 ? new Date(`${raw.slice(0, 10)}T12:00:00`) : new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  if (!fieldId) return { ok: false, error: "Оберіть поле" };

  try {
    const supabase = createServiceSupabase();
    const actor = await getCurrentActor();
    const weather_context = await captureWeatherContextForField(
      supabase,
      fieldId
    );

    const payload: Record<string, unknown> = {
      field_id: fieldId,
      date: dateIso,
      notes,
      image_url: imageUrl,
      weather_context,
    };

    let { data, error } = await supabase
      .from("scouting_reports")
      .insert(payload)
      .select("id")
      .single();

    if (error?.message?.includes("weather_context")) {
      const { weather_context: _w, ...withoutWeather } = payload;
      const retry = await supabase
        .from("scouting_reports")
        .insert(withoutWeather)
        .select("id")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) return { ok: false, error: error?.message ?? "Помилка збереження" };

    const id = String(data.id);
    await logActivity({
      actor,
      action: "create",
      entityType: "scouting_report",
      entityId: id,
      summary: `${actor.label} додав звіт скаутингу`,
      meta: { fieldId },
    });

    revalidatePath("/operations");
    revalidatePath("/fields");
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося зберегти звіт скаутингу",
    };
  }
}

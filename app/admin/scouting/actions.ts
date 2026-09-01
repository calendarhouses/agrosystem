"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { captureWeatherContextForField } from "@/lib/field-weather-context";
import {
  OPERATION_DOCS_BUCKET,
  validateAttachmentFile,
} from "@/lib/operation-attachments";
import { createServiceSupabase } from "@/lib/supabase/server";

const SCOUTING_IMAGE_PREFIX = "scouting";

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.\-а-яА-ЯіІїЇєЄґҐ\s]/gu, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function uploadScoutingPhoto(
  fieldId: string,
  input: {
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  }
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const check = validateAttachmentFile({
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  if (!check.ok) return check;
  if (!input.mimeType.startsWith("image/")) {
    return { ok: false, error: "Дозволені лише зображення" };
  }

  const supabase = createServiceSupabase();
  const safeName = sanitizeFileName(input.fileName || "photo.jpg");
  const storagePath = `${SCOUTING_IMAGE_PREFIX}/${fieldId}/${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from(OPERATION_DOCS_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });

  if (error) {
    return {
      ok: false,
      error:
        error.message.includes("Bucket not found") ||
        error.message.includes("not found")
          ? "Bucket operation-docs не створено. Виконай міграцію 039 у Supabase."
          : error.message,
    };
  }

  return { ok: true, storagePath };
}

export async function createScoutingReport(input: {
  fieldId: string;
  notes?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  imageFileName?: string | null;
  /** ISO або YYYY-MM-DD; за замовчуванням — зараз */
  date?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const fieldId = input.fieldId?.trim().toLowerCase();
  const notes = input.notes?.trim() ?? "";
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

    let image_url = input.imageUrl?.trim() || null;

    const imageBase64 = input.imageBase64?.trim();
    if (imageBase64) {
      const mimeType = input.imageMimeType?.trim() || "image/jpeg";
      const bytes = Buffer.from(imageBase64, "base64");
      const uploaded = await uploadScoutingPhoto(fieldId, {
        fileName: input.imageFileName?.trim() || "photo.jpg",
        mimeType,
        bytes,
      });
      if (!uploaded.ok) return uploaded;
      image_url = uploaded.storagePath;
    }

    const payload: Record<string, unknown> = {
      field_id: fieldId,
      date: dateIso,
      notes,
      image_url,
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

    if (error || !data) {
      return { ok: false, error: error?.message ?? "Помилка збереження" };
    }

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

export async function deleteScoutingReport(
  reportId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = reportId?.trim();
  if (!id) return { ok: false, error: "Невірний id звіту" };

  try {
    const supabase = createServiceSupabase();
    const { data: row, error: readErr } = await supabase
      .from("scouting_reports")
      .select("id, image_url")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!row) return { ok: false, error: "Звіт не знайдено" };

    const imagePath = String(row.image_url ?? "").trim();
    if (imagePath.startsWith(`${SCOUTING_IMAGE_PREFIX}/`)) {
      await supabase.storage.from(OPERATION_DOCS_BUCKET).remove([imagePath]);
    }

    const { error } = await supabase
      .from("scouting_reports")
      .delete()
      .eq("id", id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/operations");
    revalidatePath("/fields");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося видалити звіт скаутингу",
    };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { buildBasChangeRequest, allChangeItems } from "@/lib/bas-change-request";
import {
  buildBasImportWorkbook,
  type FieldContour,
} from "@/lib/bas-import-workbook";
import {
  relinkByExactName,
  type BasRequestStatus,
} from "@/lib/field-registry";
import { loadBasFields, loadRegistryRows } from "@/lib/field-registry-data";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Статус заявки бухгалтеру. Пишемо тільки в нашу базу: BAS міняє бухгалтер
 * руками у себе, ми лише фіксуємо, що передали і що він підтвердив
 * (див. .cursor/rules/bas-readonly.mdc).
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SetRequestStatusInput = {
  /** Поля, яких стосується позиція заявки */
  fieldIds: string[];
  status: BasRequestStatus;
  note?: string | null;
};

export async function setBasRequestStatus(
  input: SetRequestStatusInput
): Promise<ActionResult<{ updated: number }>> {
  const ids = input.fieldIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Не вказано жодного поля" };

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("farm_fields")
      .update({
        bas_sync_status: input.status,
        bas_synced_at: input.status === "none" ? null : new Date().toISOString(),
        bas_sync_error: input.note?.trim() || null,
      })
      .in("id", ids)
      .select("id");

    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/bas-request");
    revalidatePath("/admin/fields");
    return { ok: true, data: { updated: data?.length ?? 0 } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Не вдалося оновити статус",
    };
  }
}

export type RelinkResult = {
  linked: { field: string; basField: string; wasLinked: boolean }[];
};

/**
 * Підтягнути нові `Ref_Key` після робіт бухгалтера. Назви в обох системах
 * тепер однакові, тож зіставляємо строго за точним збігом назви.
 */
export async function relinkFieldsWithBas(): Promise<
  ActionResult<RelinkResult>
> {
  try {
    const [rows, basFields] = await Promise.all([
      loadRegistryRows(),
      loadBasFields(),
    ]);
    if (basFields.error) return { ok: false, error: basFields.error };

    const changes = relinkByExactName(rows, basFields.items);
    if (changes.length === 0) {
      return { ok: true, data: { linked: [] } };
    }

    const supabase = createServiceSupabase();
    for (const change of changes) {
      const { error } = await supabase
        .from("farm_fields")
        .update({ bas_ref_key: change.to.refKey })
        .eq("id", change.row.id);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath("/admin/bas-request");
    revalidatePath("/admin/fields");
    revalidatePath("/admin/mapping");

    return {
      ok: true,
      data: {
        linked: changes.map((change) => ({
          field: change.row.canonicalName.trim() || change.row.wialonName.trim(),
          basField: change.to.description,
          wasLinked: change.from != null,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Не вдалося перезв'язати поля",
    };
  }
}

function toContour(geometry: unknown): [number, number][] | null {
  const ring = (geometry as { coordinates?: unknown[][][] } | null)
    ?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const points: [number, number][] = [];
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat]);
  }
  return points.length >= 3 ? points : null;
}

async function loadContours(
  fieldIds: string[]
): Promise<Map<string, FieldContour>> {
  const contours = new Map<string, FieldContour>();
  if (fieldIds.length === 0) return contours;

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("farm_fields")
    .select("id, geometry")
    .in("id", fieldIds);

  if (error) {
    console.error("[bas-request] contours:", error.message);
    return contours;
  }

  for (const row of data ?? []) {
    const points = toContour(row.geometry);
    if (points) contours.set(String(row.id), { fieldId: String(row.id), points });
  }
  return contours;
}

export type ImportWorkbook = { fileName: string; base64: string };

/**
 * Книга Excel для штатного завантаження в 1С. Бухгалтер відкриває її у себе,
 * перевіряє й завантажує сам — ми в BAS нічого не пишемо.
 */
export async function buildImportWorkbook(): Promise<
  ActionResult<ImportWorkbook>
> {
  try {
    const [rows, basFields] = await Promise.all([
      loadRegistryRows(),
      loadBasFields(),
    ]);

    const request = buildBasChangeRequest(rows, basFields.items);
    const items = allChangeItems(request);
    if (items.length === 0) {
      return { ok: false, error: "Заявка порожня — змінювати нічого" };
    }

    const fieldIds = items.flatMap((item) => item.rows.map((row) => row.id));
    const contours = await loadContours([...new Set(fieldIds)]);

    return {
      ok: true,
      data: {
        fileName: `polya-bas-${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64: buildBasImportWorkbook({ request, contours }),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Не вдалося зібрати файл",
    };
  }
}

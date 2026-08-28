"use server";

import { revalidatePath } from "next/cache";

import { normalizeBasRefKey } from "@/lib/bas-mapping";
import {
  fetchLiveFieldEconomics,
  type LiveFieldEconomics,
} from "@/lib/field-analytics";
import {
  fetchFieldEquipmentHistory,
  type FieldEquipmentHistoryEntry,
} from "@/lib/field-equipment-history";
import { fetchFieldEvents, type FieldEvent } from "@/lib/field-events";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Реєстр полів пише виключно в нашу базу. У BAS нічого не створюємо й не
 * змінюємо — там ми тільки читаємо довідник (див. .cursor/rules/bas-readonly.mdc).
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SaveFieldRegistryInput = {
  id: string;
  canonicalName: string;
  fieldNo: string;
  tract: string;
  isField: boolean;
  /** Ref_Key наявного поля BAS AGRO; створення нових записів у BAS не робимо */
  basRefKey: string | null;
};

export async function saveFieldRegistryRow(
  input: SaveFieldRegistryInput
): Promise<ActionResult> {
  const id = input.id?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("farm_fields")
      .update({
        canonical_name: input.canonicalName.trim() || null,
        field_no: input.fieldNo.trim() || null,
        tract: input.tract.trim() || null,
        is_field: input.isField,
        bas_ref_key: normalizeBasRefKey(input.basRefKey),
      })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/fields");
    revalidatePath("/admin/mapping");
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти",
    };
  }
}

export type BulkSaveResult = { saved: number; failed: number };

/** Збереження всіх змінених рядків одним натисканням. */
export async function saveFieldRegistryRows(
  rows: SaveFieldRegistryInput[]
): Promise<ActionResult<BulkSaveResult>> {
  if (rows.length === 0) {
    return { ok: false, error: "Немає змін для збереження" };
  }

  let saved = 0;
  let failed = 0;

  for (const row of rows) {
    const result = await saveFieldRegistryRow(row);
    if (result.ok) saved += 1;
    else failed += 1;
  }

  revalidatePath("/admin/fields");
  revalidatePath("/admin/mapping");
  return { ok: true, data: { saved, failed } };
}

/**
 * Live-економіка поля з тіньового складу (заміна stub на Карті полів).
 * Один JOIN-запит → totalSpentUah + breakdown + recentMoves.
 */
export async function getLiveFieldEconomics(
  fieldId: string,
  activeSeason?: string
): Promise<ActionResult<LiveFieldEconomics>> {
  const id = fieldId?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  try {
    const data = await fetchLiveFieldEconomics(id, activeSeason);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити економіку поля",
    };
  }
}

/**
 * Єдина стрічка історії поля: списання ТМЦ + закриті наряди (нові → старі).
 */
export async function getFieldEvents(
  fieldId: string,
  activeSeason?: string
): Promise<ActionResult<FieldEvent[]>> {
  const id = fieldId?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  try {
    const data = await fetchFieldEvents(id, activeSeason);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити історію поля",
    };
  }
}

/**
 * Гібридна історія техніки: наряди агронома (пріоритет) + GPS Wialon.
 * Merge за (date × equipment); source: manual | hybrid | gps_only.
 */
export async function getFieldEquipmentHistory(
  fieldId: string,
  activeSeason?: string
): Promise<ActionResult<FieldEquipmentHistoryEntry[]>> {
  const id = fieldId?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  try {
    const data = await fetchFieldEquipmentHistory(id, activeSeason);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити історію техніки",
    };
  }
}

/**
 * Зберегти плановий бюджет ₴/га (null = скинути).
 * Пишемо лише в нашу БД (BAS read-only).
 */
export async function updateFieldPlannedBudget(
  fieldId: string,
  plannedBudgetPerHa: number | null
): Promise<
  ActionResult<{
    plannedBudgetPerHa: number | null;
  }>
> {
  const id = fieldId?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  let value: number | null = null;
  if (plannedBudgetPerHa != null) {
    const n = Number(plannedBudgetPerHa);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Некоректна сума бюджету" };
    }
    value = Math.round(n * 100) / 100;
    if (value === 0) value = null;
  }

  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("farm_fields")
      .update({ planned_budget_per_ha: value })
      .eq("id", id);

    if (error) {
      if (
        error.message?.includes("planned_budget_per_ha") ||
        error.code === "42703"
      ) {
        return {
          ok: false,
          error:
            "Колонка planned_budget_per_ha ще не створена. Виконай міграцію 018.",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/");
    revalidatePath("/finance");
    revalidatePath("/inventory");
    revalidatePath("/admin/fields");
    return { ok: true, data: { plannedBudgetPerHa: value } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Не вдалося зберегти бюджет",
    };
  }
}

/** Швидке доповнення паспорта (культура / площа) зі списання чи наряду */
export async function patchFieldPassportQuick(
  fieldId: string,
  input: { crop?: string; areaHa?: number }
): Promise<
  | { ok: true; data: { crop: string; areaHa: number } }
  | { ok: false; error: string }
> {
  const id = fieldId?.trim();
  if (!id) return { ok: false, error: "Немає ідентифікатора поля" };

  const patch: { crop?: string; area_ha?: number } = {};

  if (input.crop !== undefined) {
    const crop = input.crop.trim();
    if (!crop || crop === "—" || crop === "-") {
      return { ok: false, error: "Оберіть культуру" };
    }
    patch.crop = crop;
  }

  if (input.areaHa !== undefined) {
    const n = Number(input.areaHa);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "Вкажіть коректну площу (га)" };
    }
    patch.area_ha = Math.round(n * 100) / 100;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Немає даних для оновлення" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("farm_fields")
      .update(patch)
      .eq("id", id)
      .select("crop, area_ha")
      .single();

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/");
    revalidatePath("/inventory");

    return {
      ok: true,
      data: {
        crop: String(data.crop ?? patch.crop ?? ""),
        areaHa: Number(data.area_ha) || patch.area_ha || 0,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося оновити паспорт поля",
    };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import {
  normalizeBasRefKey,
  type BasMappingTable,
} from "@/lib/bas-mapping";
import { createServiceSupabase } from "@/lib/supabase/server";

const ALLOWED_TABLES = new Set<BasMappingTable>([
  "fuel_storages",
  "farm_fields",
  "wialon_bas_mapping",
  "inventory_items_cache",
]);

function revalidateMappingPaths() {
  revalidatePath("/admin/mapping");
  revalidatePath("/accounting");
  revalidatePath("/inventory");
  revalidatePath("/export");
}

/**
 * ТМЦ: bas_ref_key — і ключ, і лінк на BAS AGRO (FK з moves).
 * Перепривʼязка: переносимо рухи на новий ключ, прибираємо старий рядок.
 */
async function remapInventoryItem(
  id: string,
  newBasRefKey: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!newBasRefKey) {
    return {
      ok: false,
      error: "ТМЦ не можна відвʼязати — оберіть номенклатуру BAS AGRO",
    };
  }

  const supabase = createServiceSupabase();
  const { data: row, error: readErr } = await supabase
    .from("inventory_items_cache")
    .select(
      "id, bas_ref_key, name, custom_name, category, unit, planned_price_uah, is_local, is_hidden"
    )
    .eq("id", id)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "Позицію ТМЦ не знайдено" };

  const oldKey = String(row.bas_ref_key).toLowerCase();
  if (oldKey === newBasRefKey) return { ok: true };

  const { data: target } = await supabase
    .from("inventory_items_cache")
    .select("id, bas_ref_key")
    .eq("bas_ref_key", newBasRefKey)
    .maybeSingle();

  if (target && String(target.id) !== id) {
    const { error: moveErr } = await supabase
      .from("inventory_local_moves")
      .update({ item_ref_key: newBasRefKey })
      .eq("item_ref_key", oldKey);
    if (moveErr) return { ok: false, error: moveErr.message };

    const { error: delErr } = await supabase
      .from("inventory_items_cache")
      .delete()
      .eq("id", id);
    if (delErr) return { ok: false, error: delErr.message };
    return { ok: true };
  }

  // Новий ключ ще не в кеші — клонуємо рядок, переносимо рухи, видаляємо старий
  const { error: insertErr } = await supabase.from("inventory_items_cache").insert({
    bas_ref_key: newBasRefKey,
    name: row.name,
    custom_name: row.custom_name,
    category: row.category,
    unit: row.unit,
    planned_price_uah: row.planned_price_uah ?? 0,
    is_local: false,
    is_hidden: row.is_hidden ?? false,
  });
  if (insertErr) return { ok: false, error: insertErr.message };

  const { error: moveErr } = await supabase
    .from("inventory_local_moves")
    .update({ item_ref_key: newBasRefKey })
    .eq("item_ref_key", oldKey);
  if (moveErr) return { ok: false, error: moveErr.message };

  const { error: delErr } = await supabase
    .from("inventory_items_cache")
    .delete()
    .eq("id", id);
  if (delErr) return { ok: false, error: delErr.message };

  return { ok: true };
}

export async function saveBasMapping(input: {
  table: BasMappingTable;
  id: string;
  basRefKey: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ALLOWED_TABLES.has(input.table)) {
    return { ok: false, error: "Невідома таблиця мапінгу" };
  }

  const id = input.id?.trim();
  if (!id) {
    return { ok: false, error: "Немає ідентифікатора запису" };
  }

  const basRefKey = normalizeBasRefKey(input.basRefKey);

  try {
    if (input.table === "inventory_items_cache") {
      const res = await remapInventoryItem(id, basRefKey);
      if (!res.ok) return res;
      revalidateMappingPaths();
      return { ok: true };
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from(input.table)
      .update({ bas_ref_key: basRefKey })
      .eq("id", id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidateMappingPaths();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти",
    };
  }
}

/** Масове збереження авто-зіставлення */
export async function saveBasMappingBatch(
  items: Array<{
    table: BasMappingTable;
    id: string;
    basRefKey: string | null;
  }>
): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  let saved = 0;
  for (const item of items) {
    const res = await saveBasMapping(item);
    if (!res.ok) return res;
    saved += 1;
  }
  return { ok: true, saved };
}

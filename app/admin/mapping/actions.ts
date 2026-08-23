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
]);

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
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from(input.table)
      .update({ bas_ref_key: basRefKey })
      .eq("id", id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/admin/mapping");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти",
    };
  }
}

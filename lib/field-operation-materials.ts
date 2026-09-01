import type { SupabaseClient } from "@supabase/supabase-js";

export type FieldOperationMaterial = {
  basRefKey: string;
  itemName: string;
  category: string;
  unit: string;
  qty: number;
};

export type FieldOperationMaterialInput = {
  basRefKey: string;
  itemName?: string;
  category?: string;
  unit?: string;
  qty: number;
};

type MaterialRow = {
  operation_client_key: string;
  inventory_bas_ref_key: string;
  item_name: string | null;
  category: string | null;
  unit: string | null;
  qty: number | string;
};

function mapMaterialRow(row: MaterialRow): FieldOperationMaterial {
  return {
    basRefKey: String(row.inventory_bas_ref_key),
    itemName: String(row.item_name ?? "").trim() || "ТМЦ",
    category: String(row.category ?? "").trim(),
    unit: String(row.unit ?? "").trim(),
    qty: Math.round(Number(row.qty) * 1000) / 1000,
  };
}

export async function fetchMaterialsByClientKeys(
  supabase: SupabaseClient,
  clientKeys: string[]
): Promise<Map<string, FieldOperationMaterial[]>> {
  const map = new Map<string, FieldOperationMaterial[]>();
  const keys = [...new Set(clientKeys.filter(Boolean))];
  if (keys.length === 0) return map;

  const { data, error } = await supabase
    .from("field_operation_materials")
    .select(
      "operation_client_key, inventory_bas_ref_key, item_name, category, unit, qty"
    )
    .in("operation_client_key", keys);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return map;
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as MaterialRow[]) {
    const key = String(row.operation_client_key);
    const list = map.get(key) ?? [];
    list.push(mapMaterialRow(row));
    map.set(key, list);
  }
  return map;
}

export async function replaceOperationMaterials(
  supabase: SupabaseClient,
  clientKey: string,
  materials: FieldOperationMaterialInput[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("field_operation_materials")
    .delete()
    .eq("operation_client_key", clientKey);

  if (deleteError) {
    if (deleteError.code === "PGRST205" || deleteError.code === "42P01") return;
    throw new Error(deleteError.message);
  }

  const rows = materials
    .filter((m) => m.basRefKey && Number(m.qty) > 0)
    .map((m) => ({
      operation_client_key: clientKey,
      inventory_bas_ref_key: m.basRefKey,
      item_name: m.itemName?.trim() || "ТМЦ",
      category: m.category?.trim() || null,
      unit: m.unit?.trim() || null,
      qty: Math.round(Number(m.qty) * 1000) / 1000,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  const { error: insertError } = await supabase
    .from("field_operation_materials")
    .insert(rows);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export function formatOperationMaterialsLine(
  materials: FieldOperationMaterial[] | null | undefined
): string | null {
  if (!materials?.length) return null;
  const primary = materials[0]!;
  const qty = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: primary.qty >= 100 ? 0 : 2,
  }).format(primary.qty);
  const unit = primary.unit ? ` ${primary.unit}` : "";
  return `${primary.itemName} · ${qty}${unit}`;
}

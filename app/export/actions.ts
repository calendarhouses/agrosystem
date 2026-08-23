"use server";

import { revalidatePath } from "next/cache";

import { createServiceSupabase } from "@/lib/supabase/server";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type DraftExportMove = {
  id: string;
  date: string;
  qty: number;
  basRefKey: string;
  itemName: string;
  unit: string;
  fieldId: string | null;
  fieldName: string | null;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Усі outbound draft-рухи для Excel-експорту бухгалтеру. */
export async function listDraftMovesForExport(): Promise<
  ActionResult<DraftExportMove[]>
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .select(
        `
        id,
        date,
        qty,
        item_ref_key,
        field_id,
        farm_fields ( id, name ),
        inventory_items_cache ( name, custom_name, unit, bas_ref_key )
      `
      )
      .eq("type", "outbound")
      .eq("status", "draft")
      .order("date", { ascending: false });

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, data: [] };
      }
      return { ok: false, error: error.message };
    }

    const moves: DraftExportMove[] = (data ?? []).map((row) => {
      const field = unwrapJoin(
        row.farm_fields as
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null
      );
      const cache = unwrapJoin(
        row.inventory_items_cache as
          | {
              name: string;
              custom_name: string | null;
              unit: string | null;
              bas_ref_key: string | null;
            }
          | {
              name: string;
              custom_name: string | null;
              unit: string | null;
              bas_ref_key: string | null;
            }[]
          | null
      );

      return {
        id: String(row.id),
        date: String(row.date).slice(0, 10),
        qty: Number(row.qty) || 0,
        basRefKey: String(
          cache?.bas_ref_key || row.item_ref_key || ""
        ).toLowerCase(),
        itemName: String(
          cache?.custom_name?.trim() || cache?.name || "ТМЦ"
        ),
        unit: String(cache?.unit ?? ""),
        fieldId: field?.id
          ? String(field.id)
          : row.field_id
            ? String(row.field_id)
            : null,
        fieldName: field?.name ? String(field.name) : null,
      };
    });

    return { ok: true, data: moves };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити чернетки",
    };
  }
}

/** Після Excel — позначити рухи як передані бухгалтеру. */
export async function markMovesSentTo1c(
  moveIds: string[]
): Promise<ActionResult<{ updated: number }>> {
  const ids = [...new Set(moveIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { ok: false, error: "Немає рухів для оновлення" };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("inventory_local_moves")
      .update({
        status: "sent_to_1c",
        updated_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("status", "draft")
      .select("id");

    if (error) return { ok: false, error: error.message };

    revalidatePath("/export");
    revalidatePath("/inventory");
    return { ok: true, data: { updated: data?.length ?? 0 } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося оновити статус рухів",
    };
  }
}

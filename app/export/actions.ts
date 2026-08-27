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
  type: "outbound" | "inbound" | "sale";
  basRefKey: string;
  itemName: string;
  unit: string;
  category: string | null;
  season: string | null;
  fieldId: string | null;
  fieldName: string | null;
  note: string | null;
  buyerName: string | null;
  unitPriceUah: number | null;
  isLocalItem: boolean;
  hasAttachment: boolean;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Усі draft-рухи (прихід + списання) для Excel-експорту бухгалтеру. */
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
        type,
        note,
        season,
        buyer_name,
        unit_price_uah,
        item_ref_key,
        field_id,
        farm_fields ( id, name ),
        inventory_items_cache ( name, custom_name, unit, bas_ref_key, is_local, category )
      `
      )
      .eq("status", "draft")
      .in("type", ["outbound", "inbound", "sale"])
      .order("date", { ascending: false });

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, data: [] };
      }
      // Fallback без is_local / note / inbound / season, якщо міграція 038 ще не застосована
      if (
        error.message?.includes("is_local") ||
        error.message?.includes("note") ||
        error.message?.includes("inbound") ||
        error.message?.includes("season")
      ) {
        const legacy = await supabase
          .from("inventory_local_moves")
          .select(
            `
            id,
            date,
            qty,
            type,
            item_ref_key,
            field_id,
            farm_fields ( id, name ),
            inventory_items_cache ( name, custom_name, unit, bas_ref_key )
          `
          )
          .eq("type", "outbound")
          .eq("status", "draft")
          .order("date", { ascending: false });
        if (legacy.error) {
          if (legacy.error.code === "PGRST205" || legacy.error.code === "42P01") {
            return { ok: true, data: [] };
          }
          return { ok: false, error: legacy.error.message };
        }
        const moves: DraftExportMove[] = (legacy.data ?? []).map((row) => {
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
            type: "outbound" as const,
            basRefKey: String(
              cache?.bas_ref_key || row.item_ref_key || ""
            ).toLowerCase(),
            itemName: String(
              cache?.custom_name?.trim() || cache?.name || "ТМЦ"
            ),
            unit: String(cache?.unit ?? ""),
            category: null,
            season: null,
            fieldId: field?.id
              ? String(field.id)
              : row.field_id
                ? String(row.field_id)
                : null,
            fieldName: field?.name ? String(field.name) : null,
            note: null,
            buyerName: null,
            unitPriceUah: null,
            isLocalItem: false,
            hasAttachment: false,
          };
        });
        return { ok: true, data: moves };
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
              is_local?: boolean | null;
              category?: string | null;
            }
          | {
              name: string;
              custom_name: string | null;
              unit: string | null;
              bas_ref_key: string | null;
              is_local?: boolean | null;
              category?: string | null;
            }[]
          | null
      );

      const type =
        row.type === "inbound"
          ? ("inbound" as const)
          : row.type === "sale"
            ? ("sale" as const)
            : ("outbound" as const);
      const priceRaw = (row as { unit_price_uah?: unknown }).unit_price_uah;
      const unitPriceUah =
        priceRaw != null && Number.isFinite(Number(priceRaw))
          ? Number(priceRaw)
          : null;

      return {
        id: String(row.id),
        date: String(row.date).slice(0, 10),
        qty: Number(row.qty) || 0,
        type,
        basRefKey: String(
          cache?.bas_ref_key || row.item_ref_key || ""
        ).toLowerCase(),
        itemName: String(
          cache?.custom_name?.trim() || cache?.name || "ТМЦ"
        ),
        unit: String(cache?.unit ?? ""),
        category: cache?.category ? String(cache.category) : null,
        season:
          typeof (row as { season?: unknown }).season === "string"
            ? String((row as { season: string }).season)
            : null,
        fieldId: field?.id
          ? String(field.id)
          : row.field_id
            ? String(row.field_id)
            : null,
        fieldName: field?.name ? String(field.name) : null,
        note:
          typeof (row as { note?: unknown }).note === "string"
            ? String((row as { note: string }).note)
            : null,
        buyerName:
          typeof (row as { buyer_name?: unknown }).buyer_name === "string"
            ? String((row as { buyer_name: string }).buyer_name)
            : null,
        unitPriceUah,
        isLocalItem: cache?.is_local === true,
        hasAttachment: false,
      };
    });

    // Позначка накладних
    try {
      const supabase2 = createServiceSupabase();
      const ids = moves.map((m) => m.id);
      if (ids.length > 0) {
        const { data: atts } = await supabase2
          .from("operation_attachments")
          .select("entity_id")
          .eq("entity_type", "inventory_move")
          .in("entity_id", ids);
        const withFile = new Set(
          (atts ?? []).map((a) => String(a.entity_id))
        );
        for (const m of moves) {
          if (withFile.has(m.id)) m.hasAttachment = true;
        }
      }
    } catch {
      /* ignore */
    }

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

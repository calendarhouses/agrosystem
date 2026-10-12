import { createServiceSupabase } from "@/lib/supabase/server";
import type { BasHandoffStatus } from "@/lib/bas-drafts/statuses";

type DraftTable =
  | "inventory_local_moves"
  | "fuel_transactions"
  | "field_operations"
  | "warehouse_receipts";

export async function markBasDraftSuccess(input: {
  table: DraftTable;
  ids: string[];
  refKey: string;
  entitySet: string;
  handoffStatus?: BasHandoffStatus;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = {
    bas_draft_ref_key: input.refKey,
    bas_draft_entity: input.entitySet,
    bas_draft_sent_at: new Date().toISOString(),
    bas_draft_error: null,
  };
  if (input.table === "warehouse_receipts" && input.handoffStatus) {
    patch.bas_handoff_status = input.handoffStatus;
  }
  const { error } = await supabase
    .from(input.table)
    .update(patch)
    .in("id", input.ids);

  if (error) {
    throw new Error(`${input.table} bas_draft update: ${error.message}`);
  }
}

export async function markBasDraftFailure(input: {
  table: DraftTable;
  ids: string[];
  error: string;
  handoffStatus?: BasHandoffStatus;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = {
    bas_draft_error: input.error.slice(0, 2000),
  };
  if (input.table === "warehouse_receipts" && input.handoffStatus) {
    patch.bas_handoff_status = input.handoffStatus;
  }
  const { error } = await supabase
    .from(input.table)
    .update(patch)
    .in("id", input.ids);

  if (error) {
    console.error(`${input.table} bas_draft error update:`, error.message);
  }
}

export async function markWarehouseHandoffStatus(input: {
  receiptId: string;
  status: BasHandoffStatus;
  error?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = {
    bas_handoff_status: input.status,
  };
  if (input.error != null) {
    patch.bas_draft_error = input.error.slice(0, 2000);
  } else if (input.status !== "bas_draft_failed") {
    patch.bas_draft_error = null;
  }
  const { error } = await supabase
    .from("warehouse_receipts")
    .update(patch)
    .eq("id", input.receiptId);
  if (error) {
    console.error("warehouse_receipts handoff update:", error.message);
  }
}

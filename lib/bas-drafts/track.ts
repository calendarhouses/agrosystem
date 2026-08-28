import { createServiceSupabase } from "@/lib/supabase/server";

type DraftTable =
  | "inventory_local_moves"
  | "fuel_transactions"
  | "field_operations";

export async function markBasDraftSuccess(input: {
  table: DraftTable;
  ids: string[];
  refKey: string;
  entitySet: string;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from(input.table)
    .update({
      bas_draft_ref_key: input.refKey,
      bas_draft_entity: input.entitySet,
      bas_draft_sent_at: new Date().toISOString(),
      bas_draft_error: null,
    })
    .in("id", input.ids);

  if (error) {
    throw new Error(`${input.table} bas_draft update: ${error.message}`);
  }
}

export async function markBasDraftFailure(input: {
  table: DraftTable;
  ids: string[];
  error: string;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from(input.table)
    .update({
      bas_draft_error: input.error.slice(0, 2000),
    })
    .in("id", input.ids);

  if (error) {
    console.error(`${input.table} bas_draft error update:`, error.message);
  }
}

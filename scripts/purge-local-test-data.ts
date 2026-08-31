/**
 * Очищення локальних тестових операцій AgroSystem.
 * НЕ чіпає: Wialon sync, BAS cache (крім is_local SKU), farm_fields, equipment, мапінг.
 *
 * Usage:
 *   npx tsx scripts/purge-local-test-data.ts           # dry-run (counts)
 *   npx tsx scripts/purge-local-test-data.ts --apply   # delete
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";

const APPLY = process.argv.includes("--apply");

type CountRow = { table: string; count: number; note?: string };

async function countAll(
  supabase: ReturnType<typeof createServiceSupabase>,
  table: string,
  filter?: { column: string; value: unknown }
): Promise<number> {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) q = q.eq(filter.column, filter.value);
  const { count, error } = await q;
  if (error) {
    console.warn(`  ! ${table}: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

async function deleteAll(
  supabase: ReturnType<typeof createServiceSupabase>,
  table: string,
  filter?: { column: string; value: unknown }
): Promise<number> {
  // Supabase requires a filter for delete; use a always-true predicate via gte on created id/date when possible
  let q = supabase.from(table).delete({ count: "exact" });
  if (filter) {
    q = q.eq(filter.column, filter.value);
  } else {
    // Match all rows: uuid/text ids are never equal to empty unless we use a broad filter
    q = q.neq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { count, error } = await q;
  if (error) {
    // Fallback for tables without uuid id
    const retry = await supabase
      .from(table)
      .delete({ count: "exact" })
      .gte("created_at", "1970-01-01");
    if (retry.error) {
      console.error(`  ✗ ${table}: ${error.message} / ${retry.error.message}`);
      return -1;
    }
    return retry.count ?? 0;
  }
  return count ?? 0;
}

async function main() {
  const supabase = createServiceSupabase();
  console.log(
    APPLY
      ? "=== APPLY: видалення локальних тестів ==="
      : "=== DRY-RUN: що буде видалено (нічого не чіпаємо) ==="
  );
  console.log(
    "Залишаємо: farm_fields, equipment, fuel_storages (рядки), wialon_*, inventory BAS cache, мапінг.\n"
  );

  const plan: CountRow[] = [];

  const tables: Array<{
    table: string;
    filter?: { column: string; value: unknown };
    note?: string;
  }> = [
    { table: "operation_attachments", note: "накладні до локальних рухів" },
    { table: "inventory_local_moves", note: "прихід / списання / продаж" },
    {
      table: "inventory_items_cache",
      filter: { column: "is_local", value: true },
      note: "лише локальні SKU (is_local)",
    },
    { table: "fuel_transactions", note: "закупівлі / переміщення / заправки" },
    { table: "accountant_operation_archive", note: "архів бухгалтерії" },
    { table: "activity_log", note: "журнал дій" },
    { table: "field_operations", note: "наряди / роботи на полях" },
  ];

  // optional tables that may not exist
  const optional = ["fuel_radar_dismissed", "bas_change_requests"];

  for (const t of tables) {
    const n = await countAll(supabase, t.table, t.filter);
    plan.push({ table: t.table, count: n, note: t.note });
  }
  for (const table of optional) {
    const n = await countAll(supabase, table);
    if (n >= 0) plan.push({ table, count: n });
  }

  console.log("Поточні counts:");
  for (const row of plan) {
    const note = row.note ? ` — ${row.note}` : "";
    console.log(
      `  ${row.count < 0 ? "?" : String(row.count).padStart(5)}  ${row.table}${note}`
    );
  }

  const { data: storages } = await supabase
    .from("fuel_storages")
    .select("id, name, current_volume, price_per_liter");
  console.log("\nСклади ДП (після purge current_volume → 0, price лишається):");
  for (const s of storages ?? []) {
    console.log(
      `  ${s.name}: ${Number(s.current_volume) || 0} л · ${Number(s.price_per_liter) || 0} ₴/л`
    );
  }

  if (!APPLY) {
    console.log(
      "\nЩоб виконати: npx tsx scripts/purge-local-test-data.ts --apply"
    );
    return;
  }

  console.log("\nВидаляємо…");

  // attachments first (no FK cascade assumed)
  for (const t of [
    "operation_attachments",
    "inventory_local_moves",
    "accountant_operation_archive",
    "activity_log",
    "field_operations",
    "fuel_transactions",
    "fuel_radar_dismissed",
  ]) {
    const deleted = await deleteAll(supabase, t);
    console.log(`  ${t}: deleted ${deleted}`);
  }

  const localSku = await deleteAll(supabase, "inventory_items_cache", {
    column: "is_local",
    value: true,
  });
  console.log(`  inventory_items_cache (is_local): deleted ${localSku}`);

  // Reset storage volumes — transactions gone, balances must match
  const { error: volErr } = await supabase
    .from("fuel_storages")
    .update({ current_volume: 0 })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (volErr) {
    console.error("  ✗ fuel_storages volume reset:", volErr.message);
  } else {
    console.log("  fuel_storages: current_volume → 0");
  }

  console.log("\nГотово. Wialon/BAS дані не змінювались.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

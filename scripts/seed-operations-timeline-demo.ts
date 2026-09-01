/**
 * Демо-наряди та списання ТМЦ для перегляду «Операційної хронології».
 *
 *   npx tsx scripts/seed-operations-timeline-demo.ts
 *   npx tsx scripts/seed-operations-timeline-demo.ts --field "Василиха 1"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";

const SEASON = "2026";
const DEMO_PREFIX = "demo-timeline-vasilyha1";

const DEMO_ITEMS = [
  {
    bas_ref_key: "b1000001-0000-4000-8000-000000000001",
    name: "Карбамід",
    category: "fertilizer",
    unit: "кг",
    planned_price_uah: 28,
  },
  {
    bas_ref_key: "b1000002-0000-4000-8000-000000000002",
    name: "Насіння сої",
    category: "seed",
    unit: "кг",
    planned_price_uah: 42,
  },
  {
    bas_ref_key: "b1000003-0000-4000-8000-000000000003",
    name: "Гроностар",
    category: "zzr",
    unit: "л",
    planned_price_uah: 890,
  },
] as const;

const DEMO_OPS = [
  {
    client_key: `${DEMO_PREFIX}:op:seeding`,
    work_type: "Посів",
    crop: "Соя",
    machinery: "МТЗ-82",
    implement: "Сівалка SN-4",
    occurred_at: "2026-03-18",
    area_fact: 26.6,
    fuel_fact: 142,
    closed_by_name: "Іван Петренко",
  },
  {
    client_key: `${DEMO_PREFIX}:op:cultivation`,
    work_type: "Культивація",
    crop: "Соя",
    machinery: "МТЗ-1221",
    implement: "Культиватор 6 м",
    occurred_at: "2026-04-05",
    area_fact: 26.6,
    fuel_fact: 96,
    closed_by_name: "Олег Коваленко",
  },
  {
    client_key: `${DEMO_PREFIX}:op:spray`,
    work_type: "Обприскування",
    crop: "Соя",
    machinery: "МТЗ-82",
    implement: "Обприскувач",
    occurred_at: "2026-05-22",
    area_fact: 26.6,
    fuel_fact: 58,
    closed_by_name: "Іван Петренко",
  },
] as const;

const DEMO_MOVES = [
  {
    key: "fertilizer",
    item_ref_key: DEMO_ITEMS[0].bas_ref_key,
    qty: 1200,
    date: "2026-03-10T10:00:00.000Z",
  },
  {
    key: "seed",
    item_ref_key: DEMO_ITEMS[1].bas_ref_key,
    qty: 180,
    date: "2026-03-15T09:30:00.000Z",
  },
  {
    key: "zzr",
    item_ref_key: DEMO_ITEMS[2].bas_ref_key,
    qty: 24,
    date: "2026-05-20T14:15:00.000Z",
  },
] as const;

function fieldArg(): string {
  const idx = process.argv.indexOf("--field");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "Василиха 1";
}

async function findField(
  supabase: ReturnType<typeof createServiceSupabase>,
  needle: string
) {
  const { data, error } = await supabase
    .from("farm_fields")
    .select("id, name, crop, area_ha, is_field")
    .or(`name.ilike.%${needle}%,canonical_name.ilike.%${needle}%`)
    .order("name");

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const exact = rows.find(
    (row) =>
      String(row.name).toLowerCase().includes("василиха") &&
      Number(row.area_ha) >= 26 &&
      Number(row.area_ha) <= 27
  );
  if (exact) return exact;

  const loose = rows.find((row) =>
    String(row.name).toLowerCase().includes(needle.toLowerCase())
  );
  if (loose) return loose;

  if (rows.length === 1) return rows[0];

  throw new Error(
    `Поле не знайдено (${needle}). Доступні: ${rows
      .slice(0, 8)
      .map((r) => `${r.name} (${r.area_ha} га)`)
      .join(", ")}`
  );
}

async function upsertDemoItems(supabase: ReturnType<typeof createServiceSupabase>) {
  for (const item of DEMO_ITEMS) {
    const { error } = await supabase.from("inventory_items_cache").upsert(
      {
        bas_ref_key: item.bas_ref_key,
        name: item.name,
        category: item.category,
        unit: item.unit,
        planned_price_uah: item.planned_price_uah,
        is_local: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bas_ref_key" }
    );
    if (error) throw new Error(`inventory_items_cache: ${error.message}`);
  }
}

async function upsertDemoOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  field: { id: string; crop: string | null }
) {
  const now = new Date().toISOString();
  for (const op of DEMO_OPS) {
    const payload: Record<string, unknown> = {
      client_key: op.client_key,
      field_id: field.id,
      field_key: `farm:${field.id}`,
      work_type: op.work_type,
      crop: op.crop || field.crop || "Соя",
      status: "completed",
      machinery: op.machinery,
      implement: op.implement,
      occurred_at: op.occurred_at,
      season: SEASON,
      season_year: Number(SEASON),
      area_plan: 26.6,
      area_fact: op.area_fact,
      fuel_plan: op.fuel_fact,
      fuel_fact: op.fuel_fact,
      closed_at: `${op.occurred_at}T16:00:00.000Z`,
      closed_by_name: op.closed_by_name,
      actor_name: "Демо-агроном",
      updated_at: now,
    };

    const { error } = await supabase
      .from("field_operations")
      .upsert(payload, { onConflict: "client_key" });

    if (error) {
      const { season: _s, season_year: _sy, actor_name: _a, closed_by_name: _c, ...fallback } =
        payload;
      const retry = await supabase
        .from("field_operations")
        .upsert(fallback, { onConflict: "client_key" });
      if (retry.error) throw new Error(`field_operations: ${retry.error.message}`);
    }
  }
}

async function upsertDemoMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string
) {
  for (const move of DEMO_MOVES) {
    const { data: existing, error: findError } = await supabase
      .from("inventory_local_moves")
      .select("id")
      .eq("field_id", fieldId)
      .eq("item_ref_key", move.item_ref_key)
      .eq("date", move.date)
      .maybeSingle();

    if (findError) throw new Error(findError.message);
    if (existing?.id) continue;

    const payload: Record<string, unknown> = {
      item_ref_key: move.item_ref_key,
      field_id: fieldId,
      type: "outbound",
      qty: move.qty,
      date: move.date,
      status: "draft",
      season: SEASON,
      actor_name: "Демо-агроном",
    };

    const { error } = await supabase.from("inventory_local_moves").insert(payload);
    if (error) {
      const { season: _s, actor_name: _a, ...fallback } = payload;
      const retry = await supabase.from("inventory_local_moves").insert(fallback);
      if (retry.error) throw new Error(`inventory_local_moves: ${retry.error.message}`);
    }
  }
}

async function main() {
  const supabase = createServiceSupabase();
  const needle = fieldArg();

  console.log(`Шукаємо поле: ${needle}`);
  const field = await findField(supabase, needle);
  console.log(`→ ${field.name} (${field.area_ha} га), id=${field.id}`);

  await upsertDemoItems(supabase);
  console.log("✓ Демо-ТМЦ (3 позиції)");

  await upsertDemoOps(supabase, field);
  console.log("✓ Наряди (3 закриті роботи)");

  await upsertDemoMoves(supabase, field.id);
  console.log("✓ Списання ТМЦ (3 рухи)");

  console.log("\nГотово. Відкрий /operations і розгорни це поле в хронології.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

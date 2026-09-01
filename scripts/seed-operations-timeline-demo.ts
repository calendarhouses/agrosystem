/**
 * Демо-наряди та списання ТМЦ для перегляду «Хронології полів».
 *
 *   npm run seed:timeline-demo
 *   npm run seed:timeline-demo -- --field "Василиха 1"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";

const SEASON = "2026";

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
  {
    bas_ref_key: "b1000004-0000-4000-8000-000000000004",
    name: "Аміачна селітра",
    category: "fertilizer",
    unit: "кг",
    planned_price_uah: 22,
  },
  {
    bas_ref_key: "b1000005-0000-4000-8000-000000000005",
    name: "Насіння кукурудзи",
    category: "seed",
    unit: "кг",
    planned_price_uah: 38,
  },
] as const;

type DemoFieldPack = {
  needle: string;
  prefix: string;
  crop: string;
  areaHa: number;
  ops: Array<{
    key: string;
    work_type: string;
    machinery: string;
    implement: string;
    occurred_at: string;
    area_fact: number;
    fuel_fact: number;
    closed_by_name: string;
  }>;
  moves: Array<{
    item_ref_key: string;
    qty: number;
    date: string;
  }>;
};

const DEMO_FIELD_PACKS: DemoFieldPack[] = [
  {
    needle: "Василиха 1",
    prefix: "demo-timeline-vasilyha1",
    crop: "Соя",
    areaHa: 26.6,
    ops: [
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "МТЗ-82",
        implement: "Сівалка SN-4",
        occurred_at: "2026-03-18",
        area_fact: 26.6,
        fuel_fact: 142,
        closed_by_name: "Іван Петренко",
      },
      {
        key: "cultivation",
        work_type: "Культивація",
        machinery: "МТЗ-1221",
        implement: "Культиватор 6 м",
        occurred_at: "2026-04-05",
        area_fact: 26.6,
        fuel_fact: 96,
        closed_by_name: "Олег Коваленко",
      },
      {
        key: "spray",
        work_type: "Внесення ЗЗР",
        machinery: "МТЗ-82",
        implement: "Обприскувач",
        occurred_at: "2026-05-22",
        area_fact: 26.6,
        fuel_fact: 58,
        closed_by_name: "Іван Петренко",
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[0].bas_ref_key,
        qty: 1200,
        date: "2026-03-10T10:00:00.000Z",
      },
      {
        item_ref_key: DEMO_ITEMS[1].bas_ref_key,
        qty: 180,
        date: "2026-03-15T09:30:00.000Z",
      },
      {
        item_ref_key: DEMO_ITEMS[2].bas_ref_key,
        qty: 24,
        date: "2026-05-20T14:15:00.000Z",
      },
    ],
  },
  {
    needle: "Василиха 2",
    prefix: "demo-timeline-vasilyha2",
    crop: "Пшениця",
    areaHa: 22.5,
    ops: [
      {
        key: "plowing",
        work_type: "Оранка",
        machinery: "МТЗ-1221",
        implement: "Плуг 5 корп.",
        occurred_at: "2026-02-12",
        area_fact: 22.5,
        fuel_fact: 210,
        closed_by_name: "Олег Коваленко",
      },
      {
        key: "fertilizer",
        work_type: "Внесення добрив",
        machinery: "МТЗ-82",
        implement: "Розкидач",
        occurred_at: "2026-03-02",
        area_fact: 22.5,
        fuel_fact: 74,
        closed_by_name: "Іван Петренко",
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[3].bas_ref_key,
        qty: 900,
        date: "2026-02-28T11:00:00.000Z",
      },
    ],
  },
  {
    needle: "Григорівка",
    prefix: "demo-timeline-hryhorivka",
    crop: "Соняшник",
    areaHa: 9.8,
    ops: [
      {
        key: "cultivation",
        work_type: "Культивація",
        machinery: "МТЗ-82",
        implement: "Культиватор 4 м",
        occurred_at: "2026-04-18",
        area_fact: 9.8,
        fuel_fact: 48,
        closed_by_name: "Максим Сидоренко",
      },
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "МТЗ-82",
        implement: "Сівалка точного висіву",
        occurred_at: "2026-05-03",
        area_fact: 9.8,
        fuel_fact: 52,
        closed_by_name: "Максим Сидоренко",
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[4].bas_ref_key,
        qty: 42,
        date: "2026-04-28T08:45:00.000Z",
      },
      {
        item_ref_key: DEMO_ITEMS[2].bas_ref_key,
        qty: 8,
        date: "2026-06-10T15:20:00.000Z",
      },
    ],
  },
];

function fieldArg(): string | null {
  const idx = process.argv.indexOf("--field");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
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
  const loose = rows.find((row) =>
    String(row.name).toLowerCase().includes(needle.toLowerCase())
  );
  if (loose) return loose;

  const canonical = rows.find((row) =>
    String((row as { canonical_name?: string }).canonical_name ?? "")
      .toLowerCase()
      .includes(needle.toLowerCase())
  );
  if (canonical) return canonical;

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
  field: { id: string; crop: string | null },
  pack: DemoFieldPack
) {
  const now = new Date().toISOString();
  for (const op of pack.ops) {
    const payload: Record<string, unknown> = {
      client_key: `${pack.prefix}:op:${op.key}`,
      field_id: field.id,
      field_key: `farm:${field.id}`,
      work_type: op.work_type,
      crop: pack.crop || field.crop || "—",
      status: "completed",
      machinery: op.machinery,
      implement: op.implement,
      occurred_at: op.occurred_at,
      season: SEASON,
      season_year: Number(SEASON),
      area_plan: pack.areaHa,
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
      const {
        season: _s,
        season_year: _sy,
        actor_name: _a,
        closed_by_name: _c,
        ...fallback
      } = payload;
      const retry = await supabase
        .from("field_operations")
        .upsert(fallback, { onConflict: "client_key" });
      if (retry.error) throw new Error(`field_operations: ${retry.error.message}`);
    }
  }
}

async function upsertDemoMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  pack: DemoFieldPack
) {
  for (const move of pack.moves) {
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

async function seedFieldPack(
  supabase: ReturnType<typeof createServiceSupabase>,
  pack: DemoFieldPack
) {
  console.log(`\n→ ${pack.needle}`);
  const field = await findField(supabase, pack.needle);
  console.log(`  ${field.name} (${field.area_ha} га), id=${field.id}`);

  await upsertDemoOps(supabase, field, pack);
  console.log(`  ✓ Наряди (${pack.ops.length})`);

  await upsertDemoMoves(supabase, field.id, pack);
  console.log(`  ✓ Списання ТМЦ (${pack.moves.length})`);
}

async function main() {
  const supabase = createServiceSupabase();
  const singleField = fieldArg();
  const packs = singleField
    ? DEMO_FIELD_PACKS.filter((pack) =>
        pack.needle.toLowerCase().includes(singleField.toLowerCase())
      )
    : DEMO_FIELD_PACKS;

  if (packs.length === 0) {
    throw new Error(`Немає демо-пакета для поля «${singleField}»`);
  }

  await upsertDemoItems(supabase);
  console.log("✓ Демо-ТМЦ");

  for (const pack of packs) {
    await seedFieldPack(supabase, pack);
  }

  console.log("\nГотово. Відкрий /operations — 3 поля з хронологією.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

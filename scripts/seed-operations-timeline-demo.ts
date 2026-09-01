/**
 * Демо-дані для «Хронології полів»: наряди, списання ТМЦ, скаутинг, weather_context.
 *
 *   npm run seed:timeline-demo
 *   npm run seed:timeline-demo -- --field "Василиха 1"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";

const SEASON = "2026";
const DEMO_PREFIX = "demo-timeline-v2";

type WeatherContext = {
  temp: number;
  humidity: number;
  condition: string;
  icon: string;
};

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
  slug: string;
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
    wage_fact?: number;
    weather_context: WeatherContext;
  }>;
  moves: Array<{
    item_ref_key: string;
    qty: number;
    date: string;
    weather_context: WeatherContext;
  }>;
  scouting: Array<{
    key: string;
    date: string;
    notes: string;
    image_url: string;
    weather_context: WeatherContext;
  }>;
};

const FIELD_PHOTO = {
  crop: "https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=900&auto=format&fit=crop&q=80",
  soil: "https://images.unsplash.com/photo-1574943329822-55c397a0e0cc?w=900&auto=format&fit=crop&q=80",
  leaf: "https://images.unsplash.com/photo-1464226187744-fa90b21236aa?w=900&auto=format&fit=crop&q=80",
  sprayer: "https://images.unsplash.com/photo-1500382017468-9049fed747aa?w=900&auto=format&fit=crop&q=80",
} as const;

const DEMO_FIELD_PACKS: DemoFieldPack[] = [
  {
    needle: "Василиха 1",
    slug: "vasilyha1",
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
        wage_fact: 4200,
        weather_context: {
          temp: 11,
          humidity: 58,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
      {
        key: "cultivation",
        work_type: "Культивація",
        machinery: "МТЗ-1221",
        implement: "Культиватор 6 м",
        occurred_at: "2026-04-05",
        area_fact: 26.6,
        fuel_fact: 96,
        wage_fact: 3100,
        weather_context: {
          temp: 16,
          humidity: 52,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "spray",
        work_type: "Внесення ЗЗР",
        machinery: "МТЗ-82",
        implement: "Обприскувач 18 м",
        occurred_at: "2026-05-22",
        area_fact: 26.6,
        fuel_fact: 58,
        wage_fact: 2800,
        weather_context: {
          temp: 19,
          humidity: 71,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[0].bas_ref_key,
        qty: 1200,
        date: "2026-03-10T10:00:00.000Z",
        weather_context: {
          temp: 9,
          humidity: 64,
          condition: "Туман",
          icon: "cloud",
        },
      },
      {
        item_ref_key: DEMO_ITEMS[1].bas_ref_key,
        qty: 180,
        date: "2026-03-15T09:30:00.000Z",
        weather_context: {
          temp: 12,
          humidity: 55,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
      {
        item_ref_key: DEMO_ITEMS[2].bas_ref_key,
        qty: 24,
        date: "2026-05-20T14:15:00.000Z",
        weather_context: {
          temp: 18,
          humidity: 68,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
    scouting: [
      {
        key: "emergence",
        date: "2026-03-28T11:20:00.000Z",
        notes: "Сходи рівномірні, фаза VE. Вологість ґрунту достатня.",
        image_url: FIELD_PHOTO.crop,
        weather_context: {
          temp: 14,
          humidity: 61,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "pest-check",
        date: "2026-05-18T08:45:00.000Z",
        notes: "Пошкодження листя мінімальні. Рекомендовано обробку ЗЗР.",
        image_url: FIELD_PHOTO.leaf,
        weather_context: {
          temp: 17,
          humidity: 74,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
    ],
  },
  {
    needle: "Василиха 2",
    slug: "vasilyha2",
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
        wage_fact: 5400,
        weather_context: {
          temp: 3,
          humidity: 78,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
      {
        key: "fertilizer",
        work_type: "Внесення добрив",
        machinery: "МТЗ-82",
        implement: "Розкидач",
        occurred_at: "2026-03-02",
        area_fact: 22.5,
        fuel_fact: 74,
        wage_fact: 2600,
        weather_context: {
          temp: 8,
          humidity: 66,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[3].bas_ref_key,
        qty: 900,
        date: "2026-02-28T11:00:00.000Z",
        weather_context: {
          temp: 5,
          humidity: 70,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
    ],
    scouting: [
      {
        key: "tillering",
        date: "2026-04-12T16:10:00.000Z",
        notes: "Кущіння нормальне. Локально затоплення на північній ділянці.",
        image_url: FIELD_PHOTO.soil,
        weather_context: {
          temp: 13,
          humidity: 82,
          condition: "Мряка",
          icon: "cloud-rain",
        },
      },
    ],
  },
  {
    needle: "Григорівка",
    slug: "hryhorivka",
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
        wage_fact: 1800,
        weather_context: {
          temp: 15,
          humidity: 49,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "МТЗ-82",
        implement: "Сівалка точного висіву",
        occurred_at: "2026-05-03",
        area_fact: 9.8,
        fuel_fact: 52,
        wage_fact: 1950,
        weather_context: {
          temp: 18,
          humidity: 44,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item_ref_key: DEMO_ITEMS[4].bas_ref_key,
        qty: 42,
        date: "2026-04-28T08:45:00.000Z",
        weather_context: {
          temp: 16,
          humidity: 51,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        item_ref_key: DEMO_ITEMS[2].bas_ref_key,
        qty: 8,
        date: "2026-06-10T15:20:00.000Z",
        weather_context: {
          temp: 24,
          humidity: 38,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    scouting: [
      {
        key: "stand-count",
        date: "2026-05-20T07:30:00.000Z",
        notes: "Густота посіву в нормі. Є окремі прогалини на краю поля.",
        image_url: FIELD_PHOTO.sprayer,
        weather_context: {
          temp: 20,
          humidity: 46,
          condition: "Ясно",
          icon: "sun",
        },
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

async function purgeOldDemo(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldIds: string[]
) {
  const prefixes = ["demo-timeline-", `${DEMO_PREFIX}:`];

  for (const prefix of prefixes) {
    const { error: opsErr } = await supabase
      .from("field_operations")
      .delete()
      .like("client_key", `${prefix}%`);
    if (opsErr && !opsErr.message.includes("PGRST205")) {
      console.warn(`  ! field_operations purge (${prefix}): ${opsErr.message}`);
    }
  }

  if (fieldIds.length > 0) {
    const { error: movesErr } = await supabase
      .from("inventory_local_moves")
      .delete()
      .in("field_id", fieldIds)
      .in(
        "item_ref_key",
        DEMO_ITEMS.map((item) => item.bas_ref_key)
      );
    if (movesErr && !movesErr.message.includes("PGRST205")) {
      console.warn(`  ! inventory_local_moves purge: ${movesErr.message}`);
    }

    const { error: scoutErr } = await supabase
      .from("scouting_reports")
      .delete()
      .in("field_id", fieldIds);
    if (scoutErr && !scoutErr.message.includes("PGRST205")) {
      console.warn(`  ! scouting_reports purge: ${scoutErr.message}`);
    }
  }
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
      client_key: `${DEMO_PREFIX}:${pack.slug}:op:${op.key}`,
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
      wage_plan: op.wage_fact ?? null,
      wage_fact: op.wage_fact ?? null,
      closed_at: `${op.occurred_at}T16:00:00.000Z`,
      weather_context: op.weather_context,
      updated_at: now,
    };

    const { error } = await supabase
      .from("field_operations")
      .upsert(payload, { onConflict: "client_key" });

    if (error) {
      if (error.message.includes("weather_context")) {
        const { weather_context: _w, ...withoutWeather } = payload;
        const retry = await supabase
          .from("field_operations")
          .upsert(withoutWeather, { onConflict: "client_key" });
        if (retry.error) {
          throw new Error(`field_operations: ${retry.error.message}`);
        }
        continue;
      }

      const {
        season: _s,
        season_year: _sy,
        wage_plan: _wp,
        wage_fact: _wf,
        weather_context: _w,
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
    const payload: Record<string, unknown> = {
      item_ref_key: move.item_ref_key,
      field_id: fieldId,
      type: "outbound",
      qty: move.qty,
      date: move.date,
      status: "draft",
      season: SEASON,
      weather_context: move.weather_context,
    };

    const { error } = await supabase.from("inventory_local_moves").insert(payload);
    if (error) {
      if (error.message.includes("weather_context")) {
        const { weather_context: _w, ...withoutWeather } = payload;
        const retry = await supabase
          .from("inventory_local_moves")
          .insert(withoutWeather);
        if (retry.error) {
          throw new Error(`inventory_local_moves: ${retry.error.message}`);
        }
        continue;
      }

      const { season: _s, weather_context: _w, ...fallback } = payload;
      const retry = await supabase.from("inventory_local_moves").insert(fallback);
      if (retry.error) {
        throw new Error(`inventory_local_moves: ${retry.error.message}`);
      }
    }
  }
}

async function upsertDemoScouting(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  pack: DemoFieldPack
) {
  for (const report of pack.scouting) {
    const payload: Record<string, unknown> = {
      field_id: fieldId,
      date: report.date,
      notes: report.notes,
      image_url: report.image_url,
      weather_context: report.weather_context,
    };

    const { error } = await supabase.from("scouting_reports").insert(payload);
    if (error) {
      if (error.message.includes("weather_context")) {
        const { weather_context: _w, ...withoutWeather } = payload;
        const retry = await supabase
          .from("scouting_reports")
          .insert(withoutWeather);
        if (retry.error) {
          throw new Error(`scouting_reports: ${retry.error.message}`);
        }
        continue;
      }
      throw new Error(`scouting_reports: ${error.message}`);
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

  await upsertDemoScouting(supabase, field.id, pack);
  console.log(`  ✓ Скаутинг (${pack.scouting.length})`);

  return field.id;
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

  console.log("Очищення старих демо-записів…");
  const fieldIds: string[] = [];
  for (const pack of DEMO_FIELD_PACKS) {
    try {
      const field = await findField(supabase, pack.needle);
      fieldIds.push(field.id);
    } catch {
      /* поле може бути відсутнє */
    }
  }
  await purgeOldDemo(supabase, fieldIds);
  console.log("✓ Старі демо-дані прибрано");

  await upsertDemoItems(supabase);
  console.log("✓ Демо-ТМЦ");

  for (const pack of packs) {
    await seedFieldPack(supabase, pack);
  }

  console.log(
    "\nГотово. Відкрий /operations — наряди, ТМЦ, скаутинг і погодні штампи на карті метро."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

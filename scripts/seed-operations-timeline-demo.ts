/**
 * Демо-дані для «Хронології полів» і карток полів:
 * наряди з ТМЦ за типом робіт, списання складу, скаутинг, погодні штампи.
 *
 *   npm run seed:timeline-demo
 *   npm run seed:timeline-demo -- --field "Василиха 1"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createServiceSupabase } from "../lib/supabase/server";

const SEASON = "2026";
const DEMO_PREFIX = "demo-timeline-v3";

type WeatherContext = {
  temp: number;
  humidity: number;
  condition: string;
  icon: string;
};

const DEMO_ITEMS = [
  {
    bas_ref_key: "b1000001-0000-4000-8000-000000000001",
    name: "Карбамід 46%",
    category: "fertilizer",
    unit: "кг",
    planned_price_uah: 28,
  },
  {
    bas_ref_key: "b1000002-0000-4000-8000-000000000002",
    name: "Аміачна селітра",
    category: "fertilizer",
    unit: "кг",
    planned_price_uah: 22,
  },
  {
    bas_ref_key: "b1000003-0000-4000-8000-000000000003",
    name: "Насіння сої",
    category: "seed",
    unit: "кг",
    planned_price_uah: 42,
  },
  {
    bas_ref_key: "b1000004-0000-4000-8000-000000000004",
    name: "Насіння кукурудзи ДКС 471",
    category: "seed",
    unit: "кг",
    planned_price_uah: 38,
  },
  {
    bas_ref_key: "b1000005-0000-4000-8000-000000000005",
    name: "Насіння соняшника СУНПРО",
    category: "seed",
    unit: "кг",
    planned_price_uah: 55,
  },
  {
    bas_ref_key: "b1000006-0000-4000-8000-000000000006",
    name: "Насіння ріпаку ES Alien",
    category: "seed",
    unit: "кг",
    planned_price_uah: 48,
  },
  {
    bas_ref_key: "b1000007-0000-4000-8000-000000000007",
    name: "Гроностар 75",
    category: "zzr",
    unit: "л",
    planned_price_uah: 890,
  },
  {
    bas_ref_key: "b1000008-0000-4000-8000-000000000008",
    name: "Амістар Топ",
    category: "zzr",
    unit: "л",
    planned_price_uah: 1200,
  },
] as const;

type DemoItem = (typeof DEMO_ITEMS)[number];

type DemoOp = {
  key: string;
  work_type: string;
  status?: "completed" | "planned" | "in_progress";
  machinery: string;
  implement: string;
  occurred_at: string;
  area_fact?: number;
  fuel_fact?: number;
  fuel_plan?: number;
  wage_fact?: number;
  wage_plan?: number;
  weather_context: WeatherContext;
  /** ТМЦ зі складу — відповідає типу робіт */
  material?: {
    item: DemoItem;
    qty: number;
  };
};

type DemoFieldPack = {
  needle: string;
  slug: string;
  crop: string;
  areaHa: number;
  ops: DemoOp[];
  moves: Array<{
    item: DemoItem;
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
  crop: "https://picsum.photos/seed/agro-crop-row/480/360",
  soil: "https://picsum.photos/seed/agro-soil-moist/480/360",
  leaf: "https://picsum.photos/seed/agro-leaf-disease/480/360",
  stand: "https://picsum.photos/seed/agro-field-stand/480/360",
  ndvi: "https://picsum.photos/seed/agro-ndvi-scout/480/360",
} as const;

const I = {
  urea: DEMO_ITEMS[0],
  ammonium: DEMO_ITEMS[1],
  soySeed: DEMO_ITEMS[2],
  cornSeed: DEMO_ITEMS[3],
  sunSeed: DEMO_ITEMS[4],
  rapeSeed: DEMO_ITEMS[5],
  gronostar: DEMO_ITEMS[6],
  amistar: DEMO_ITEMS[7],
} as const;

const DEMO_FIELD_PACKS: DemoFieldPack[] = [
  {
    needle: "Василиха 1",
    slug: "vas1",
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
        material: { item: I.soySeed, qty: 80 },
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
        material: { item: I.gronostar, qty: 53 },
        weather_context: {
          temp: 19,
          humidity: 71,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
      {
        key: "harvest-plan",
        work_type: "Збирання",
        status: "planned",
        machinery: "John Deere S790",
        implement: "Жатка 9 м",
        occurred_at: "2026-10-05",
        fuel_plan: 180,
        wage_plan: 8500,
        weather_context: {
          temp: 14,
          humidity: 62,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item: I.soySeed,
        qty: 80,
        date: "2026-03-15T09:30:00.000Z",
        weather_context: {
          temp: 12,
          humidity: 55,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
      {
        item: I.gronostar,
        qty: 53,
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
        notes: "Сходи сої рівномірні, фаза VE. Вологість ґрунту достатня.",
        image_url: FIELD_PHOTO.crop,
        weather_context: {
          temp: 14,
          humidity: 61,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "pest",
        date: "2026-05-18T08:45:00.000Z",
        notes: "Пошкодження листя мінімальні. Рекомендовано обробку Гроностаром.",
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
    slug: "vas2",
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
        material: { item: I.ammonium, qty: 450 },
        weather_context: {
          temp: 8,
          humidity: 66,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
      {
        key: "spray-plan",
        work_type: "Внесення ЗЗР",
        status: "planned",
        machinery: "МТЗ-82",
        implement: "Обприскувач 18 м",
        occurred_at: "2026-09-12",
        fuel_plan: 48,
        wage_plan: 2400,
        material: { item: I.amistar, qty: 45 },
        weather_context: {
          temp: 20,
          humidity: 58,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    moves: [
      {
        item: I.ammonium,
        qty: 450,
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
        notes: "Кущіння пшениці нормальне. Локально затоплення на північній ділянці.",
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
    slug: "hryh",
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
        material: { item: I.sunSeed, qty: 24 },
        weather_context: {
          temp: 18,
          humidity: 44,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
      {
        key: "spray",
        work_type: "Обприскування",
        machinery: "МТЗ-82",
        implement: "Обприскувач 18 м",
        occurred_at: "2026-06-14",
        area_fact: 9.8,
        fuel_fact: 32,
        wage_fact: 1600,
        material: { item: I.amistar, qty: 20 },
        weather_context: {
          temp: 24,
          humidity: 38,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    moves: [
      {
        item: I.sunSeed,
        qty: 24,
        date: "2026-04-28T08:45:00.000Z",
        weather_context: {
          temp: 16,
          humidity: 51,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    scouting: [
      {
        key: "stand",
        date: "2026-05-20T07:30:00.000Z",
        notes: "Густота соняшника в нормі. Окремі прогалини на краю поля.",
        image_url: FIELD_PHOTO.stand,
        weather_context: {
          temp: 20,
          humidity: 46,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
  },
  {
    needle: "Поле 6",
    slug: "p6",
    crop: "Кукурудза",
    areaHa: 246.4,
    ops: [
      {
        key: "plowing",
        work_type: "Оранка",
        machinery: "МТЗ-1221",
        implement: "Плуг 5 корп.",
        occurred_at: "2026-03-25",
        area_fact: 246.4,
        fuel_fact: 1980,
        wage_fact: 42000,
        weather_context: {
          temp: 10,
          humidity: 60,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "John Deere 8R",
        implement: "Сівалка 12 рядна",
        occurred_at: "2026-04-20",
        area_fact: 246.4,
        fuel_fact: 1320,
        wage_fact: 38000,
        material: { item: I.cornSeed, qty: 6160 },
        weather_context: {
          temp: 17,
          humidity: 48,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "fert-plan",
        work_type: "Внесення добрив",
        status: "planned",
        machinery: "МТЗ-1221",
        implement: "Розкидач",
        occurred_at: "2026-09-18",
        fuel_plan: 420,
        wage_plan: 12000,
        material: { item: I.urea, qty: 9856 },
        weather_context: {
          temp: 19,
          humidity: 55,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item: I.cornSeed,
        qty: 6160,
        date: "2026-04-15T10:00:00.000Z",
        weather_context: {
          temp: 15,
          humidity: 52,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    scouting: [
      {
        key: "ndvi",
        date: "2026-06-22T09:00:00.000Z",
        notes: "NDVI рівномірний. На півдні — легке стресування від посухи.",
        image_url: FIELD_PHOTO.ndvi,
        weather_context: {
          temp: 28,
          humidity: 35,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
  },
  {
    needle: "Поле 7",
    slug: "p7",
    crop: "Пшениця",
    areaHa: 153.5,
    ops: [
      {
        key: "fertilizer",
        work_type: "Внесення добрив",
        machinery: "МТЗ-1221",
        implement: "Розкидач",
        occurred_at: "2026-02-28",
        area_fact: 153.5,
        fuel_fact: 380,
        wage_fact: 14500,
        material: { item: I.urea, qty: 3070 },
        weather_context: {
          temp: 6,
          humidity: 72,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
      {
        key: "spray",
        work_type: "Внесення ЗЗР",
        machinery: "МТЗ-82",
        implement: "Обприскувач 24 м",
        occurred_at: "2026-05-08",
        area_fact: 153.5,
        fuel_fact: 290,
        wage_fact: 11200,
        material: { item: I.gronostar, qty: 307 },
        weather_context: {
          temp: 18,
          humidity: 65,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item: I.urea,
        qty: 3070,
        date: "2026-02-25T12:00:00.000Z",
        weather_context: {
          temp: 4,
          humidity: 75,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
    ],
    scouting: [
      {
        key: "flag-leaf",
        date: "2026-05-25T07:15:00.000Z",
        notes: "Фаза колосання. Ознаки септоріозу на 3% площі — обробку проведено.",
        image_url: FIELD_PHOTO.leaf,
        weather_context: {
          temp: 16,
          humidity: 78,
          condition: "Мряка",
          icon: "cloud-rain",
        },
      },
    ],
  },
  {
    needle: "Винарівка",
    slug: "vyn",
    crop: "Ріпак",
    areaHa: 28,
    ops: [
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "МТЗ-82",
        implement: "Сівалка 4 м",
        occurred_at: "2026-08-22",
        area_fact: 28,
        fuel_fact: 88,
        wage_fact: 3200,
        material: { item: I.rapeSeed, qty: 14 },
        weather_context: {
          temp: 22,
          humidity: 42,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "fertilizer",
        work_type: "Підживлення",
        machinery: "МТЗ-82",
        implement: "Розкидач",
        occurred_at: "2026-09-05",
        status: "planned",
        fuel_plan: 42,
        wage_plan: 1800,
        material: { item: I.ammonium, qty: 560 },
        weather_context: {
          temp: 21,
          humidity: 48,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [
      {
        item: I.rapeSeed,
        qty: 14,
        date: "2026-08-18T08:00:00.000Z",
        weather_context: {
          temp: 20,
          humidity: 45,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    scouting: [
      {
        key: "pre-sow",
        date: "2026-08-15T10:30:00.000Z",
        notes: "Передпосівний огляд. Вологість ґрунту достатня для озимого ріпаку.",
        image_url: FIELD_PHOTO.soil,
        weather_context: {
          temp: 19,
          humidity: 55,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
  },
  {
    needle: "Поле 1.1",
    slug: "p11",
    crop: "Кукурудза",
    areaHa: 63,
    ops: [
      {
        key: "seeding",
        work_type: "Посів",
        machinery: "МТЗ-1221",
        implement: "Сівалка 8 рядна",
        occurred_at: "2026-04-12",
        area_fact: 63,
        fuel_fact: 340,
        wage_fact: 9800,
        material: { item: I.cornSeed, qty: 1575 },
        weather_context: {
          temp: 16,
          humidity: 50,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "top-dress",
        work_type: "Підживлення",
        machinery: "МТЗ-82",
        implement: "Розкидач",
        occurred_at: "2026-06-02",
        area_fact: 63,
        fuel_fact: 95,
        wage_fact: 3200,
        material: { item: I.urea, qty: 1260 },
        weather_context: {
          temp: 23,
          humidity: 40,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
    moves: [
      {
        item: I.cornSeed,
        qty: 1575,
        date: "2026-04-08T09:00:00.000Z",
        weather_context: {
          temp: 14,
          humidity: 54,
          condition: "Мінливо хмарно",
          icon: "cloud-sun",
        },
      },
    ],
    scouting: [
      {
        key: "v4",
        date: "2026-05-10T11:00:00.000Z",
        notes: "Фаза V4–V6. Рівномірний розвиток, без ознак дефіциту азоту.",
        image_url: FIELD_PHOTO.crop,
        weather_context: {
          temp: 21,
          humidity: 44,
          condition: "Ясно",
          icon: "sun",
        },
      },
    ],
  },
  {
    needle: "Поле 4.1",
    slug: "p41",
    crop: "Ріпак",
    areaHa: 90,
    ops: [
      {
        key: "cultivation",
        work_type: "Культивація",
        machinery: "МТЗ-1221",
        implement: "Культиватор 6 м",
        occurred_at: "2026-08-10",
        area_fact: 90,
        fuel_fact: 210,
        wage_fact: 6800,
        weather_context: {
          temp: 24,
          humidity: 38,
          condition: "Ясно",
          icon: "sun",
        },
      },
      {
        key: "spray-plan",
        work_type: "Внесення ЗЗР",
        status: "planned",
        machinery: "МТЗ-82",
        implement: "Обприскувач 18 м",
        occurred_at: "2026-09-22",
        fuel_plan: 95,
        wage_plan: 4100,
        material: { item: I.gronostar, qty: 180 },
        weather_context: {
          temp: 18,
          humidity: 52,
          condition: "Хмарно",
          icon: "cloud",
        },
      },
      {
        key: "scout-task",
        work_type: "Скаутинг",
        status: "planned",
        machinery: "—",
        implement: "—",
        occurred_at: "2026-09-08",
        weather_context: {
          temp: 20,
          humidity: 50,
          condition: "Переважно ясно",
          icon: "cloud-sun",
        },
      },
    ],
    moves: [],
    scouting: [
      {
        key: "stubble",
        date: "2026-08-08T08:20:00.000Z",
        notes: "Після жнив пшениці. Солома розкладена, готово до культивації.",
        image_url: FIELD_PHOTO.stand,
        weather_context: {
          temp: 25,
          humidity: 36,
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
    .select("id, name, canonical_name, crop, area_ha, is_field")
    .or(`name.ilike.%${needle}%,canonical_name.ilike.%${needle}%`)
    .order("name");

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const exact = rows.find(
    (row) =>
      String((row as { canonical_name?: string }).canonical_name ?? row.name)
        .trim()
        .toLowerCase() === needle.trim().toLowerCase()
  );
  if (exact) return exact;

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
  const prefixes = [
    "demo-timeline-",
    "demo-timeline-v2:",
    "demo-timeline-v3:",
  ];

  for (const prefix of prefixes) {
    const { data: opKeys } = await supabase
      .from("field_operations")
      .select("client_key")
      .like("client_key", `${prefix}%`);

    const keys = (opKeys ?? []).map((row) => String(row.client_key));
    if (keys.length > 0) {
      const { error: matErr } = await supabase
        .from("field_operation_materials")
        .delete()
        .in("operation_client_key", keys);
      if (matErr && !matErr.message.includes("PGRST205")) {
        console.warn(`  ! field_operation_materials purge: ${matErr.message}`);
      }
    }

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

function clientKey(pack: DemoFieldPack, op: DemoOp): string {
  return `${DEMO_PREFIX}:${pack.slug}:op:${op.key}`;
}

async function upsertDemoOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  field: { id: string; crop: string | null },
  pack: DemoFieldPack
) {
  const now = new Date().toISOString();
  for (const op of pack.ops) {
    const status = op.status ?? "completed";
    const isCompleted = status === "completed";
    const key = clientKey(pack, op);

    const payload: Record<string, unknown> = {
      client_key: key,
      field_id: field.id,
      field_key: `farm:${field.id}`,
      work_type: op.work_type,
      crop: pack.crop || field.crop || "—",
      status,
      machinery: op.machinery,
      implement: op.implement,
      occurred_at: op.occurred_at,
      season: SEASON,
      season_year: Number(SEASON),
      area_plan: pack.areaHa,
      area_fact: isCompleted ? (op.area_fact ?? pack.areaHa) : null,
      fuel_plan: op.fuel_plan ?? op.fuel_fact ?? null,
      fuel_fact: isCompleted ? (op.fuel_fact ?? null) : null,
      wage_plan: op.wage_plan ?? op.wage_fact ?? null,
      wage_fact: isCompleted ? (op.wage_fact ?? null) : null,
      closed_at: isCompleted ? `${op.occurred_at}T16:00:00.000Z` : null,
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
      } else {
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

    if (op.material) {
      await upsertOpMaterial(supabase, key, op.material.item, op.material.qty);
    } else {
      await supabase
        .from("field_operation_materials")
        .delete()
        .eq("operation_client_key", key);
    }
  }
}

async function upsertOpMaterial(
  supabase: ReturnType<typeof createServiceSupabase>,
  clientKeyValue: string,
  item: DemoItem,
  qty: number
) {
  await supabase
    .from("field_operation_materials")
    .delete()
    .eq("operation_client_key", clientKeyValue);

  const { error } = await supabase.from("field_operation_materials").insert({
    operation_client_key: clientKeyValue,
    inventory_bas_ref_key: item.bas_ref_key,
    item_name: item.name,
    category: item.category,
    unit: item.unit,
    qty,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.warn(
        "  ! field_operation_materials: таблиця ще не застосована (053)"
      );
      return;
    }
    throw new Error(`field_operation_materials: ${error.message}`);
  }
}

async function upsertDemoMoves(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  pack: DemoFieldPack
) {
  for (const move of pack.moves) {
    const payload: Record<string, unknown> = {
      item_ref_key: move.item.bas_ref_key,
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
  const withMaterial = pack.ops.filter((op) => op.material).length;
  console.log(
    `  ✓ Наряди (${pack.ops.length}, з ТМЦ: ${withMaterial})`
  );

  if (pack.moves.length > 0) {
    await upsertDemoMoves(supabase, field.id, pack);
    console.log(`  ✓ Списання ТМЦ (${pack.moves.length})`);
  }

  if (pack.scouting.length > 0) {
    await upsertDemoScouting(supabase, field.id, pack);
    console.log(`  ✓ Скаутинг (${pack.scouting.length})`);
  }

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
  await purgeOldDemo(supabase, [...new Set(fieldIds)]);
  console.log("✓ Старі демо-дані прибрано");

  await upsertDemoItems(supabase);
  console.log("✓ Демо-ТМЦ на складі");

  let seeded = 0;
  for (const pack of packs) {
    try {
      await seedFieldPack(supabase, pack);
      seeded += 1;
    } catch (error) {
      console.warn(
        `  ⚠ Пропущено: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  console.log(
    `\nГотово (${seeded}/${packs.length} полів). Відкрий /operations і картки полів — наряди з ТМЦ, скаутинг, заплановані роботи.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

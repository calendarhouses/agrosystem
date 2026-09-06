/**
 * Фенологія культури: GDD (Growing Degree Days) + орієнтовна BBCH-фаза.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveFieldCoordinates } from "@/lib/field-weather-context";
import { isSowingOperationType } from "@/lib/field-operation-norms";
import { todayKyivYmd } from "@/lib/kyiv-date";

export type CropPhenologyResult = {
  crop: string;
  sowingDate: string;
  accumulatedGdd: number;
  baseTempC: number;
  bbchCode: number;
  stageName: string;
  percentProgress: number;
  daysToNextStage: number | null;
  nextBbchCode: number | null;
  nextStageName: string | null;
  advisory: string;
  weatherDays: number;
  source: "gdd" | "days_fallback";
};

type BbchStage = {
  code: number;
  name: string;
  /** Накопичені GDD від сівби до входу у фазу */
  gdd: number;
};

function cropKey(crop: string): string {
  return crop.trim().toLowerCase();
}

/** Біологічний нуль: +6 зернові/ріпак, +10 кукурудза/соняшник/соя. */
export function biologicalZeroC(crop: string): number {
  const key = cropKey(crop);
  if (
    key.includes("кукуруд") ||
    key.includes("соняш") ||
    key.includes("соя") ||
    key.includes("маїс") ||
    key.includes("maize") ||
    key.includes("corn")
  ) {
    return 10;
  }
  return 6;
}

function stagesForCrop(crop: string): BbchStage[] {
  const key = cropKey(crop);
  if (key.includes("кукуруд") || key.includes("maize") || key.includes("corn")) {
    return [
      { code: 0, name: "Сівба / сухе насіння", gdd: 0 },
      { code: 10, name: "Сходи (колеоптиль)", gdd: 80 },
      { code: 14, name: "4 листки", gdd: 220 },
      { code: 19, name: "9+ листків", gdd: 380 },
      { code: 30, name: "Початок видовження стебла", gdd: 520 },
      { code: 51, name: "Початок викидання волоті", gdd: 720 },
      { code: 65, name: "Цвітіння", gdd: 900 },
      { code: 75, name: "Молочна стиглість", gdd: 1150 },
      { code: 85, name: "Воскова стиглість", gdd: 1350 },
      { code: 89, name: "Повна стиглість", gdd: 1550 },
    ];
  }
  if (key.includes("соняш")) {
    return [
      { code: 0, name: "Сівба", gdd: 0 },
      { code: 10, name: "Сходи", gdd: 90 },
      { code: 14, name: "4 листки", gdd: 200 },
      { code: 30, name: "Ріст стебла", gdd: 400 },
      { code: 51, name: "Утворення кошика", gdd: 650 },
      { code: 65, name: "Цвітіння", gdd: 850 },
      { code: 75, name: "Налив насіння", gdd: 1100 },
      { code: 89, name: "Фізіологічна стиглість", gdd: 1400 },
    ];
  }
  if (
    key.includes("пшен") ||
    key.includes("ячмін") ||
    key.includes("жито") ||
    key.includes("овес") ||
    key.includes("зерн")
  ) {
    return [
      { code: 0, name: "Сівба", gdd: 0 },
      { code: 10, name: "Сходи", gdd: 70 },
      { code: 21, name: "Кущіння", gdd: 180 },
      { code: 32, name: "Вихід у трубку / 2 міжвузля", gdd: 350 },
      { code: 41, name: "Прапорцевий листок", gdd: 520 },
      { code: 55, name: "Колосіння", gdd: 700 },
      { code: 65, name: "Цвітіння", gdd: 850 },
      { code: 75, name: "Молочна стиглість", gdd: 1050 },
      { code: 87, name: "Воскова стиглість", gdd: 1250 },
      { code: 89, name: "Повна стиглість", gdd: 1450 },
    ];
  }
  // Універсальна шкала
  return [
    { code: 0, name: "Сівба", gdd: 0 },
    { code: 10, name: "Сходи", gdd: 80 },
    { code: 14, name: "4 листки / ранній ріст", gdd: 220 },
    { code: 32, name: "Видовження / гілкування", gdd: 450 },
    { code: 65, name: "Цвітіння", gdd: 850 },
    { code: 75, name: "Налив / молочна стиглість", gdd: 1100 },
    { code: 89, name: "Стиглість", gdd: 1450 },
  ];
}

function resolveStage(
  accumulatedGdd: number,
  stages: BbchStage[]
): {
  current: BbchStage;
  next: BbchStage | null;
  percentProgress: number;
} {
  let current = stages[0]!;
  for (const stage of stages) {
    if (accumulatedGdd >= stage.gdd) current = stage;
  }
  const idx = stages.findIndex((s) => s.code === current.code);
  const next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1]! : null;
  const floor = current.gdd;
  const ceiling = next?.gdd ?? floor + 200;
  const span = Math.max(1, ceiling - floor);
  const pct = next
    ? Math.min(99, Math.max(0, Math.round(((accumulatedGdd - floor) / span) * 100)))
    : 100;
  return { current, next, percentProgress: pct };
}

async function fetchDailyTemps(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; tmax: number; tmin: number }>> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "Europe/Kyiv");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Open-Meteo archive HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: Array<number | null>;
      temperature_2m_min?: Array<number | null>;
    };
  };
  const times = data.daily?.time ?? [];
  const maxes = data.daily?.temperature_2m_max ?? [];
  const mins = data.daily?.temperature_2m_min ?? [];
  const out: Array<{ date: string; tmax: number; tmin: number }> = [];
  for (let i = 0; i < times.length; i++) {
    const tmax = Number(maxes[i]);
    const tmin = Number(mins[i]);
    if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) continue;
    out.push({ date: times[i]!, tmax, tmin });
  }
  return out;
}

function accumulateGdd(
  days: Array<{ tmax: number; tmin: number }>,
  baseTempC: number
): { total: number; recentAvgDaily: number } {
  let total = 0;
  const daily: number[] = [];
  for (const day of days) {
    const mean = (day.tmax + day.tmin) / 2;
    const gdd = Math.max(0, mean - baseTempC);
    total += gdd;
    daily.push(gdd);
  }
  const recent = daily.slice(-7);
  const recentAvgDaily =
    recent.length > 0
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : 0;
  return {
    total: Math.round(total * 10) / 10,
    recentAvgDaily: Math.round(recentAvgDaily * 10) / 10,
  };
}

async function findSowingDate(
  supabase: SupabaseClient,
  fieldId: string
): Promise<{ crop: string; sowingDate: string } | null> {
  const fieldKey = `farm:${fieldId}`;
  const { data: field } = await supabase
    .from("farm_fields")
    .select("id, crop, name, canonical_name")
    .eq("id", fieldId)
    .maybeSingle();

  const passportCrop = String(field?.crop ?? "").trim();

  const { data: ops } = await supabase
    .from("field_operations")
    .select("occurred_at, work_type, crop, status")
    .or(`field_id.eq.${fieldId},field_key.eq.${fieldKey}`)
    .neq("status", "cancelled")
    .order("occurred_at", { ascending: false })
    .limit(200);

  const sowingOps = (ops ?? []).filter((op) => {
    const wt = String(op.work_type ?? "");
    const lower = wt.toLowerCase();
    return (
      isSowingOperationType(wt) ||
      lower.includes("сівб") ||
      lower.includes("посів")
    );
  });

  if (sowingOps.length === 0) {
    if (!passportCrop || passportCrop === "—") return null;
    // Без дати сівби — не рахуємо GDD
    return null;
  }

  const latest = sowingOps.reduce((best, op) =>
    String(op.occurred_at ?? "").localeCompare(String(best.occurred_at ?? "")) >
    0
      ? op
      : best
  );

  const sowingDate = String(latest.occurred_at ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sowingDate)) return null;

  const crop =
    String(latest.crop ?? "").trim() ||
    passportCrop ||
    "—";

  return { crop, sowingDate };
}

function buildAdvisory(params: {
  crop: string;
  stageName: string;
  bbchCode: number;
  daysToNext: number | null;
  nextName: string | null;
  percentProgress: number;
}): string {
  const { crop, stageName, bbchCode, daysToNext, nextName, percentProgress } =
    params;
  const bits = [
    `${crop}: BBCH ${bbchCode} — ${stageName} (${percentProgress}% до наступної фази).`,
  ];
  if (daysToNext != null && nextName) {
    bits.push(
      `Орієнтовно ~${daysToNext} дн. до «${nextName}» за поточним темпом тепла.`
    );
  } else if (!nextName) {
    bits.push("Культура близька до фінальної фази шкали.");
  }
  if (bbchCode >= 60 && bbchCode < 70) {
    bits.push("Увага до запилення / обприскувань у вікно цвітіння.");
  } else if (bbchCode >= 75) {
    bits.push("Плануйте контроль вологості та вікно збирання.");
  } else if (bbchCode > 0 && bbchCode < 30) {
    bits.push("Контроль сходів, бурʼянів і ґрунтової вологи.");
  }
  return bits.join(" ");
}

export async function getCropPhenologyForField(
  supabase: SupabaseClient,
  fieldId: string
): Promise<
  | { ok: true; result: CropPhenologyResult }
  | { ok: false; error: string }
> {
  const sowing = await findSowingDate(supabase, fieldId);
  if (!sowing) {
    return {
      ok: false,
      error:
        "Не знайдено дату сівби (наряд з типом «посів»/«сівба»). Додайте операцію посіву або вкажіть культуру в паспорті.",
    };
  }

  const { crop, sowingDate } = sowing;
  const baseTempC = biologicalZeroC(crop);
  const stages = stagesForCrop(crop);
  const today = todayKyivYmd();
  const endDate = sowingDate > today ? sowingDate : today;

  const coords = await resolveFieldCoordinates(supabase, fieldId);
  if (!coords) {
    return {
      ok: false,
      error: "Немає геометрії поля — не можу взяти історичну погоду для GDD.",
    };
  }

  try {
    const days = await fetchDailyTemps(
      coords.latitude,
      coords.longitude,
      sowingDate,
      endDate
    );
    if (days.length === 0) {
      return {
        ok: false,
        error: "Open-Meteo не повернув денні температури за період від сівби.",
      };
    }

    const { total, recentAvgDaily } = accumulateGdd(days, baseTempC);
    const { current, next, percentProgress } = resolveStage(total, stages);
    const gddToNext = next ? Math.max(0, next.gdd - total) : 0;
    const daysToNextStage =
      next && recentAvgDaily > 0.5
        ? Math.max(1, Math.ceil(gddToNext / recentAvgDaily))
        : next
          ? null
          : 0;

    const result: CropPhenologyResult = {
      crop,
      sowingDate,
      accumulatedGdd: total,
      baseTempC,
      bbchCode: current.code,
      stageName: current.name,
      percentProgress,
      daysToNextStage:
        daysToNextStage === 0 && !next ? 0 : daysToNextStage,
      nextBbchCode: next?.code ?? null,
      nextStageName: next?.name ?? null,
      advisory: buildAdvisory({
        crop,
        stageName: current.name,
        bbchCode: current.code,
        daysToNext: daysToNextStage === 0 && !next ? 0 : daysToNextStage,
        nextName: next?.name ?? null,
        percentProgress,
      }),
      weatherDays: days.length,
      source: "gdd",
    };
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Помилка розрахунку фенології",
    };
  }
}

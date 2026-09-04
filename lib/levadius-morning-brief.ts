/**
 * Збір даних + генерація ранкового зведення LEVADIUS для Telegram.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import {
  DEFAULT_WEATHER_LOCATION,
  evaluateSprayingWeatherWindow,
  fetchPlanningWeather,
  fetchWeather,
} from "@/lib/weather";
import { todayKyivYmd, shiftKyivYmd } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";

const TO_HOURS_LEFT_THRESHOLD = 15;

export type MorningBriefPayload = {
  date: string;
  plannedOps: Array<{
    fieldName: string;
    workType: string;
    status: string;
    equipment: string | null;
    mechanic: string | null;
    areaPlan: number | null;
  }>;
  weather: {
    tempC: number | null;
    windMs: number | null;
    condition: string | null;
    sprayAdvice: string | null;
    goodWindows: string[];
    optimalCount: number;
    blockedCount: number;
  };
  ndviAlerts: Array<{
    fieldName: string;
    dropPercent: number;
    zoneNote: string | null;
  }>;
  maintenanceDue: Array<{
    name: string;
    currentHours: number | null;
    nextServiceHours: number | null;
    hoursLeft: number | null;
  }>;
};

function finiteNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function displayFieldName(row: {
  name?: string | null;
  canonical_name?: string | null;
}): string {
  return (
    (row.canonical_name && String(row.canonical_name).trim()) ||
    (row.name && String(row.name).trim()) ||
    "Поле"
  );
}

export async function collectMorningBriefData(): Promise<MorningBriefPayload> {
  const supabase = createServiceSupabase();
  const today = todayKyivYmd();
  const tomorrow = shiftKyivYmd(today, 1);

  const [opsRes, ndviRes, eqRes] = await Promise.all([
    supabase
      .from("field_operations")
      .select(
        "id, work_type, status, area_plan, machinery, mechanic_name, occurred_at, farm_fields ( name, canonical_name )"
      )
      .gte("occurred_at", `${today}T00:00:00`)
      .lt("occurred_at", `${tomorrow}T00:00:00`)
      .in("status", ["planned", "assigned", "in_progress"])
      .order("occurred_at", { ascending: true })
      .limit(40),
    supabase
      .from("field_ndvi_alerts")
      .select(
        "drop_percent, zone_note, farm_fields ( name, canonical_name )"
      )
      .eq("is_active", true)
      .order("detected_at", { ascending: false })
      .limit(15),
    supabase
      .from("equipment")
      .select(
        "id, name, current_motohours, next_service_motohours, maintenance_status, is_active"
      )
      .neq("is_active", false)
      .not("next_service_motohours", "is", null)
      .limit(200),
  ]);

  const plannedOps = (opsRes.data ?? []).map((row) => {
    const fieldRel = row.farm_fields as
      | { name?: string | null; canonical_name?: string | null }
      | { name?: string | null; canonical_name?: string | null }[]
      | null;
    const field = Array.isArray(fieldRel) ? fieldRel[0] : fieldRel;
    return {
      fieldName: field ? displayFieldName(field) : "—",
      workType: String(row.work_type ?? "Робота"),
      status: String(row.status ?? ""),
      equipment: row.machinery ? String(row.machinery) : null,
      mechanic: row.mechanic_name ? String(row.mechanic_name) : null,
      areaPlan:
        row.area_plan != null ? finiteNumber(row.area_plan) || null : null,
    };
  });

  const ndviAlerts = (ndviRes.data ?? []).map((row) => {
    const fieldRel = row.farm_fields as
      | { name?: string | null; canonical_name?: string | null }
      | { name?: string | null; canonical_name?: string | null }[]
      | null;
    const field = Array.isArray(fieldRel) ? fieldRel[0] : fieldRel;
    return {
      fieldName: field ? displayFieldName(field) : "—",
      dropPercent: finiteNumber(row.drop_percent),
      zoneNote: row.zone_note ? String(row.zone_note) : null,
    };
  });

  const maintenanceDue = (eqRes.data ?? [])
    .map((row) => {
      const current =
        row.current_motohours != null
          ? finiteNumber(row.current_motohours)
          : null;
      const next =
        row.next_service_motohours != null
          ? finiteNumber(row.next_service_motohours)
          : null;
      const hoursLeft =
        current != null && next != null ? next - current : null;
      return {
        name: String(row.name ?? "Техніка"),
        currentHours: current,
        nextServiceHours: next,
        hoursLeft,
      };
    })
    .filter(
      (row) =>
        row.hoursLeft != null &&
        row.hoursLeft <= TO_HOURS_LEFT_THRESHOLD
    )
    .sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0))
    .slice(0, 12);

  let weather: MorningBriefPayload["weather"] = {
    tempC: null,
    windMs: null,
    condition: null,
    sprayAdvice: null,
    goodWindows: [],
    optimalCount: 0,
    blockedCount: 0,
  };

  try {
    const { latitude, longitude } = DEFAULT_WEATHER_LOCATION;
    const [current, planning] = await Promise.all([
      fetchWeather(latitude, longitude),
      fetchPlanningWeather(latitude, longitude),
    ]);
    const window = evaluateSprayingWeatherWindow(planning.hourly, {
      hoursAhead: 24,
    });
    weather = {
      tempC: current.tempC,
      windMs: current.windMs,
      condition: current.condition,
      sprayAdvice: window.advice,
      goodWindows: window.goodWindows.slice(0, 4).map(
        (w) => `${w.from}–${w.to} (${w.verdict})`
      ),
      optimalCount: window.optimalCount,
      blockedCount: window.blockedCount,
    };
  } catch (err) {
    console.warn(
      "[morning-brief] weather:",
      err instanceof Error ? err.message : err
    );
  }

  return {
    date: today,
    plannedOps,
    weather,
    ndviAlerts,
    maintenanceDue,
  };
}

function buildFactsBlock(data: MorningBriefPayload): string {
  const lines: string[] = [
    `Дата (Kyiv): ${data.date}`,
    `Планові роботи сьогодні: ${data.plannedOps.length}`,
  ];
  for (const op of data.plannedOps.slice(0, 12)) {
    lines.push(
      `- ${op.workType} · ${op.fieldName}` +
        (op.equipment ? ` · ${op.equipment}` : "") +
        (op.mechanic ? ` · ${op.mechanic}` : "") +
        (op.areaPlan ? ` · ${op.areaPlan} га` : "") +
        ` [${op.status}]`
    );
  }

  lines.push(
    `Погода: ${data.weather.tempC ?? "?"}°C, вітер ${data.weather.windMs ?? "?"} м/с, ${data.weather.condition ?? "—"}`
  );
  lines.push(`Обприскування: ${data.weather.sprayAdvice ?? "немає оцінки"}`);
  if (data.weather.goodWindows.length) {
    lines.push(`Вікна ЗЗР: ${data.weather.goodWindows.join("; ")}`);
  }
  lines.push(
    `NDVI-тривоги: ${data.ndviAlerts.length}` +
      (data.ndviAlerts.length
        ? ` — ${data.ndviAlerts
            .slice(0, 5)
            .map((a) => `${a.fieldName} −${a.dropPercent}%`)
            .join("; ")}`
        : "")
  );
  lines.push(`ТО < ${TO_HOURS_LEFT_THRESHOLD} мотогодин: ${data.maintenanceDue.length}`);
  for (const m of data.maintenanceDue.slice(0, 8)) {
    lines.push(
      `- ${m.name}: лишилось ${m.hoursLeft?.toFixed(0) ?? "?"} мотогодин`
    );
  }
  return lines.join("\n");
}

export async function generateMorningBriefText(
  data: MorningBriefPayload
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return fallbackBriefText(data);
  }

  const modelId =
    process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || "gemini-3.7-flash";
  const google = createGoogleGenerativeAI({ apiKey });
  const facts = buildFactsBlock(data);

  try {
    const result = await generateText({
      model: google(modelId),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
            includeThoughts: false,
          },
        },
      },
      prompt: [
        "Сформуй чітке, заряджене ранкове зведення диспетчера для керівника на 5-6 рядків з емодзі.",
        "Мова: українська. Без канцеляриту. Лише факти з блоку нижче — нічого не вигадуй.",
        "Структура: привітання/дата → план робіт → погода/ЗЗР → NDVI → ТО техніки → короткий заклик до дії.",
        "",
        "ДАНІ:",
        facts,
      ].join("\n"),
    });
    const text = result.text.trim();
    return text || fallbackBriefText(data);
  } catch (err) {
    console.error(
      "[morning-brief] Gemini:",
      err instanceof Error ? err.message : err
    );
    return fallbackBriefText(data);
  }
}

function fallbackBriefText(data: MorningBriefPayload): string {
  const sprayOk = data.weather.optimalCount > 0;
  return [
    `🌅 LEVADIUS · ранок ${data.date}`,
    `📋 У зміні: ${data.plannedOps.length} робіт` +
      (data.plannedOps[0]
        ? ` (перша: ${data.plannedOps[0].workType} · ${data.plannedOps[0].fieldName})`
        : ""),
    `🌤️ ${data.weather.tempC ?? "?"}°C, вітер ${data.weather.windMs ?? "?"} м/с` +
      (sprayOk ? " · є вікно для ЗЗР" : " · ЗЗР обмежено"),
    data.ndviAlerts.length
      ? `🛰️ NDVI: ${data.ndviAlerts.length} тривог (топ: ${data.ndviAlerts[0]!.fieldName} −${data.ndviAlerts[0]!.dropPercent}%)`
      : "🛰️ NDVI: критичних тривог немає",
    data.maintenanceDue.length
      ? `🔧 ТО скоро: ${data.maintenanceDue
          .slice(0, 3)
          .map((m) => `${m.name} (${m.hoursLeft?.toFixed(0)} м/г)`)
          .join(", ")}`
      : "🔧 Техніка з ТО <15 м/г: немає",
    "✅ Перевірте план зміни в LEVADIUS перед виїздом.",
  ].join("\n");
}

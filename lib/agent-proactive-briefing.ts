/**
 * Оперативне зведення зміни LEVADIUS — проактивний вхідний бриф диспетчера.
 */

import "server-only";

import {
  checkPredictiveRefuelNeeds,
  checkWeatherRiskForActiveJobs,
} from "@/lib/agent-smart-dispatch";
import { resolveFuelTankVolumeLiters } from "@/lib/equipment-fuel-tanks";
import { findUnrecordedRefuelings } from "@/lib/fuel-unrecorded-refuelings";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getCachedWialonUnitsFull } from "@/lib/wialon-live-cache";
import {
  hasValidWialonPosition,
  parseWialonUnitTelemetry,
  type WialonUnit,
} from "@/lib/wialon";

const LOW_FUEL_PCT = 15;
const LOOKBACK_HOURS = 12;

export type ProactiveBriefPriority = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

export type ProactiveBriefAction = {
  id: string;
  label: string;
  /** Текст, який піде в чат як відповідь користувача */
  prompt: string;
};

export type ProactiveBriefing = {
  ok: true;
  generatedAt: string;
  tone: "alert" | "calm";
  headline: string;
  summary: string;
  priorities: ProactiveBriefPriority[];
  actions: ProactiveBriefAction[];
  stats: {
    machinesInField: number;
    lowFuelCount: number;
    radarUnrecordedCount: number;
    weatherRiskCount: number;
    lookbackHours: number;
  };
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function countMachinesInField(): Promise<number> {
  const supabase = createServiceSupabase();
  const { count, error } = await supabase
    .from("field_operations")
    .select("id", { count: "exact", head: true })
    .eq("status", "in_progress");
  if (error) {
    console.warn("[proactive-briefing] in_progress count", error.message);
    return 0;
  }
  return count ?? 0;
}

type LowFuelHit = {
  equipmentName: string;
  pct: number;
  liters: number;
  tankL: number;
};

async function findCriticalFuelTanks(): Promise<LowFuelHit[]> {
  const supabase = createServiceSupabase();
  const { data: equipment, error } = await supabase
    .from("equipment")
    .select("id, name, wialon_id, fuel_tank_volume, is_active")
    .eq("is_active", true)
    .not("wialon_id", "is", null)
    .limit(200);

  if (error) {
    console.warn("[proactive-briefing] equipment", error.message);
    return [];
  }

  let units: WialonUnit[] = [];
  try {
    const live = await getCachedWialonUnitsFull();
    units = live.units ?? [];
  } catch (err) {
    console.warn(
      "[proactive-briefing] wialon",
      err instanceof Error ? err.message : err
    );
    return [];
  }

  const byId = new Map(units.map((u) => [Number(u.id), u]));
  const hits: LowFuelHit[] = [];

  for (const row of equipment ?? []) {
    const wid = Number(row.wialon_id);
    if (!(wid > 0)) continue;
    const unit = byId.get(wid);
    if (!unit || !hasValidWialonPosition(unit)) continue;

    const telemetry = parseWialonUnitTelemetry(unit);
    const liters = telemetry.fuelLiters;
    if (liters == null || !(liters >= 0)) continue;

    const tankFromDb =
      row.fuel_tank_volume != null && Number(row.fuel_tank_volume) > 0
        ? Number(row.fuel_tank_volume)
        : null;
    const tankL =
      tankFromDb ??
      resolveFuelTankVolumeLiters(String(row.name ?? ""), unit.nm ?? "") ??
      null;
    if (tankL == null || !(tankL > 0)) continue;

    const pct = (liters / tankL) * 100;
    if (pct >= LOW_FUEL_PCT) continue;

    hits.push({
      equipmentName: String(row.name ?? unit.nm ?? "Техніка"),
      pct: round1(pct),
      liters: round1(liters),
      tankL: Math.round(tankL),
    });
  }

  hits.sort((a, b) => a.pct - b.pct);
  return hits;
}

function buildActions(input: {
  lowFuelCount: number;
  radarCount: number;
  weatherCount: number;
  machinesInField: number;
}): ProactiveBriefAction[] {
  const actions: ProactiveBriefAction[] = [];

  if (input.radarCount > 0) {
    actions.push({
      id: "radar",
      label: "Перевірити радар палива",
      prompt: "Покажи невраховані заправки в радарі DUT",
    });
  }
  if (input.lowFuelCount > 0) {
    actions.push({
      id: "fuel-scout",
      label: "Паливний штурман",
      prompt: "Кому скоро кінчиться ДП у полі?",
    });
  }
  if (input.weatherCount > 0) {
    actions.push({
      id: "weather",
      label: "Погода на вечір",
      prompt: "Перевір погодні ризики для відкритих нарядів",
    });
  }
  if (input.machinesInField > 0) {
    actions.push({
      id: "fleet-day",
      label: "Зведення дня флоту",
      prompt: "Зведення парку за сьогодні: простої, зливи, мотогодини",
    });
  }

  // Завжди мати 2–3 дії
  const defaults: ProactiveBriefAction[] = [
    {
      id: "radar-default",
      label: "Перевірити радар палива",
      prompt: "Покажи невраховані заправки в радарі DUT",
    },
    {
      id: "fleet-default",
      label: "Зведення дня флоту",
      prompt: "Зведення парку за сьогодні",
    },
    {
      id: "weather-default",
      label: "Погода на вечір",
      prompt: "Яка погода на активні наряди на найближчі години?",
    },
  ];

  for (const d of defaults) {
    if (actions.length >= 3) break;
    if (actions.some((a) => a.id === d.id || a.label === d.label)) continue;
    actions.push(d);
  }

  return actions.slice(0, 3);
}

/**
 * Сканує оперативну картину (≈12 год контексту) і формує бриф диспетчера.
 */
export async function getProactiveBriefing(): Promise<ProactiveBriefing> {
  const supabase = createServiceSupabase();

  const [
    machinesInField,
    lowFuelHits,
    radarEvents,
    weather,
    predictive,
  ] = await Promise.all([
    countMachinesInField(),
    findCriticalFuelTanks(),
    findUnrecordedRefuelings({ lookbackHours: LOOKBACK_HOURS }).catch((err) => {
      console.warn(
        "[proactive-briefing] radar",
        err instanceof Error ? err.message : err
      );
      return [];
    }),
    checkWeatherRiskForActiveJobs({ supabase }).catch((err) => {
      console.warn(
        "[proactive-briefing] weather",
        err instanceof Error ? err.message : err
      );
      return { ok: true as const, checked: 0, alerts: [], message: "" };
    }),
    checkPredictiveRefuelNeeds({ supabase }).catch((err) => {
      console.warn(
        "[proactive-briefing] predictive",
        err instanceof Error ? err.message : err
      );
      return { ok: true as const, checked: 0, alerts: [], message: "" };
    }),
  ]);

  const priorities: ProactiveBriefPriority[] = [];

  for (const hit of lowFuelHits.slice(0, 5)) {
    priorities.push({
      id: `fuel-pct-${hit.equipmentName}`,
      severity: hit.pct < 10 ? "critical" : "warning",
      title: `Бак ${hit.pct}% · ${hit.equipmentName}`,
      detail: `${hit.liters} л з ${hit.tankL} л — нижче ${LOW_FUEL_PCT}%`,
    });
  }

  for (const a of predictive.alerts.slice(0, 3)) {
    const key = `fuel-eta-${a.equipmentId}`;
    if (priorities.some((p) => p.id === key)) continue;
    priorities.push({
      id: key,
      severity: "warning",
      title: `Паливо на межі · ${a.equipmentName}`,
      detail:
        a.alertMessage ||
        `Залишилось ≈${a.hoursLeft} год · ${a.currentFuel} л`,
    });
  }

  if (radarEvents.length > 0) {
    const top = radarEvents
      .slice(0, 3)
      .map((e) => `${e.equipmentName} +${Math.round(e.volume)} л`)
      .join("; ");
    priorities.push({
      id: "radar",
      severity: radarEvents.length >= 3 ? "critical" : "warning",
      title: `Радар DUT: ${radarEvents.length} неврахованих заправок`,
      detail: top || "Потрібне рішення оператора",
    });
  }

  for (const w of weather.alerts.slice(0, 4)) {
    priorities.push({
      id: `wx-${w.operationId}`,
      severity: "warning",
      title: `Погода · ${w.fieldName}`,
      detail:
        w.alertMessage ||
        `${w.operationType}${w.urgentAction ? ` · ${w.urgentAction}` : ""}`,
    });
  }

  const lowFuelCount = lowFuelHits.length;
  const radarUnrecordedCount = radarEvents.length;
  const weatherRiskCount = weather.alerts.length;
  const hasIssues =
    lowFuelCount > 0 ||
    radarUnrecordedCount > 0 ||
    weatherRiskCount > 0 ||
    predictive.alerts.length > 0;

  const actions = buildActions({
    lowFuelCount,
    radarCount: radarUnrecordedCount,
    weatherCount: weatherRiskCount,
    machinesInField,
  });

  if (!hasIssues) {
    const summary = `Диспетчер на зміні. У полі ${machinesInField} ${
      machinesInField === 1 ? "агрегат" : machinesInField < 5 ? "агрегати" : "агрегатів"
    }, відхилень по паливу та погоді немає. Працюємо за планом.`;
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      tone: "calm",
      headline: "Оперативне зведення зміни",
      summary,
      priorities: [
        {
          id: "all-clear",
          severity: "info",
          title: "Контроль у нормі",
          detail: "Критичних баків, DUT-радар і штормових ризиків немає.",
        },
      ],
      actions,
      stats: {
        machinesInField,
        lowFuelCount: 0,
        radarUnrecordedCount: 0,
        weatherRiskCount: 0,
        lookbackHours: LOOKBACK_HOURS,
      },
    };
  }

  const parts: string[] = [
    `Прийнято зміну. У полі ${machinesInField} ${
      machinesInField === 1 ? "агрегат" : "агрегатів"
    }.`,
  ];
  if (lowFuelCount > 0) {
    parts.push(`Критичний бак (<${LOW_FUEL_PCT}%): ${lowFuelCount}.`);
  }
  if (radarUnrecordedCount > 0) {
    parts.push(`Радар DUT без рішення: ${radarUnrecordedCount}.`);
  }
  if (weatherRiskCount > 0) {
    parts.push(`Погодний ризик на відкритих нарядах: ${weatherRiskCount}.`);
  }
  parts.push("Тримаю на контролі — пріоритети нижче.");

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    tone: "alert",
    headline: "Оперативне зведення зміни",
    summary: parts.join(" "),
    priorities: priorities.slice(0, 8),
    actions,
    stats: {
      machinesInField,
      lowFuelCount,
      radarUnrecordedCount,
      weatherRiskCount,
      lookbackHours: LOOKBACK_HOURS,
    },
  };
}

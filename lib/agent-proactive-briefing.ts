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
import { ukPlural, ukSuspicionLabel } from "@/lib/uk-plural";
import {
  hasValidWialonPosition,
  parseWialonUnitTelemetry,
  type WialonUnit,
} from "@/lib/wialon";

const LOW_FUEL_PCT = 15;
const LOOKBACK_HOURS = 12;

function shortEquipmentName(name: string, max = 28): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

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
  topRadarName?: string | null;
  topRadarLiters?: number | null;
}): ProactiveBriefAction[] {
  const actions: ProactiveBriefAction[] = [];
  const radarName = input.topRadarName?.trim() || null;
  const radarL =
    input.topRadarLiters != null && Number.isFinite(input.topRadarLiters)
      ? Math.round(input.topRadarLiters)
      : null;

  if (input.radarCount === 1 && radarName) {
    const short = shortEquipmentName(radarName);
    actions.push({
      id: "radar",
      label: `Розберемо ${short}?`,
      prompt: radarL
        ? `Розбери підозру радара по «${radarName}» (+${radarL} л): запропонуй зафіксувати в облік або відхилити як хибне спрацювання`
        : `Розбери підозру радара по «${radarName}»: запропонуй зафіксувати в облік або відхилити як хибне спрацювання`,
    });
  } else if (input.radarCount > 1) {
    actions.push({
      id: "radar",
      label: "З найбільшого об'єму?",
      prompt:
        "Покажи підозри на заправку повз облік, почни з найбільшого об'єму і запропонуй що робити з першою",
    });
  } else if (input.radarCount > 0) {
    actions.push({
      id: "radar",
      label: "Розберемо радар?",
      prompt:
        "Покажи підозри на заправку повз облік і запропонуй зафіксувати або відхилити",
    });
  }
  if (input.lowFuelCount > 0) {
    actions.push({
      id: "fuel-scout",
      label: "Кому кінчиться ДП?",
      prompt: "Кому скоро кінчиться ДП у полі? Запропонуй кого заправити першим",
    });
  }
  if (input.weatherCount > 0) {
    actions.push({
      id: "weather",
      label: "Що з погодою?",
      prompt:
        "Перевір погодні ризики для відкритих нарядів і скажи, чи варто згортати роботу",
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
      label: "Радар палива",
      prompt:
        "Покажи підозри на заправку повз облік і запропонуй наступний крок",
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

function buildAlertSummary(input: {
  machinesInField: number;
  lowFuelCount: number;
  radarCount: number;
  weatherCount: number;
  topRadarName?: string | null;
  topRadarLiters?: number | null;
  topLowFuelName?: string | null;
}): string {
  const {
    machinesInField,
    lowFuelCount,
    radarCount,
    weatherCount,
    topRadarName,
    topRadarLiters,
    topLowFuelName,
  } = input;

  const radarName = topRadarName?.trim() || null;
  const liters =
    topRadarLiters != null && Number.isFinite(topRadarLiters)
      ? Math.round(topRadarLiters)
      : null;

  // Одна підозра — без «по черзі», одразу питання з вибором
  if (radarCount === 1 && lowFuelCount === 0 && weatherCount === 0) {
    if (radarName && liters != null) {
      return `Радар зловив доливання повз облік: «${radarName}» +${liters} л. Зафіксуємо в облік чи це хибне спрацювання?`;
    }
    if (radarName) {
      return `Радар зловив доливання повз облік на «${radarName}». Зафіксуємо в облік чи відхилимо?`;
    }
    return `Є 1 підозра повз облік. Зафіксуємо в облік чи відхилимо як хибне спрацювання?`;
  }

  if (radarCount === 1 && radarName) {
    const extra: string[] = [];
    if (lowFuelCount > 0) {
      extra.push(
        `${lowFuelCount} ${ukPlural(lowFuelCount, "бак", "баки", "баків")} на межі`
      );
    }
    if (weatherCount > 0) {
      extra.push(
        `погода тисне на ${weatherCount} ${ukPlural(weatherCount, "наряд", "наряди", "нарядів")}`
      );
    }
    const litersBit = liters != null ? ` (+${liters} л)` : "";
    const extraBit = extra.length ? ` Плюс: ${extra.join(", ")}.` : "";
    return `Спочатку радар: «${radarName}»${litersBit} повз облік.${extraBit} Зафіксувати чи відхилити?`;
  }

  const bits: string[] = [];
  if (machinesInField > 0) bits.push(`${machinesInField} у полі`);
  if (lowFuelCount > 0) {
    bits.push(
      `${lowFuelCount} ${ukPlural(lowFuelCount, "критичний бак", "критичні баки", "критичних баків")}`
    );
  }
  if (radarCount > 0) {
    bits.push(`${ukSuspicionLabel(radarCount)} повз облік`);
  }
  if (weatherCount > 0) {
    bits.push(
      `погода тисне на ${weatherCount} ${ukPlural(weatherCount, "наряд", "наряди", "нарядів")}`
    );
  }

  // Кілька підозр — конкретне питання, не «по черзі»
  if (radarCount > 1 && lowFuelCount === 0 && weatherCount === 0) {
    return `Дивись: ${ukSuspicionLabel(radarCount)} повз облік. З чого почнемо — з найбільшого об'єму?`;
  }

  if (lowFuelCount > 0 && radarCount === 0 && weatherCount === 0) {
    const who = topLowFuelName ? ` («${shortEquipmentName(topLowFuelName)}»)` : "";
    return `Дивись: ${lowFuelCount} ${ukPlural(lowFuelCount, "бак", "баки", "баків")} на межі${who}. Кого заправити першим?`;
  }

  if (weatherCount > 0 && radarCount === 0 && lowFuelCount === 0) {
    return `Дивись: погода тисне на ${weatherCount} ${ukPlural(weatherCount, "наряд", "наряди", "нарядів")}. Глянемо, чи згортати роботу?`;
  }

  const lead = bits.length ? `Дивись: ${bits.join(", ")}.` : "Є нюанси по зміні.";
  if (radarCount > 0) {
    return `${lead} Почнемо з радара — показати першу підозру?`;
  }
  if (lowFuelCount > 0) {
    return `${lead} Кого з критичних баків заправити першим?`;
  }
  return `${lead} З чого почнемо?`;
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
      title:
        radarEvents.length === 1
          ? "Підозра на заправку повз облік"
          : `${ukSuspicionLabel(radarEvents.length)} на заправку повз облік`,
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
  const topRadar = radarEvents[0] ?? null;
  const topLowFuel = lowFuelHits[0] ?? null;
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
    topRadarName: topRadar?.equipmentName ?? null,
    topRadarLiters: topRadar?.volume ?? null,
  });

  if (!hasIssues) {
    const summary =
      machinesInField > 0
        ? `У полі ${machinesInField} — усе спокійно по паливу й погоді. Якщо щось смикне, я одразу скажу.`
        : `Поки тихо: техніки в полі немає, баків і радара без сюрпризів. Питай, якщо треба щось глянути.`;
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      tone: "calm",
      headline: "Я на зміні",
      summary,
      priorities: [],
      actions: actions.slice(0, 2),
      stats: {
        machinesInField,
        lowFuelCount: 0,
        radarUnrecordedCount: 0,
        weatherRiskCount: 0,
        lookbackHours: LOOKBACK_HOURS,
      },
    };
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    tone: "alert",
    headline: "Є нюанс по зміні",
    summary: buildAlertSummary({
      machinesInField,
      lowFuelCount,
      radarCount: radarUnrecordedCount,
      weatherCount: weatherRiskCount,
      topRadarName: topRadar?.equipmentName ?? null,
      topRadarLiters: topRadar?.volume ?? null,
      topLowFuelName: topLowFuel?.equipmentName ?? null,
    }),
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

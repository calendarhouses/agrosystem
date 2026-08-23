import { length as turfLength, lineString } from "@turf/turf";
import type { Position } from "geojson";

/** Семпл повідомлення для денної аналітики */
export type DayAnalyticsSample = {
  t: number;
  lng: number;
  lat: number;
  speed: number;
  fuelLiters: number | null;
  ignition: boolean | null;
  /** Код/ідентифікатор водія з повідомлення (якщо є) */
  driverCode: string | null;
};

export type DriverShiftSpan = {
  code: string;
  label: string;
  startUnix: number;
  endUnix: number;
};

export type FuelDrainEvent = {
  id: string;
  startUnix: number;
  endUnix: number;
  litersLost: number;
  lat: number;
  lng: number;
  confidence: "high" | "medium";
};

export type DayAnalyticsSummary = {
  distanceKm: number;
  /** Години з ignition on; якщо ignition немає — години в русі */
  workHours: number;
  hoursIdling: number;
  fuelStart: number | null;
  fuelEnd: number | null;
  fuelDelta: number | null;
  hasFuelSensor: boolean;
  hasIgnitionSensor: boolean;
  sampleCount: number;
};

export type DayAnalyticsPayload = {
  summary: DayAnalyticsSummary;
  fuelEvents: FuelDrainEvent[];
  /** Легкі семпли для клієнта (вже проріджені) */
  samples: DayAnalyticsSample[];
};

const SAMPLE_STEP_SEC = 40;
const IDLE_MIN_SEC = 2 * 60;
const IDLE_MAX_SPEED = 2;

/**
 * Детекція зливу (анти-шум Wialon/LLS):
 * датчик часто шле рівень «пачками» із запізненням — короткі стрибки
 * −30…−60 л за 0–2 хв майже завжди артефакт, а не шланг.
 */
const DRAIN_MIN_LITERS = 40;
/** Стоянка має тривати достатньо довго */
const DRAIN_PARK_MIN_SEC = 12 * 60;
/** Після падіння рівень має утриматись (підтвердження) */
const DRAIN_CONFIRM_SEC = 15 * 60;
/** Не створювати нову подію одразу після попередньої (зшивка пакетів) */
const DRAIN_COOLDOWN_SEC = 40 * 60;
/** Перші хвилини стоянки — «усадка» датчика, не беремо в baseline */
const DRAIN_SETTLE_SEC = 4 * 60;
const DRAIN_MAX_AVG_SPEED = 2;

function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Прорідження семплів: завжди перший/останній + зміни стану + крок у часі */
export function downsampleAnalyticsSamples(
  samples: DayAnalyticsSample[]
): DayAnalyticsSample[] {
  if (samples.length <= 2) return samples;

  const out: DayAnalyticsSample[] = [samples[0]];
  let lastKept = samples[0];

  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    const dt = s.t - lastKept.t;
    const fuelJump =
      s.fuelLiters != null &&
      lastKept.fuelLiters != null &&
      Math.abs(s.fuelLiters - lastKept.fuelLiters) >= 3;
    const ignChanged = s.ignition !== lastKept.ignition;
    const driverChanged = s.driverCode !== lastKept.driverCode;
    const speedClass = (v: number) => (v >= IDLE_MAX_SPEED ? 1 : 0);
    const speedChanged = speedClass(s.speed) !== speedClass(lastKept.speed);

    if (
      dt >= SAMPLE_STEP_SEC ||
      fuelJump ||
      ignChanged ||
      driverChanged ||
      speedChanged
    ) {
      out.push(s);
      lastKept = s;
    }
  }

  const last = samples[samples.length - 1];
  if (out[out.length - 1]?.t !== last.t) out.push(last);
  return out;
}

export function computeDistanceKm(samples: DayAnalyticsSample[]): number {
  const moving = samples.filter((s) => s.speed >= IDLE_MAX_SPEED);
  if (moving.length < 2) {
    // fallback: усі хаверсинові сегменти з рухом
    let km = 0;
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      if (cur.speed < IDLE_MAX_SPEED && prev.speed < IDLE_MAX_SPEED) continue;
      km += haversineKm([prev.lng, prev.lat], [cur.lng, cur.lat]);
    }
    return Math.round(km * 10) / 10;
  }

  try {
    const coords: Position[] = moving.map((s) => [s.lng, s.lat]);
    const line = lineString(coords);
    const km = turfLength(line, { units: "kilometers" });
    return Math.round(km * 10) / 10;
  } catch {
    let km = 0;
    for (let i = 1; i < moving.length; i++) {
      km += haversineKm(
        [moving[i - 1].lng, moving[i - 1].lat],
        [moving[i].lng, moving[i].lat]
      );
    }
    return Math.round(km * 10) / 10;
  }
}

function sumConditionHours(
  samples: DayAnalyticsSample[],
  predicate: (s: DayAnalyticsSample) => boolean,
  minSec: number
): number {
  if (samples.length < 2) return 0;
  let totalSec = 0;
  let runStart: number | null = null;

  const flush = (endT: number) => {
    if (runStart == null) return;
    const dur = endT - runStart;
    if (dur >= minSec) totalSec += dur;
    runStart = null;
  };

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const ok = predicate(s);
    if (ok) {
      if (runStart == null) runStart = s.t;
    } else {
      const prev = samples[i - 1];
      flush(prev?.t ?? s.t);
    }
  }
  const last = samples[samples.length - 1];
  flush(last.t);

  return Math.round((totalSec / 3600) * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Медіанне згладжування рівня палива — прибирає одиночні стрибки LLS */
function smoothFuelSeries(
  samples: Array<DayAnalyticsSample & { fuelLiters: number }>
): number[] {
  const n = samples.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const window: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
      window.push(samples[k].fuelLiters);
    }
    out[i] = median(window) ?? samples[i].fuelLiters;
  }
  return out;
}

type ParkSegment = {
  startIdx: number;
  endIdx: number;
  startUnix: number;
  endUnix: number;
};

/** Довгі стоянки — саме там шукаємо злив, не в кожному мікрострибку датчика */
function findParkingSegments(
  samples: Array<DayAnalyticsSample & { fuelLiters: number }>
): ParkSegment[] {
  const segments: ParkSegment[] = [];
  let runStart: number | null = null;

  const flush = (endIdx: number) => {
    if (runStart == null) return;
    const startUnix = samples[runStart].t;
    const endUnix = samples[endIdx].t;
    if (endUnix - startUnix >= DRAIN_PARK_MIN_SEC) {
      segments.push({
        startIdx: runStart,
        endIdx,
        startUnix,
        endUnix,
      });
    }
    runStart = null;
  };

  for (let i = 0; i < samples.length; i++) {
    const parked = samples[i].speed <= DRAIN_MAX_AVG_SPEED;
    if (parked) {
      if (runStart == null) runStart = i;
    } else {
      flush(Math.max(0, i - 1));
    }
  }
  if (runStart != null) flush(samples.length - 1);
  return segments;
}

/**
 * Злив = стійке падіння рівня на довгій стоянці, підтверджене утриманням.
 * Запізнені «пачки» Wialon зливаються в одну подію на стоянку (cooldown).
 */
export function detectFuelDrainEvents(
  samples: DayAnalyticsSample[]
): FuelDrainEvent[] {
  const withFuel = samples.filter(
    (s): s is DayAnalyticsSample & { fuelLiters: number } =>
      s.fuelLiters != null && Number.isFinite(s.fuelLiters)
  );
  if (withFuel.length < 8) return [];

  const smoothed = smoothFuelSeries(withFuel);
  const parks = findParkingSegments(withFuel);
  const events: FuelDrainEvent[] = [];

  for (const park of parks) {
    // Baseline після «усадки» датчика на початку стоянки
    const settleEndT = park.startUnix + DRAIN_SETTLE_SEC;
    const baselineVals: number[] = [];
    const endVals: number[] = [];
    let dropIdx: number | null = null;
    let peakBaseline = -Infinity;

    for (let i = park.startIdx; i <= park.endIdx; i++) {
      const t = withFuel[i].t;
      const fuel = smoothed[i];
      if (t <= settleEndT + 60) {
        baselineVals.push(fuel);
        peakBaseline = Math.max(peakBaseline, fuel);
        continue;
      }
      if (baselineVals.length === 0) {
        baselineVals.push(fuel);
        peakBaseline = fuel;
      }

      // Шукаємо перший стійкий спад відносно baseline
      const baseline = median(baselineVals) ?? peakBaseline;
      if (dropIdx == null && baseline - fuel >= DRAIN_MIN_LITERS * 0.6) {
        dropIdx = i;
      }
    }

    // Рівень у другій половині / наприкінці стоянки
    const parkMidT = park.startUnix + (park.endUnix - park.startUnix) * 0.45;
    for (let i = park.startIdx; i <= park.endIdx; i++) {
      if (withFuel[i].t >= parkMidT) endVals.push(smoothed[i]);
    }

    const baseline = median(baselineVals);
    const endLevel = median(endVals);
    if (baseline == null || endLevel == null) continue;

    const lost = baseline - endLevel;
    if (lost < DRAIN_MIN_LITERS) continue;

    // Підтвердження: після передбачуваного падіння рівень не відіграв назад
    const confirmFrom = dropIdx ?? park.startIdx;
    const confirmStartT = withFuel[confirmFrom].t;
    const confirmEndT = confirmStartT + DRAIN_CONFIRM_SEC;
    if (park.endUnix < confirmEndT) {
      // Стоянка закінчилась занадто швидко після падіння — сумнівно
      if (park.endUnix - confirmStartT < DRAIN_CONFIRM_SEC * 0.65) continue;
    }

    const confirmVals: number[] = [];
    for (let i = confirmFrom; i <= park.endIdx; i++) {
      if (withFuel[i].t >= confirmStartT && withFuel[i].t <= confirmEndT + 120) {
        confirmVals.push(smoothed[i]);
      }
    }
    const confirmMed = median(confirmVals);
    if (confirmMed == null) continue;
    // Відскок > 35% втрати = шум / заправка / калібрування
    if (confirmMed > endLevel + lost * 0.35) continue;
    if (baseline - confirmMed < DRAIN_MIN_LITERS * 0.75) continue;

    const eventStart = withFuel[confirmFrom].t;
    const eventEnd = Math.min(
      park.endUnix,
      Math.max(eventStart + 60, withFuel[park.endIdx].t)
    );

    // Зшити з попередньою подією — запізнені пакети LLS/Wialon, не новий злив
    const prev = events[events.length - 1];
    if (prev && eventStart - prev.endUnix < DRAIN_COOLDOWN_SEC) {
      prev.endUnix = Math.max(prev.endUnix, eventEnd);
      prev.litersLost = Math.round(Math.max(prev.litersLost, lost));
      prev.lat = withFuel[park.endIdx].lat;
      prev.lng = withFuel[park.endIdx].lng;
      if (lost >= 55) prev.confidence = "high";
      continue;
    }

    const confidence: "high" | "medium" =
      lost >= 55 &&
      park.endUnix - park.startUnix >= DRAIN_PARK_MIN_SEC + 10 * 60 &&
      baseline - confirmMed >= lost * 0.85
        ? "high"
        : "medium";

    events.push({
      id: `drain-${park.startUnix}-${Math.round(lost)}`,
      startUnix: eventStart,
      endUnix: eventEnd,
      litersLost: Math.round(lost),
      lat: withFuel[park.endIdx].lat,
      lng: withFuel[park.endIdx].lng,
      confidence,
    });
  }

  return events;
}

/** Стабільний старт/фініш бака: медіана країв, без одиночного «битого» семпла Wialon */
function stableFuelEndpoints(
  fuelValues: number[],
  tankVolumeLiters?: number | null
): {
  fuelStart: number | null;
  fuelEnd: number | null;
  fuelDelta: number | null;
} {
  if (fuelValues.length === 0) {
    return { fuelStart: null, fuelEnd: null, fuelDelta: null };
  }

  const edge = Math.min(5, Math.max(1, Math.floor(fuelValues.length / 4)));
  const startMed = median(fuelValues.slice(0, edge));
  const endMed = median(fuelValues.slice(-edge));
  if (startMed == null || endMed == null) {
    return { fuelStart: null, fuelEnd: null, fuelDelta: null };
  }

  const fuelStart = Math.round(startMed * 10) / 10;
  const fuelEnd = Math.round(endMed * 10) / 10;
  let fuelDelta: number | null = Math.round((fuelEnd - fuelStart) * 10) / 10;

  // Баки агротехніки рідко > ~1200 л; цистерна бензовоза — до ~8000.
  // Якщо відомий номінал бака — дельта не може бути більшою за бак×1.15.
  const tankCap: number | null =
    tankVolumeLiters != null &&
    Number.isFinite(tankVolumeLiters) &&
    tankVolumeLiters > 0
      ? tankVolumeLiters
      : null;
  const MAX_PLAUSIBLE_DELTA = tankCap != null ? tankCap * 1.15 : 900;
  const MAX_PLAUSIBLE_LEVEL = tankCap != null ? tankCap * 1.2 : 2500;

  if (fuelStart > MAX_PLAUSIBLE_LEVEL || fuelEnd > MAX_PLAUSIBLE_LEVEL) {
    return { fuelStart: null, fuelEnd: null, fuelDelta: null };
  }
  if (fuelDelta != null && Math.abs(fuelDelta) > MAX_PLAUSIBLE_DELTA) {
    fuelDelta = null;
  }

  return { fuelStart, fuelEnd, fuelDelta };
}

export function buildDayAnalyticsFromSamples(
  rawSamples: DayAnalyticsSample[],
  options?: {
    tankVolumeLiters?: number | null;
    /** Бензовоз тощо — не детектувати «злив» */
    skipFuelDrainDetection?: boolean;
  }
): DayAnalyticsPayload {
  const samples = downsampleAnalyticsSamples(rawSamples);
  const hasFuelSensor = samples.some((s) => s.fuelLiters != null);
  const hasIgnitionSensor = samples.some((s) => s.ignition != null);

  const fuelValues = samples
    .map((s) => s.fuelLiters)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const { fuelStart, fuelEnd, fuelDelta } = stableFuelEndpoints(
    fuelValues,
    options?.tankVolumeLiters
  );

  const hoursIdling = sumConditionHours(
    samples,
    (s) => {
      if (s.speed > IDLE_MAX_SPEED) return false;
      if (s.ignition === true) return true;
      if (s.ignition === false) return false;
      // без ignition: не рахуємо idle (уникаємо фейку)
      return false;
    },
    IDLE_MIN_SEC
  );

  const workHours = hasIgnitionSensor
    ? sumConditionHours(samples, (s) => s.ignition === true, 60)
    : sumConditionHours(samples, (s) => s.speed >= IDLE_MAX_SPEED, 60);

  const summary: DayAnalyticsSummary = {
    distanceKm: computeDistanceKm(samples),
    workHours,
    hoursIdling,
    fuelStart,
    fuelEnd,
    fuelDelta,
    hasFuelSensor,
    hasIgnitionSensor,
    sampleCount: samples.length,
  };

  return {
    summary,
    fuelEvents:
      hasFuelSensor && !options?.skipFuelDrainDetection
        ? detectFuelDrainEvents(samples)
        : [],
    samples,
  };
}

/** Години сесій журналу (field/road/base) — для UI підсумку */
const EMPTY_DRIVER_CODES = new Set([
  "",
  "0",
  "0000000000000000",
  "null",
  "undefined",
]);

export function normalizeDriverCode(raw: unknown): string | null {
  if (raw == null) return null;
  const code = String(raw).trim();
  if (!code || EMPTY_DRIVER_CODES.has(code.toLowerCase())) return null;
  if (/^0+$/.test(code)) return null;
  return code;
}

export function formatDriverLabel(code: string): string {
  // Довгі hex/iButton коди — коротший вигляд
  if (code.length >= 12 && /^[0-9a-fA-F]+$/.test(code)) {
    return `Механізатор · …${code.slice(-4).toUpperCase()}`;
  }
  return code;
}

/** Історія змін водія за день з аналітичних семплів */
export function buildDriverShiftHistory(
  samples: DayAnalyticsSample[]
): DriverShiftSpan[] {
  const withDriver = samples.filter((s) => s.driverCode);
  if (withDriver.length === 0) return [];

  const spans: DriverShiftSpan[] = [];
  let currentCode = withDriver[0].driverCode!;
  let startUnix = withDriver[0].t;

  for (let i = 1; i < withDriver.length; i++) {
    const s = withDriver[i];
    const code = s.driverCode!;
    if (code === currentCode) continue;
    spans.push({
      code: currentCode,
      label: formatDriverLabel(currentCode),
      startUnix,
      endUnix: withDriver[i - 1].t,
    });
    currentCode = code;
    startUnix = s.t;
  }

  const last = withDriver[withDriver.length - 1];
  spans.push({
    code: currentCode,
    label: formatDriverLabel(currentCode),
    startUnix,
    endUnix: last.t,
  });

  // Прибрати мікро-сесії < 3 хв (шум прикладення ключа)
  return spans.filter((s) => s.endUnix - s.startUnix >= 3 * 60);
}

export function hoursFromSessionSpans(
  sessions: Array<{ kind: string; startUnix: number; endUnix: number }>
): { hoursOnField: number; hoursOnRoad: number; hoursAtBase: number } {
  let field = 0;
  let road = 0;
  let base = 0;
  for (const s of sessions) {
    const h = Math.max(0, (s.endUnix - s.startUnix) / 3600);
    if (s.kind === "field") field += h;
    else if (s.kind === "base") base += h;
    else road += h;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    hoursOnField: round(field),
    hoursOnRoad: round(road),
    hoursAtBase: round(base),
  };
}

export const EMPTY_DAY_ANALYTICS: DayAnalyticsPayload = {
  summary: {
    distanceKm: 0,
    workHours: 0,
    hoursIdling: 0,
    fuelStart: null,
    fuelEnd: null,
    fuelDelta: null,
    hasFuelSensor: false,
    hasIgnitionSensor: false,
    sampleCount: 0,
  },
  fuelEvents: [],
  samples: [],
};

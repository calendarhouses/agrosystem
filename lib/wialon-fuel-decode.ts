/**
 * Єдиний декодер рівня палива з params повідомлення Wialon.
 * Техніка / карта / паливо / CRON — усі читають через ці функції.
 */

export type WialonFuelSensorLike = {
  id: number | string;
  n?: string;
  t?: string;
  p?: string;
  tbl?: Array<{ x?: number; a?: number; b?: number }>;
};

const RAW_FUEL_KEYS = [
  "fuel",
  "fuel_level",
  "rs",
  "rs485fuel",
  "adc1",
  "lls",
  "io_201",
] as const;

const MAX_PLAUSIBLE_LITERS = 12_000;

function isValidRaw(raw: number): boolean {
  return Number.isFinite(raw) && raw >= 0 && raw < 65_000;
}

function isPlausibleLiters(value: number, max = MAX_PLAUSIBLE_LITERS): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

/** Чи сконфігуровано ДУТ (тип / імʼя), без огляду на живі семпли. */
export function sensorsHaveFuelLevel(
  sensors: WialonFuelSensorLike[]
): boolean {
  return sensors.some(
    (s) =>
      s.t === "fuel level" ||
      /топлив|палив|fuel|уровень топлива|рівень палив|бак/i.test(s.n || "")
  );
}

export function listFuelSensors(
  sensors: WialonFuelSensorLike[]
): WialonFuelSensorLike[] {
  const byType = sensors.filter((s) => s.t === "fuel level");
  if (byType.length > 0) return byType;
  return sensors.filter((s) =>
    /топлив|палив|fuel|уровень топлива|рівень палив/i.test(s.n || "")
  );
}

/**
 * Калібрувальна таблиця Wialon: y = a * x + b для сегмента з найбільшим x ≤ raw.
 * (той самий алгоритм, що в історичному розборі треків)
 */
export function applySensorCalibrationTable(
  tbl: WialonFuelSensorLike["tbl"],
  raw: number
): number | null {
  if (!Array.isArray(tbl) || tbl.length === 0 || !Number.isFinite(raw)) {
    return null;
  }
  const pts = tbl
    .map((row) => ({
      x: Number(row.x),
      a: Number(row.a),
      b: Number(row.b),
    }))
    .filter((row) => Number.isFinite(row.x) && Number.isFinite(row.a))
    .sort((left, right) => left.x - right.x);
  if (!pts.length) return null;

  // raw нижче початку калібрування — це дропаут ДУТ (io=0), а не «порожній бак».
  // Без цієї перевірки другий бак «зникає» і дає фантомні −/+300 л.
  if (raw < pts[0]!.x) return null;

  // Вище таблиці — не екстраполюємо: 65532 тощо це «датчик недоступний».
  const lastX = pts[pts.length - 1]!.x;
  if (raw > lastX * 1.05) return null;
  const x = Math.min(raw, lastX);

  let segment = pts[0]!;
  for (const point of pts) {
    if (x >= point.x) segment = point;
    else break;
  }
  const value = segment.a * x + (Number.isFinite(segment.b) ? segment.b : 0);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function evaluateSensorWithParams(
  sensors: WialonFuelSensorLike[],
  sensor: WialonFuelSensorLike,
  params: Record<string, unknown>,
  depth = 0
): number | null {
  if (!sensor || depth > 6) return null;
  const key = sensor.p?.trim() ?? "";
  if (!key) return null;

  if (key.includes("[")) {
    // Сума баків: значення валідне лише коли ВСІ баки віддали рівень.
    // Частковий підсумок = фантомний злив/заправка на обʼєм «зниклого» бака.
    let sum = 0;
    let counted = 0;
    let expected = 0;
    for (const match of key.matchAll(/\[([^\]]+)\]/g)) {
      expected += 1;
      const child = sensors.find((item) => item.n === match[1]);
      if (!child) continue;
      const childValue = evaluateSensorWithParams(
        sensors,
        child,
        params,
        depth + 1
      );
      if (childValue != null && Number.isFinite(childValue)) {
        sum += childValue;
        counted += 1;
      }
    }
    if (expected === 0 || counted !== expected) return null;
    return sum;
  }

  if (!(key in params)) return null;
  const raw = Number(params[key]);
  if (!isValidRaw(raw)) return null;
  if (sensor.tbl?.length) {
    return applySensorCalibrationTable(sensor.tbl, raw);
  }
  return raw;
}

/** Калібровані літри з params (без сирого ADC як «літри»). */
export function readCalibratedFuelFromParams(
  sensors: WialonFuelSensorLike[],
  params: Record<string, unknown>,
  maxPlausible = MAX_PLAUSIBLE_LITERS
): number | null {
  for (const sensor of listFuelSensors(sensors)) {
    const value = evaluateSensorWithParams(sensors, sensor, params);
    if (value != null && isPlausibleLiters(value, maxPlausible)) {
      return Math.round(value * 10) / 10;
    }
  }
  return null;
}

/** Сирі іменовані ключі (fallback, коли немає таблиці датчиків). */
export function readRawFuelFromParams(
  params: Record<string, unknown>
): number | null {
  for (const key of RAW_FUEL_KEYS) {
    if (!(key in params)) continue;
    const raw = Number(params[key]);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
  }
  for (const [key, value] of Object.entries(params)) {
    if (!/fuel|палив|топлив|lls|^rs$/i.test(key)) continue;
    const raw = Number(value);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
  }
  return null;
}

/**
 * Єдина точка читання літрів з params повідомлення.
 * 1) калібровка ДУТ (якщо є sensors)
 * 2) інакше — іменовані fuel/lls ключі
 */
export function readFuelLitersFromParams(
  params: Record<string, unknown>,
  sensors: WialonFuelSensorLike[] = []
): number | null {
  if (sensors.length > 0 && sensorsHaveFuelLevel(sensors)) {
    return readCalibratedFuelFromParams(sensors, params);
  }
  return readRawFuelFromParams(params);
}

export type TimedFuelSample = {
  t: number;
  liters: number;
  lat?: number | null;
  lng?: number | null;
};

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Медіанне згладжування рівня — прибирає «плюскіт» у баку під час роботи.
 * Спільне для детекції заправок і розрахунку витрати, щоб цифри збігались.
 */
export function smoothFuelSamples<T extends { liters: number }>(
  samples: T[],
  radius = 2
): T[] {
  if (samples.length <= 2 || radius < 1) return samples;
  return samples.map((sample, i) => {
    const window: number[] = [];
    for (
      let k = Math.max(0, i - radius);
      k <= Math.min(samples.length - 1, i + radius);
      k++
    ) {
      window.push(samples[k]!.liters);
    }
    const med = medianOf(window);
    return med == null
      ? sample
      : { ...sample, liters: Math.round(med * 10) / 10 };
  });
}

/** Медіана значень у часовому вікні [fromT, toT]. */
export function medianInWindow(
  samples: Array<{ t: number; liters: number }>,
  fromT: number,
  toT: number
): number | null {
  const vals: number[] = [];
  for (const s of samples) {
    if (s.t < fromT) continue;
    if (s.t > toT) break;
    vals.push(s.liters);
  }
  return medianOf(vals);
}

/** Мін. приріст рівня (л) = заправка, не шум датчика */
const MIN_FILL_L = 30;
/** Більше за це — сміття датчика, не заправка */
const MAX_FILL_L = 900;
/** Приріст між семплами, з якого починаємо вважати підйом */
const FILL_RISE_STEP_L = 1;
/** Допустиме просідання всередині заправки (л) */
const FILL_SAG_L = 3;
/** Пауза без росту, після якої заправка вважається завершеною (сек) */
const FILL_FLAT_BREAK_SEC = 6 * 60;
/** Максимальна тривалість однієї заправки (сек) */
const FILL_MAX_DURATION_SEC = 45 * 60;
/** Вікно для рівня «до» і «після» заправки (сек) */
const FILL_LEVEL_WINDOW_SEC = 10 * 60;

export type FuelFill = {
  /** Індекс семпла на піку заправки (у вихідному масиві) */
  index: number;
  startT: number;
  endT: number;
  volume: number;
};

/**
 * Заправки з ряду ДУТ: обʼєм = медіана рівня після − медіана рівня до.
 *
 * Єдина точка для техніки, полів і журналу палива. Рахуємо по згладженому
 * ряду: плюскіт палива в баку під час роботи дає ±25 л і без цього
 * рахувався б як заправка.
 */
export function detectFuelFills(
  samples: Array<{ t: number; liters: number }>
): FuelFill[] {
  if (samples.length < 5) return [];

  const smoothed = smoothFuelSamples(samples, 2);
  const n = smoothed.length;
  const fills: FuelFill[] = [];

  let i = 0;
  while (i < n - 1) {
    if (smoothed[i + 1]!.liters - smoothed[i]!.liters < FILL_RISE_STEP_L) {
      i += 1;
      continue;
    }

    const startT = smoothed[i]!.t;
    let cursor = i;
    let topIdx = i;
    while (cursor + 1 < n) {
      const next = smoothed[cursor + 1]!;
      if (next.t - startT > FILL_MAX_DURATION_SEC) break;
      if (next.liters < smoothed[cursor]!.liters - FILL_SAG_L) break;
      if (next.liters > smoothed[topIdx]!.liters) topIdx = cursor + 1;
      if (next.t - smoothed[topIdx]!.t > FILL_FLAT_BREAK_SEC) break;
      cursor += 1;
    }

    const endT = smoothed[topIdx]!.t;
    const before =
      medianInWindow(smoothed, startT - FILL_LEVEL_WINDOW_SEC, startT) ??
      smoothed[i]!.liters;
    const after =
      medianInWindow(smoothed, endT, endT + FILL_LEVEL_WINDOW_SEC) ??
      smoothed[topIdx]!.liters;
    const volume = Math.round((after - before) * 10) / 10;

    if (volume >= MIN_FILL_L && volume <= MAX_FILL_L) {
      const prev = fills[fills.length - 1];
      // Заправка «сходинками»: вікна до/після перекриваються і та сама
      // заливка інакше потрапляє в список двічі.
      if (prev && startT - prev.endT <= FILL_LEVEL_WINDOW_SEC) {
        const merged =
          Math.round(
            (after -
              (medianInWindow(
                smoothed,
                prev.startT - FILL_LEVEL_WINDOW_SEC,
                prev.startT
              ) ??
                after - prev.volume - volume)) *
              10
          ) / 10;
        prev.endT = endT;
        prev.index = topIdx;
        prev.volume = Math.min(
          MAX_FILL_L,
          Math.max(prev.volume, merged)
        );
      } else {
        fills.push({ index: topIdx, startT, endT, volume });
      }
      i = topIdx + 1;
      continue;
    }

    i += 1;
  }

  return fills;
}

/**
 * Витрата за ДРП на інтервалі: (рівень_старт − рівень_фініш) + заправки.
 * Краї беремо з медіани, щоб один «битий» семпл не зсував результат.
 */
export function fuelConsumedFromSamples(
  samples: Array<{ t: number; liters: number }>
): { consumed: number | null; start: number | null; end: number | null; filled: number } {
  if (samples.length < 2) {
    return { consumed: null, start: null, end: null, filled: 0 };
  }
  const smoothed = smoothFuelSamples(samples, 2);
  const edge = Math.min(5, Math.max(1, Math.floor(smoothed.length / 4)));
  const start = medianOf(smoothed.slice(0, edge).map((s) => s.liters));
  const end = medianOf(smoothed.slice(-edge).map((s) => s.liters));
  const filled =
    Math.round(
      detectFuelFills(samples).reduce((acc, f) => acc + f.volume, 0) * 10
    ) / 10;

  if (start == null || end == null) {
    return { consumed: null, start, end, filled };
  }
  const consumed = Math.round((start - end + filled) * 10) / 10;
  return {
    consumed,
    start: Math.round(start * 10) / 10,
    end: Math.round(end * 10) / 10,
    filled,
  };
}

type MessageLike = {
  t?: number;
  p?: Record<string, unknown> | unknown;
  pos?: { x?: number; y?: number } | null;
};

function readMessageParams(msg: MessageLike): Record<string, unknown> {
  const p = msg.p;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

/**
 * Часові семпли палива з історії повідомлень (спільний для field/radar/FLS).
 */
export function extractTimedFuelSamples(
  messages: MessageLike[],
  sensors: WialonFuelSensorLike[] = [],
  options?: { includePosition?: boolean }
): TimedFuelSample[] {
  const out: TimedFuelSample[] = [];
  for (const msg of messages) {
    const t = typeof msg.t === "number" && Number.isFinite(msg.t) ? msg.t : null;
    if (t == null || t <= 0) continue;
    const liters = readFuelLitersFromParams(readMessageParams(msg), sensors);
    if (liters == null) continue;
    const sample: TimedFuelSample = { t, liters };
    if (options?.includePosition) {
      const pos = msg.pos;
      const lng = pos != null ? Number(pos.x) : NaN;
      const lat = pos != null ? Number(pos.y) : NaN;
      if (Number.isFinite(lng) && Number.isFinite(lat) && lng > 0 && lat > 0) {
        sample.lng = lng;
        sample.lat = lat;
      } else {
        sample.lng = null;
        sample.lat = null;
      }
    }
    out.push(sample);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

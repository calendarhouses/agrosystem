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

  let segment = pts[0]!;
  for (const point of pts) {
    if (raw >= point.x) segment = point;
    else break;
  }
  const value =
    segment.a * raw + (Number.isFinite(segment.b) ? segment.b : 0);
  return Number.isFinite(value) ? value : null;
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
    let sum = 0;
    let ok = false;
    for (const match of key.matchAll(/\[([^\]]+)\]/g)) {
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
        ok = true;
      }
    }
    return ok ? sum : null;
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

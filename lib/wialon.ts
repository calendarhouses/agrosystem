/**
 * Wialon Hosting — ВИКЛЮЧНО READ-ONLY.
 * Дозволені svc: token/login, core/search_items, resource/get_zone_data,
 * unit/calc_last_message, messages/load_interval (історія треку).
 * (get_zone_data потрібен: search_items з flags=4097 не віддає точки полігонів.)
 * Заборонено: create / update / delete / будь-які мутації.
 */

import type {
  Feature,
  FeatureCollection,
  LineString,
  Polygon,
  Position,
} from "geojson";

import {
  buildDayAnalyticsFromSamples,
  EMPTY_DAY_ANALYTICS,
  normalizeDriverCode,
  type DayAnalyticsPayload,
  type DayAnalyticsSample,
} from "@/lib/equipment-day-analytics";

export type {
  DayAnalyticsPayload,
  DayAnalyticsSample,
  DayAnalyticsSummary,
  FuelDrainEvent,
} from "@/lib/equipment-day-analytics";

const WIALON_API_URL = "https://hst-api.wialon.com/wialon/ajax.html";

/**
 * Base (1) + Last message (1024) + Sensors (4096) + Counters (8192)
 * = 13313 — pos, lmsg, sens, cnm/cneh
 */
export const WIALON_UNIT_FLAGS_TELEMETRY = 13313;

/** @deprecated використовуйте WIALON_UNIT_FLAGS_TELEMETRY */
export const WIALON_UNIT_FLAGS_BASIC_POS = WIALON_UNIT_FLAGS_TELEMETRY;

/** Базовий прапор + геозони (1 | 4096) */
export const WIALON_RESOURCE_FLAGS_ZONES = 4097;

/** Середній обʼєм бака трактора (л), якщо точний не передається */
export const DEFAULT_TRACTOR_TANK_LITERS = 800;

const DEFAULT_GEOFENCE_COLOR = "#C05621";

export type WialonErrorResponse = {
  error: number;
  reason?: string;
};

export type WialonLoginResponse = {
  eid: string;
  user?: {
    id: number;
    nm: string;
  };
};

export type WialonPosition = {
  t: number;
  y: number;
  x: number;
  z?: number;
  s?: number;
  c?: number;
  sc?: number;
};

export type WialonSensor = {
  id: number;
  n: string;
  t: string;
  d?: string;
  m?: string;
  /** Параметр повідомлення або вираз на кшталт `[Бак 1]+[Бак 2]` */
  p?: string;
  tbl?: Array<{ x?: number; a?: number; b?: number }>;
};

export type WialonUnit = {
  id: number;
  nm: string;
  cls?: number;
  mu?: number;
  pos?: WialonPosition | null;
  lmsg?: {
    t?: number;
    pos?: WialonPosition;
    p?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  /** Датчики (flags & 4096) */
  sens?: Record<string, WialonSensor> | WialonSensor[];
  /** Лічильники (деякі акаунти) */
  cns?: { mlg?: number; eht?: number; [key: string]: unknown };
  /** Пробіг (км), flags & 8192 */
  cnm?: number;
  cnm_km?: number;
  /** Мотогодини, flags & 8192 */
  cneh?: number;
  cne?: number;
  /**
   * Розраховані значення датчиків з unit/calc_last_message
   * (ключ = id датчика).
   */
  sensorCalc?: Record<string, number>;
};

/** Відсіює відсутні / нульові / відʼємні координати (не показувати в океані) */
export function hasValidWialonPosition(
  unit: WialonUnit
): unit is WialonUnit & { pos: WialonPosition } {
  const pos = unit.pos;
  if (!pos) return false;
  const { x, y } = pos;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x > 0 &&
    y > 0
  );
}

export type WialonZonePoint = {
  x: number;
  y: number;
  r?: number;
};

export type WialonZone = {
  id?: number;
  n: string;
  /** Текстовий опис геозони */
  d?: string;
  /** 2 = полігон */
  t: number;
  /** Колір Wialon (часто BGR int) */
  c?: number;
  p?: WialonZonePoint[];
};

export type WialonResource = {
  id: number;
  nm: string;
  /** Zone library (стандартна назва у Wialon) */
  zl?: Record<string, WialonZone> | WialonZone[];
  /** Альтернативний ключ, якщо API віддає zones */
  zones?: Record<string, WialonZone> | WialonZone[];
};

export type WialonSearchItemsResponse<T = WialonUnit> = {
  searchSpec?: Record<string, unknown>;
  dataFlags?: number;
  totalItemsCount?: number;
  indexFrom?: number;
  indexTo?: number;
  items: T[];
};

export type WialonGeofenceProperties = {
  id: string;
  name: string;
  description: string;
  color: string;
  wialon_id: number | null;
  resourceId: number;
  resourceName: string;
};

function getToken(): string {
  const token = process.env.WIALON_API_TOKEN?.trim();
  if (!token) {
    throw new Error("WIALON_API_TOKEN не задано в env");
  }
  return token;
}

/** Дозволені read-only сервіси */
type WialonReadService =
  | "token/login"
  | "core/search_items"
  | "resource/get_zone_data"
  | "unit/calc_last_message"
  | "messages/load_interval";

export type WialonTrackMessage = {
  t?: number;
  pos?: WialonPosition | null;
  [key: string]: unknown;
};

export type WialonMessagesLoadResponse = {
  messages?: WialonTrackMessage[];
  count?: number;
};

export type WialonTrackLineFeature = Feature<
  LineString,
  { pointCount: number; unitId: number; times: number[] }
>;

export const EMPTY_TRACK_LINE: WialonTrackLineFeature = {
  type: "Feature",
  properties: { pointCount: 0, unitId: 0, times: [] },
  geometry: { type: "LineString", coordinates: [] },
};

async function wialonRequest<T>(
  svc: WialonReadService,
  params: Record<string, unknown>,
  sid?: string
): Promise<T> {
  const url = new URL(WIALON_API_URL);
  url.searchParams.set("svc", svc);
  url.searchParams.set("params", JSON.stringify(params));
  if (sid) {
    url.searchParams.set("sid", sid);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Wialon HTTP ${response.status}`);
  }

  const data = (await response.json()) as T & Partial<WialonErrorResponse>;

  if (typeof data === "object" && data != null && "error" in data && data.error) {
    const reason = data.reason ? `: ${data.reason}` : "";
    throw new Error(`Wialon error ${data.error}${reason}`);
  }

  return data;
}

/** Логін по токену → Session ID (`eid`) */
export async function wialonLogin(): Promise<string> {
  try {
    const data = await wialonRequest<WialonLoginResponse>("token/login", {
      token: getToken(),
    });

    if (!data.eid?.trim()) {
      throw new Error("Wialon login: порожній eid");
    }

    return data.eid;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Wialon login не вдався");
  }
}

/** Мін. швидкість (км/год) для точки треку — відсікає GPS-дрейф на стоянці */
export const MIN_TRACK_SPEED_KMH = 2;

export type WialonTrackBundle = {
  track: WialonTrackLineFeature;
  analytics: DayAnalyticsPayload;
};

function readMessageParams(
  msg: WialonTrackMessage
): Record<string, unknown> {
  const p = msg.p;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

function readFuelFromMessageParams(
  params: Record<string, unknown>
): number | null {
  for (const key of [
    "fuel",
    "fuel_level",
    "rs",
    "rs485fuel",
    "adc1",
    "lls",
    "io_201",
  ] as const) {
    if (!(key in params)) continue;
    const raw = Number(params[key]);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
  }
  // евристика: ключі з fuel/палив/rs у назві
  for (const [key, value] of Object.entries(params)) {
    if (!/fuel|палив|топлив|lls|^rs$/i.test(key)) continue;
    const raw = Number(value);
    if (Number.isFinite(raw) && raw >= 0 && raw < 5000) return raw;
  }
  return null;
}

function readIgnitionFromMessageParams(
  params: Record<string, unknown>
): boolean | null {
  for (const key of ["io_239", "io_240", "io_1", "ignition", "engine"] as const) {
    if (!(key in params)) continue;
    const raw = Number(params[key]);
    if (Number.isFinite(raw)) return raw > 0;
  }
  if ("pwr_ext" in params) {
    const raw = Number(params.pwr_ext);
    if (Number.isFinite(raw) && raw > 0) return raw >= 13.2;
  }
  return null;
}

function readDriverFromMessageParams(
  params: Record<string, unknown>
): string | null {
  for (const key of [
    "drvr_code",
    "driver_code",
    "driver",
    "avl_driver",
    "driverCode",
  ] as const) {
    if (!(key in params)) continue;
    const code = normalizeDriverCode(params[key]);
    if (code) return code;
  }
  return null;
}

export type LoadWialonMessagesOptions = {
  /** Wialon messages/load_interval flags (1 = з параметрами датчиків) */
  flags?: number;
  flagsMask?: number;
};

export async function loadWialonUnitMessages(
  eid: string,
  unitId: number,
  timeFrom: number,
  timeTo: number,
  options?: LoadWialonMessagesOptions
): Promise<WialonTrackMessage[]> {
  if (!eid?.trim()) {
    throw new Error("Потрібен eid (session id)");
  }
  if (!Number.isFinite(unitId) || unitId <= 0) {
    throw new Error("Некоректний unitId");
  }
  if (
    !Number.isFinite(timeFrom) ||
    !Number.isFinite(timeTo) ||
    timeTo < timeFrom
  ) {
    throw new Error("Некоректний часовий інтервал");
  }

  const data = await wialonRequest<WialonMessagesLoadResponse>(
    "messages/load_interval",
    {
      itemId: unitId,
      timeFrom,
      timeTo,
      // Як у треках: flags=0 + flagsMask — інакше Wialon часто вертає []
      flags: options?.flags ?? 0,
      flagsMask: options?.flagsMask ?? 65280,
      loadCount: 0xffffffff,
    },
    eid
  );

  return Array.isArray(data.messages) ? data.messages : [];
}

/**
 * Рівні палива з історії повідомлень (л).
 * Ключі: fuel / fuel_level / rs / lls / *fuel* у назві.
 */
export function extractFuelLevelsFromMessages(
  messages: WialonTrackMessage[]
): number[] {
  const levels: number[] = [];
  for (const msg of messages) {
    const params = readMessageParams(msg);
    const fromKnown = readFuelFromMessageParams(params);
    if (fromKnown != null) {
      levels.push(fromKnown);
      continue;
    }
    // Fallback: перший числовий параметр, схожий на обʼєм бака (1–5000 л)
    for (const [key, value] of Object.entries(params)) {
      if (/rs|adc|lls|io_\d+/i.test(key) && !/temp|volt|pwr|sat/i.test(key)) {
        const raw = Number(value);
        if (Number.isFinite(raw) && raw >= 0 && raw < 5000) {
          levels.push(raw);
          break;
        }
      }
    }
  }
  return levels;
}

/**
 * Приріст палива за інтервал: max(level) − min(level).
 * Немає повідомлень / датчика → null.
 */
export function estimateFuelAddedFromMessages(
  messages: WialonTrackMessage[]
): number | null {
  const fuelLevels = extractFuelLevelsFromMessages(messages);
  if (fuelLevels.length === 0) return null;
  const wialonAdded = Math.max(...fuelLevels) - Math.min(...fuelLevels);
  if (!Number.isFinite(wialonAdded) || wialonAdded < 0) return null;
  return Math.round(wialonAdded * 100) / 100;
}

function buildTrackFromMessages(
  messages: WialonTrackMessage[],
  unitId: number
): WialonTrackLineFeature {
  const coordinates: Position[] = [];
  const times: number[] = [];

  for (const msg of messages) {
    const pos = msg.pos;
    if (!pos) continue;
    const { x, y } = pos;
    const speed = Number(pos.s ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
      continue;
    }
    if (!Number.isFinite(speed) || speed < MIN_TRACK_SPEED_KMH) {
      continue;
    }
    coordinates.push([x, y]);
    times.push(
      typeof msg.t === "number" && Number.isFinite(msg.t) ? msg.t : 0
    );
  }

  return {
    type: "Feature",
    properties: { pointCount: coordinates.length, unitId, times },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function buildAnalyticsSamplesFromMessages(
  messages: WialonTrackMessage[]
): DayAnalyticsSample[] {
  const samples: DayAnalyticsSample[] = [];

  for (const msg of messages) {
    const pos = msg.pos;
    if (!pos) continue;
    const { x, y } = pos;
    const speed = Number(pos.s ?? 0);
    const t = typeof msg.t === "number" && Number.isFinite(msg.t) ? msg.t : 0;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x <= 0 ||
      y <= 0 ||
      t <= 0
    ) {
      continue;
    }
    const params = readMessageParams(msg);
    samples.push({
      t,
      lng: x,
      lat: y,
      speed: Number.isFinite(speed) ? speed : 0,
      fuelLiters: readFuelFromMessageParams(params),
      ignition: readIgnitionFromMessageParams(params),
      driverCode: readDriverFromMessageParams(params),
    });
  }

  return samples;
}

/**
 * Історія повідомлень юніта за інтервал → GeoJSON LineString (READ-ONLY).
 * svc=messages/load_interval. Точки лише при русі (pos.s >= MIN_TRACK_SPEED_KMH).
 */
export async function getWialonUnitTrack(
  eid: string,
  unitId: number,
  timeFrom: number,
  timeTo: number
): Promise<WialonTrackLineFeature> {
  const messages = await loadWialonUnitMessages(eid, unitId, timeFrom, timeTo);
  return buildTrackFromMessages(messages, unitId);
}

/**
 * Трек (лише рух) + денна аналітика (усі точки: паливо, idle, зливи).
 * Один запит messages/load_interval.
 */
export async function getWialonUnitTrackBundle(
  eid: string,
  unitId: number,
  timeFrom: number,
  timeTo: number
): Promise<WialonTrackBundle> {
  const messages = await loadWialonUnitMessages(eid, unitId, timeFrom, timeTo);
  const track = buildTrackFromMessages(messages, unitId);
  const rawSamples = buildAnalyticsSamplesFromMessages(messages);
  const analytics =
    rawSamples.length > 0
      ? buildDayAnalyticsFromSamples(rawSamples)
      : EMPTY_DAY_ANALYTICS;

  return { track, analytics };
}

/** Розрахунок усіх датчиків за останнім повідомленням (READ-ONLY). */
async function calcUnitLastMessageSensors(
  eid: string,
  unitId: number
): Promise<Record<string, number>> {
  try {
    const data = await wialonRequest<Record<string, number>>(
      "unit/calc_last_message",
      { unitId, sensors: [] },
      eid
    );
    if (!data || typeof data !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Список техніки (avl_unit): база + last message + датчики + лічильники.
 * flags=13313. Додатково — READ-ONLY calc_last_message для точних літрів.
 */
export async function getWialonUnits(eid: string): Promise<WialonUnit[]> {
  try {
    if (!eid?.trim()) {
      throw new Error("Потрібен eid (session id)");
    }

    const data = await wialonRequest<WialonSearchItemsResponse<WialonUnit>>(
      "core/search_items",
      {
        spec: {
          itemsType: "avl_unit",
          propName: "sys_name",
          propValueMask: "*",
          sortType: "sys_name",
        },
        force: 1,
        flags: WIALON_UNIT_FLAGS_TELEMETRY,
        from: 0,
        to: 0,
      },
      eid
    );

    const items = Array.isArray(data.items) ? data.items : [];

    const withCalc = await Promise.all(
      items.map(async (unit) => {
        const sensorCalc = await calcUnitLastMessageSensors(eid, unit.id);
        return { ...unit, sensorCalc };
      })
    );

    return withCalc;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Wialon search_items (units) не вдався");
  }
}

/**
 * Одна одиниця техніки за sys_id (датчики + calc_last_message).
 */
export async function getWialonUnitById(
  eid: string,
  unitId: number
): Promise<WialonUnit | null> {
  if (!eid?.trim()) {
    throw new Error("Потрібен eid (session id)");
  }
  if (!Number.isFinite(unitId) || unitId <= 0) {
    return null;
  }

  const data = await wialonRequest<WialonSearchItemsResponse<WialonUnit>>(
    "core/search_items",
    {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_id",
        propValueMask: String(unitId),
        sortType: "sys_name",
      },
      force: 1,
      flags: WIALON_UNIT_FLAGS_TELEMETRY,
      from: 0,
      to: 1,
    },
    eid
  );

  const unit = Array.isArray(data.items) ? data.items[0] : undefined;
  if (!unit || unit.id !== unitId) return null;

  const sensorCalc = await calcUnitLastMessageSensors(eid, unit.id);
  return { ...unit, sensorCalc };
}

function listUnitSensors(unit: WialonUnit): WialonSensor[] {
  const sens = unit.sens;
  if (!sens) return [];
  return Array.isArray(sens) ? sens : Object.values(sens);
}

function getLastMessageParams(unit: WialonUnit): Record<string, unknown> {
  const fromLmsg = unit.lmsg?.p;
  if (fromLmsg && typeof fromLmsg === "object") return fromLmsg;
  const root = (unit as { p?: Record<string, unknown> }).p;
  return root && typeof root === "object" ? root : {};
}

/** Teltonika / LLS часто віддають 65532/65535 як «немає даних». */
function isValidRawSensorValue(raw: number): boolean {
  return Number.isFinite(raw) && raw >= 0 && raw < 65000;
}

/** Wialon calc інколи повертає великі відʼємні sentinel-значення. */
function isPlausibleSensorValue(value: number, max = 50_000): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

/**
 * Калібрувальна таблиця Wialon: y = a * x + b для сегмента з найбільшим x ≤ raw.
 */
function applySensorCalibrationTable(
  tbl: WialonSensor["tbl"],
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

  let segment = pts[0];
  for (const point of pts) {
    if (raw >= point.x) segment = point;
    else break;
  }
  const value =
    segment.a * raw + (Number.isFinite(segment.b) ? segment.b : 0);
  return Number.isFinite(value) ? value : null;
}

function readCalcSensorValue(
  unit: WialonUnit,
  sensor: WialonSensor
): number | null {
  const calc = unit.sensorCalc;
  if (!calc) return null;
  const value = calc[String(sensor.id)] ?? calc[sensor.id as unknown as string];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function evaluateSensorLocally(
  unit: WialonUnit,
  sensor: WialonSensor,
  depth = 0
): number | null {
  if (!sensor || depth > 6) return null;
  const params = getLastMessageParams(unit);
  const key = sensor.p?.trim() ?? "";
  if (!key) return null;

  if (key.includes("[")) {
    let sum = 0;
    let ok = false;
    for (const match of key.matchAll(/\[([^\]]+)\]/g)) {
      const child = listUnitSensors(unit).find((item) => item.n === match[1]);
      if (!child) continue;
      const childValue = evaluateSensorLocally(unit, child, depth + 1);
      if (childValue != null && Number.isFinite(childValue)) {
        sum += childValue;
        ok = true;
      }
    }
    return ok ? sum : null;
  }

  if (!(key in params)) return null;
  const raw = Number(params[key]);
  if (!isValidRawSensorValue(raw)) return null;
  if (sensor.tbl?.length) {
    return applySensorCalibrationTable(sensor.tbl, raw);
  }
  return raw;
}

function resolveSensorNumeric(
  unit: WialonUnit,
  sensor: WialonSensor,
  maxPlausible = 50_000
): number | null {
  const fromCalc = readCalcSensorValue(unit, sensor);
  if (fromCalc != null) {
    // Якщо Wialon порахував значення — довіряємо лише валідному діапазону.
    // Відʼємний sentinel означає «немає даних», без локального fallback.
    return isPlausibleSensorValue(fromCalc, maxPlausible) ? fromCalc : null;
  }
  const local = evaluateSensorLocally(unit, sensor);
  if (local != null && isPlausibleSensorValue(local, maxPlausible)) {
    return local;
  }
  return null;
}

export type WialonUnitTelemetry = {
  ignition: boolean | null;
  fuelLiters: number | null;
  mileageKm: number | null;
  engineHours: number | null;
  voltage: number | null;
  satellites: number | null;
};

/**
 * Розбір запалювання, палива, пробігу та мотогодин з unit (sens / lmsg / counters).
 */
export function parseWialonUnitTelemetry(unit: WialonUnit): WialonUnitTelemetry {
  const sensors = listUnitSensors(unit);
  const params = getLastMessageParams(unit);

  const fuelSensor =
    sensors.find((sensor) => sensor.t === "fuel level") ||
    sensors.find((sensor) =>
      /топлив|палив|fuel|уровень топлива|рівень палив/i.test(sensor.n || "")
    );
  const fuelLiters = fuelSensor
    ? resolveSensorNumeric(unit, fuelSensor, 20_000)
    : (() => {
        for (const key of ["fuel", "adc1", "lls", "io_201"] as const) {
          const raw = Number(params[key]);
          if (isValidRawSensorValue(raw) && raw < 5000) return raw;
        }
        return null;
      })();

  const ignitionSensor =
    sensors.find((sensor) => sensor.t === "engine operation") ||
    sensors.find((sensor) =>
      /зажиг|ignition|запал|engine/i.test(sensor.n || "")
    );

  let ignition: boolean | null = null;
  if (ignitionSensor) {
    const fromCalc = readCalcSensorValue(unit, ignitionSensor);
    if (fromCalc != null && Number.isFinite(fromCalc)) {
      ignition = fromCalc > 0;
    } else {
      const paramKey = ignitionSensor.p?.trim();
      if (paramKey && paramKey in params && !paramKey.includes("[")) {
        const raw = Number(params[paramKey]);
        if (Number.isFinite(raw)) {
          // Цифровий IO або напруга як проксі запалювання
          if (paramKey === "pwr_ext" || ignitionSensor.t === "voltage") {
            ignition = raw >= 13.2;
          } else {
            ignition = raw > 0;
          }
        }
      }
    }
  }
  if (ignition == null) {
    for (const key of ["io_239", "io_240", "io_1"] as const) {
      if (key in params) {
        const raw = Number(params[key]);
        if (Number.isFinite(raw)) {
          ignition = raw > 0;
          break;
        }
      }
    }
  }

  const mileageRaw =
    unit.cns?.mlg ?? unit.cnm_km ?? unit.cnm ?? null;
  const mileageKm =
    mileageRaw != null && Number.isFinite(Number(mileageRaw))
      ? Number(mileageRaw)
      : null;

  const engineRaw = unit.cns?.eht ?? unit.cneh ?? unit.cne ?? null;
  const engineHours =
    engineRaw != null && Number.isFinite(Number(engineRaw))
      ? Number(engineRaw)
      : null;

  const voltageSensor = sensors.find((sensor) => sensor.t === "voltage");
  let voltage: number | null = null;
  if (voltageSensor) {
    voltage = resolveSensorNumeric(unit, voltageSensor, 100);
  }
  if (voltage == null) {
    const raw = Number(params.pwr_ext);
    if (Number.isFinite(raw) && raw > 0 && raw < 100) voltage = raw;
  }

  const satellites =
    unit.pos?.sc != null && Number.isFinite(unit.pos.sc)
      ? unit.pos.sc
      : (() => {
          const sats = Number(params.sats ?? params.io_21);
          return Number.isFinite(sats) ? sats : null;
        })();

  return {
    ignition,
    fuelLiters,
    mileageKm,
    engineHours,
    voltage,
    satellites,
  };
}

/** Чи сконфігуровано датчик рівня палива (ДУТ) на юніті. */
export function unitHasFuelSensor(unit: WialonUnit): boolean {
  const sensors = listUnitSensors(unit);
  const named =
    sensors.find((sensor) => sensor.t === "fuel level") ||
    sensors.find((sensor) =>
      /топлив|палив|fuel|уровень топлива|рівень палив/i.test(sensor.n || "")
    );
  if (named) return true;
  const telemetry = parseWialonUnitTelemetry(unit);
  return telemetry.fuelLiters != null && Number.isFinite(telemetry.fuelLiters);
}

/**
 * Ресурси з геозонами (avl_resource) + точки полігонів.
 * 1) core/search_items flags=4097 — каталог зон
 * 2) resource/get_zone_data — READ-ONLY координати (поле `p`)
 */
export async function getWialonGeofences(
  eid: string
): Promise<WialonResource[]> {
  try {
    if (!eid?.trim()) {
      throw new Error("Потрібен eid (session id)");
    }

    const data = await wialonRequest<WialonSearchItemsResponse<WialonResource>>(
      "core/search_items",
      {
        spec: {
          itemsType: "avl_resource",
          propName: "sys_name",
          propValueMask: "*",
          sortType: "sys_name",
        },
        force: 1,
        flags: WIALON_RESOURCE_FLAGS_ZONES,
        from: 0,
        to: 0,
      },
      eid
    );

    const resources = Array.isArray(data.items) ? data.items : [];
    return await attachZonePoints(eid, resources);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Wialon geofences не вдалося отримати");
  }
}

/** Підтягує `p` для зон кожного ресурсу (read-only). */
async function attachZonePoints(
  eid: string,
  resources: WialonResource[]
): Promise<WialonResource[]> {
  const enriched: WialonResource[] = [];

  for (const resource of resources) {
    const meta = listZones(resource);
    const zoneIds = meta
      .map(({ zone }) => zone.id)
      .filter((id): id is number => typeof id === "number");

    if (zoneIds.length === 0) {
      enriched.push(resource);
      continue;
    }

    const zonesWithPoints = await wialonRequest<WialonZone[]>(
      "resource/get_zone_data",
      {
        itemId: resource.id,
        col: zoneIds,
      },
      eid
    );

    const byId = new Map<number, WialonZone>();
    for (const zone of Array.isArray(zonesWithPoints) ? zonesWithPoints : []) {
      if (typeof zone.id === "number") byId.set(zone.id, zone);
    }

    const zl: Record<string, WialonZone> = {};
    for (const { key, zone } of meta) {
      const full =
        typeof zone.id === "number" ? byId.get(zone.id) : undefined;
      zl[key] = full ? { ...zone, ...full } : zone;
    }

    enriched.push({ ...resource, zl });
  }

  return enriched;
}

/** Колір Wialon (int) → валідний HEX `#rrggbb` (як у клієнтському ПЗ) */
export function wialonColorToHex(color?: number | null): string {
  if (!color || !Number.isFinite(color)) return DEFAULT_GEOFENCE_COLOR;
  const hex =
    "#" + ((color >>> 0) & 0xffffff).toString(16).padStart(6, "0");
  return hex === "#000000" ? DEFAULT_GEOFENCE_COLOR : hex;
}

function listZones(
  resource: WialonResource
): Array<{ key: string; zone: WialonZone }> {
  const raw = resource.zl ?? resource.zones;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((zone, index) => ({
      key: String(zone.id ?? index),
      zone,
    }));
  }

  return Object.entries(raw).map(([key, zone]) => ({ key, zone }));
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length < 3) return ring;
  const [firstLon, firstLat] = ring[0]!;
  const [lastLon, lastLat] = ring[ring.length - 1]!;
  if (firstLon === lastLon && firstLat === lastLat) return ring;
  return [...ring, [firstLon, firstLat]];
}

/**
 * Ресурси Wialon → GeoJSON FeatureCollection (лише полігони t===2).
 */
export function wialonResourcesToGeofenceGeoJSON(
  resources: WialonResource[]
): FeatureCollection<Polygon, WialonGeofenceProperties> {
  const features: Feature<Polygon, WialonGeofenceProperties>[] = [];

  for (const resource of resources) {
    for (const { key, zone } of listZones(resource)) {
      if (zone.t !== 2 || !Array.isArray(zone.p) || zone.p.length < 3) {
        continue;
      }

      const ring = closeRing(
        zone.p
          .filter(
            (point) =>
              Number.isFinite(point.x) &&
              Number.isFinite(point.y) &&
              point.x > 0 &&
              point.y > 0
          )
          .map((point) => [point.x, point.y] as Position)
      );

      if (ring.length < 4) continue;

      features.push({
        type: "Feature",
        id: `${resource.id}-${key}`,
        properties: {
          id: `${resource.id}-${key}`,
          name: zone.n || resource.nm || "Геозона",
          description: (zone.d ?? "").trim(),
          color: wialonColorToHex(zone.c),
          wialon_id: typeof zone.id === "number" ? zone.id : null,
          resourceId: resource.id,
          resourceName: resource.nm,
        },
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export const EMPTY_GEOFENCE_COLLECTION: FeatureCollection<
  Polygon,
  WialonGeofenceProperties
> = {
  type: "FeatureCollection",
  features: [],
};

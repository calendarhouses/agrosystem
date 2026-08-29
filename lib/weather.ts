/** Погода через Open-Meteo (без API-ключа) */

import { FARM_BASE_LOCATION } from "@/lib/farm-base-location";

export type WeatherSnapshot = {
  tempC: number;
  humidityPercent: number;
  windMs: number;
  condition: string;
  weatherCode: number;
  latitude: number;
  longitude: number;
  /** °C, шар ґрунту 18 см (Open-Meteo: soil_temperature_18cm) */
  soilTempC: number | null;
  /** % обʼємної вологості, шар 3–9 см (Open-Meteo: soil_moisture_3_to_9cm) */
  soilMoisturePercent: number | null;
};

export type WeatherLocation = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

/** Короткий підпис для шапки (лише населений пункт, без області). */
export function shortWeatherPlaceLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "—";
  const first = trimmed.split(",")[0]?.trim();
  return first || trimmed;
}

/** Дефолт: Іванівка біля Ставища / Кривця — де поля господарства */
export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  id: FARM_BASE_LOCATION.id,
  label: FARM_BASE_LOCATION.label,
  latitude: FARM_BASE_LOCATION.latitude,
  longitude: FARM_BASE_LOCATION.longitude,
};

export const WEATHER_BASE_LOCATIONS: WeatherLocation[] = [
  DEFAULT_WEATHER_LOCATION,
  {
    id: "kyiv-city",
    label: "Київ",
    latitude: 50.4501,
    longitude: 30.5234,
  },
  {
    id: "vinnytsia",
    label: "Вінниця",
    latitude: 49.2331,
    longitude: 28.4682,
  },
  {
    id: "odesa",
    label: "Одеса",
    latitude: 46.4825,
    longitude: 30.7233,
  },
  {
    id: "lviv",
    label: "Львів",
    latitude: 49.8397,
    longitude: 24.0297,
  },
];

const WMO_CONDITION: Record<number, string> = {
  0: "Ясно",
  1: "Переважно ясно",
  2: "Мінливо хмарно",
  3: "Хмарно",
  45: "Туман",
  48: "Іней / туман",
  51: "Мряка",
  61: "Дощ",
  63: "Помірний дощ",
  65: "Сильний дощ",
  71: "Сніг",
  80: "Зливи",
  95: "Гроза",
};

function conditionFromCode(code: number | undefined): string {
  if (code == null || Number.isNaN(code)) return "Погода";
  return WMO_CONDITION[code] ?? "Мінлива погода";
}

const CURRENT_VARS =
  "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,soil_temperature_18cm,soil_moisture_3_to_9cm";

type CurrentWeatherPayload = {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  wind_speed_10m?: number;
  weather_code?: number;
  soil_temperature_18cm?: number;
  soil_moisture_3_to_9cm?: number;
  soil_moisture_3_9cm?: number;
};

function parseCurrent(
  current: CurrentWeatherPayload,
  latitude: number,
  longitude: number
): WeatherSnapshot {
  const soilRaw =
    current.soil_moisture_3_to_9cm ?? current.soil_moisture_3_9cm;
  return {
    tempC: Math.round(Number(current.temperature_2m) || 0),
    humidityPercent: Math.round(Number(current.relative_humidity_2m) || 0),
    windMs: Math.round(Number(current.wind_speed_10m) || 0),
    condition: conditionFromCode(current.weather_code),
    weatherCode: Number(current.weather_code) || 0,
    latitude,
    longitude,
    soilTempC:
      current.soil_temperature_18cm == null
        ? null
        : Math.round(Number(current.soil_temperature_18cm) * 10) / 10,
    soilMoisturePercent:
      soilRaw == null ? null : Math.round(Number(soilRaw) * 100),
  };
}

/** GET Open-Meteo current weather за координатами */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", CURRENT_VARS);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const response = await fetch(url.toString(), {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    current?: CurrentWeatherPayload;
  };

  const current = data.current;
  if (!current) {
    throw new Error("Немає current у відповіді Open-Meteo");
  }

  return parseCurrent(current, latitude, longitude);
}

export type HourlyForecastHour = {
  time: string;
  tempC: number;
  precipProbability: number;
  precipitationMm: number;
  weatherCode: number;
};

/** Погодинний прогноз з вітром — для планування робіт (до 7 днів). */
export type PlanningWeatherHour = HourlyForecastHour & {
  windMs: number;
};

const HOURLY_VARS =
  "temperature_2m,wind_speed_10m,precipitation_probability,precipitation,weather_code";

function mapHourlyRows(data: {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    wind_speed_10m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
  };
}): PlanningWeatherHour[] {
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const winds = data.hourly?.wind_speed_10m ?? [];
  const probs = data.hourly?.precipitation_probability ?? [];
  const precip = data.hourly?.precipitation ?? [];
  const codes = data.hourly?.weather_code ?? [];

  return times.map((time, index) => ({
    time,
    tempC: Math.round(Number(temps[index]) || 0),
    windMs: Math.round((Number(winds[index]) || 0) * 10) / 10,
    precipProbability: Math.round(Number(probs[index]) || 0),
    precipitationMm: Number(precip[index]) || 0,
    weatherCode: Number(codes[index]) || 0,
  }));
}

/** Найближча година прогнозу до обраної дати й часу. */
export function pickWeatherAtTime(
  hourly: PlanningWeatherHour[],
  dateIso: string,
  timeHm: string
): PlanningWeatherHour | null {
  if (!hourly.length || !dateIso.trim() || !timeHm.trim()) return null;

  const [hhRaw, mmRaw = "0"] = timeHm.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || hh < 0 || hh > 23) return null;

  const target = new Date(
    `${dateIso}T${String(hh).padStart(2, "0")}:${String(Math.min(59, Math.max(0, mm))).padStart(2, "0")}:00`
  );
  if (Number.isNaN(target.getTime())) return null;

  let best: PlanningWeatherHour | null = null;
  let bestDiff = Infinity;
  for (const hour of hourly) {
    const t = new Date(hour.time);
    if (Number.isNaN(t.getTime())) continue;
    const diff = Math.abs(t.getTime() - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = hour;
    }
  }
  return best;
}

/** Обприскування / ЗЗР — перевіряємо вітер і температуру. */
export function isSprayOperationType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return (
    normalized.includes("ззр") ||
    normalized.includes("обприск") ||
    normalized === "внесення ззр"
  );
}

export type SprayWeatherVerdict = "optimal" | "warning";

export function evaluateSprayWeatherConditions(
  windMs: number,
  tempC: number
): SprayWeatherVerdict {
  if (windMs > 5 || tempC > 25) return "warning";
  return "optimal";
}

export type FieldWeatherAdvisoryTone = "good" | "caution" | "bad" | "neutral";

export type FieldWeatherAdvisory = {
  tone: FieldWeatherAdvisoryTone;
  title: string;
  detail?: string;
};

function kyivCalendarMonth(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      month: "numeric",
    }).format(now)
  );
}

function isEarlySpringCrop(crop: string): boolean {
  const normalized = crop.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("ячмін") ||
    normalized.includes("пшен") ||
    normalized.includes("горох") ||
    normalized.includes("ріпак") ||
    normalized.includes("озим")
  );
}

/** Контекстна підказка для блоку «Стан поля» — погода, сезон, культура. */
export function evaluateFieldWeatherAdvisory(
  weather: WeatherSnapshot,
  options?: {
    crop?: string;
    daysSinceSowing?: number | null;
    hourly?: HourlyForecastHour[];
    now?: Date;
  }
): FieldWeatherAdvisory {
  const now = options?.now ?? new Date();
  const month = kyivCalendarMonth(now);
  const hourly = options?.hourly ?? [];
  const nextHours = hourly.slice(0, 6);
  const maxPrecipProb = nextHours.length
    ? Math.max(...nextHours.map((h) => h.precipProbability))
    : 0;
  const rainSoon = nextHours.some(
    (h) => h.precipitationMm > 0.3 || h.precipProbability >= 65
  );
  const stormSoon = nextHours.some((h) => h.weatherCode >= 95);

  const { tempC, windMs, soilTempC, soilMoisturePercent, weatherCode, condition } =
    weather;
  const crop = options?.crop?.trim() ?? "";
  const daysSinceSowing = options?.daysSinceSowing ?? null;

  if (weatherCode >= 95 || stormSoon) {
    return {
      tone: "bad",
      title: "Гроза — полеві роботи небезпечні",
      detail: "Зачекайте, поки не вщухне",
    };
  }

  if (windMs > 8) {
    return {
      tone: "bad",
      title: "Сильний вітер — обробку не проводити",
      detail: `${windMs} м/с, ризик знесення ЗЗР`,
    };
  }

  if (weatherCode >= 65 || weatherCode === 80) {
    return {
      tone: "bad",
      title: "Дощ — техніка може застрягти",
      detail: condition,
    };
  }

  if (rainSoon || maxPrecipProb >= 70) {
    return {
      tone: "caution",
      title: "Опади найближчими годинами",
      detail:
        maxPrecipProb > 0 ? `Ймовірність до ${maxPrecipProb}%` : undefined,
    };
  }

  if (windMs > 5) {
    return {
      tone: "caution",
      title: "Вітрено — не обприскувати",
      detail: `${windMs} м/с (норма до 5 м/с)`,
    };
  }

  if (tempC > 28) {
    return {
      tone: "caution",
      title: "Спека — обережно з ЗЗР",
      detail: `${tempC}°C, краще рано вранці або ввечері`,
    };
  }

  if (tempC < 5 && month >= 3 && month <= 4) {
    return {
      tone: "caution",
      title: "Холодно для виходу в поле",
      detail: `${tempC}°C повітря`,
    };
  }

  if (
    month >= 6 &&
    month <= 9 &&
    soilMoisturePercent != null &&
    soilMoisturePercent < 22
  ) {
    return {
      tone: "caution",
      title: "Низька волога ґрунту",
      detail: `${soilMoisturePercent}% на глибині 3–9 см`,
    };
  }

  if (month >= 3 && month <= 5 && soilTempC != null) {
    if (soilTempC < 5) {
      return {
        tone: "bad",
        title: "Захолодлено для сівби",
        detail: `T ґрунту ${soilTempC}°C`,
      };
    }
    if (soilTempC <= 10) {
      return {
        tone: "caution",
        title: "Ґрунт прогрівається",
        detail: `${soilTempC}°C — скоро вікно для ярих`,
      };
    }
    if (isEarlySpringCrop(crop) || !crop) {
      return {
        tone: "good",
        title: "Оптимально для ранніх ярих",
        detail: `T ґрунту ${soilTempC}°C`,
      };
    }
    return {
      tone: "good",
      title: "Ґрунт прогрітий — можна сівати",
      detail: `${soilTempC}°C`,
    };
  }

  if (
    month >= 8 &&
    month <= 10 &&
    daysSinceSowing != null &&
    daysSinceSowing >= 90
  ) {
    if (windMs <= 4 && tempC >= 18 && tempC <= 32 && maxPrecipProb < 40) {
      return {
        tone: "good",
        title: "Добре для жатви / сушки",
        detail: `${tempC}°, вітер ${windMs} м/с`,
      };
    }
  }

  if (windMs <= 5 && tempC <= 25 && tempC >= 10 && maxPrecipProb < 45) {
    return {
      tone: "good",
      title: "Вікно для обприскування",
      detail: `Вітер ${windMs} м/с, ${tempC}°`,
    };
  }

  if (windMs <= 6 && maxPrecipProb < 50 && tempC >= 8) {
    return {
      tone: "good",
      title: "Погода підходить для робіт",
      detail: `${condition}, ${tempC}°`,
    };
  }

  if ((month >= 11 || month <= 2) && soilTempC != null && soilTempC < 5) {
    return {
      tone: "neutral",
      title: "Ґрунт холодний — поза сезоном",
      detail: `${soilTempC}°C`,
    };
  }

  return {
    tone: "neutral",
    title: condition,
    detail: `${tempC}°, вітер ${windMs} м/с`,
  };
}

/** 7-денний погодинний прогноз (вітер + t°) для PlanWorkPanel. */
export async function fetchPlanningWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<{ hourly: PlanningWeatherHour[] }> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", HOURLY_VARS);
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const response = await fetch(url.toString(), {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      wind_speed_10m?: number[];
      precipitation_probability?: number[];
      precipitation?: number[];
      weather_code?: number[];
    };
  };

  return { hourly: mapHourlyRows(data) };
}

/** Погодинний прогноз на 12 год (температура + опади) */
export async function fetchHourlyForecast(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<HourlyForecastHour[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,precipitation,weather_code"
  );
  url.searchParams.set("forecast_hours", "12");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url.toString(), {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
      precipitation?: number[];
      weather_code?: number[];
    };
  };

  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const probs = data.hourly?.precipitation_probability ?? [];
  const precip = data.hourly?.precipitation ?? [];
  const codes = data.hourly?.weather_code ?? [];

  return times.slice(0, 12).map((time, index) => ({
    time,
    tempC: Math.round(Number(temps[index]) || 0),
    precipProbability: Math.round(Number(probs[index]) || 0),
    precipitationMm: Number(precip[index]) || 0,
    weatherCode: Number(codes[index]) || 0,
  }));
}

/** Current + 12h hourly одним запитом для popup поля/трактора */
export async function fetchWeatherWithHourly(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<{ current: WeatherSnapshot; hourly: HourlyForecastHour[] }> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", CURRENT_VARS);
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,precipitation,weather_code"
  );
  url.searchParams.set("forecast_hours", "12");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const response = await fetch(url.toString(), {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    current?: CurrentWeatherPayload;
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
      precipitation?: number[];
      weather_code?: number[];
    };
  };

  const current = data.current;
  if (!current) {
    throw new Error("Немає current у відповіді Open-Meteo");
  }

  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const probs = data.hourly?.precipitation_probability ?? [];
  const precip = data.hourly?.precipitation ?? [];
  const codes = data.hourly?.weather_code ?? [];

  return {
    current: parseCurrent(current, latitude, longitude),
    hourly: times.slice(0, 12).map((time, index) => ({
      time,
      tempC: Math.round(Number(temps[index]) || 0),
      precipProbability: Math.round(Number(probs[index]) || 0),
      precipitationMm: Number(precip[index]) || 0,
      weatherCode: Number(codes[index]) || 0,
    })),
  };
}

/** Агро-шар ґрунту (18 см + волога 3–9 см) — окремий запит за потреби */
export async function fetchSoilData(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<Pick<WeatherSnapshot, "soilTempC" | "soilMoisturePercent">> {
  const snapshot = await fetchWeather(latitude, longitude, signal);
  return {
    soilTempC: snapshot.soilTempC,
    soilMoisturePercent: snapshot.soilMoisturePercent,
  };
}

const LOCAL_KEY = "agrosystem.weather_location.v2";

export function readStoredWeatherLocation(): WeatherLocation {
  if (typeof window === "undefined") return DEFAULT_WEATHER_LOCATION;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return DEFAULT_WEATHER_LOCATION;
    const parsed = JSON.parse(raw) as WeatherLocation;
    if (
      typeof parsed?.latitude === "number" &&
      typeof parsed?.longitude === "number"
    ) {
      const label = parsed.label || DEFAULT_WEATHER_LOCATION.label;
      // Старий placeholder / довга назва дефолту → короткий «Ivanivka»
      if (
        parsed.id === "default" ||
        parsed.id === "ivanivka-bilotserkivskyi" ||
        parsed.id === "ivanivka-fastiv" ||
        label === "Не обрано" ||
        label === "Ivanivka Білоцерківський район" ||
        label.trim() === ""
      ) {
        return DEFAULT_WEATHER_LOCATION;
      }
      return {
        id: parsed.id || "custom",
        label,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_WEATHER_LOCATION;
}

export function writeStoredWeatherLocation(location: WeatherLocation) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(location));
}

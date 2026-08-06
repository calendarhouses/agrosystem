/** Погода через Open-Meteo (без API-ключа) */

export type WeatherSnapshot = {
  tempC: number;
  humidityPercent: number;
  windMs: number;
  condition: string;
  latitude: number;
  longitude: number;
};

export type WeatherLocation = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

/** Дефолтні координати, якщо локацію ще не обрано */
export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  id: "default",
  label: "Не обрано",
  latitude: 50.0,
  longitude: 30.2,
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

/** GET Open-Meteo current weather за координатами */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
  );
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
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
  };

  const current = data.current;
  if (!current) {
    throw new Error("Немає current у відповіді Open-Meteo");
  }

  return {
    tempC: Math.round(Number(current.temperature_2m) || 0),
    humidityPercent: Math.round(Number(current.relative_humidity_2m) || 0),
    windMs: Math.round(Number(current.wind_speed_10m) || 0),
    condition: conditionFromCode(current.weather_code),
    latitude,
    longitude,
  };
}

const LOCAL_KEY = "agrosystem.weather_location.v1";

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
      return {
        id: parsed.id || "custom",
        label: parsed.label || "Власна локація",
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

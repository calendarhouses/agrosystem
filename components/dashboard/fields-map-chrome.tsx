"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Loader2,
  MapPin,
  Settings2,
  Sun,
  Wind,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import {
  DEFAULT_WEATHER_LOCATION,
  fetchWeather,
  readStoredWeatherLocation,
  writeStoredWeatherLocation,
  type WeatherLocation,
  type WeatherSnapshot,
} from "@/lib/weather";
import { cn } from "@/lib/utils";

function WeatherGlyph({ code, className }: { code: number; className?: string }) {
  const size = cn("h-4 w-4", className);
  if (code >= 95) return <CloudLightning className={cn(size, "text-violet-600")} />;
  if ((code >= 51 && code < 70) || code >= 80) {
    return <CloudRain className={cn(size, "text-sky-600")} />;
  }
  if (code === 0) return <Sun className={cn(size, "text-amber-500")} />;
  if (code <= 2) return <CloudSun className={cn(size, "text-amber-500")} />;
  return <Cloud className={cn(size, "text-zinc-500")} />;
}

type FieldsMapChromeProps = {
  align?: "start" | "end";
};

/** Погода — плаваюче скло на карті (сезон обирається в деталях поля) */
export function FieldsMapChrome({ align = "end" }: FieldsMapChromeProps) {
  const [location, setLocation] = useState<WeatherLocation>(
    DEFAULT_WEATHER_LOCATION
  );
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeResults, setPlaceResults] = useState<GeoSearchResult[]>([]);
  const [latDraft, setLatDraft] = useState(
    String(DEFAULT_WEATHER_LOCATION.latitude)
  );
  const [lngDraft, setLngDraft] = useState(
    String(DEFAULT_WEATHER_LOCATION.longitude)
  );

  useEffect(() => {
    const stored = readStoredWeatherLocation();
    setLocation(stored);
    setLatDraft(String(stored.latitude));
    setLngDraft(String(stored.longitude));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchWeather(location.latitude, location.longitude, controller.signal)
      .then((data) => {
        setWeather(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setWeather(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Помилка погоди");
      });

    return () => controller.abort();
  }, [location.latitude, location.longitude]);

  useEffect(() => {
    if (!settingsOpen) return;
    const q = placeQuery.trim();
    if (q.length < 2) {
      setPlaceResults([]);
      setPlaceError(null);
      setPlaceLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPlaceLoading(true);
      setPlaceError(null);
      searchPlaces(q, controller.signal)
        .then((results) => {
          setPlaceResults(results);
          setPlaceLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setPlaceResults([]);
          setPlaceLoading(false);
          setPlaceError(err instanceof Error ? err.message : "Помилка пошуку");
        });
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [placeQuery, settingsOpen]);

  function applyLocation(next: WeatherLocation) {
    setLocation(next);
    writeStoredWeatherLocation(next);
    setLatDraft(String(next.latitude));
    setLngDraft(String(next.longitude));
    setPlaceQuery("");
    setPlaceResults([]);
    setSettingsOpen(false);
  }

  function applyCustomCoords() {
    const latitude = Number(latDraft.replace(",", "."));
    const longitude = Number(lngDraft.replace(",", "."));
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      setError("Некоректні координати");
      return;
    }
    applyLocation({
      id: "custom",
      label: "Власна локація",
      latitude,
      longitude,
    });
  }

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-wrap items-center gap-2",
        align === "start" ? "justify-start" : "justify-end"
      )}
    >
      <div className="flex items-center gap-1 rounded-2xl border border-white/40 bg-background/75 py-1 pr-1 pl-2.5 shadow-lg backdrop-blur-xl">
        <div className="min-w-0 px-1">
          <div className="flex items-center gap-1.5">
            {loading && !weather ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            ) : weather ? (
              <WeatherGlyph code={weather.weatherCode} />
            ) : null}
            <span className="text-lg font-extrabold tabular-nums leading-none tracking-tight text-zinc-900">
              {weather ? `${weather.tempC}°` : error ? "—" : "…"}
            </span>
            <span className="hidden max-w-[7rem] truncate text-[11px] font-medium text-zinc-500 sm:inline">
              {error ? "Немає даних" : weather?.condition ?? "Погода"}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] font-medium tabular-nums text-zinc-500">
            <span className="inline-flex items-center gap-0.5 truncate">
              <MapPin className="h-2.5 w-2.5 shrink-0 text-amber-700" />
              <span className="max-w-[6.5rem] truncate">
                {location.label.trim() || "—"}
              </span>
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Wind className="h-2.5 w-2.5" />
              {weather ? `${weather.windMs}` : "—"}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Droplets className="h-2.5 w-2.5 text-sky-600" />
              {weather ? `${weather.humidityPercent}%` : "—"}
            </span>
          </div>
        </div>

        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger
            type="button"
            aria-label="Налаштування погоди"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/70 hover:text-zinc-800 md:h-8 md:w-8"
          >
            <Settings2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
          </PopoverTrigger>
            <PopoverContent
            align="end"
            className="w-[min(calc(100vw-1.5rem),20rem)] rounded-2xl border border-white/50 bg-background/95 p-3 text-zinc-900 shadow-xl backdrop-blur-xl"
          >
            <PopoverHeader>
              <PopoverTitle className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                <MapPin className="h-4 w-4 text-emerald-700" />
                Локація погоди
              </PopoverTitle>
            </PopoverHeader>

            <Input
              value={placeQuery}
              onChange={(event) => setPlaceQuery(event.target.value)}
              placeholder="Село, місто або вулиця…"
              className="mt-2 h-11 rounded-xl text-base md:h-9 md:text-sm"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Пошук локації погоди · не навігація по карті
            </p>

            {placeLoading ? (
              <p className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Шукаємо…
              </p>
            ) : null}
            {placeError ? (
              <p className="mt-2 text-xs text-amber-800">{placeError}</p>
            ) : null}

            {placeResults.length > 0 ? (
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {placeResults.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() =>
                        applyLocation({
                          id: result.id,
                          label: result.label,
                          latitude: result.latitude,
                          longitude: result.longitude,
                        })
                      }
                      className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm text-zinc-800 transition-colors hover:bg-white"
                    >
                      {result.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
              <div className="space-y-1">
                <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
                  Lat
                </Label>
                <Input
                  value={latDraft}
                  onChange={(event) => setLatDraft(event.target.value)}
                  className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
                  Lng
                </Label>
                <Input
                  value={lngDraft}
                  onChange={(event) => setLngDraft(event.target.value)}
                  className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={applyCustomCoords}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white transition-colors hover:bg-emerald-800"
            >
              Застосувати координати
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

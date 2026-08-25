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
  Sprout,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import { seasonLabel } from "@/lib/season";
import { useSeasonStore } from "@/lib/season-store";
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

/** Сезон + погода — плаваюче скло на карті */
export function FieldsMapChrome({ align = "end" }: FieldsMapChromeProps) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const availableSeasons = useSeasonStore((s) => s.availableSeasons);
  const setActiveSeason = useSeasonStore((s) => s.setActiveSeason);

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
      <Select
        value={String(activeSeason)}
        onValueChange={(v) => {
          if (typeof v === "string" && v) setActiveSeason(v);
        }}
      >
        <SelectTrigger
          className={cn(
            "h-10 min-h-10 min-w-[148px] gap-2 rounded-2xl border-white/40 bg-background/75 px-3",
            "text-sm font-semibold text-zinc-800 shadow-lg backdrop-blur-xl",
            "hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-emerald-600/30",
            "data-[size=default]:h-10 data-[size=default]:min-h-10"
          )}
          aria-label="Агросезон"
        >
          <Sprout className="h-3.5 w-3.5 text-emerald-700" />
          <SelectValue>{seasonLabel(String(activeSeason))}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[200px] rounded-xl">
          <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
            Агросезон (бер–лют)
          </div>
          {availableSeasons.map((year) => (
            <SelectItem key={year} value={year} className="rounded-lg">
              {seasonLabel(year)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/70 hover:text-zinc-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 rounded-2xl border border-white/50 bg-background/95 p-3 text-zinc-900 shadow-xl backdrop-blur-xl"
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
              className="mt-2 h-9 rounded-xl text-sm"
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
                      className="w-full rounded-xl px-2.5 py-2 text-left text-xs text-zinc-800 transition-colors hover:bg-white"
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
                  className="h-9 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
                  Lng
                </Label>
                <Input
                  value={lngDraft}
                  onChange={(event) => setLngDraft(event.target.value)}
                  className="h-9 rounded-xl text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={applyCustomCoords}
              className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl bg-emerald-700 text-xs font-bold text-white transition-colors hover:bg-emerald-800"
            >
              Застосувати координати
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

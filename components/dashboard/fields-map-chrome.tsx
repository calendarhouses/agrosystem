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
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchPlaces, type GeoSearchResult } from "@/lib/geocode";
import { useIsMobile } from "@/lib/use-mobile";
import { BootReveal } from "@/components/layout/boot-reveal";
import {
  DEFAULT_WEATHER_LOCATION,
  fetchWeather,
  readStoredWeatherLocation,
  WEATHER_BASE_LOCATIONS,
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

function WeatherSettingsForm({
  currentLocationId,
  placeQuery,
  setPlaceQuery,
  placeLoading,
  placeError,
  placeResults,
  latDraft,
  setLatDraft,
  lngDraft,
  setLngDraft,
  onPickPreset,
  onPickPlace,
  onApplyCoords,
}: {
  currentLocationId: string;
  placeQuery: string;
  setPlaceQuery: (value: string) => void;
  placeLoading: boolean;
  placeError: string | null;
  placeResults: GeoSearchResult[];
  latDraft: string;
  setLatDraft: (value: string) => void;
  lngDraft: string;
  setLngDraft: (value: string) => void;
  onPickPreset: (location: WeatherLocation) => void;
  onPickPlace: (result: GeoSearchResult) => void;
  onApplyCoords: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-2.5">
        <Label className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Швидкий вибір
        </Label>
        <div className="flex flex-wrap gap-2">
          {WEATHER_BASE_LOCATIONS.map((preset) => {
            const active = currentLocationId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-vaul-no-drag=""
                onClick={() => onPickPreset(preset)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors touch-manipulation",
                  active
                    ? "border-emerald-700 bg-emerald-700 text-white shadow-sm shadow-emerald-900/20"
                    : "border-[#E5DFD3] bg-white/90 text-zinc-700 hover:border-emerald-700/35 hover:bg-white"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <Label className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Пошук місця
        </Label>
        <Input
          value={placeQuery}
          onChange={(event) => setPlaceQuery(event.target.value)}
          placeholder="Село, місто або вулиця…"
          data-vaul-no-drag=""
          className="h-11 rounded-xl border-[#E5DFD3] bg-white/95 text-base shadow-sm md:h-9 md:text-sm"
        />
        <p className="text-[11px] leading-snug text-zinc-500">
          Лише для прогнозу погоди · карта не переміщується
        </p>

        {placeLoading ? (
          <p className="inline-flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Шукаємо…
          </p>
        ) : null}
        {placeError ? (
          <p className="text-xs font-medium text-amber-800">{placeError}</p>
        ) : null}

        {placeResults.length > 0 ? (
          <ul className="max-h-44 space-y-1.5 overflow-y-auto overscroll-contain rounded-xl border border-[#E5DFD3]/80 bg-white/70 p-1">
            {placeResults.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  data-vaul-no-drag=""
                  onClick={() => onPickPlace(result)}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm text-zinc-800 transition-colors hover:bg-[#F4F1EA] active:bg-[#EDE8DC]"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                  <span className="min-w-0 leading-snug">{result.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-[#E5DFD3]/80 bg-white/60 p-3">
        <Label className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Координати вручну
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
              Lat
            </Label>
            <Input
              value={latDraft}
              onChange={(event) => setLatDraft(event.target.value)}
              data-vaul-no-drag=""
              inputMode="decimal"
              className="h-11 rounded-xl border-[#E5DFD3] bg-white text-base md:h-9 md:text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-wider text-zinc-500 uppercase">
              Lng
            </Label>
            <Input
              value={lngDraft}
              onChange={(event) => setLngDraft(event.target.value)}
              data-vaul-no-drag=""
              inputMode="decimal"
              className="h-11 rounded-xl border-[#E5DFD3] bg-white text-base md:h-9 md:text-sm"
            />
          </div>
        </div>
        <button
          type="button"
          data-vaul-no-drag=""
          onClick={onApplyCoords}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white shadow-sm shadow-emerald-900/15 transition-colors hover:bg-emerald-800 active:scale-[0.99]"
        >
          Застосувати координати
        </button>
      </section>
    </div>
  );
}

/** Погода — плаваюче скло на карті (сезон обирається в деталях поля) */
export function FieldsMapChrome({ align = "end" }: FieldsMapChromeProps) {
  const isMobile = useIsMobile();
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

  const settingsTrigger = (
    <button
      type="button"
      aria-label="Налаштування погоди"
      onClick={() => setSettingsOpen(true)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/70 hover:text-zinc-800 md:h-8 md:w-8"
    >
      <Settings2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
    </button>
  );

  const settingsForm = (
    <WeatherSettingsForm
      currentLocationId={location.id}
      placeQuery={placeQuery}
      setPlaceQuery={setPlaceQuery}
      placeLoading={placeLoading}
      placeError={placeError}
      placeResults={placeResults}
      latDraft={latDraft}
      setLatDraft={setLatDraft}
      lngDraft={lngDraft}
      setLngDraft={setLngDraft}
      onPickPreset={applyLocation}
      onPickPlace={(result) =>
        applyLocation({
          id: result.id,
          label: result.label,
          latitude: result.latitude,
          longitude: result.longitude,
        })
      }
      onApplyCoords={applyCustomCoords}
    />
  );

  return (
    <BootReveal
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

        {isMobile ? (
          <>
            {settingsTrigger}
            <Drawer
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              dismissible
              modal={false}
              shouldScaleBackground={false}
              noBodyStyles
            >
              <DrawerContent className="max-h-[calc(92dvh-var(--app-bottom-inset))] gap-0 border-[#E5DFD3]/90 bg-[#F4F1EA] pb-3">
                <DrawerTitle className="sr-only">Локація погоди</DrawerTitle>
                <DrawerHandle />
                <DrawerHeader className="gap-1 border-b border-[#E5DFD3]/80 pb-3 pt-0">
                  <DrawerTitle className="flex items-center gap-2 text-base font-bold text-zinc-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-700/10">
                      <MapPin className="h-4 w-4 text-emerald-700" />
                    </span>
                    Локація погоди
                  </DrawerTitle>
                  <p className="pl-10 text-[12px] leading-snug text-zinc-500">
                    Джерело прогнозу для карти та полів
                  </p>
                </DrawerHeader>
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4"
                  data-allow-pan="true"
                  data-vaul-no-drag=""
                >
                  {settingsForm}
                </div>
              </DrawerContent>
            </Drawer>
          </>
        ) : (
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
              className="w-[min(calc(100vw-1.5rem),22rem)] rounded-2xl border border-[#E5DFD3]/80 bg-[#F4F1EA]/98 p-4 text-zinc-900 shadow-xl backdrop-blur-xl"
            >
              <PopoverHeader className="mb-1">
                <PopoverTitle className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                  <MapPin className="h-4 w-4 text-emerald-700" />
                  Локація погоди
                </PopoverTitle>
              </PopoverHeader>
              {settingsForm}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </BootReveal>
  );
}

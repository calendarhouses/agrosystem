"use client";

import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplet,
  Loader2,
  Sprout,
  Sun,
  Thermometer,
  Wind,
} from "lucide-react";

import type { HourlyForecastHour, WeatherSnapshot } from "@/lib/weather";
import { cn } from "@/lib/utils";

type FieldMicroclimateProps = {
  weather: WeatherSnapshot | null;
  hourly?: HourlyForecastHour[] | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
};

function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isCurrentHour(iso: string): boolean {
  const t = new Date(iso);
  const now = new Date();
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate() &&
    t.getHours() === now.getHours()
  );
}

function HourIcon({ code, precipMm }: { code: number; precipMm: number }) {
  const size = "h-5 w-5";
  if (code >= 95) {
    return <CloudLightning className={cn(size, "text-violet-500")} />;
  }
  if (precipMm > 0.05 || (code >= 51 && code < 70) || code >= 80) {
    return <CloudRain className={cn(size, "text-blue-500")} />;
  }
  if (code === 0) return <Sun className={cn(size, "text-amber-500")} />;
  if (code <= 2) return <CloudSun className={cn(size, "text-amber-500")} />;
  return <Cloud className={cn(size, "text-zinc-400")} />;
}

function MetricSep({ className }: { className?: string }) {
  return <span className={cn("text-zinc-300", className)}>|</span>;
}

/** Мікроклімат + компактний прогноз 12 год (стиль Apple Weather) */
export function FieldMicroclimate({
  weather,
  hourly = null,
  loading = false,
  error = null,
  className,
}: FieldMicroclimateProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-2xl border border-[#E5DFD3] bg-zinc-50 px-4 py-3.5">
        <p className="mb-3 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
          Мікроклімат ділянки
        </p>

        {loading ? (
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Завантаження…
          </p>
        ) : error ? (
          <p className="text-sm text-[#C05621]">{error}</p>
        ) : weather ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Thermometer className="h-4 w-4 shrink-0 text-[#C05621]" />
                {weather.tempC}°C
              </span>
              <MetricSep />
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Wind className="h-4 w-4 shrink-0 text-zinc-500" />
                {weather.windMs} м/с
              </span>
              <MetricSep />
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Droplet className="h-4 w-4 shrink-0 text-blue-500" />
                {weather.humidityPercent}%
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-amber-700/90">
              <span className="inline-flex items-center gap-1.5">
                <Sprout className="h-4 w-4 shrink-0" />
                Ґрунт
              </span>
              <MetricSep className="text-amber-700/35" />
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Thermometer className="h-4 w-4 shrink-0" />
                {weather.soilTempC != null ? `${weather.soilTempC}°C` : "—"}
              </span>
              <MetricSep className="text-amber-700/35" />
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Droplet className="h-4 w-4 shrink-0" />
                {weather.soilMoisturePercent != null
                  ? `${weather.soilMoisturePercent}%`
                  : "—"}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Немає даних</p>
        )}
      </div>

      {!loading && !error && hourly && hourly.length > 0 ? (
        <div className="rounded-2xl border border-[#E5DFD3]/80 bg-[#EBE5D9]/50 px-4 py-3.5 backdrop-blur-md">
          <p className="mb-3 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
            Прогноз на 12 год
          </p>
          <div
            className="no-scrollbar flex gap-1 overflow-x-auto"
            role="list"
            aria-label="Погодинний прогноз"
          >
            {hourly.map((hour) => {
              const now = isCurrentHour(hour.time);
              return (
                <div
                  key={hour.time}
                  role="listitem"
                  className={cn(
                    "flex w-[3.25rem] shrink-0 flex-col items-center gap-1 rounded-xl px-0.5 py-1.5",
                    now && "bg-white/70 shadow-sm"
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      now ? "font-bold text-[#276749]" : "text-zinc-500"
                    )}
                  >
                    {now ? "Зараз" : hourLabel(hour.time)}
                  </span>
                  <HourIcon
                    code={hour.weatherCode}
                    precipMm={hour.precipitationMm}
                  />
                  {hour.precipProbability > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-500 tabular-nums">
                      <Droplet className="h-3 w-3 shrink-0" />
                      {hour.precipProbability}%
                    </span>
                  ) : (
                    <span className="h-4" aria-hidden />
                  )}
                  <span className="text-sm font-bold text-zinc-900 tabular-nums">
                    {hour.tempC}°
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

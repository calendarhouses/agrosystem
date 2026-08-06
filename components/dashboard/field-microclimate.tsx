"use client";

import { Droplets, Loader2, Wind } from "lucide-react";

import type { WeatherSnapshot } from "@/lib/weather";
import { cn } from "@/lib/utils";

type FieldMicroclimateProps = {
  weather: WeatherSnapshot | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
};

/** Компактний блок мікроклімату ділянки (Premium Clay) */
export function FieldMicroclimate({
  weather,
  loading = false,
  error = null,
  className,
}: FieldMicroclimateProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#E5DFD3] bg-zinc-100/80 px-3.5 py-3",
        className
      )}
    >
      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
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
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-zinc-900">
          <span className="tabular-nums">🌡️ {weather.tempC}°C</span>
          <span className="text-zinc-300">|</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Wind className="h-3.5 w-3.5 text-zinc-500" />
            {weather.windMs} м/с
          </span>
          <span className="text-zinc-300">|</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Droplets className="h-3.5 w-3.5 text-[#C05621]" />
            {weather.humidityPercent}%
          </span>
        </p>
      ) : (
        <p className="text-sm text-zinc-500">Немає даних</p>
      )}
    </div>
  );
}

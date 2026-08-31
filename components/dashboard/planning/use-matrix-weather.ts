"use client";

import { useEffect, useState } from "react";

import { DEFAULT_WEATHER_LOCATION } from "@/lib/weather";

export type MatrixDayWeather = {
  precipitationMm: number;
};

/** Добовий сумарний опад (Open-Meteo, ~16 днів прогнозу) */
export function useMatrixWeather() {
  const [precipByDay, setPrecipByDay] = useState<
    ReadonlyMap<string, MatrixDayWeather>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set(
          "latitude",
          String(DEFAULT_WEATHER_LOCATION.latitude)
        );
        url.searchParams.set(
          "longitude",
          String(DEFAULT_WEATHER_LOCATION.longitude)
        );
        url.searchParams.set("daily", "precipitation_sum");
        url.searchParams.set("forecast_days", "16");
        url.searchParams.set("timezone", "Europe/Kyiv");

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          daily?: {
            time?: string[];
            precipitation_sum?: number[];
          };
        };

        const times = data.daily?.time ?? [];
        const sums = data.daily?.precipitation_sum ?? [];
        const next = new Map<string, MatrixDayWeather>();

        for (let i = 0; i < times.length; i++) {
          const raw = times[i];
          if (!raw) continue;
          const ymd = raw.slice(0, 10);
          next.set(ymd, {
            precipitationMm: Number(sums[i]) || 0,
          });
        }

        if (!cancelled) setPrecipByDay(next);
      } catch {
        /* offline / abort */
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return precipByDay;
}

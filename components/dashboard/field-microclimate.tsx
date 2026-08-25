"use client";

import {
  CheckCircle2,
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

import {
  evaluateFieldWeatherAdvisory,
  type FieldWeatherAdvisory,
  type HourlyForecastHour,
  type WeatherSnapshot,
} from "@/lib/weather";
import { phenologyCycleDays } from "@/lib/field-operation-norms";
import { cn } from "@/lib/utils";

type FieldMicroclimateProps = {
  weather: WeatherSnapshot | null;
  hourly?: HourlyForecastHour[] | null;
  loading?: boolean;
  error?: string | null;
  /** Днів від останнього completed «Посів»; null = блок фенології приховано */
  daysSinceSowing?: number | null;
  /** Культура з паспорта поля — для сезонних підказок і шкали фенології */
  crop?: string;
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

function HourIcon({
  code,
  precipMm,
  className,
}: {
  code: number;
  precipMm: number;
  className?: string;
}) {
  const size = cn("h-5 w-5", className);
  if (code >= 95) {
    return <CloudLightning className={cn(size, "text-violet-500")} />;
  }
  if (precipMm > 0.05 || (code >= 51 && code < 70) || code >= 80) {
    return <CloudRain className={cn(size, "text-sky-500")} />;
  }
  if (code === 0) return <Sun className={cn(size, "text-amber-500")} />;
  if (code <= 2) return <CloudSun className={cn(size, "text-amber-500")} />;
  return <Cloud className={cn(size, "text-zinc-400")} />;
}

function formatSoilTemp(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? `${value}°C` : `${value.toFixed(1)}°C`;
}

const ADVISORY_STYLES: Record<
  FieldWeatherAdvisory["tone"],
  { className: string; Icon: typeof CheckCircle2 }
> = {
  good: {
    className:
      "border-emerald-200/80 bg-emerald-50/90 text-emerald-700",
    Icon: CheckCircle2,
  },
  caution: {
    className: "border-amber-200/70 bg-amber-50/80 text-amber-800",
    Icon: Thermometer,
  },
  bad: {
    className: "border-rose-200/80 bg-rose-50/90 text-rose-700",
    Icon: CloudLightning,
  },
  neutral: {
    className: "border-zinc-200/80 bg-zinc-50/90 text-zinc-700",
    Icon: CloudSun,
  },
};

function FieldWeatherAdvisoryBadge({
  advisory,
}: {
  advisory: FieldWeatherAdvisory;
}) {
  const { className, Icon } = ADVISORY_STYLES[advisory.tone];

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        className
      )}
    >
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {advisory.title}
      </p>
      {advisory.detail ? (
        <p className="mt-1 pl-5 text-[10px] leading-snug opacity-90">
          {advisory.detail}
        </p>
      ) : null}
    </div>
  );
}

function formatCropLabel(crop: string): string {
  const trimmed = crop.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return "Культура";
  return trimmed;
}

function pluralDaysUk(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "днів";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дні";
  return "днів";
}

function PhenologyBar({
  daysSinceSowing,
  crop,
}: {
  daysSinceSowing: number;
  crop: string;
}) {
  const cycleDays = phenologyCycleDays(crop);
  const progress = Math.min(
    100,
    Math.round((daysSinceSowing / cycleDays) * 100)
  );
  const cropLabel = formatCropLabel(crop);
  const dayWord = pluralDaysUk(daysSinceSowing);

  return (
    <div className="mt-4 rounded-xl border border-white/70 bg-white/60 p-3.5 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#276749] uppercase">
          <Sprout className="h-3.5 w-3.5" />
          Фенологія
        </p>
        <span className="text-xs font-bold text-zinc-700 tabular-nums">
          {daysSinceSowing} {dayWord}
        </span>
      </div>
      <p className="mb-2.5 text-sm leading-snug text-zinc-700">
        <span className="font-semibold text-zinc-900">{cropLabel}</span> росте вже{" "}
        <span className="font-semibold tabular-nums text-[#276749]">
          {daysSinceSowing} {dayWord}
        </span>{" "}
        <span className="text-zinc-500">
          (орієнтовний цикл {cycleDays} днів)
        </span>
      </p>
      <div
        className="h-2 overflow-hidden rounded-full bg-[#276749]/10"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${cropLabel}: ${daysSinceSowing} з ${cycleDays} днів`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#276749] via-[#3d8f5c] to-[#68d391] transition-all duration-500"
          style={{ width: `${Math.max(progress, 4)}%` }}
        />
      </div>
    </div>
  );
}

const glassCardClass =
  "rounded-xl border border-white/70 bg-white/80 p-3.5 shadow-sm backdrop-blur-md";

/** Мікроклімат + компактний прогноз 12 год */
export function FieldMicroclimate({
  weather,
  hourly = null,
  loading = false,
  error = null,
  daysSinceSowing = null,
  crop = "",
  className,
}: FieldMicroclimateProps) {
  const advisory = weather
    ? evaluateFieldWeatherAdvisory(weather, {
        crop,
        daysSinceSowing,
        hourly: hourly ?? undefined,
      })
    : null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-sm backdrop-blur-md">
        <div className="border-b border-white/50 px-4 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
            Стан поля
          </p>
        </div>

        <div className="px-4 py-4">
          {loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Завантаження…
            </p>
          ) : error ? (
            <p className="text-sm text-[#C05621]">{error}</p>
          ) : weather ? (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-50 ring-1 ring-sky-100">
                  <HourIcon
                    code={weather.weatherCode}
                    precipMm={0}
                    className="!h-7 !w-7"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">
                    Атмосфера
                  </p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-zinc-900 tabular-nums leading-none">
                    {weather.tempC}°
                  </p>
                  <p className="mt-1.5 text-sm font-medium text-zinc-600">
                    {weather.condition}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className={glassCardClass}>
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    <Wind className="h-3 w-3" />
                    Вітер
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-zinc-900 tabular-nums">
                    {weather.windMs}
                    <span className="ml-1 text-[11px] font-semibold text-zinc-400">
                      м/с
                    </span>
                  </p>
                </div>
                <div className={glassCardClass}>
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    <Droplet className="h-3 w-3 text-sky-500" />
                    Вологість
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-zinc-900 tabular-nums">
                    {weather.humidityPercent}
                    <span className="ml-1 text-[11px] font-semibold text-zinc-400">
                      %
                    </span>
                  </p>
                </div>
                <div className={glassCardClass}>
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    <Thermometer className="h-3 w-3 text-amber-600" />
                    T ґрунту
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-zinc-900 tabular-nums">
                    {formatSoilTemp(weather.soilTempC)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">18 см</p>
                </div>
                <div className={glassCardClass}>
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    <Droplet className="h-3 w-3 text-emerald-600" />
                    Волога ґрунту
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-zinc-900 tabular-nums">
                    {weather.soilMoisturePercent != null
                      ? `${weather.soilMoisturePercent}%`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">3–9 см</p>
                </div>
              </div>

              {advisory ? <FieldWeatherAdvisoryBadge advisory={advisory} /> : null}

              {daysSinceSowing != null && daysSinceSowing >= 0 ? (
                <PhenologyBar daysSinceSowing={daysSinceSowing} crop={crop} />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Немає даних</p>
          )}
        </div>
      </div>

      {!loading && !error && hourly && hourly.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-4 py-3.5 shadow-sm backdrop-blur-md">
          <p className="mb-3 text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
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
                    now && "bg-[#276749]/10 ring-1 ring-[#276749]/20"
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
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-500 tabular-nums">
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

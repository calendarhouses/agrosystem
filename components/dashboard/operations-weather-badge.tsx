import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Sun,
} from "lucide-react";

import type { WeatherContext } from "@/lib/field-timeline-types";
import { cn } from "@/lib/utils";

function WeatherConditionIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  switch (icon) {
    case "sun":
      return <Sun className={className} aria-hidden />;
    case "cloud-sun":
      return <CloudSun className={className} aria-hidden />;
    case "cloud-rain":
      return <CloudRain className={className} aria-hidden />;
    case "cloud-lightning":
      return <CloudLightning className={className} aria-hidden />;
    default:
      return <Cloud className={className} aria-hidden />;
  }
}

export function OperationsWeatherBadge({
  weatherContext,
  desktop = false,
}: {
  weatherContext: WeatherContext | null;
  desktop?: boolean;
}) {
  if (!weatherContext) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
        "text-[10px] font-medium tracking-wide",
        desktop
          ? "border-zinc-200/90 bg-zinc-900/[0.04] text-zinc-500"
          : "ml-2 border-white/10 bg-white/5 text-zinc-400"
      )}
      title={weatherContext.condition}
      aria-label={`Погода: ${weatherContext.condition}, ${weatherContext.temp}°C, вологість ${weatherContext.humidity}%`}
    >
      <WeatherConditionIcon
        icon={weatherContext.icon}
        className="size-3 shrink-0 opacity-90"
      />
      <span className="tabular-nums">{weatherContext.temp}°C</span>
      <span className="inline-flex items-center gap-0.5 tabular-nums opacity-90">
        <Droplets className="size-2.5 shrink-0" aria-hidden />
        {weatherContext.humidity}%
      </span>
    </span>
  );
}

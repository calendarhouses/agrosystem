"use client";

import {
  AlertTriangle,
  CheckCircle,
  Droplets,
  Sprout,
  Tractor,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  findCropOperationById,
  type IdealConditions,
} from "@/lib/agronomy-dictionary";
import type {
  AgroCurrentWeather,
  AgroInsightStatus,
  InsightCardData,
} from "@/lib/agronomy-engine";
import { formatApproxUah } from "@/lib/agronomy-resources";
import { cn } from "@/lib/utils";

export type MeteoChip = {
  id: string;
  label: string;
  ok: boolean;
};

function formatSignedTemp(c: number): string {
  const rounded = Math.round(c * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°C`;
}

function isRaining(weather: AgroCurrentWeather | null | undefined): boolean {
  if (!weather) return false;
  if (typeof weather.isRaining === "boolean") return weather.isRaining;
  if (
    typeof weather.precipitationMm === "number" &&
    weather.precipitationMm > 0.2
  ) {
    return true;
  }
  const code = weather.weatherCode;
  if (typeof code !== "number") return false;
  return (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code === 95 ||
    code === 96 ||
    code === 99
  );
}

/** 3 мікро-метрики для приладової панелі картки */
export function buildMeteoChips(
  conditions: IdealConditions,
  weather: AgroCurrentWeather | null | undefined,
  status: AgroInsightStatus
): MeteoChip[] {
  const planning = status === "PLANNING" || !weather;
  const chips: MeteoChip[] = [];

  if (typeof conditions.minSoilTemp === "number") {
    const soil = weather?.soilTempC;
    if (planning || soil == null) {
      chips.push({
        id: "soil",
        label: `Ґрунт ≥ ${conditions.minSoilTemp}°C`,
        ok: status === "PERFECT_CONDITIONS",
      });
    } else {
      chips.push({
        id: "soil",
        label: `Ґрунт ${formatSignedTemp(soil)}`,
        ok: soil >= conditions.minSoilTemp,
      });
    }
  } else {
    chips.push({
      id: "soil",
      label:
        weather?.soilTempC != null
          ? `Ґрунт ${formatSignedTemp(weather.soilTempC)}`
          : "Ґрунт —",
      ok: status !== "WAITING_WEATHER",
    });
  }

  if (typeof conditions.maxWind === "number") {
    const wind = weather?.windMs;
    if (planning || wind == null || !Number.isFinite(wind)) {
      chips.push({
        id: "wind",
        label: `Вітер ≤ ${conditions.maxWind} м/с`,
        ok: status === "PERFECT_CONDITIONS",
      });
    } else {
      chips.push({
        id: "wind",
        label: `Вітер ${Math.round(wind * 10) / 10} м/с`,
        ok: wind <= conditions.maxWind,
      });
    }
  } else if (weather && Number.isFinite(weather.windMs)) {
    chips.push({
      id: "wind",
      label: `Вітер ${Math.round(weather.windMs * 10) / 10} м/с`,
      ok: status !== "WAITING_WEATHER",
    });
  } else {
    chips.push({
      id: "wind",
      label: "Вітер —",
      ok: status === "PERFECT_CONDITIONS" || status === "PLANNING",
    });
  }

  if (conditions.requiresNoRain === true) {
    const raining = isRaining(weather);
    chips.push({
      id: "rain",
      label: planning
        ? "Без дощу"
        : raining
          ? "Дощ / вологість"
          : "Без дощу",
      ok: planning
        ? status === "PERFECT_CONDITIONS" || status === "PLANNING"
        : !raining,
    });
  } else if (typeof conditions.maxAirTemp === "number") {
    const air = weather?.tempC;
    if (planning || air == null) {
      chips.push({
        id: "air",
        label: `Повітря ≤ ${conditions.maxAirTemp}°C`,
        ok: status === "PERFECT_CONDITIONS",
      });
    } else {
      chips.push({
        id: "air",
        label: `Повітря ${formatSignedTemp(air)}`,
        ok: air <= conditions.maxAirTemp,
      });
    }
  } else {
    chips.push({
      id: "rain",
      label: "Вікно робіт",
      ok: status !== "WAITING_WEATHER",
    });
  }

  return chips.slice(0, 3);
}

function operationIcon(operationName: string, type: string): {
  Icon: LucideIcon;
  wrap: string;
  fg: string;
} {
  const n = operationName.toLowerCase();
  if (n.includes("посів")) {
    return {
      Icon: Sprout,
      wrap: "bg-emerald-500/15",
      fg: "text-emerald-700 dark:text-emerald-400",
    };
  }
  if (
    n.includes("гербіцид") ||
    n.includes("десик") ||
    n.includes("ззр") ||
    type === "ТМЦ"
  ) {
    return {
      Icon: Droplets,
      wrap: "bg-sky-500/15",
      fg: "text-sky-700 dark:text-sky-400",
    };
  }
  if (n.includes("збір") || type === "Збір") {
    return {
      Icon: Wheat,
      wrap: "bg-amber-500/15",
      fg: "text-amber-800 dark:text-amber-400",
    };
  }
  return {
    Icon: Tractor,
    wrap: "bg-primary/10",
    fg: "text-primary",
  };
}

type SmartInsightCardProps = {
  insight: InsightCardData;
  weather?: AgroCurrentWeather | null;
  onPlan: (insight: InsightCardData) => void;
  onOrderTmc: (insight: InsightCardData) => void;
};

export function SmartInsightCard({
  insight,
  weather = null,
  onPlan,
  onOrderTmc,
}: SmartInsightCardProps) {
  const op = findCropOperationById(insight.operationId);
  const chips = buildMeteoChips(
    op?.idealConditions ?? {},
    weather,
    insight.status
  );
  const { Icon, wrap, fg } = operationIcon(
    insight.operationName,
    insight.operationType
  );

  const resource = insight.resourceStatus;
  const fleet = insight.fleetStatus;
  const needsTmc = resource.requiredQty > 0;
  const isDeficit = resource.status === "DEFICIT";
  const fleetBusy = fleet.status === "BUSY";
  const costLabel = formatApproxUah(insight.estimatedCost.totalUah);

  return (
    <TooltipProvider delay={120}>
      <article
        className={cn(
          "group relative overflow-hidden rounded-3xl p-5 pb-16",
          "border border-border/50 bg-card/40 shadow-sm backdrop-blur-2xl",
          "transition-all hover:shadow-md"
        )}
      >
        <div
          className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100"
          aria-hidden
        />

        {insight.isCriticalPriority ? (
          <Badge
            variant="destructive"
            className="absolute top-3 right-3 z-10 animate-pulse border-0"
          >
            Критичний пріоритет
          </Badge>
        ) : null}

        <div className="relative flex items-start justify-between gap-3 pr-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                wrap,
                fg
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                {insight.operationName}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {insight.crop}
              </p>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger
              delay={120}
              className={cn(
                "inline-flex h-auto shrink-0 cursor-default items-center justify-center rounded-4xl border-0 px-2.5 py-1 outline-none",
                "bg-slate-900 font-mono text-[11px] font-medium tracking-tight text-white",
                "dark:bg-white dark:text-black",
                insight.isCriticalPriority && "mt-8"
              )}
            >
              {costLabel}
            </TooltipTrigger>
            <TooltipContent>
              Орієнтовний бюджет (ТМЦ + Паливо)
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {insight.fields.map((field) => (
            <span
              key={field.id}
              className="rounded-md border border-border/60 bg-background/50 px-2 py-1 text-xs text-muted-foreground"
            >
              {field.name}
              {field.areaHa != null && Number.isFinite(field.areaHa)
                ? ` · ${Math.round(field.areaHa * 10) / 10} га`
                : ""}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className={cn(
                "flex items-center gap-1 text-xs",
                chip.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  chip.ok ? "bg-emerald-500" : "bg-amber-500"
                )}
              />
              {chip.label}
            </span>
          ))}
        </div>

        {needsTmc ? (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Забезпечення ресурсами
            </p>
            {isDeficit ? (
              <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 p-2 text-rose-500">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="text-xs leading-snug">
                  Дефіцит ТМЦ: бракує {resource.deficitQty} {resource.unit}
                  {resource.item ? ` («${resource.item}»)` : ""}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2 text-emerald-500">
                <CheckCircle size={16} className="shrink-0" />
                <span className="text-xs leading-snug">
                  Ресурси в наявності (Склад: {resource.availableQty}{" "}
                  {resource.unit})
                </span>
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Забезпечення технікою
          </p>
          {fleetBusy ? (
            <span className="flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-1 text-xs text-rose-500">
              <Tractor size={14} />
              Техніка зайнята / В ремонті
              {fleet.totalMatching > 0
                ? ` (вільно ${fleet.availableCount} з ${fleet.requiredCount})`
                : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-500">
              <Tractor size={14} />
              Доступно {fleet.availableCount} {fleet.unitLabel}
            </span>
          )}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground italic">
          {insight.explanation}
        </p>

        <div className="absolute right-4 bottom-4">
          {isDeficit && needsTmc ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOrderTmc(insight)}
              className={cn(
                "rounded-full px-4 shadow-lg",
                "bg-orange-600 text-white hover:bg-orange-700"
              )}
            >
              🛒 Замовити ТМЦ
            </Button>
          ) : fleetBusy ? (
            <Button
              type="button"
              size="sm"
              disabled
              className="rounded-full px-4 shadow-lg opacity-70"
              title="Немає вільної техніки для цієї операції"
            >
              Техніка недоступна
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onPlan(insight)}
              className={cn(
                "rounded-full px-4 shadow-lg",
                insight.status === "PERFECT_CONDITIONS" && "animate-pulse"
              )}
            >
              🚜 Спланувати наряд
            </Button>
          )}
        </div>
      </article>
    </TooltipProvider>
  );
}

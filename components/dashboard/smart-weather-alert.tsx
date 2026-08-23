"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CloudLightning, Loader2, Wind } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fieldCentroid } from "@/lib/field-centroid";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  evaluateSprayWeatherConditions,
  fetchPlanningWeather,
  isSprayOperationType,
  pickWeatherAtTime,
  type PlanningWeatherHour,
} from "@/lib/weather";
import { cn } from "@/lib/utils";

type SmartWeatherAlertProps = {
  workType: string;
  date: string;
  timeFrom: string;
  fieldGeometry?: FieldGeometry | null;
  className?: string;
};

export function SmartWeatherAlert({
  workType,
  date,
  timeFrom,
  fieldGeometry = null,
  className,
}: SmartWeatherAlertProps) {
  const sprayOp = isSprayOperationType(workType);
  const centroid = useMemo(
    () => fieldCentroid(fieldGeometry),
    [fieldGeometry]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hourly, setHourly] = useState<PlanningWeatherHour[]>([]);

  useEffect(() => {
    if (!sprayOp || !centroid) {
      setHourly([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchPlanningWeather(
      centroid.latitude,
      centroid.longitude,
      controller.signal
    )
      .then(({ hourly: rows }) => {
        setHourly(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHourly([]);
        setLoading(false);
        setError(
          err instanceof Error ? err.message : "Не вдалося завантажити прогноз"
        );
      });

    return () => controller.abort();
  }, [sprayOp, centroid?.latitude, centroid?.longitude]);

  const slot = useMemo(
    () => pickWeatherAtTime(hourly, date, timeFrom),
    [hourly, date, timeFrom]
  );

  if (!sprayOp) return null;

  if (!centroid) {
    return (
      <Alert
        className={cn(
          "border-zinc-200 bg-zinc-50 text-zinc-700",
          className
        )}
      >
        <CloudLightning className="text-zinc-500" />
        <AlertTitle>Погода для обприскування</AlertTitle>
        <AlertDescription>
          Немає контуру поля — привʼяжіть геометрію, щоб перевірити вітер і
          температуру.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading && hourly.length === 0) {
    return (
      <Alert
        className={cn(
          "border-sky-200/80 bg-sky-50/80 text-sky-950",
          className
        )}
      >
        <Loader2 className="animate-spin text-sky-600" />
        <AlertTitle>Перевірка погоди…</AlertTitle>
        <AlertDescription>
          Open-Meteo · {date} о {timeFrom}
        </AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert
        className={cn(
          "border-amber-200 bg-amber-50 text-amber-950",
          className
        )}
      >
        <CloudLightning className="text-amber-700" />
        <AlertTitle>Прогноз недоступний</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!slot) {
    return (
      <Alert
        className={cn(
          "border-zinc-200 bg-zinc-50 text-zinc-700",
          className
        )}
      >
        <CloudLightning className="text-zinc-500" />
        <AlertTitle>Немає прогнозу на цей час</AlertTitle>
        <AlertDescription>
          Оберіть дату в межах 7 днів від сьогодні.
        </AlertDescription>
      </Alert>
    );
  }

  const verdict = evaluateSprayWeatherConditions(slot.windMs, slot.tempC);

  if (verdict === "warning") {
    return (
      <Alert
        className={cn(
          "border-amber-300 bg-amber-50 text-amber-950",
          className
        )}
      >
        <Wind className="text-amber-700" />
        <AlertTitle>Увага: несприятливі умови для обприскування</AlertTitle>
        <AlertDescription>
          Вітер: {slot.windMs} м/с, T: {slot.tempC}°C. Ризик знесення препарату.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      className={cn(
        "border-emerald-200 bg-emerald-50 text-emerald-950",
        className
      )}
    >
      <CheckCircle2 className="text-emerald-700" />
      <AlertTitle>Погодні умови оптимальні для обраного часу</AlertTitle>
      <AlertDescription>
        Вітер: {slot.windMs} м/с · T: {slot.tempC}°C · {date} о {timeFrom}
      </AlertDescription>
    </Alert>
  );
}

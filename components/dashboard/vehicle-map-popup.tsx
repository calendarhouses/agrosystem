"use client";

import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { ArrowRight, Fuel, Gauge, X } from "lucide-react";
import Link from "next/link";

import {
  parseWialonUnitTelemetry,
  type WialonUnit,
} from "@/lib/wialon";

type VehicleMapPopupProps = {
  unit: WialonUnit;
  onClose: () => void;
};

function lastContactLabel(unit: WialonUnit): string {
  const unix = unit.lmsg?.t ?? unit.pos?.t;
  if (unix == null || !Number.isFinite(unix) || unix <= 0) {
    return "Немає даних";
  }
  try {
    return formatDistanceToNow(new Date(unix * 1000), {
      addSuffix: true,
      locale: uk,
    });
  } catch {
    return "Немає даних";
  }
}

/** Попап техніки на карті полів — компактний, кнопка завжди видима */
export function VehicleMapPopup({ unit, onClose }: VehicleMapPopupProps) {
  const speed = Math.max(0, Math.round(Number(unit.pos?.s ?? 0)));
  const isMoving = speed > 0;

  const telemetry = useMemo(() => parseWialonUnitTelemetry(unit), [unit]);
  const fuelLiters = telemetry.fuelLiters;
  const hasFuelData =
    fuelLiters !== undefined &&
    fuelLiters !== null &&
    Number.isFinite(fuelLiters) &&
    fuelLiters >= 0;

  const lastContact = lastContactLabel(unit);

  return (
    <div className="absolute bottom-3 left-3 z-50 flex w-[min(100%-1.5rem,320px)] max-h-[min(100%-1.5rem,420px)] flex-col overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white text-zinc-900 shadow-xl">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3.5 pt-3.5 pb-2">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold tracking-tight text-zinc-900">
              {unit.nm}
            </p>
            {isMoving ? (
              <span className="mt-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                У русі
              </span>
            ) : (
              <span className="mt-1 inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                Зупинка
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Закрити"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <Gauge className="h-3.5 w-3.5 text-amber-500" />
              Швидкість
            </div>
            <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
              {speed}{" "}
              <span className="text-xs font-semibold text-zinc-400">км/год</span>
            </p>
          </div>

          <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <Fuel className="h-3.5 w-3.5 text-emerald-600" />
              Паливо
            </div>
            {hasFuelData ? (
              <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
                {Math.round(fuelLiters).toLocaleString("uk-UA")}{" "}
                <span className="text-xs font-semibold text-zinc-400">л</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-medium text-zinc-400">Немає ДУТ</p>
            )}
          </div>

          <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-zinc-500">
              Останній звʼязок
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">
              {lastContact}
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-100 p-3">
        <Link
          href={`/equipment?id=${unit.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          Деталі в Моніторингу
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

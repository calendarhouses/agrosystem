"use client";

import { useState } from "react";
import {
  CloudSun,
  Droplets,
  Map as MapIcon,
  Sparkles,
  Wind,
} from "lucide-react";

import { FieldDetailSheet } from "@/components/dashboard/field-detail-sheet";
import { HeaderPanel, PageHeader } from "@/components/layout/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import {
  ACCENT_STYLES,
  AI_INSIGHT,
  DASHBOARD_SUMMARY,
  FIELDS,
  type Field,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

/** Агро-ШІ — панель тієї ж висоти, що заголовок і погода */
function AgroAiChip() {
  return (
    <HeaderPanel className="flex h-full min-h-[7.5rem] flex-col justify-center gap-2 border-[#276749]/25 bg-[#276749]/10 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#276749]/30 bg-[#F4F1EA] text-[#276749]">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-[#276749]">Агро-ШІ Асистент</p>
        <span className="ml-auto rounded-full border border-[#276749]/30 bg-[#F4F1EA] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#276749] uppercase">
          Live
        </span>
      </div>
      <p className="line-clamp-2 text-sm leading-snug text-zinc-900">
        <span className="font-semibold text-[#276749]">{AI_INSIGHT.title}:</span>{" "}
        {AI_INSIGHT.message}
      </p>
    </HeaderPanel>
  );
}

/** Погода — рівна картка з повітрям */
function WeatherChip() {
  const { weather } = DASHBOARD_SUMMARY;

  return (
    <HeaderPanel className="relative flex h-full min-h-[7.5rem] flex-col justify-between overflow-hidden px-4 py-4 sm:px-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full bg-[#D69E2E]/15"
      />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Агро-Погода
        </p>
        <span className="truncate text-[11px] text-zinc-500">{weather.region}</span>
      </div>

      <div className="relative mt-2 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#D69E2E]/30 bg-[#D69E2E]/15">
          <CloudSun className="h-6 w-6 text-[#D69E2E]" />
        </div>
        <div className="min-w-0">
          <p className="text-3xl font-extrabold tracking-tight text-zinc-900">
            {weather.tempC}
            <span className="text-lg font-semibold text-zinc-500">°C</span>
          </p>
          <p className="truncate text-sm text-zinc-500">{weather.condition}</p>
        </div>
      </div>

      <div className="relative mt-3 flex gap-2">
        <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 px-2 py-1.5 text-[11px] font-medium text-zinc-600">
          <Wind className="h-3 w-3 text-zinc-500" />
          {weather.windMs} м/с
        </span>
        <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#E5DFD3] bg-zinc-100 px-2 py-1.5 text-[11px] font-medium text-zinc-600">
          <Droplets className="h-3 w-3 text-[#C05621]" />
          {weather.humidityPercent}%
        </span>
      </div>
    </HeaderPanel>
  );
}

/** Головний розділ: карта полів + погода */
export function FieldsView() {
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openField(field: Field) {
    setSelectedField(field);
    setSheetOpen(true);
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-4 pt-3 pb-4 sm:px-6 lg:px-8">
      <PageHeader
        icon={MapIcon}
        title="Карта Полів"
        description={`${FIELDS.length} активні ділянки · ${DASHBOARD_SUMMARY.totalAreaHa} га`}
        panels={[<AgroAiChip key="ai" />, <WeatherChip key="weather" />]}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-5 lg:gap-5">
        <GlassCard className="flex min-h-0 flex-col hover:scale-100 lg:col-span-1">
          <p className="mb-3 text-sm font-medium text-zinc-500">Список ділянок</p>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {FIELDS.map((field) => {
              const accent = ACCENT_STYLES[field.accent];
              const active = selectedField?.id === field.id && sheetOpen;
              return (
                <li key={field.id}>
                  <button
                    type="button"
                    onClick={() => openField(field)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200",
                      active
                        ? "border-[#276749]/30 bg-[#276749]/10"
                        : "border-[#E5DFD3] bg-zinc-100 hover:border-[#E5DFD3] hover:bg-[#E5DFD3]/40"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        accent.dot
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {field.name}: {field.crop}
                      </p>
                      <p className="text-xs text-zinc-500">{field.areaHa} га</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </GlassCard>

        <GlassCard className="flex min-h-[420px] flex-col hover:scale-100 lg:col-span-4 lg:min-h-0">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
              <MapIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Інтерактивна карта</p>
              <p className="text-xs text-zinc-500/80">
                Натисніть плашку або пункт списку для економіки гектара
              </p>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
            <div
              aria-hidden
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "linear-gradient(#52525b 1px, transparent 1px), linear-gradient(90deg, #52525b 1px, transparent 1px)",
                backgroundSize: "32px 32px",
              }}
            />
            <div
              aria-hidden
              className={cn(
                "absolute top-[18%] left-[12%] h-36 w-52 rotate-[-8deg] rounded-[40%] border",
                ACCENT_STYLES.lime.shape
              )}
            />
            <div
              aria-hidden
              className={cn(
                "absolute top-[40%] right-[12%] h-40 w-56 rotate-[12deg] rounded-[45%] border",
                ACCENT_STYLES.amber.shape
              )}
            />
            <div
              aria-hidden
              className={cn(
                "absolute bottom-[14%] left-[30%] h-32 w-48 rotate-[-3deg] rounded-[42%] border",
                ACCENT_STYLES.orange.shape
              )}
            />

            {FIELDS.map((field) => {
              const accent = ACCENT_STYLES[field.accent];
              const active = selectedField?.id === field.id && sheetOpen;
              return (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => openField(field)}
                  className={cn(
                    "absolute z-10 flex items-center gap-2 rounded-full border px-3 py-2 backdrop-blur-sm",
                    "transition-all duration-200 hover:brightness-110",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                    accent.pill,
                    accent.glow,
                    active && "ring-2 ring-white/40",
                    field.mapPositionClass
                  )}
                >
                  <span className="h-2 w-2 rounded-full bg-white/90" />
                  <span className="text-xs font-semibold text-white">
                    {field.name}: {field.crop}
                  </span>
                  <span className="text-xs text-white/75">{field.areaHa} га</span>
                </button>
              );
            })}

            <div className="absolute right-3 bottom-3 rounded-lg border border-zinc-600 bg-zinc-800/90 px-2 py-1 text-[10px] tracking-widest text-zinc-300">
              N ↑
            </div>
          </div>
        </GlassCard>
      </div>

      <FieldDetailSheet
        field={selectedField}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </main>
  );
}

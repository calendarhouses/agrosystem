import type { FieldFuelPeriod } from "@/app/fuel/actions";
import { FUEL_KPI_LOAD_SEED_MS } from "@/lib/fuel-kpi-load-constants";
import { createServiceSupabase } from "@/lib/supabase/server";

export { FUEL_KPI_LOAD_SEED_MS } from "@/lib/fuel-kpi-load-constants";

const MIN_MS = 2_500;
const MAX_MS = 120_000;
const EMA_ALPHA = 0.4;

const PERIODS: FieldFuelPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "season",
];

export function clampFuelKpiLoadMs(ms: number): number {
  return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms)));
}

export function isFieldFuelPeriod(v: unknown): v is FieldFuelPeriod {
  return typeof v === "string" && PERIODS.includes(v as FieldFuelPeriod);
}

/** Очікуваний час повного циклу для періоду (DB EMA або seed). */
export async function getSharedFuelKpiLoadMs(
  period: FieldFuelPeriod
): Promise<number> {
  try {
    const sb = createServiceSupabase();
    const { data, error } = await sb
      .from("fuel_kpi_load_stats")
      .select("ema_ms")
      .eq("period", period)
      .maybeSingle();
    if (error || data?.ema_ms == null) {
      return FUEL_KPI_LOAD_SEED_MS[period];
    }
    return clampFuelKpiLoadMs(Number(data.ema_ms));
  } catch {
    return FUEL_KPI_LOAD_SEED_MS[period];
  }
}

export async function getAllSharedFuelKpiLoadMs(): Promise<
  Record<FieldFuelPeriod, number>
> {
  const out = { ...FUEL_KPI_LOAD_SEED_MS };
  try {
    const sb = createServiceSupabase();
    const { data, error } = await sb
      .from("fuel_kpi_load_stats")
      .select("period, ema_ms");
    if (error || !data) return out;
    for (const row of data) {
      if (isFieldFuelPeriod(row.period) && row.ema_ms != null) {
        out[row.period] = clampFuelKpiLoadMs(Number(row.ema_ms));
      }
    }
  } catch {
    /* seed */
  }
  return out;
}

/**
 * Підмішати новий замір у спільну EMA.
 * elapsedMs — повний цикл на клієнті (усі чанки до готових KPI).
 */
export async function recordSharedFuelKpiLoadMs(
  period: FieldFuelPeriod,
  elapsedMs: number
): Promise<number> {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 800) {
    return getSharedFuelKpiLoadMs(period);
  }
  const measured = clampFuelKpiLoadMs(elapsedMs);
  const sb = createServiceSupabase();

  const { data: existing } = await sb
    .from("fuel_kpi_load_stats")
    .select("ema_ms, samples")
    .eq("period", period)
    .maybeSingle();

  const prev =
    existing?.ema_ms != null
      ? clampFuelKpiLoadMs(Number(existing.ema_ms))
      : FUEL_KPI_LOAD_SEED_MS[period];
  const samples = Math.max(1, Number(existing?.samples) || 1);
  // Перші заміри важать більше; далі стабільна EMA
  const alpha = samples < 5 ? 0.55 : EMA_ALPHA;
  const next = clampFuelKpiLoadMs(prev * (1 - alpha) + measured * alpha);

  const { error } = await sb.from("fuel_kpi_load_stats").upsert(
    {
      period,
      ema_ms: next,
      samples: samples + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "period" }
  );

  if (error) {
    console.error("[fuel-kpi-load-stats]", error.message);
    return prev;
  }
  return next;
}

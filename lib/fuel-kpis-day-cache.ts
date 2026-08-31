/**
 * Durable day-cache KPI палива в Supabase.
 * In-memory Map на Vercel не шариться між інстансами — тому сезон
 * щоразу знову тягнув Wialon. Цей кеш — один на всіх до кінця дня Києва.
 */

import type { FieldFuelPeriod } from "@/app/fuel/actions";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";

const DAY_CACHE_PERIODS = new Set<FieldFuelPeriod>([
  "yesterday",
  "week",
  "month",
  "season",
]);

export function isFuelKpiDayCachePeriod(period: FieldFuelPeriod): boolean {
  return DAY_CACHE_PERIODS.has(period);
}

export async function readFuelKpisDayCache<T>(
  period: FieldFuelPeriod,
  dayYmd = todayKyivYmd()
): Promise<T | null> {
  if (!isFuelKpiDayCachePeriod(period)) return null;
  try {
    const sb = createServiceSupabase();
    const { data, error } = await sb
      .from("fuel_kpis_day_cache")
      .select("payload")
      .eq("period", period)
      .eq("day_ymd", dayYmd)
      .maybeSingle();
    if (error || data?.payload == null) return null;
    return data.payload as T;
  } catch (err) {
    console.error(
      "[fuel-kpis-day-cache] read",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function writeFuelKpisDayCache(
  period: FieldFuelPeriod,
  payload: unknown,
  dayYmd = todayKyivYmd()
): Promise<void> {
  if (!isFuelKpiDayCachePeriod(period)) return;
  try {
    const sb = createServiceSupabase();
    const { error } = await sb.from("fuel_kpis_day_cache").upsert(
      {
        period,
        day_ymd: dayYmd,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "period,day_ymd" }
    );
    if (error) {
      console.error("[fuel-kpis-day-cache] write", error.message);
    }
  } catch (err) {
    console.error(
      "[fuel-kpis-day-cache] write",
      err instanceof Error ? err.message : err
    );
  }
}

/** Видалити durable KPI за поточний календарний день Києва. */
export async function invalidateFuelKpisDayCache(
  dayYmd = todayKyivYmd()
): Promise<void> {
  try {
    const sb = createServiceSupabase();
    const { error } = await sb
      .from("fuel_kpis_day_cache")
      .delete()
      .eq("day_ymd", dayYmd);
    if (error) {
      console.error("[fuel-kpis-day-cache] invalidate", error.message);
    }
  } catch (err) {
    console.error(
      "[fuel-kpis-day-cache] invalidate",
      err instanceof Error ? err.message : err
    );
  }
}

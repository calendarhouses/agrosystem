/**
 * Інвалідація KPI палива після intraday sync-telemetry.
 * Фінансовий boot кешується на клієнті — оновлюється при наступному fetch без stale guard.
 */

import { clearFuelKpisServerCache } from "@/lib/fuel-kpis-cache";
import { invalidateFuelKpisDayCache } from "@/lib/fuel-kpis-day-cache";
import { todayKyivYmd } from "@/lib/kyiv-date";

export async function invalidateFuelKpisAfterTelemetrySync(
  now = new Date()
): Promise<void> {
  clearFuelKpisServerCache("fuel:kpis:");
  await invalidateFuelKpisDayCache(todayKyivYmd(now));
}

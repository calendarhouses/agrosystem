import { NextResponse } from "next/server";

import {
  getFieldFuelConsumed,
  getFuelRefueledForPeriod,
  type FieldFuelPeriod,
} from "@/app/fuel/actions";
import {
  endOfKyivDayMs,
  peekFuelKpisServerCache,
  writeFuelKpisServerCache,
} from "@/lib/fuel-kpis-cache";
import {
  isFuelKpiDayCachePeriod,
  readFuelKpisDayCache,
  writeFuelKpisDayCache,
} from "@/lib/fuel-kpis-day-cache";
import { getSharedFuelKpiLoadMs } from "@/lib/fuel-kpi-load-stats";
import { sumStorageVolumeForPeriod } from "@/lib/fuel-storage-period";
import { todayKyivYmd } from "@/lib/kyiv-date";

export const runtime = "nodejs";
export const maxDuration = 60;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

const PERIODS = new Set<FieldFuelPeriod>([
  "today",
  "yesterday",
  "week",
  "month",
  "season",
]);

function parsePeriod(raw: string | null): FieldFuelPeriod {
  if (raw && PERIODS.has(raw as FieldFuelPeriod)) {
    return raw as FieldFuelPeriod;
  }
  return "today";
}

type KpisPayload = {
  ok: true;
  period: FieldFuelPeriod;
  burned: Awaited<ReturnType<typeof getFieldFuelConsumed>>;
  refueled: Awaited<ReturnType<typeof getFuelRefueledForPeriod>>;
  storages: Awaited<ReturnType<typeof sumStorageVolumeForPeriod>> | null;
  expectedLoadMs: number;
};

/**
 * GET /api/fuel/kpis?period=today|week|month|season
 * Сезон/місяць/тиждень: спільний кеш у БД до кінця дня Києва (для всіх).
 */
export async function GET(request: Request) {
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const dayYmd = todayKyivYmd();
  const cacheKey = `fuel:kpis:${period}:${dayYmd}`;

  const mem = peekFuelKpisServerCache<KpisPayload>(cacheKey);
  if (mem) {
    const expectedLoadMs =
      mem.expectedLoadMs ?? (await getSharedFuelKpiLoadMs(period));
    return NextResponse.json(
      { ...mem, expectedLoadMs },
      { headers: JSON_UTF8 }
    );
  }

  if (isFuelKpiDayCachePeriod(period)) {
    const durable = await readFuelKpisDayCache<KpisPayload>(period, dayYmd);
    if (durable?.ok) {
      const expectedLoadMs =
        durable.expectedLoadMs ?? (await getSharedFuelKpiLoadMs(period));
      const payload = { ...durable, expectedLoadMs };
      writeFuelKpisServerCache(cacheKey, payload, endOfKyivDayMs());
      return NextResponse.json(payload, { headers: JSON_UTF8 });
    }
  }

  try {
    const [burned, refueled, storages, expectedLoadMs] = await Promise.all([
      getFieldFuelConsumed(period),
      getFuelRefueledForPeriod(period),
      sumStorageVolumeForPeriod(period).catch((err) => {
        console.error(
          "[fuel/kpis] storages",
          err instanceof Error ? err.message : err
        );
        return null;
      }),
      getSharedFuelKpiLoadMs(period),
    ]);

    const payload: KpisPayload = {
      ok: true,
      period,
      burned,
      refueled,
      storages,
      expectedLoadMs,
    };

    const incomplete =
      burned.ok === true && burned.data.coverageIncomplete === true;

    if (!incomplete && isFuelKpiDayCachePeriod(period)) {
      writeFuelKpisServerCache(cacheKey, payload, endOfKyivDayMs());
      void writeFuelKpisDayCache(period, payload, dayYmd);
    }

    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        period,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити KPI палива",
        burned: null,
        refueled: null,
        storages: null,
        expectedLoadMs: await getSharedFuelKpiLoadMs(period).catch(() => 9000),
      },
      { status: 502, headers: JSON_UTF8 }
    );
  }
}

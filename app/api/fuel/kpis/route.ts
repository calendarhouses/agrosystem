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

function isUsefulKpiPayload(payload: KpisPayload): boolean {
  const burnedOk =
    payload.burned?.ok === true &&
    (payload.burned.data.hasData ||
      payload.burned.data.liters > 0 ||
      (payload.burned.data.totalLiters ?? 0) > 0);
  const refuelOk =
    payload.refueled?.ok === true &&
    (payload.refueled.data.hasData || payload.refueled.data.liters > 0);
  return burnedOk || refuelOk;
}

/**
 * GET /api/fuel/kpis?period=today|week|month|season&backfill=1
 * Сезон на першому заході — лише БД (швидко, як місяць).
 * backfill=1 — дотягнути ще кілька днів з Wialon у фоні.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));
  const backfill = url.searchParams.get("backfill") === "1";
  const dayYmd = todayKyivYmd();
  const cacheKey = `fuel:kpis:${period}:${dayYmd}`;

  // Backfill завжди свіжий (не з кешу), щоб догрузити пропуски
  if (!backfill) {
    const mem = peekFuelKpisServerCache<KpisPayload>(cacheKey);
    if (mem && isUsefulKpiPayload(mem)) {
      const expectedLoadMs =
        mem.expectedLoadMs ?? (await getSharedFuelKpiLoadMs(period));
      return NextResponse.json(
        { ...mem, expectedLoadMs },
        { headers: JSON_UTF8 }
      );
    }

    if (isFuelKpiDayCachePeriod(period)) {
      const durable = await readFuelKpisDayCache<KpisPayload>(period, dayYmd);
      if (durable?.ok && isUsefulKpiPayload(durable)) {
        const expectedLoadMs =
          durable.expectedLoadMs ?? (await getSharedFuelKpiLoadMs(period));
        const payload = { ...durable, expectedLoadMs };
        writeFuelKpisServerCache(cacheKey, payload, endOfKyivDayMs());
        return NextResponse.json(payload, { headers: JSON_UTF8 });
      }
    }
  }

  try {
    const [burned, storages, expectedLoadMs] = await Promise.all([
      getFieldFuelConsumed(period, { backfill }),
      sumStorageVolumeForPeriod(period).catch((err) => {
        console.error(
          "[fuel/kpis] storages",
          err instanceof Error ? err.message : err
        );
        return null;
      }),
      getSharedFuelKpiLoadMs(period),
    ]);
    const refueled = await getFuelRefueledForPeriod(period, { backfill });

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

    if (
      !incomplete &&
      isUsefulKpiPayload(payload) &&
      isFuelKpiDayCachePeriod(period)
    ) {
      writeFuelKpisServerCache(cacheKey, payload, endOfKyivDayMs());
      void writeFuelKpisDayCache(period, payload, dayYmd);
    } else if (isUsefulKpiPayload(payload) && !backfill) {
      // Короткий mem-кеш навіть при incomplete — щоб повторний захід був швидкий
      writeFuelKpisServerCache(cacheKey, payload, Date.now() + 2 * 60 * 1000);
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

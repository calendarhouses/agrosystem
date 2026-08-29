import type { DayAnalyticsPayload } from "@/lib/equipment-day-analytics";
import type { FleetTrackedUnit } from "@/lib/equipment-fleet";
import { isFuelDeliveryUnit } from "@/lib/equipment-fuel-tanks";
import type { WialonUnit } from "@/lib/wialon";

export type SmartAlertKind = "fuel_drain" | "long_idle";

export type SmartAlert = {
  id: string;
  kind: SmartAlertKind;
  unitId: number;
  unitName: string;
  title: string;
  detail: string;
  severity: "critical" | "warning" | "info";
  lng: number | null;
  lat: number | null;
  createdAt: number;
};

const LONG_IDLE_SEC = 60 * 60;
const IDLE_MAX_SPEED = 2;

function parseTelemetryIgnition(unit: WialonUnit): boolean | null {
  const sensors = unit.sens as Record<string, unknown>[] | undefined;
  if (!Array.isArray(sensors)) return null;
  for (const s of sensors) {
    const name = String((s as { n?: string }).n ?? "").toLowerCase();
    if (!/запал|ignition|двиг/i.test(name)) continue;
    const val = (s as { v?: unknown }).v;
    if (val === 1 || val === true || val === "1") return true;
    if (val === 0 || val === false || val === "0") return false;
  }
  return null;
}

function isIdleSample(s: { speed: number; ignition: boolean | null }): boolean {
  return (
    s.speed <= IDLE_MAX_SPEED &&
    (s.ignition === true || s.ignition == null)
  );
}

/** Live-стан: зараз холостий хід (швидкість + запалювання з телеметрії). */
export function isUnitCurrentlyIdle(unit: WialonUnit): boolean {
  const speed = Number(unit.pos?.s ?? 0);
  if (!Number.isFinite(speed) || speed > IDLE_MAX_SPEED) return false;
  const ignition = parseTelemetryIgnition(unit);
  return ignition === true || ignition == null;
}

/** Поточний простій (хвіст треку), не сума за день. */
export function currentIdleStreakSec(
  samples: DayAnalyticsPayload["samples"],
  nowSec: number
): number {
  if (!samples?.length) return 0;
  let i = samples.length - 1;
  if (!isIdleSample(samples[i]!)) return 0;
  while (i > 0 && isIdleSample(samples[i - 1]!)) i--;
  const start = samples[i]!.t;
  return Math.max(0, nowSec - start);
}

export type BuildSmartAlertsInput = {
  units: FleetTrackedUnit[];
  analyticsByUnitId?: Map<number, DayAnalyticsPayload>;
  /**
   * Початок поточного idle з live GPS (unix sec) — флот-wide без треку.
   * Оновлюється на клієнті під час поллінгу позицій.
   */
  idleSinceByUnitId?: Map<number, number>;
  /** Події зливу з БД (wialon_equipment_day_stats) для fleet-wide моніторингу */
  drainEventsByUnitId?: Map<number, number>;
  /** YYYY-MM-DD — для стабільного id toast (без повторів при зміні count) */
  alertDayKey?: string;
};

/**
 * Аномалії дня для центру сповіщень.
 * Втрата GPS — лише у FleetAlertStrip (offline), щоб не дублювати.
 */
export function buildSmartAlerts(input: BuildSmartAlertsInput): SmartAlert[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const out: SmartAlert[] = [];
  const analyticsMap = input.analyticsByUnitId ?? new Map();
  const idleSinceMap = input.idleSinceByUnitId ?? new Map();
  const drainFromDb = input.drainEventsByUnitId ?? new Map();
  const dayKey = input.alertDayKey ?? "today";

  for (const unit of input.units) {
    const pos = unit.pos;
    const lng = pos?.x ?? null;
    const lat = pos?.y ?? null;

    const analytics = analyticsMap.get(unit.id);
    const currentlyIdle = isUnitCurrentlyIdle(unit);

    const fromTrack = currentlyIdle
      ? currentIdleStreakSec(analytics?.samples ?? [], nowSec)
      : 0;
    const sinceLive = idleSinceMap.get(unit.id);
    const fromLive =
      currentlyIdle && sinceLive != null
        ? Math.max(0, nowSec - sinceLive)
        : 0;
    const idleSec = Math.max(fromTrack, fromLive);

    if (currentlyIdle && idleSec >= LONG_IDLE_SEC) {
      const hours = Math.round((idleSec / 3600) * 10) / 10;
      out.push({
        id: `idle:${unit.id}:${dayKey}:${Math.floor(hours)}`,
        kind: "long_idle",
        unitId: unit.id,
        unitName: unit.nm,
        title: "Тривалий холостий хід",
        detail: `${unit.nm} — ~${hours} год простою зараз, зайве паливо`,
        severity: "warning",
        lng,
        lat,
        createdAt: nowSec,
      });
    }

    const fuelEvents = analytics?.fuelEvents ?? [];
    if (fuelEvents.length > 0 && !isFuelDeliveryUnit(unit.nm)) {
      const top = fuelEvents[0]!;
      out.push({
        id: `drain:${unit.id}:${top.id}`,
        kind: "fuel_drain",
        unitId: unit.id,
        unitName: unit.nm,
        title: "Підозра на злив палива",
        detail: `${unit.nm} — втрата ~${Math.round(top.litersLost)} л`,
        severity: "critical",
        lng: top.lng,
        lat: top.lat,
        createdAt: nowSec,
      });
    } else {
      const dbDrains = drainFromDb.get(unit.id) ?? 0;
      if (dbDrains > 0 && !isFuelDeliveryUnit(unit.nm)) {
        out.push({
          id: `drain-db:${unit.id}:${dayKey}`,
          kind: "fuel_drain",
          unitId: unit.id,
          unitName: unit.nm,
          title: "Підозра на злив палива",
          detail: `${unit.nm} — ${dbDrains} ${dbDrains === 1 ? "подія" : "події"} за день`,
          severity: "critical",
          lng,
          lat,
          createdAt: nowSec,
        });
      }
    }
  }

  const order: Record<SmartAlertKind, number> = {
    fuel_drain: 0,
    long_idle: 1,
  };
  out.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.unitName.localeCompare(b.unitName, "uk")
  );
  return out;
}

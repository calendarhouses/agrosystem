/**
 * Періодичне виявлення польових аномалій (idle з запалюванням, злив пального).
 */

import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

import { todayKyivYmd } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";
import { broadcastTelegram } from "@/lib/telegram";
import { getCachedWialonUnitsFull } from "@/lib/wialon-live-cache";
import {
  hasValidWialonPosition,
  parseWialonUnitTelemetry,
  type WialonUnit,
} from "@/lib/wialon";

const IDLE_ALERT_MINUTES = 40;
const FUEL_DROP_LITERS = 35;
const FUEL_ALERT_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 год
const IDLE_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 год

export type TelemetryAlert = {
  type: "idle_engine" | "fuel_drain";
  equipmentId: string;
  equipmentName: string;
  fieldId?: string | null;
  fieldName?: string | null;
  message: string;
  meta?: Record<string, unknown>;
};

type WatchRow = {
  equipment_id: string;
  wialon_unit_id: number | null;
  idle_since: string | null;
  idle_field_id: string | null;
  idle_alerted_at: string | null;
  last_fuel_liters: number | null;
  last_fuel_at: string | null;
  last_fuel_alert_at: string | null;
};

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFieldPolygon(
  geometry: unknown
): Feature<Polygon | MultiPolygon> | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  if (!g.coordinates) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: geometry as Polygon | MultiPolygon,
  };
}

function displayName(row: {
  name?: string | null;
  canonical_name?: string | null;
}): string {
  return (
    (row.canonical_name && String(row.canonical_name).trim()) ||
    (row.name && String(row.name).trim()) ||
    "Поле"
  );
}

function minutesBetween(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((toMs - from) / 60_000));
}

export async function runTelemetryAnomalyScan(options?: {
  dryRun?: boolean;
}): Promise<{
  checked: number;
  alerts: TelemetryAlert[];
  telegram: { ok: boolean; sent: number; error?: string };
}> {
  const dryRun = options?.dryRun === true;
  const supabase = createServiceSupabase();
  const now = Date.now();
  const today = todayKyivYmd();
  const alerts: TelemetryAlert[] = [];

  const live = await getCachedWialonUnitsFull();
  const units = live.units ?? [];

  const [{ data: equipment }, { data: fields }, { data: watches }, { data: dayStats }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select("id, name, wialon_id, is_active")
        .neq("is_active", false)
        .not("wialon_id", "is", null)
        .limit(400),
      supabase
        .from("farm_fields")
        .select("id, name, canonical_name, geometry, is_field")
        .eq("is_field", true)
        .limit(500),
      supabase.from("levadius_telemetry_watch").select("*").limit(500),
      supabase
        .from("wialon_equipment_day_stats")
        .select(
          "equipment_id, drain_events, fuel_delta, fuel_consumed, distance_km, hours_idling"
        )
        .eq("date", today)
        .gt("drain_events", 0)
        .limit(100),
    ]);

  const eqByWialon = new Map<number, { id: string; name: string }>();
  for (const row of equipment ?? []) {
    const wid = Number(row.wialon_id);
    if (!Number.isFinite(wid)) continue;
    eqByWialon.set(wid, {
      id: String(row.id),
      name: String(row.name ?? "Техніка"),
    });
  }

  const watchByEq = new Map<string, WatchRow>();
  for (const row of (watches ?? []) as WatchRow[]) {
    watchByEq.set(String(row.equipment_id), row);
  }

  const fieldPolys = (fields ?? [])
    .map((row) => {
      const poly = toFieldPolygon(row.geometry);
      if (!poly) return null;
      return {
        id: String(row.id),
        name: displayName(row),
        poly,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    poly: Feature<Polygon | MultiPolygon>;
  }>;

  function findFieldAt(lng: number, lat: number): { id: string; name: string } | null {
    const pt = point([lng, lat]);
    for (const f of fieldPolys) {
      try {
        if (booleanPointInPolygon(pt, f.poly)) {
          return { id: f.id, name: f.name };
        }
      } catch {
        /* skip */
      }
    }
    return null;
  }

  const unitById = new Map<number, WialonUnit>();
  for (const u of units) unitById.set(u.id, u);

  for (const [wialonId, eq] of eqByWialon) {
    const unit = unitById.get(wialonId);
    if (!unit || !hasValidWialonPosition(unit)) continue;

    const telemetry = parseWialonUnitTelemetry(unit);
    const speed = Math.max(0, Number(unit.pos?.s ?? 0));
    const lat = Number(unit.pos?.y);
    const lng = Number(unit.pos?.x);
    const ignition = telemetry.ignition === true;
    const fuelLiters = telemetry.fuelLiters;
    const onField =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? findFieldAt(lng, lat)
        : null;

    const prev = watchByEq.get(eq.id);
    const patch: Record<string, unknown> = {
      equipment_id: eq.id,
      wialon_unit_id: wialonId,
      updated_at: new Date(now).toISOString(),
    };

    // ── Idle + ignition on field ─────────────────────────────────────
    const idleCandidate =
      ignition && speed < 0.5 && onField != null;

    if (idleCandidate && onField) {
      const idleSince = prev?.idle_since || new Date(now).toISOString();
      const sameField =
        !prev?.idle_field_id || prev.idle_field_id === onField.id;
      const sinceIso = sameField
        ? idleSince
        : new Date(now).toISOString();
      patch.idle_since = sinceIso;
      patch.idle_field_id = onField.id;

      const mins = minutesBetween(sinceIso, now);
      const lastAlert = prev?.idle_alerted_at
        ? Date.parse(prev.idle_alerted_at)
        : 0;
      const cooled =
        !Number.isFinite(lastAlert) ||
        now - lastAlert >= IDLE_ALERT_COOLDOWN_MS;

      if (mins >= IDLE_ALERT_MINUTES && cooled) {
        const message =
          `⚠️ Увага диспетчера: Трактор ${eq.name} стоїть на полі ${onField.name} без руху з увімкненим двигуном вже ${mins} хв. Перевірте зв'язок із механізатором!`;
        alerts.push({
          type: "idle_engine",
          equipmentId: eq.id,
          equipmentName: eq.name,
          fieldId: onField.id,
          fieldName: onField.name,
          message,
          meta: { minutes: mins, speed, ignition },
        });
        if (!dryRun) {
          patch.idle_alerted_at = new Date(now).toISOString();
        }
      }
    } else {
      patch.idle_since = null;
      patch.idle_field_id = null;
    }

    // ── Fuel drain (live delta) ──────────────────────────────────────
    if (fuelLiters != null && fuelLiters >= 0) {
      const prevFuel = prev?.last_fuel_liters != null
        ? finiteNumber(prev.last_fuel_liters)
        : null;
      const prevAt = prev?.last_fuel_at
        ? Date.parse(prev.last_fuel_at)
        : NaN;

      if (
        prevFuel != null &&
        Number.isFinite(prevAt) &&
        now - prevAt < 90 * 60 * 1000 &&
        prevFuel - fuelLiters >= FUEL_DROP_LITERS &&
        speed < 3
      ) {
        const lastFuelAlert = prev?.last_fuel_alert_at
          ? Date.parse(prev.last_fuel_alert_at)
          : 0;
        const cooled =
          !Number.isFinite(lastFuelAlert) ||
          now - lastFuelAlert >= FUEL_ALERT_COOLDOWN_MS;
        if (cooled) {
          const drop = Math.round(prevFuel - fuelLiters);
          const fieldLabel = onField?.name ?? "поза полем";
          const message =
            `⚠️ Увага диспетчера: Підозрілий злив пального — ${eq.name}: −${drop} л за короткий час (рівень ${Math.round(prevFuel)}→${Math.round(fuelLiters)} л), рух мінімальний${onField ? `, локація: поле ${fieldLabel}` : ""}. Перевірте!`;
          alerts.push({
            type: "fuel_drain",
            equipmentId: eq.id,
            equipmentName: eq.name,
            fieldId: onField?.id ?? null,
            fieldName: onField?.name ?? null,
            message,
            meta: { dropLiters: drop, from: prevFuel, to: fuelLiters },
          });
          if (!dryRun) {
            patch.last_fuel_alert_at = new Date(now).toISOString();
          }
        }
      }

      patch.last_fuel_liters = fuelLiters;
      patch.last_fuel_at = new Date(now).toISOString();
    }

    const { error: upsertErr } = await supabase
      .from("levadius_telemetry_watch")
      .upsert(patch, { onConflict: "equipment_id" });
    if (upsertErr) {
      console.warn(
        "[telemetry-alerts] watch upsert",
        eq.id,
        upsertErr.message
      );
    }
  }

  // Day-stats drain_events (додатковий сигнал, якщо live ще не спіймав)
  for (const row of dayStats ?? []) {
    const eqId = String(row.equipment_id);
    const already = alerts.some(
      (a) => a.equipmentId === eqId && a.type === "fuel_drain"
    );
    if (already) continue;
    const drains = Number(row.drain_events ?? 0);
    if (drains <= 0) continue;
    const eq = (equipment ?? []).find((e) => String(e.id) === eqId);
    if (!eq) continue;
    const prev = watchByEq.get(eqId);
    const lastFuelAlert = prev?.last_fuel_alert_at
      ? Date.parse(prev.last_fuel_alert_at)
      : 0;
    if (
      Number.isFinite(lastFuelAlert) &&
      now - lastFuelAlert < FUEL_ALERT_COOLDOWN_MS
    ) {
      continue;
    }
    const dist = finiteNumber(row.distance_km) ?? 0;
    const message =
      `⚠️ Увага диспетчера: Wialon зафіксував ${drains} подію зливу пального на техніці ${eq.name} (сьогодні, пробіг ${dist.toFixed(1)} км). Перевірте журнал пального!`;
    alerts.push({
      type: "fuel_drain",
      equipmentId: eqId,
      equipmentName: String(eq.name),
      message,
      meta: { drainEvents: drains, source: "day_stats" },
    });
    if (!dryRun) {
      await supabase.from("levadius_telemetry_watch").upsert(
        {
          equipment_id: eqId,
          last_fuel_alert_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "equipment_id" }
      );
    }
  }

  let telegram: { ok: boolean; sent: number; error?: string } = {
    ok: true,
    sent: 0,
  };
  if (alerts.length > 0 && !dryRun) {
    const text = alerts.map((a) => a.message).join("\n\n");
    const broadcast = await broadcastTelegram(text);
    telegram = {
      ok: broadcast.ok,
      sent: broadcast.sent,
      error: broadcast.error,
    };
  } else if (alerts.length > 0 && dryRun) {
    telegram = { ok: true, sent: 0, error: "dryRun" };
  }

  return {
    checked: eqByWialon.size,
    alerts,
    telegram,
  };
}

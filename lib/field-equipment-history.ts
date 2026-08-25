/**
 * Гібридна історія техніки на полі:
 * джерело 1 (пріоритет) — наряди агронома (field_operations),
 * джерело 2 — GPS / ДРП (wialon_field_fuel_logs).
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";
import { estimateAreaHaFromTrack } from "@/lib/field-operations";
import type { FieldTechVisit } from "@/lib/field-tech-history";

export type FieldEquipmentHistorySource = "manual" | "gps_only" | "hybrid";

export type FieldEquipmentHistoryEntry = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** UUID з public.equipment, якщо вдалось зіставити */
  equipmentId: string | null;
  equipmentName: string;
  wialonUnitId: number | null;
  source: FieldEquipmentHistorySource;
  /** Наряд (якщо є) */
  operationId?: string;
  clientKey?: string;
  workType?: string;
  crop?: string;
  status?: string;
  areaHa?: number;
  /** Ширина захвату з наряду (м) — для оцінки га з пробігу */
  implementWidthM?: number | null;
  fuelUsedL?: number;
  wageUah?: number;
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
  /** Початок / кінець візиту (UNIX sec) — для точного часу в наряді */
  visitStartUnix?: number | null;
  visitEndUnix?: number | null;
  /** Паливо з Wialon (л), якщо є GPS-лог на цей день */
  gpsFuelConsumedL?: number;
};

type EquipmentRow = {
  id: string;
  name: string;
  wialon_id: number | null;
};

type OpRow = {
  id: string;
  client_key: string | null;
  work_type: string | null;
  crop: string | null;
  machinery: string | null;
  status: string | null;
  occurred_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  wialon_unit_id: number | string | null;
  area_fact: number | string | null;
  area_plan: number | string | null;
  fuel_fact: number | string | null;
  fuel_plan: number | string | null;
  wage_fact: number | string | null;
  wage_plan: number | string | null;
  tracker_distance_km: number | string | null;
  tracker_work_hours: number | string | null;
  tracker_fuel_l: number | string | null;
  implement_width_m: number | string | null;
};

type GpsRow = {
  id: string;
  date: string;
  fuel_consumed: number | string | null;
  equipment_id: string;
  equipment:
    | { id: string; name: string; wialon_id: number | null }
    | { id: string; name: string; wialon_id: number | null }[]
    | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function dateYmd(value: string | null | undefined): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function hasMachinery(row: OpRow): boolean {
  const name = (row.machinery ?? "").trim();
  if (name && name !== "—" && name !== "-") return true;
  return optionalNum(row.wialon_unit_id) != null;
}

/** Стабільний ключ злиття: день + техніка */
export function equipmentHistoryMergeKey(
  date: string,
  equipmentId: string | null,
  wialonUnitId: number | null,
  equipmentName: string
): string {
  if (equipmentId) return `${date}|eq:${equipmentId}`;
  if (wialonUnitId != null) return `${date}|wialon:${wialonUnitId}`;
  const nameKey = normalizeNameKey(equipmentName);
  if (nameKey) return `${date}|name:${nameKey}`;
  return `${date}|unknown`;
}

type EquipmentIndex = {
  byId: Map<string, EquipmentRow>;
  byWialonId: Map<number, EquipmentRow>;
  byName: Map<string, EquipmentRow>;
};

function buildEquipmentIndex(rows: EquipmentRow[]): EquipmentIndex {
  const byId = new Map<string, EquipmentRow>();
  const byWialonId = new Map<number, EquipmentRow>();
  const byName = new Map<string, EquipmentRow>();
  for (const row of rows) {
    byId.set(row.id, row);
    if (row.wialon_id != null && Number.isFinite(row.wialon_id)) {
      byWialonId.set(row.wialon_id, row);
    }
    const key = normalizeNameKey(row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  }
  return { byId, byWialonId, byName };
}

function resolveEquipmentForOp(
  row: OpRow,
  index: EquipmentIndex
): { equipmentId: string | null; equipmentName: string; wialonUnitId: number | null } {
  const wialonUnitId = optionalNum(row.wialon_unit_id);
  const machineryName = (row.machinery ?? "").trim();
  const displayName =
    machineryName && machineryName !== "—" && machineryName !== "-"
      ? machineryName
      : "";

  if (wialonUnitId != null) {
    const byWialon = index.byWialonId.get(wialonUnitId);
    if (byWialon) {
      return {
        equipmentId: byWialon.id,
        equipmentName: displayName || byWialon.name,
        wialonUnitId,
      };
    }
  }

  if (displayName) {
    const byName = index.byName.get(normalizeNameKey(displayName));
    if (byName) {
      return {
        equipmentId: byName.id,
        equipmentName: displayName,
        wialonUnitId: byName.wialon_id ?? wialonUnitId,
      };
    }
  }

  return {
    equipmentId: null,
    equipmentName: displayName || (wialonUnitId != null ? `Wialon #${wialonUnitId}` : "Техніка"),
    wialonUnitId,
  };
}

function preferArea(row: OpRow): number {
  const fact = num(row.area_fact);
  if (fact > 0) return round2(fact);

  const plan = num(row.area_plan);
  const dist = optionalNum(row.tracker_distance_km);
  const width = optionalNum(row.implement_width_m);
  if (dist != null && width != null && dist > 0 && width > 0) {
    return estimateAreaHaFromTrack(dist, width, plan > 0 ? plan : null);
  }

  return round2(Math.max(0, plan));
}

function preferFuel(row: OpRow): number {
  const fact = num(row.fuel_fact);
  const plan = num(row.fuel_plan);
  return round2(fact > 0 ? fact : Math.max(0, plan));
}

function preferWage(row: OpRow): number {
  const fact = num(row.wage_fact);
  const plan = num(row.wage_plan);
  return round2(fact > 0 ? fact : Math.max(0, plan));
}

function opToManualEntry(
  row: OpRow,
  index: EquipmentIndex
): FieldEquipmentHistoryEntry | null {
  if (!hasMachinery(row)) return null;
  const date =
    dateYmd(row.occurred_at) ??
    dateYmd(row.closed_at) ??
    dateYmd(row.created_at);
  if (!date) return null;

  const resolved = resolveEquipmentForOp(row, index);
  const clientKey = String(row.client_key ?? row.id);

  return {
    id: `manual:${clientKey}:${date}`,
    date,
    equipmentId: resolved.equipmentId,
    equipmentName: resolved.equipmentName,
    wialonUnitId: resolved.wialonUnitId,
    source: "manual",
    operationId: String(row.id),
    clientKey,
    workType: (row.work_type ?? "").trim() || undefined,
    crop: (row.crop ?? "").trim() || undefined,
    status: String(row.status ?? "") || undefined,
    areaHa: preferArea(row),
    implementWidthM: optionalNum(row.implement_width_m),
    fuelUsedL: preferFuel(row),
    wageUah: preferWage(row),
    trackerDistanceKm: optionalNum(row.tracker_distance_km),
    trackerWorkHours: optionalNum(row.tracker_work_hours),
    trackerFuelL: optionalNum(row.tracker_fuel_l),
  };
}

function gpsToEntry(row: GpsRow): FieldEquipmentHistoryEntry | null {
  const date = dateYmd(row.date);
  if (!date) return null;
  const eq = unwrapJoin(row.equipment);
  const equipmentId = String(row.equipment_id || eq?.id || "").trim() || null;
  const equipmentName = (eq?.name ?? "").trim() || "Техніка";
  const wialonUnitId =
    eq?.wialon_id != null && Number.isFinite(Number(eq.wialon_id))
      ? Number(eq.wialon_id)
      : null;
  const fuel = round2(Math.max(0, num(row.fuel_consumed)));

  return {
    id: `gps:${row.id}`,
    date,
    equipmentId,
    equipmentName,
    wialonUnitId,
    source: "gps_only",
    gpsFuelConsumedL: fuel,
  };
}

/**
 * Злиття: manual > hybrid > gps_only.
 * Ключ: date + equipment (id / wialon / name).
 */
export function mergeEquipmentHistory(
  manual: FieldEquipmentHistoryEntry[],
  gps: FieldEquipmentHistoryEntry[]
): FieldEquipmentHistoryEntry[] {
  const map = new Map<string, FieldEquipmentHistoryEntry>();

  for (const entry of manual) {
    const key = equipmentHistoryMergeKey(
      entry.date,
      entry.equipmentId,
      entry.wialonUnitId,
      entry.equipmentName
    );
    const prev = map.get(key);
    if (!prev) {
      map.set(key, entry);
      continue;
    }
    // Кілька нарядів на той самий день/техніку — беремо з більшою площею / новіший id
    const prevArea = prev.areaHa ?? 0;
    const nextArea = entry.areaHa ?? 0;
    if (nextArea >= prevArea) map.set(key, entry);
  }

  for (const entry of gps) {
    const key = equipmentHistoryMergeKey(
      entry.date,
      entry.equipmentId,
      entry.wialonUnitId,
      entry.equipmentName
    );
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
      continue;
    }
    // Є наряд — пріоритет людей, GPS лише доповнює (hybrid)
    map.set(key, {
      ...existing,
      source: "hybrid",
      gpsFuelConsumedL: entry.gpsFuelConsumedL,
      equipmentId: existing.equipmentId ?? entry.equipmentId,
      equipmentName:
        existing.equipmentName && existing.equipmentName !== "Техніка"
          ? existing.equipmentName
          : entry.equipmentName,
      wialonUnitId: existing.wialonUnitId ?? entry.wialonUnitId,
      id: existing.id.startsWith("manual:")
        ? existing.id.replace(/^manual:/, "hybrid:")
        : `hybrid:${existing.id}`,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.equipmentName.localeCompare(b.equipmentName, "uk");
  });
}

/** KPI для вкладки «Техніка» з mergedHistory */
export function summarizeEquipmentHistory(entries: FieldEquipmentHistoryEntry[]) {
  const uniqueEquipment = new Set(
    entries.map((e) => e.equipmentId ?? `name:${e.equipmentName.toLowerCase()}`)
  );

  /** Заплановані наряди ще не зробили роботу — не в години/пробіг/га */
  const workDone = entries.filter((e) => {
    if (e.source === "gps_only") return true;
    const status = String(e.status ?? "").toLowerCase();
    return status !== "planned";
  });

  const totalHours = workDone.reduce(
    (sum, e) => sum + Math.max(0, e.trackerWorkHours ?? 0),
    0
  );
  const totalDistanceKm = workDone.reduce(
    (sum, e) => sum + Math.max(0, e.trackerDistanceKm ?? 0),
    0
  );
  const totalAreaHa = workDone.reduce(
    (sum, e) => sum + Math.max(0, e.areaHa ?? 0),
    0
  );
  const gpsOnlyCount = entries.filter((e) => e.source === "gps_only").length;
  const confirmedCount = entries.filter((e) => {
    if (e.source !== "manual" && e.source !== "hybrid") return false;
    const status = String(e.status ?? "").toLowerCase();
    return status === "completed" || status === "in_progress";
  }).length;

  return {
    totalVisits: entries.length,
    uniqueUnits: uniqueEquipment.size,
    totalHours: Math.round(totalHours * 10) / 10,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalAreaHa: Math.round(totalAreaHa * 10) / 10,
    gpsOnlyCount,
    confirmedCount,
  };
}

/** Локальна дата YYYY-MM-DD (не UTC — інакше зсув дня для України) */
function localDateYmd(unix: number): string {
  const d = new Date(unix * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** GPS-візит з треку → запис історії (для вкладки «Техніка») */
export function trackVisitToHistoryEntry(
  visit: FieldTechVisit,
  options?: { implementWidthM?: number | null; areaCapHa?: number | null }
): FieldEquipmentHistoryEntry {
  const date = localDateYmd(visit.startUnix);
  const hours = Math.max(0, (visit.endUnix - visit.startUnix) / 3600);
  const width = options?.implementWidthM ?? null;
  const areaHa =
    width != null && width > 0 && visit.distanceKm > 0
      ? estimateAreaHaFromTrack(
          visit.distanceKm,
          width,
          options?.areaCapHa ?? null
        )
      : undefined;

  return {
    id: visit.isLive ? `live:${visit.unitId}` : `track:${visit.id}`,
    date,
    equipmentId: null,
    equipmentName: visit.unitName,
    wialonUnitId: visit.unitId,
    source: "gps_only",
    status: visit.isLive ? "in_progress" : undefined,
    workType: visit.isLive ? "Зараз на полі" : undefined,
    trackerDistanceKm: visit.distanceKm > 0 ? visit.distanceKm : null,
    trackerWorkHours: hours > 0 ? Math.round(hours * 10) / 10 : null,
    visitStartUnix: visit.isLive ? null : visit.startUnix,
    visitEndUnix: visit.isLive ? null : visit.endUnix,
    implementWidthM: width,
    areaHa,
  };
}

/**
 * Додає GPS-візити з треків до історії нарядів/fuel-логів.
 * Якщо вже є наряд на той день/техніку — збагачує пробігом і годинами.
 */
export function mergeTrackVisitsIntoHistory(
  history: FieldEquipmentHistoryEntry[],
  visits: FieldTechVisit[],
  options?: { implementWidthM?: number | null; areaCapHa?: number | null }
): FieldEquipmentHistoryEntry[] {
  const map = new Map<string, FieldEquipmentHistoryEntry>();

  for (const entry of history) {
    const key = equipmentHistoryMergeKey(
      entry.date,
      entry.equipmentId,
      entry.wialonUnitId,
      entry.equipmentName
    );
    map.set(key, entry);
  }

  for (const visit of visits) {
    if (visit.isLive) continue;
    const entry = trackVisitToHistoryEntry(visit, options);
    const key = equipmentHistoryMergeKey(
      entry.date,
      entry.equipmentId,
      entry.wialonUnitId,
      entry.equipmentName
    );
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
      continue;
    }

    const dist = Math.max(
      existing.trackerDistanceKm ?? 0,
      entry.trackerDistanceKm ?? 0
    );
    const hours = Math.max(
      existing.trackerWorkHours ?? 0,
      entry.trackerWorkHours ?? 0
    );
    const width = existing.implementWidthM ?? entry.implementWidthM ?? null;
    let areaHa = existing.areaHa ?? 0;
    if (areaHa <= 0 && dist > 0 && width != null && width > 0) {
      areaHa = estimateAreaHaFromTrack(dist, width, options?.areaCapHa ?? null);
    } else if ((entry.areaHa ?? 0) > areaHa) {
      areaHa = entry.areaHa ?? 0;
    }

    map.set(key, {
      ...existing,
      source:
        existing.source === "manual" || existing.source === "hybrid"
          ? "hybrid"
          : "gps_only",
      trackerDistanceKm: dist > 0 ? Math.round(dist * 10) / 10 : existing.trackerDistanceKm,
      trackerWorkHours: hours > 0 ? Math.round(hours * 10) / 10 : existing.trackerWorkHours,
      visitStartUnix: existing.visitStartUnix ?? entry.visitStartUnix ?? null,
      visitEndUnix: existing.visitEndUnix ?? entry.visitEndUnix ?? null,
      implementWidthM: width,
      areaHa: areaHa > 0 ? areaHa : existing.areaHa,
      equipmentName:
        existing.equipmentName && existing.equipmentName !== "Техніка"
          ? existing.equipmentName
          : entry.equipmentName,
      wialonUnitId: existing.wialonUnitId ?? entry.wialonUnitId,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.equipmentName.localeCompare(b.equipmentName, "uk");
  });
}

async function resolveFieldOperationKeys(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string
): Promise<string[]> {
  const keys = [`farm:${fieldId}`];
  const { data } = await supabase
    .from("farm_fields")
    .select("wialon_zone_id")
    .eq("id", fieldId)
    .maybeSingle();
  const zoneId = String(data?.wialon_zone_id ?? "").trim();
  if (zoneId) keys.push(`wialon:${zoneId}`);
  return Array.from(new Set(keys));
}

const OP_SELECT = `
  id,
  client_key,
  work_type,
  crop,
  machinery,
  status,
  occurred_at,
  closed_at,
  created_at,
  wialon_unit_id,
  area_fact,
  area_plan,
  fuel_fact,
  fuel_plan,
  wage_fact,
  wage_plan,
  tracker_distance_km,
  tracker_work_hours,
  tracker_fuel_l,
  implement_width_m
`;

async function fetchManualOps(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string,
  fieldKeys: string[]
): Promise<OpRow[]> {
  const keys = Array.from(
    new Set([`farm:${fieldId}`, ...fieldKeys].filter(Boolean))
  );
  const orFilter = [
    `field_id.eq.${fieldId}`,
    ...keys.map((key) => `field_key.eq.${key}`),
  ].join(",");

  const base = () =>
    supabase
      .from("field_operations")
      .select(OP_SELECT)
      .neq("status", "cancelled")
      .or(orFilter)
      .order("occurred_at", { ascending: false });

  let { data, error } = await base().eq("season", season);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("field_operations")
    ) {
      return [];
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const year = Number(season);
      let q = base();
      if (Number.isFinite(year)) q = q.eq("season_year", year);
      const legacy = await q;
      if (legacy.error) return [];
      data = legacy.data;
      error = null;
    } else if (
      error.message?.includes("tracker_") ||
      error.message?.includes("wialon_unit_id")
    ) {
      const slim = await supabase
        .from("field_operations")
        .select(
          `
          id, client_key, work_type, crop, machinery, status,
          occurred_at, closed_at, created_at,
          area_fact, area_plan, fuel_fact, fuel_plan, wage_fact, wage_plan
        `
        )
        .neq("status", "cancelled")
        .eq("season", season)
        .or(orFilter)
        .order("occurred_at", { ascending: false });
      if (slim.error) return [];
      data = (slim.data ?? []).map((row) => ({
        ...row,
        wialon_unit_id: null,
        tracker_distance_km: null,
        tracker_work_hours: null,
        tracker_fuel_l: null,
        implement_width_m: null,
      }));
      error = null;
    } else {
      throw new Error(error.message);
    }
  }

  return (data ?? []) as OpRow[];
}

async function fetchGpsLogs(
  supabase: ReturnType<typeof createServiceSupabase>,
  fieldId: string,
  season: string
): Promise<GpsRow[]> {
  const select = `
    id,
    date,
    fuel_consumed,
    equipment_id,
    equipment ( id, name, wialon_id )
  `;

  let { data, error } = await supabase
    .from("wialon_field_fuel_logs")
    .select(select)
    .eq("field_id", fieldId)
    .eq("season", season)
    .order("date", { ascending: false });

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("wialon_field_fuel_logs")
    ) {
      return [];
    }
    if (error.message?.includes("season") || error.code === "42703") {
      const legacy = await supabase
        .from("wialon_field_fuel_logs")
        .select(select)
        .eq("field_id", fieldId)
        .order("date", { ascending: false });
      if (legacy.error) return [];
      data = legacy.data;
      error = null;
    } else {
      throw new Error(error.message);
    }
  }

  return (data ?? []) as GpsRow[];
}

async function fetchEquipmentIndex(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<EquipmentIndex> {
  const { data, error } = await supabase
    .from("equipment")
    .select("id, name, wialon_id")
    .eq("is_active", true);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return buildEquipmentIndex([]);
    }
    // без is_active
    const retry = await supabase.from("equipment").select("id, name, wialon_id");
    if (retry.error) return buildEquipmentIndex([]);
    return buildEquipmentIndex(
      (retry.data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        wialon_id:
          row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
            ? Number(row.wialon_id)
            : null,
      }))
    );
  }

  return buildEquipmentIndex(
    (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      wialon_id:
        row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
          ? Number(row.wialon_id)
          : null,
    }))
  );
}

/**
 * Єдиний масив історії техніки для поля (наряди + GPS), нові → старі.
 */
export async function fetchFieldEquipmentHistory(
  fieldId: string,
  activeSeason: string = DEFAULT_SEASON
): Promise<FieldEquipmentHistoryEntry[]> {
  const id = fieldId?.trim().toLowerCase();
  if (!id) return [];
  const season = normalizeSeason(activeSeason);

  const supabase = createServiceSupabase();
  const fieldKeys = await resolveFieldOperationKeys(supabase, id);

  const [ops, gpsLogs, equipmentIndex] = await Promise.all([
    fetchManualOps(supabase, id, season, fieldKeys),
    fetchGpsLogs(supabase, id, season),
    fetchEquipmentIndex(supabase),
  ]);

  const manual = ops
    .map((row) => opToManualEntry(row, equipmentIndex))
    .filter((row): row is FieldEquipmentHistoryEntry => row != null);

  const gps = gpsLogs
    .map((row) => gpsToEntry(row))
    .filter((row): row is FieldEquipmentHistoryEntry => row != null);

  return mergeEquipmentHistory(manual, gps);
}

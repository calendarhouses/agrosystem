/**
 * Денний журнал флоту (Excel/CSV) для LEVADIUS exportEquipmentDayJournal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { todayKyivYmd } from "@/lib/kyiv-date";
import { currentAgroSeason } from "@/lib/season";

export type FleetJournalFormat = "xlsx" | "csv";

export type FleetJournalRow = {
  Машина: string;
  Тип: string;
  Водій: string;
  "Відвідані поля": string;
  "Пробіг (км)": number | "";
  Мотогодини: number | "";
  "Спалено пального (л DUT)": number | "";
  "Середня витрата л/год": number | "";
  "Час простою (idle год)": number | "";
};

export type FleetJournalBuildResult = {
  date: string;
  rows: FleetJournalRow[];
  totalMachines: number;
  filenameBase: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function relName(rel: unknown): string | null {
  if (!rel) return null;
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row || typeof row !== "object") return null;
  const name = (row as { canonical_name?: string; name?: string }).canonical_name
    || (row as { name?: string }).name;
  return name ? String(name) : null;
}

export async function buildFleetDayJournal(
  supabase: SupabaseClient,
  dateRaw?: string | null
): Promise<FleetJournalBuildResult> {
  const dateYmd =
    dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim())
      ? dateRaw.trim()
      : todayKyivYmd();
  const season = currentAgroSeason();

  const { data: equipment, error: eqErr } = await supabase
    .from("equipment")
    .select("id, name, type, code, wialon_id, is_active")
    .not("wialon_id", "is", null)
    .order("name")
    .limit(500);

  if (eqErr) throw new Error(eqErr.message);

  const eqRows = (equipment ?? []).filter(
    (e) => e.wialon_id != null && Number(e.wialon_id) > 0
  );
  const wialonIds = eqRows.map((e) => Number(e.wialon_id));

  let statsQuery = supabase
    .from("wialon_equipment_day_stats")
    .select(
      "wialon_unit_id, distance_km, work_hours, hours_idling, fuel_consumed, season"
    )
    .eq("date", dateYmd)
    .eq("season", season);

  if (wialonIds.length > 0) {
    statsQuery = statsQuery.in("wialon_unit_id", wialonIds);
  }

  let { data: stats, error: stErr } = await statsQuery;
  if (stErr && (stErr.message?.includes("season") || stErr.code === "42703")) {
    const legacy = await supabase
      .from("wialon_equipment_day_stats")
      .select(
        "wialon_unit_id, distance_km, work_hours, hours_idling, fuel_consumed"
      )
      .eq("date", dateYmd)
      .in("wialon_unit_id", wialonIds.length ? wialonIds : [-1]);
    stats = legacy.data as typeof stats;
    stErr = legacy.error;
  }
  if (stErr) {
    if (
      stErr.code === "PGRST205" ||
      stErr.code === "42P01" ||
      stErr.message?.includes("wialon_equipment_day_stats")
    ) {
      stats = [];
    } else {
      throw new Error(stErr.message);
    }
  }

  const statsByUnit = new Map<
    number,
    {
      distanceKm: number;
      workHours: number;
      idleHours: number;
      fuelLiters: number;
    }
  >();
  for (const row of stats ?? []) {
    const id = Number(row.wialon_unit_id);
    if (!Number.isFinite(id)) continue;
    statsByUnit.set(id, {
      distanceKm: Number(row.distance_km) || 0,
      workHours: Number(row.work_hours) || 0,
      idleHours: Number(row.hours_idling) || 0,
      fuelLiters: Number(row.fuel_consumed) || 0,
    });
  }

  // Водії + поля з нарядів за день
  const eqIds = eqRows.map((e) => String(e.id));
  const driverByEq = new Map<string, string>();
  const fieldsByEq = new Map<string, Set<string>>();

  if (eqIds.length > 0) {
    const dayStart = `${dateYmd}T00:00:00+03:00`;
    const dayEnd = `${dateYmd}T23:59:59+03:00`;
    const { data: ops } = await supabase
      .from("field_operations")
      .select(
        `
        equipment_id, mechanic_name, occurred_at,
        farm_fields ( name, canonical_name )
      `
      )
      .in("equipment_id", eqIds)
      .gte("occurred_at", dayStart)
      .lte("occurred_at", dayEnd)
      .limit(2000);

    for (const op of ops ?? []) {
      const eid = op.equipment_id ? String(op.equipment_id) : "";
      if (!eid) continue;
      const mechanic = op.mechanic_name ? String(op.mechanic_name).trim() : "";
      if (mechanic && !driverByEq.has(eid)) driverByEq.set(eid, mechanic);
      const fieldName = relName(op.farm_fields);
      if (fieldName) {
        if (!fieldsByEq.has(eid)) fieldsByEq.set(eid, new Set());
        fieldsByEq.get(eid)!.add(fieldName);
      }
    }
  }

  const rows: FleetJournalRow[] = [];
  for (const eq of eqRows) {
    const unitId = Number(eq.wialon_id);
    const st = statsByUnit.get(unitId);
    const work = st?.workHours ?? 0;
    const fuel = st?.fuelLiters ?? 0;
    const avg =
      work > 0.05 && fuel > 0 ? round1(fuel / work) : ("" as const);
    const fields = fieldsByEq.get(String(eq.id));
    const name = String(eq.name ?? "Техніка");
    const code = eq.code ? String(eq.code) : "";

    rows.push({
      Машина: code ? `${name} (${code})` : name,
      Тип: eq.type ? String(eq.type) : "",
      Водій: driverByEq.get(String(eq.id)) ?? "",
      "Відвідані поля": fields ? [...fields].sort().join(", ") : "",
      "Пробіг (км)": st ? round1(st.distanceKm) : "",
      Мотогодини: st ? round1(st.workHours) : "",
      "Спалено пального (л DUT)": st ? round1(st.fuelLiters) : "",
      "Середня витрата л/год": avg,
      "Час простою (idle год)": st ? round1(st.idleHours) : "",
    });
  }

  // Сорт: спочатку з активністю
  rows.sort((a, b) => {
    const aKm = typeof a["Пробіг (км)"] === "number" ? a["Пробіг (км)"] : 0;
    const bKm = typeof b["Пробіг (км)"] === "number" ? b["Пробіг (км)"] : 0;
    if (bKm !== aKm) return bKm - aKm;
    return String(a.Машина).localeCompare(String(b.Машина), "uk");
  });

  const ymdCompact = dateYmd.replaceAll("-", "");
  return {
    date: dateYmd,
    rows,
    totalMachines: rows.length,
    filenameBase: `Fleet_Journal_${ymdCompact.slice(0, 4)}`,
  };
}

export function fleetJournalToXlsxBuffer(
  journal: FleetJournalBuildResult
): Buffer {
  const sheet = XLSX.utils.json_to_sheet(journal.rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Журнал");
  const out = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}

export function fleetJournalToCsv(journal: FleetJournalBuildResult): string {
  const sheet = XLSX.utils.json_to_sheet(journal.rows);
  return XLSX.utils.sheet_to_csv(sheet);
}

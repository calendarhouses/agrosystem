/**
 * Універсальний Excel-звіт для LEVADIUS (generateCustomExcelReport).
 * Стилізація через exceljs: графітова шапка, формати чисел, рядок SUM.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

import {
  fetchMaterialsByClientKeys,
  formatOperationMaterialsLine,
} from "@/lib/field-operation-materials";
import { fetchCompanyFinancialOverview } from "@/lib/company-finance";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { normalizeSeason } from "@/lib/season";

export const CUSTOM_EXCEL_SCOPES = [
  "equipment_single",
  "equipment_fleet",
  "field_operations",
  "fuel_movement",
  "inventory_moves",
  "driver_work",
  "financial_summary",
] as const;

export type CustomExcelScope = (typeof CUSTOM_EXCEL_SCOPES)[number];

export type CustomExcelMetric =
  | "fuel"
  | "motohours"
  | "speed"
  | "area"
  | "cost";

export type CustomExcelBuildInput = {
  reportScope: CustomExcelScope;
  title: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  targetEntityIdOrName?: string | null;
  includeMetrics?: string[] | null;
};

export type CustomExcelColumnKind = "text" | "number2" | "money" | "int";

export type CustomExcelColumn = {
  key: string;
  header: string;
  kind: CustomExcelColumnKind;
  sum?: boolean;
};

export type CustomExcelBuildResult = {
  title: string;
  filename: string;
  filenameBase: string;
  reportScope: CustomExcelScope;
  dateFrom: string;
  dateTo: string;
  entityLabel: string | null;
  columns: CustomExcelColumn[];
  rows: Record<string, string | number | null>[];
  totalRows: number;
  totalSummary: Record<string, number>;
  sheetName: string;
};

function isYmd(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function resolveDateRange(
  dateFrom?: string | null,
  dateTo?: string | null
): { dateFrom: string; dateTo: string } {
  const today = todayKyivYmd();
  const to = isYmd(dateTo) ? dateTo.trim() : today;
  const from = isYmd(dateFrom) ? dateFrom.trim() : shiftDays(to, -30);
  return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function metricSet(includeMetrics?: string[] | null): Set<string> {
  const set = new Set<string>();
  for (const m of includeMetrics ?? []) {
    const key = String(m).trim().toLowerCase();
    if (key) set.add(key);
  }
  return set;
}

function wants(metrics: Set<string>, key: CustomExcelMetric, fallback = true): boolean {
  if (metrics.size === 0) return fallback;
  return metrics.has(key);
}

export function sanitizeExcelFilenameBase(title: string): string {
  const base = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return base || "LEVADIUS_Zvit";
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function resolveEquipment(
  supabase: SupabaseClient,
  lookupRaw: string
): Promise<{ id: string; name: string; wialonId: number | null } | null> {
  const lookup = lookupRaw.trim();
  if (!lookup) return null;
  if (/^[0-9a-f-]{36}$/i.test(lookup)) {
    const { data } = await supabase
      .from("equipment")
      .select("id, name, wialon_id")
      .eq("id", lookup)
      .maybeSingle();
    if (!data) return null;
    return {
      id: String(data.id),
      name: String(data.name ?? "Техніка"),
      wialonId:
        data.wialon_id != null && Number.isFinite(Number(data.wialon_id))
          ? Number(data.wialon_id)
          : null,
    };
  }
  const safe = lookup.replaceAll(",", " ");
  const { data } = await supabase
    .from("equipment")
    .select("id, name, wialon_id")
    .or(`name.ilike.%${safe}%,full_name.ilike.%${safe}%,code.ilike.%${safe}%`)
    .order("name")
    .limit(5);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? "Техніка"),
    wialonId:
      row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
        ? Number(row.wialon_id)
        : null,
  };
}

async function resolveField(
  supabase: SupabaseClient,
  lookupRaw: string
): Promise<{ id: string; name: string } | null> {
  const lookup = lookupRaw.trim();
  if (!lookup) return null;
  if (/^[0-9a-f-]{36}$/i.test(lookup)) {
    const { data } = await supabase
      .from("farm_fields")
      .select("id, name")
      .eq("id", lookup)
      .maybeSingle();
    if (!data) return null;
    return { id: String(data.id), name: String(data.name ?? "Поле") };
  }
  const safe = lookup.replaceAll(",", " ");
  const { data } = await supabase
    .from("farm_fields")
    .select("id, name")
    .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
    .eq("is_field", true)
    .order("name")
    .limit(5);
  const row = data?.[0];
  if (!row) return null;
  return { id: String(row.id), name: String(row.name ?? "Поле") };
}

async function resolveStorage(
  supabase: SupabaseClient,
  lookupRaw: string
): Promise<{ id: string; name: string } | null> {
  const lookup = lookupRaw.trim();
  if (!lookup) return null;
  if (/^[0-9a-f-]{36}$/i.test(lookup)) {
    const { data } = await supabase
      .from("fuel_storages")
      .select("id, name")
      .eq("id", lookup)
      .maybeSingle();
    if (!data) return null;
    return { id: String(data.id), name: String(data.name ?? "Ємність") };
  }
  const safe = lookup.replaceAll(",", " ");
  const { data } = await supabase
    .from("fuel_storages")
    .select("id, name")
    .ilike("name", `%${safe}%`)
    .order("name")
    .limit(5);
  const row = data?.[0];
  if (!row) return null;
  return { id: String(row.id), name: String(row.name ?? "Ємність") };
}

async function resolveInventoryItem(
  supabase: SupabaseClient,
  lookupRaw: string
): Promise<{ refKey: string; name: string; unit: string | null } | null> {
  const lookup = lookupRaw.trim();
  if (!lookup) return null;
  const safe = lookup.replaceAll(",", " ");
  const { data } = await supabase
    .from("inventory_items_cache")
    .select("bas_ref_key, name, unit")
    .or(`name.ilike.%${safe}%,bas_ref_key.eq.${safe}`)
    .order("name")
    .limit(8);
  const row = data?.[0];
  if (!row?.bas_ref_key) return null;
  return {
    refKey: String(row.bas_ref_key),
    name: String(row.name ?? lookup),
    unit: row.unit != null ? String(row.unit) : null,
  };
}

function joinName(value: unknown): string {
  if (!value) return "—";
  const row = Array.isArray(value) ? value[0] : value;
  if (row && typeof row === "object" && "name" in row) {
    const name = (row as { name?: unknown }).name;
    return name != null && String(name).trim() ? String(name) : "—";
  }
  return "—";
}

function typeFuelLabel(type: string): string {
  if (type === "inbound") return "Закупівля";
  if (type === "transfer") return "Перекачування";
  if (type === "outbound") return "Роздача";
  return type || "—";
}

function typeInvLabel(type: string): string {
  if (type === "inbound") return "Прихід";
  if (type === "sale") return "Продаж";
  if (type === "outbound") return "Списання";
  return type || "—";
}

function statusOpLabel(status: string | null | undefined): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "completed" || s === "done") return "Виконано";
  if (s === "in_progress") return "В роботі";
  if (s === "planned" || s === "assigned") return "План";
  if (s === "cancelled") return "Скасовано";
  return status || "—";
}

async function buildEquipmentSingle(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string },
  metrics: Set<string>
): Promise<CustomExcelBuildResult> {
  const target = input.targetEntityIdOrName?.trim();
  if (!target) {
    throw new Error("Для звіту по техніці вкажи назву (наприклад Magnum 380).");
  }
  const eq = await resolveEquipment(supabase, target);
  if (!eq) {
    throw new Error(`Техніку «${target}» не знайдено.`);
  }

  const season = normalizeSeason(range.dateFrom.slice(0, 4));
  let dayQ = supabase
    .from("wialon_equipment_day_stats")
    .select(
      "date, distance_km, work_hours, hours_idling, fuel_consumed, fuel_start, fuel_end, fuel_delta, equipment_id, wialon_unit_id"
    )
    .gte("date", range.dateFrom)
    .lte("date", range.dateTo)
    .order("date", { ascending: true })
    .limit(400);
  dayQ = dayQ.eq("equipment_id", eq.id);
  let { data: dayRows, error: dayErr } = await dayQ;
  if ((!dayRows || dayRows.length === 0) && eq.wialonId != null) {
    const retry = await supabase
      .from("wialon_equipment_day_stats")
      .select(
        "date, distance_km, work_hours, hours_idling, fuel_consumed, fuel_start, fuel_end, fuel_delta, equipment_id, wialon_unit_id"
      )
      .eq("wialon_unit_id", eq.wialonId)
      .gte("date", range.dateFrom)
      .lte("date", range.dateTo)
      .order("date", { ascending: true })
      .limit(400);
    dayRows = retry.data;
    dayErr = retry.error;
  }
  if (dayErr) throw new Error(dayErr.message);

  const { data: ops } = await supabase
    .from("field_operations")
    .select(
      "id, client_key, work_type, status, area_fact, occurred_at, date_from, date_to, field_id, mechanic_name, farm_fields(name)"
    )
    .eq("equipment_id", eq.id)
    .gte("occurred_at", `${range.dateFrom}T00:00:00`)
    .lte("occurred_at", `${range.dateTo}T23:59:59`)
    .order("occurred_at", { ascending: true })
    .limit(500);

  const { data: fuelTx } = await supabase
    .from("fuel_transactions")
    .select("transaction_date, amount_liters, transaction_type, notes")
    .eq("equipment_id", eq.id)
    .eq("transaction_type", "outbound")
    .gte("transaction_date", range.dateFrom)
    .lte("transaction_date", `${range.dateTo}T23:59:59`)
    .limit(500);

  const opsByDay = new Map<string, { fields: Set<string>; works: string[] }>();
  for (const op of ops ?? []) {
    const day = String(op.occurred_at ?? op.date_from ?? "").slice(0, 10);
    if (!day) continue;
    const fieldName = joinName(op.farm_fields);
    const bucket = opsByDay.get(day) ?? { fields: new Set(), works: [] };
    if (fieldName && fieldName !== "—") bucket.fields.add(fieldName);
    if (op.work_type) bucket.works.push(String(op.work_type));
    opsByDay.set(day, bucket);
  }

  const fuelByDay = new Map<string, number>();
  for (const tx of fuelTx ?? []) {
    const day = String(tx.transaction_date ?? "").slice(0, 10);
    if (!day) continue;
    fuelByDay.set(day, round2((fuelByDay.get(day) ?? 0) + num(tx.amount_liters)));
  }

  const columns: CustomExcelColumn[] = [
    { key: "date", header: "Дата", kind: "text" },
    { key: "fields", header: "Поля", kind: "text" },
    { key: "works", header: "Роботи", kind: "text" },
    { key: "distanceKm", header: "Пробіг, км", kind: "number2", sum: true },
  ];
  if (wants(metrics, "motohours")) {
    columns.push({
      key: "workHours",
      header: "Мотогодини",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "fuel")) {
    columns.push({
      key: "fuelDut",
      header: "Паливо DUT, л",
      kind: "number2",
      sum: true,
    });
    columns.push({
      key: "refuelLiters",
      header: "Заправки, л",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "speed")) {
    columns.push({
      key: "avgSpeed",
      header: "Сер. швидкість, км/год",
      kind: "number2",
    });
  }

  const dayList = dayRows ?? [];
  const rows: Record<string, string | number | null>[] = [];
  const dayKeys = new Set(dayList.map((d) => String(d.date).slice(0, 10)));
  for (const key of opsByDay.keys()) dayKeys.add(key);
  for (const key of fuelByDay.keys()) dayKeys.add(key);
  const sortedDays = [...dayKeys].sort();

  const statsByDay = new Map(
    dayList.map((d) => [String(d.date).slice(0, 10), d] as const)
  );

  for (const day of sortedDays) {
    const st = statsByDay.get(day);
    const bucket = opsByDay.get(day);
    const distance = round2(num(st?.distance_km));
    const hours = round2(num(st?.work_hours));
    const fuelDut = round2(num(st?.fuel_consumed ?? st?.fuel_delta));
    const refuel = fuelByDay.get(day) ?? 0;
    const avgSpeed =
      hours > 0.05 ? round2(distance / hours) : null;
    rows.push({
      date: day,
      fields: bucket ? [...bucket.fields].join(", ") : "",
      works: bucket ? bucket.works.join("; ") : "",
      distanceKm: distance || null,
      workHours: hours || null,
      fuelDut: fuelDut || null,
      refuelLiters: refuel || null,
      avgSpeed,
    });
  }

  void season;
  return finalizeResult({
    input,
    range,
    entityLabel: eq.name,
    columns,
    rows,
    sheetName: "Техніка",
  });
}

async function buildEquipmentFleet(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string },
  metrics: Set<string>
): Promise<CustomExcelBuildResult> {
  const { data: dayRows, error } = await supabase
    .from("wialon_equipment_day_stats")
    .select(
      "date, distance_km, work_hours, fuel_consumed, fuel_delta, equipment_id"
    )
    .gte("date", range.dateFrom)
    .lte("date", range.dateTo)
    .order("date", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);

  const eqIds = [
    ...new Set(
      (dayRows ?? [])
        .map((r) => (r.equipment_id ? String(r.equipment_id) : null))
        .filter(Boolean) as string[]
    ),
  ];
  const { data: eqRows } = eqIds.length
    ? await supabase.from("equipment").select("id, name").in("id", eqIds)
    : { data: [] as { id: string; name: string }[] };
  const eqNames = new Map(
    (eqRows ?? []).map((e) => [String(e.id), String(e.name ?? "Техніка")])
  );

  const agg = new Map<
    string,
    {
      name: string;
      days: number;
      distance: number;
      hours: number;
      fuel: number;
    }
  >();

  for (const row of dayRows ?? []) {
    const id = row.equipment_id ? String(row.equipment_id) : "unknown";
    const name = eqNames.get(id) ?? "Техніка";
    const cur = agg.get(id) ?? {
      name,
      days: 0,
      distance: 0,
      hours: 0,
      fuel: 0,
    };
    cur.days += 1;
    cur.distance += num(row.distance_km);
    cur.hours += num(row.work_hours);
    cur.fuel += num(row.fuel_consumed ?? row.fuel_delta);
    agg.set(id, cur);
  }

  const columns: CustomExcelColumn[] = [
    { key: "name", header: "Техніка", kind: "text" },
    { key: "days", header: "Днів у роботі", kind: "int", sum: true },
    { key: "distanceKm", header: "Пробіг, км", kind: "number2", sum: true },
  ];
  if (wants(metrics, "motohours")) {
    columns.push({
      key: "workHours",
      header: "Мотогодини",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "fuel")) {
    columns.push({
      key: "fuelDut",
      header: "Паливо DUT, л",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "speed")) {
    columns.push({
      key: "avgSpeed",
      header: "Сер. швидкість, км/год",
      kind: "number2",
    });
  }

  const rows = [...agg.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "uk"))
    .map((a) => ({
      name: a.name,
      days: a.days,
      distanceKm: round2(a.distance),
      workHours: round2(a.hours),
      fuelDut: round2(a.fuel),
      avgSpeed: a.hours > 0.05 ? round2(a.distance / a.hours) : null,
    }));

  return finalizeResult({
    input,
    range,
    entityLabel: "Весь парк",
    columns,
    rows,
    sheetName: "Флот",
  });
}

async function buildFieldOperations(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string },
  metrics: Set<string>
): Promise<CustomExcelBuildResult> {
  const target = input.targetEntityIdOrName?.trim();
  if (!target) {
    throw new Error("Для звіту по полю вкажи назву поля (наприклад Василиха).");
  }
  const field = await resolveField(supabase, target);
  if (!field) throw new Error(`Поле «${target}» не знайдено.`);

  const { data: ops, error } = await supabase
    .from("field_operations")
    .select(
      "id, client_key, work_type, status, area_plan, area_fact, fuel_fact, wage_fact, machinery, implement, mechanic_name, occurred_at, date_from, date_to"
    )
    .eq("field_id", field.id)
    .gte("occurred_at", `${range.dateFrom}T00:00:00`)
    .lte("occurred_at", `${range.dateTo}T23:59:59`)
    .order("occurred_at", { ascending: true })
    .limit(800);
  if (error) throw new Error(error.message);

  const clientKeys = (ops ?? [])
    .map((o) => (o.client_key ? String(o.client_key) : null))
    .filter(Boolean) as string[];
  const materialsMap = await fetchMaterialsByClientKeys(supabase, clientKeys);

  const columns: CustomExcelColumn[] = [
    { key: "date", header: "Дата", kind: "text" },
    { key: "workType", header: "Операція", kind: "text" },
    { key: "status", header: "Статус", kind: "text" },
    { key: "mechanic", header: "Виконавець", kind: "text" },
    { key: "machine", header: "Агрегат", kind: "text" },
  ];
  if (wants(metrics, "area")) {
    columns.push({
      key: "areaFact",
      header: "Факт, га",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "fuel")) {
    columns.push({
      key: "fuelFact",
      header: "Паливо, л",
      kind: "number2",
      sum: true,
    });
  }
  columns.push({ key: "materials", header: "ТМЦ", kind: "text" });
  if (wants(metrics, "cost")) {
    columns.push({
      key: "wage",
      header: "ЗП, ₴",
      kind: "money",
      sum: true,
    });
  }

  const rows = (ops ?? []).map((op) => {
    const mats = op.client_key
      ? formatOperationMaterialsLine(materialsMap.get(String(op.client_key)) ?? [])
      : "";
    const machine = [op.machinery, op.implement].filter(Boolean).join(" + ");
    return {
      date: String(op.occurred_at ?? op.date_from ?? "").slice(0, 10),
      workType: String(op.work_type ?? "—"),
      status: statusOpLabel(op.status),
      mechanic: String(op.mechanic_name ?? "—"),
      machine: machine || "—",
      areaFact: round2(num(op.area_fact)) || null,
      fuelFact: round2(num(op.fuel_fact)) || null,
      materials: mats || "—",
      wage: round2(num(op.wage_fact)) || null,
    };
  });

  return finalizeResult({
    input,
    range,
    entityLabel: field.name,
    columns,
    rows,
    sheetName: "Поле",
  });
}

async function buildFuelMovement(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string }
): Promise<CustomExcelBuildResult> {
  const target = input.targetEntityIdOrName?.trim();
  let storage = target ? await resolveStorage(supabase, target) : null;
  let equipment =
    !storage && target ? await resolveEquipment(supabase, target) : null;

  if (target && !storage && !equipment) {
    throw new Error(
      `Не знайшов ємність чи техніку «${target}» для звіту по паливу.`
    );
  }

  let q = supabase
    .from("fuel_transactions")
    .select(
      "id, transaction_type, amount_liters, transaction_date, price_per_liter, total_cost, notes, operator_name, from_storage_id, to_storage_id, equipment_id"
    )
    .gte("transaction_date", range.dateFrom)
    .lte("transaction_date", `${range.dateTo}T23:59:59`)
    .order("transaction_date", { ascending: true })
    .limit(1000);

  if (storage) {
    q = q.or(
      `from_storage_id.eq.${storage.id},to_storage_id.eq.${storage.id}`
    );
  } else if (equipment) {
    q = q.eq("equipment_id", equipment.id);
  }

  let { data, error } = await q;
  if (error && /is_reverted/i.test(error.message)) {
    // already not filtering is_reverted
  }
  if (error) {
    // retry without order edge cases
    throw new Error(error.message);
  }

  // Soft-filter reverted if column present in rows (ignored if absent)
  const txRows = (data ?? []).filter((row) => {
    const r = row as Record<string, unknown>;
    return r.is_reverted !== true;
  });

  const storageIds = new Set<string>();
  const eqIds = new Set<string>();
  for (const row of txRows) {
    if (row.from_storage_id) storageIds.add(String(row.from_storage_id));
    if (row.to_storage_id) storageIds.add(String(row.to_storage_id));
    if (row.equipment_id) eqIds.add(String(row.equipment_id));
  }
  const [{ data: storages }, { data: eqs }] = await Promise.all([
    storageIds.size
      ? supabase
          .from("fuel_storages")
          .select("id, name")
          .in("id", [...storageIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    eqIds.size
      ? supabase.from("equipment").select("id, name").in("id", [...eqIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const stMap = new Map(
    (storages ?? []).map((s) => [String(s.id), String(s.name)])
  );
  const eqMap = new Map(
    (eqs ?? []).map((e) => [String(e.id), String(e.name)])
  );

  const columns: CustomExcelColumn[] = [
    { key: "date", header: "Дата", kind: "text" },
    { key: "type", header: "Тип", kind: "text" },
    { key: "from", header: "Звідки", kind: "text" },
    { key: "to", header: "Куди / техніка", kind: "text" },
    { key: "liters", header: "Літри", kind: "number2", sum: true },
    { key: "volumeBefore", header: "Залишок до", kind: "number2" },
    { key: "volumeAfter", header: "Залишок після", kind: "number2" },
    { key: "cost", header: "Сума, ₴", kind: "money", sum: true },
    { key: "operator", header: "Оператор", kind: "text" },
    { key: "notes", header: "Примітка", kind: "text" },
  ];

  let running = 0;
  const rows = txRows.map((tx) => {
    const liters = round2(num(tx.amount_liters));
    const type = String(tx.transaction_type ?? "");
    const signed =
      storage && String(tx.from_storage_id) === storage.id
        ? -liters
        : storage && String(tx.to_storage_id) === storage.id
          ? liters
          : liters;
    const before = round2(running);
    running = round2(running + signed);
    return {
      date: String(tx.transaction_date ?? "").slice(0, 10),
      type: typeFuelLabel(type),
      from: tx.from_storage_id
        ? stMap.get(String(tx.from_storage_id)) ?? "—"
        : "—",
      to:
        (tx.to_storage_id
          ? stMap.get(String(tx.to_storage_id))
          : null) ||
        (tx.equipment_id ? eqMap.get(String(tx.equipment_id)) : null) ||
        "—",
      liters,
      volumeBefore: before,
      volumeAfter: running,
      cost: round2(num(tx.total_cost)) || null,
      operator: String(tx.operator_name ?? "—"),
      notes: String(tx.notes ?? ""),
    };
  });

  return finalizeResult({
    input,
    range,
    entityLabel: storage?.name ?? equipment?.name ?? "Весь рух ДП",
    columns,
    rows,
    sheetName: "Паливо",
  });
}

async function buildInventoryMoves(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string }
): Promise<CustomExcelBuildResult> {
  const target = input.targetEntityIdOrName?.trim();
  if (!target) {
    throw new Error("Для звіту по ТМЦ вкажи назву препарату/добрива.");
  }
  const item = await resolveInventoryItem(supabase, target);
  if (!item) throw new Error(`Позицію «${target}» на складі не знайдено.`);

  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      "id, type, qty, date, note, buyer_name, unit_price_uah, field_id, farm_fields(name), actor_name"
    )
    .eq("item_ref_key", item.refKey)
    .gte("date", range.dateFrom)
    .lte("date", range.dateTo)
    .order("date", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  const columns: CustomExcelColumn[] = [
    { key: "date", header: "Дата", kind: "text" },
    { key: "type", header: "Тип", kind: "text" },
    { key: "qty", header: `Кількість${item.unit ? `, ${item.unit}` : ""}`, kind: "number2", sum: true },
    { key: "field", header: "Поле", kind: "text" },
    { key: "buyer", header: "Контрагент", kind: "text" },
    { key: "price", header: "Ціна, ₴", kind: "money" },
    { key: "sum", header: "Сума, ₴", kind: "money", sum: true },
    { key: "actor", header: "Хто вніс", kind: "text" },
    { key: "note", header: "Примітка", kind: "text" },
  ];

  const rows = (data ?? []).map((m) => {
    const qty = round2(num(m.qty));
    const price =
      m.unit_price_uah != null ? round2(num(m.unit_price_uah)) : null;
    const fieldName = joinName(m.farm_fields);
    return {
      date: String(m.date ?? "").slice(0, 10),
      type: typeInvLabel(String(m.type ?? "")),
      qty,
      field: fieldName,
      buyer: String(m.buyer_name ?? "—"),
      price,
      sum: price != null ? round2(qty * price) : null,
      actor: String(m.actor_name ?? "—"),
      note: String(m.note ?? ""),
    };
  });

  return finalizeResult({
    input,
    range,
    entityLabel: item.name,
    columns,
    rows,
    sheetName: "ТМЦ",
  });
}

async function buildDriverWork(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string },
  metrics: Set<string>
): Promise<CustomExcelBuildResult> {
  const target = input.targetEntityIdOrName?.trim();
  if (!target) {
    throw new Error("Для звіту по механізатору вкажи ПІБ або прізвище.");
  }
  const safe = target.replaceAll(",", " ");
  const { data: ops, error } = await supabase
    .from("field_operations")
    .select(
      "id, work_type, status, area_fact, fuel_fact, wage_fact, machinery, implement, mechanic_name, occurred_at, date_from, farm_fields(name)"
    )
    .ilike("mechanic_name", `%${safe}%`)
    .gte("occurred_at", `${range.dateFrom}T00:00:00`)
    .lte("occurred_at", `${range.dateTo}T23:59:59`)
    .order("occurred_at", { ascending: true })
    .limit(800);
  if (error) throw new Error(error.message);

  const columns: CustomExcelColumn[] = [
    { key: "date", header: "Дата", kind: "text" },
    { key: "field", header: "Поле", kind: "text" },
    { key: "workType", header: "Операція", kind: "text" },
    { key: "machine", header: "Агрегат", kind: "text" },
    { key: "status", header: "Статус", kind: "text" },
  ];
  if (wants(metrics, "area")) {
    columns.push({
      key: "areaFact",
      header: "Факт, га",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "fuel")) {
    columns.push({
      key: "fuelFact",
      header: "Паливо, л",
      kind: "number2",
      sum: true,
    });
  }
  if (wants(metrics, "cost")) {
    columns.push({
      key: "wage",
      header: "ЗП, ₴",
      kind: "money",
      sum: true,
    });
  }

  const rows = (ops ?? []).map((op) => {
    const fieldName = joinName(op.farm_fields);
    return {
      date: String(op.occurred_at ?? op.date_from ?? "").slice(0, 10),
      field: fieldName,
      workType: String(op.work_type ?? "—"),
      machine: [op.machinery, op.implement].filter(Boolean).join(" + ") || "—",
      status: statusOpLabel(op.status),
      areaFact: round2(num(op.area_fact)) || null,
      fuelFact: round2(num(op.fuel_fact)) || null,
      wage: round2(num(op.wage_fact)) || null,
    };
  });

  const driverName =
    (ops?.[0]?.mechanic_name ? String(ops[0].mechanic_name) : null) || target;

  return finalizeResult({
    input,
    range,
    entityLabel: driverName,
    columns,
    rows,
    sheetName: "Механізатор",
  });
}

async function buildFinancialSummary(
  input: CustomExcelBuildInput,
  range: { dateFrom: string; dateTo: string }
): Promise<CustomExcelBuildResult> {
  const season = normalizeSeason(range.dateFrom.slice(0, 4));
  const overview = await fetchCompanyFinancialOverview(season, {
    startIso: range.dateFrom,
    endIso: range.dateTo,
  });

  const columns: CustomExcelColumn[] = [
    { key: "metric", header: "Показник", kind: "text" },
    { key: "value", header: "Значення", kind: "money" },
    { key: "note", header: "Примітка", kind: "text" },
  ];

  const rows: Record<string, string | number | null>[] = [
    {
      metric: "План бюджету полів",
      value: round2(overview.globalPlanUah),
      note: "₴",
    },
    {
      metric: "Факт витрат за період",
      value: round2(overview.globalFactUah),
      note: "ТМЦ + паливо + ЗП",
    },
    {
      metric: "ТМЦ",
      value: round2(overview.inventorySpentUah),
      note: "₴",
    },
    {
      metric: "Паливо",
      value: round2(overview.fuelCostUah),
      note: "₴",
    },
    {
      metric: "ЗП",
      value: round2(overview.salaryUah),
      note: "₴",
    },
    {
      metric: "Продажі врожаю (локальні)",
      value: round2(overview.localSalesUah),
      note: "₴",
    },
    {
      metric: "Приходи на склад (локальні)",
      value: round2(overview.localInboundUah),
      note: "₴",
    },
    {
      metric: "Burn rate",
      value:
        overview.globalBurnRate != null
          ? round2(overview.globalBurnRate)
          : null,
      note: "% від плану",
    },
  ];

  for (const slice of overview.expenseAnatomy.slice(0, 12)) {
    rows.push({
      metric: `Анатомія · ${slice.label}`,
      value: round2(slice.amountUah),
      note: `${round2(slice.pct)}%`,
    });
  }

  for (const field of overview.fields.slice(0, 40)) {
    rows.push({
      metric: `Поле · ${field.name}`,
      value: round2(field.spentUah),
      note:
        field.burnRate != null
          ? `burn ${round2(field.burnRate)}% · ${field.crop || "—"}`
          : field.crop || "—",
    });
  }

  return finalizeResult({
    input,
    range,
    entityLabel: "Фінзвіт",
    columns,
    rows,
    sheetName: "Фінанси",
  });
}

function finalizeResult(params: {
  input: CustomExcelBuildInput;
  range: { dateFrom: string; dateTo: string };
  entityLabel: string | null;
  columns: CustomExcelColumn[];
  rows: Record<string, string | number | null>[];
  sheetName: string;
}): CustomExcelBuildResult {
  const title = params.input.title.trim() || "Звіт LEVADIUS";
  const filenameBase = sanitizeExcelFilenameBase(title);
  const totalSummary: Record<string, number> = {};
  for (const col of params.columns) {
    if (!col.sum) continue;
    let sum = 0;
    for (const row of params.rows) {
      sum += num(row[col.key]);
    }
    totalSummary[col.key] = round2(sum);
  }

  return {
    title,
    filename: `${filenameBase}.xlsx`,
    filenameBase,
    reportScope: params.input.reportScope,
    dateFrom: params.range.dateFrom,
    dateTo: params.range.dateTo,
    entityLabel: params.entityLabel,
    columns: params.columns,
    rows: params.rows,
    totalRows: params.rows.length,
    totalSummary,
    sheetName: params.sheetName,
  };
}

export async function buildCustomExcelReport(
  supabase: SupabaseClient,
  input: CustomExcelBuildInput
): Promise<CustomExcelBuildResult> {
  const range = resolveDateRange(input.dateFrom, input.dateTo);
  const metrics = metricSet(input.includeMetrics);

  switch (input.reportScope) {
    case "equipment_single":
      return buildEquipmentSingle(supabase, input, range, metrics);
    case "equipment_fleet":
      return buildEquipmentFleet(supabase, input, range, metrics);
    case "field_operations":
      return buildFieldOperations(supabase, input, range, metrics);
    case "fuel_movement":
      return buildFuelMovement(supabase, input, range);
    case "inventory_moves":
      return buildInventoryMoves(supabase, input, range);
    case "driver_work":
      return buildDriverWork(supabase, input, range, metrics);
    case "financial_summary":
      return buildFinancialSummary(input, range);
    default:
      throw new Error(`Невідомий тип звіту: ${input.reportScope}`);
  }
}

export async function customExcelToBuffer(
  report: CustomExcelBuildResult
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LEVADIUS";
  wb.created = new Date();
  const ws = wb.addWorksheet(report.sheetName.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Title row
  ws.mergeCells(1, 1, 1, Math.max(1, report.columns.length));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${report.title} · ${report.dateFrom} — ${report.dateTo}`;
  titleCell.font = { bold: true, size: 12, color: { argb: "FF111827" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 22;

  // Header
  const headerRow = ws.getRow(2);
  report.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF111827" } },
      left: { style: "thin", color: { argb: "FF111827" } },
      bottom: { style: "thin", color: { argb: "FF111827" } },
      right: { style: "thin", color: { argb: "FF111827" } },
    };
  });
  headerRow.height = 20;

  const dataStart = 3;
  report.rows.forEach((row, rIdx) => {
    const excelRow = ws.getRow(dataStart + rIdx);
    report.columns.forEach((col, cIdx) => {
      const cell = excelRow.getCell(cIdx + 1);
      const raw = row[col.key];
      if (raw == null || raw === "") {
        cell.value = null;
      } else if (col.kind === "text") {
        cell.value = String(raw);
      } else {
        cell.value = Number(raw);
        if (col.kind === "number2") cell.numFmt = "0.00";
        else if (col.kind === "money") cell.numFmt = '#,##0.00 "₴"';
        else if (col.kind === "int") cell.numFmt = "0";
      }
      cell.alignment = {
        vertical: "middle",
        horizontal: col.kind === "text" ? "left" : "right",
      };
    });
  });

  const dataEnd = dataStart + Math.max(0, report.rows.length) - 1;
  if (report.rows.length > 0) {
    const totalRowIdx = dataEnd + 1;
    const totalRow = ws.getRow(totalRowIdx);
    report.columns.forEach((col, cIdx) => {
      const cell = totalRow.getCell(cIdx + 1);
      if (cIdx === 0) {
        cell.value = "Разом";
      } else if (col.sum) {
        const letter = colLetter(cIdx);
        cell.value = {
          formula: `SUM(${letter}${dataStart}:${letter}${dataEnd})`,
        };
        if (col.kind === "number2") cell.numFmt = "0.00";
        else if (col.kind === "money") cell.numFmt = '#,##0.00 "₴"';
        else if (col.kind === "int") cell.numFmt = "0";
      }
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
    });
  }

  report.columns.forEach((col, idx) => {
    const maxLen = Math.max(
      col.header.length,
      ...report.rows.map((r) => String(r[col.key] ?? "").length),
      8
    );
    ws.getColumn(idx + 1).width = Math.min(42, Math.max(12, maxLen + 2));
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildCustomExcelDownloadUrl(
  input: CustomExcelBuildInput & {
    resolvedTitle?: string;
  }
): string {
  const params = new URLSearchParams();
  params.set("reportScope", input.reportScope);
  params.set("title", input.resolvedTitle ?? input.title);
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  if (input.targetEntityIdOrName?.trim()) {
    params.set("target", input.targetEntityIdOrName.trim());
  }
  if (input.includeMetrics?.length) {
    params.set("metrics", input.includeMetrics.join(","));
  }
  return `/api/export/custom-excel?${params.toString()}`;
}

/**
 * Матриця операцій сезону (як експорт Хронології) — для API / агента.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import {
  fetchMaterialsByClientKeys,
  formatOperationMaterialsLine,
} from "@/lib/field-operation-materials";
import {
  computeEquipmentTimelineCost,
  equipmentFuelLiters,
  equipmentWageUah,
} from "@/lib/field-timeline-cost";
import { DEFAULT_DIESEL_PRICE_UAH } from "@/lib/fuel-price";
import { normalizeSeason } from "@/lib/season";
import { todayKyivYmd } from "@/lib/kyiv-date";

export type OperationsMatrixPeriod =
  | "all_season"
  | "current_month"
  | "last_30_days"
  | "custom";

export type OperationsMatrixFormat = "xlsx" | "csv";

export type OperationsMatrixRow = {
  Дата: string;
  Поле: string;
  "№/Урочище": string;
  Культура: string;
  "Операція (Станція)": string;
  Статус: string;
  "Агрегат (Трактор + Знаряддя)": string;
  Механізатор: string;
  "План га": number | "";
  "Факт га": number | "";
  "Витрата ДП (л)": number | "";
  "л/га": number | "";
  "Списані ТМЦ": string;
  "Нарахована ЗП": number | "";
  "Собівартість робіт (грн)": number | "";
};

export type OperationsMatrixBuildInput = {
  season: number | string;
  fieldId?: string | null;
  period?: OperationsMatrixPeriod;
  dateFrom?: string | null;
  dateTo?: string | null;
  dieselPriceUah?: number;
};

export type OperationsMatrixBuildResult = {
  rows: OperationsMatrixRow[];
  totalOperations: number;
  totalArea: number;
  season: string;
  periodLabel: string;
  filenameBase: string;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function statusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed" || s === "done") return "Виконано";
  if (s === "in_progress") return "В роботі";
  if (s === "assigned") return "Призначено";
  if (s === "planned") return "Заплановано";
  if (s === "cancelled") return "Скасовано";
  return status ? String(status) : "—";
}

function fieldLabel(row: {
  name?: string | null;
  canonical_name?: string | null;
}): string {
  return (
    (row.canonical_name && String(row.canonical_name).trim()) ||
    (row.name && String(row.name).trim()) ||
    "Поле"
  );
}

function tractLabel(fieldNo?: string | null, tract?: string | null): string {
  const no = String(fieldNo ?? "").trim();
  const tr = String(tract ?? "").trim();
  if (no && tr) return `${no} / ${tr}`;
  return no || tr || "—";
}

function aggregateLabel(
  machinery?: string | null,
  implement?: string | null
): string {
  const m = String(machinery ?? "").trim();
  const i = String(implement ?? "").trim();
  if (m && i) return `${m} + ${i}`;
  return m || i || "—";
}

function resolveDateRange(
  seasonYear: number,
  period: OperationsMatrixPeriod,
  dateFrom?: string | null,
  dateTo?: string | null
): { start: string; end: string; label: string } {
  const today = todayKyivYmd();
  const seasonStart = `${seasonYear}-01-01`;
  const seasonEnd = `${seasonYear}-12-31`;

  if (period === "custom" && dateFrom && dateTo) {
    return {
      start: dateFrom.slice(0, 10),
      end: dateTo.slice(0, 10),
      label: `${dateFrom.slice(0, 10)}_${dateTo.slice(0, 10)}`,
    };
  }

  if (period === "current_month") {
    const y = Number(today.slice(0, 4));
    const m = today.slice(5, 7);
    const start = `${y}-${m}-01`;
    const end = today;
    return { start, end, label: `${y}-${m}` };
  }

  if (period === "last_30_days") {
    const endDate = new Date(`${today}T12:00:00`);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 29);
    const start = startDate.toISOString().slice(0, 10);
    return { start, end: today, label: "last30" };
  }

  return {
    start: seasonStart,
    end: seasonEnd,
    label: `season${seasonYear}`,
  };
}

export async function buildOperationsMatrix(
  supabase: SupabaseClient,
  input: OperationsMatrixBuildInput
): Promise<OperationsMatrixBuildResult> {
  const season = normalizeSeason(input.season ?? 2026);
  const seasonYear = Number(season) || 2026;
  const period = input.period ?? "all_season";
  const { start, end, label } = resolveDateRange(
    seasonYear,
    period,
    input.dateFrom,
    input.dateTo
  );
  const dieselPrice = input.dieselPriceUah ?? DEFAULT_DIESEL_PRICE_UAH;

  let fieldsQuery = supabase
    .from("farm_fields")
    .select("id, name, canonical_name, crop, area_ha, field_no, tract")
    .eq("is_field", true)
    .limit(2000);

  if (input.fieldId) {
    fieldsQuery = fieldsQuery.eq("id", input.fieldId);
  }

  const { data: fields, error: fieldsError } = await fieldsQuery;
  if (fieldsError) throw new Error(fieldsError.message);

  const fieldRows = fields ?? [];
  if (fieldRows.length === 0) {
    return {
      rows: [],
      totalOperations: 0,
      totalArea: 0,
      season,
      periodLabel: label,
      filenameBase: `LEVADIUS_Matrix_${season}`,
    };
  }

  const fieldById = new Map(
    fieldRows.map((f) => [String(f.id), f] as const)
  );

  let opsQuery = supabase
    .from("field_operations")
    .select(
      `
      id, client_key, field_id, field_key, occurred_at, work_type, status,
      crop, machinery, implement, mechanic_name,
      area_plan, area_fact, fuel_plan, fuel_fact, wage_plan, wage_fact,
      season, season_year
    `
    )
    .gte("occurred_at", start)
    .lte("occurred_at", `${end}T23:59:59.999Z`)
    .neq("status", "cancelled")
    .order("occurred_at", { ascending: true })
    .limit(5000);

  if (input.fieldId) {
    const fieldKey = `farm:${input.fieldId}`;
    opsQuery = opsQuery.or(
      `field_id.eq.${input.fieldId},field_key.eq.${fieldKey}`
    );
  }

  const { data: ops, error: opsError } = await opsQuery;
  if (opsError) throw new Error(opsError.message);

  const operations = (ops ?? []).filter((op) => {
    const fid =
      (op.field_id && String(op.field_id)) ||
      (typeof op.field_key === "string" && op.field_key.startsWith("farm:")
        ? op.field_key.slice(5)
        : null);
    if (fid == null || !fieldById.has(fid)) return false;

    const sy =
      typeof op.season_year === "number"
        ? op.season_year
        : Number(String(op.season ?? "").trim());
    // Без сезону в рядку — лишаємо (дата вже в вікні); інакше лише цей сезон.
    if (Number.isFinite(sy) && sy > 0 && sy !== seasonYear) return false;
    return true;
  });

  const clientKeys = operations
    .map((op) => String(op.client_key || "").trim())
    .filter(Boolean);
  const materialsMap = await fetchMaterialsByClientKeys(supabase, clientKeys);

  const rows: OperationsMatrixRow[] = [];
  let totalArea = 0;

  for (const op of operations) {
    const fid =
      (op.field_id && String(op.field_id)) ||
      (typeof op.field_key === "string" && op.field_key.startsWith("farm:")
        ? op.field_key.slice(5)
        : "");
    const field = fieldById.get(fid);
    if (!field) continue;

    const plan = num(op.area_plan);
    const fact = num(op.area_fact);
    const areaForRate = fact > 0 ? fact : plan;
    const fuelL = equipmentFuelLiters(op);
    const wage = equipmentWageUah(op);
    const cost = computeEquipmentTimelineCost(op, dieselPrice);
    const lPerHa =
      areaForRate > 0 && fuelL > 0 ? round2(fuelL / areaForRate) : 0;
    const mats =
      formatOperationMaterialsLine(
        materialsMap.get(String(op.client_key || "")) ?? []
      ) || "—";

    if (fact > 0) totalArea += fact;
    else if (plan > 0) totalArea += plan;

    rows.push({
      Дата: String(op.occurred_at ?? "").slice(0, 10),
      Поле: fieldLabel(field),
      "№/Урочище": tractLabel(field.field_no, field.tract),
      Культура:
        String(op.crop ?? "").trim() ||
        String(field.crop ?? "").trim() ||
        "—",
      "Операція (Станція)": String(op.work_type ?? "Операція").trim() || "—",
      Статус: statusLabel(op.status),
      "Агрегат (Трактор + Знаряддя)": aggregateLabel(
        op.machinery,
        op.implement
      ),
      Механізатор: String(op.mechanic_name ?? "").trim() || "—",
      "План га": plan > 0 ? round2(plan) : "",
      "Факт га": fact > 0 ? round2(fact) : "",
      "Витрата ДП (л)": fuelL > 0 ? round2(fuelL) : "",
      "л/га": lPerHa > 0 ? lPerHa : "",
      "Списані ТМЦ": mats,
      "Нарахована ЗП": wage > 0 ? round2(wage) : "",
      "Собівартість робіт (грн)": cost > 0 ? cost : "",
    });
  }

  return {
    rows,
    totalOperations: rows.length,
    totalArea: round2(totalArea),
    season,
    periodLabel: label,
    filenameBase: `LEVADIUS_Matrix_${season}`,
  };
}

export function operationsMatrixToXlsxBuffer(
  rows: OperationsMatrixRow[]
): Buffer {
  const book = XLSX.utils.book_new();
  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["Немає операцій для експорту"]]);
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]!);
    sheet["!cols"] = keys.map((k) => ({
      wch: Math.min(36, Math.max(10, k.length + 4)),
    }));
  }
  XLSX.utils.book_append_sheet(book, sheet, "Матриця");
  const raw = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(raw);
}

export function operationsMatrixToCsv(rows: OperationsMatrixRow[]): string {
  const headers: (keyof OperationsMatrixRow)[] = [
    "Дата",
    "Поле",
    "№/Урочище",
    "Культура",
    "Операція (Станція)",
    "Статус",
    "Агрегат (Трактор + Знаряддя)",
    "Механізатор",
    "План га",
    "Факт га",
    "Витрата ДП (л)",
    "л/га",
    "Списані ТМЦ",
    "Нарахована ЗП",
    "Собівартість робіт (грн)",
  ];

  const escape = (value: string | number) => {
    const raw = value == null ? "" : String(value);
    if (/[;"\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
    return raw;
  };

  const lines = [headers.map(escape).join(";")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? "")).join(";"));
  }
  return `\uFEFF${lines.join("\n")}`;
}

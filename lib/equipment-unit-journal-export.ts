/**
 * Експорт денного журналу однієї машини (сесії + KPI) для агента / API.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { buildEquipmentDayTrack } from "@/lib/agent-equipment-ops";
import { todayKyivYmd } from "@/lib/kyiv-date";

export type UnitJournalFormat = "xlsx" | "csv";

export type UnitJournalBuildResult = {
  date: string;
  equipmentId: string;
  equipmentName: string;
  filenameBase: string;
  sessionCount: number;
  distanceKm: number;
  workHours: number;
  rows: Array<Record<string, string | number>>;
  summaryRows: Array<Record<string, string | number>>;
};

function clockFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

function kindUk(kind: string): string {
  if (kind === "field") return "Поле";
  if (kind === "base") return "База";
  return "Дорога";
}

export async function buildEquipmentUnitDayJournal(params: {
  supabase: SupabaseClient;
  equipmentId: string;
  equipmentName: string;
  wialonId: number | null;
  date?: string | null;
}): Promise<UnitJournalBuildResult> {
  const track = await buildEquipmentDayTrack({
    supabase: params.supabase,
    equipmentId: params.equipmentId,
    equipmentName: params.equipmentName,
    wialonId: params.wialonId,
    date: params.date,
  });
  if (!track.ok) {
    throw new Error(track.error);
  }

  const dateYmd = track.date || todayKyivYmd();
  const rows = track.visits.map((v) => ({
    "Час з": clockFromIso(v.startIso),
    "Час до": clockFromIso(v.endIso),
    Локація: v.name,
    Тип: kindUk(v.kind),
    "Тривалість хв": v.durationMin,
  }));

  const avg =
    track.workHours > 0.05 && track.fuelBurnedLiters != null
      ? Math.round((track.fuelBurnedLiters / track.workHours) * 10) / 10
      : "—";

  const summaryRows = [
    { Показник: "Техніка", Значення: track.equipmentName },
    { Показник: "Дата", Значення: dateYmd },
    { Показник: "Пробіг, км", Значення: track.distanceKm },
    { Показник: "Мотогодини", Значення: track.workHours },
    { Показник: "Idle, год", Значення: track.idleHours },
    { Показник: "На полі, год", Значення: track.hoursOnField },
    {
      Показник: "Спалено DUT, л",
      Значення: track.fuelBurnedLiters ?? "—",
    },
    { Показник: "Середня витрата л/год", Значення: avg },
    {
      Показник: "Середня швидкість, км/год",
      Значення: track.avgSpeedKmh ?? "—",
    },
    {
      Показник: "Макс. швидкість, км/год",
      Значення: track.maxSpeedKmh ?? "—",
    },
  ];

  const safeName = track.equipmentName
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .slice(0, 40);
  return {
    date: dateYmd,
    equipmentId: track.equipmentId,
    equipmentName: track.equipmentName,
    filenameBase: `Unit_Journal_${safeName}_${dateYmd.replaceAll("-", "")}`,
    sessionCount: rows.length,
    distanceKm: track.distanceKm,
    workHours: track.workHours,
    rows:
      rows.length > 0
        ? rows
        : [
            {
              "Час з": "—",
              "Час до": "—",
              Локація: "Немає сесій",
              Тип: "—",
              "Тривалість хв": 0,
            },
          ],
    summaryRows,
  };
}

export function unitJournalToXlsxBuffer(
  journal: UnitJournalBuildResult
): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(journal.rows),
    "Журнал"
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(journal.summaryRows),
    "Підсумок"
  );
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

export function unitJournalToCsv(journal: UnitJournalBuildResult): string {
  const sheet = XLSX.utils.json_to_sheet(journal.rows);
  return XLSX.utils.sheet_to_csv(sheet);
}

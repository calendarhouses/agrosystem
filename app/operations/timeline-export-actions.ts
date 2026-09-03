"use server";

import {
  fetchMaterialsByClientKeys,
  formatOperationMaterialsLine,
} from "@/lib/field-operation-materials";
import { mapOperationRow } from "@/lib/field-operations";
import {
  parseTimelineEventId,
  type ParsedTimelineEventId,
} from "@/lib/field-timeline-ids";
import type {
  UnifiedTimelineEventType,
  WeatherContext,
} from "@/lib/field-timeline-types";
import { createServiceSupabase } from "@/lib/supabase/server";

export type TimelineExcelStationInput = {
  eventId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  areaHa: number;
  dateIso: string;
  type: UnifiedTimelineEventType;
  title: string;
  subtitle: string;
  metric: string | null;
  cost: number;
  notes: string | null;
  imageUrl: string | null;
  operationStatus?: string | null;
  weatherContext?: WeatherContext | null;
};

export type TimelineExcelRow = {
  Поле: string;
  Культура: string;
  "Площа поля, га": number | "";
  Дата: string;
  Тип: string;
  Назва: string;
  Статус: string;
  Метрика: string;
  "Сума, ₴": number | "";
  Техніка: string;
  Знаряддя: string;
  Механізатор: string;
  "Площа факт, га": number | "";
  "Паливо факт, л": number | "";
  "Паливо план, л": number | "";
  "Ставка, ₴/га": number | "";
  "ЗП факт, ₴": number | "";
  "ЗП план, ₴": number | "";
  Матеріали: string;
  "Категорія ТМЦ": string;
  Кількість: number | "";
  Одиниця: string;
  "Ціна, ₴": number | "";
  "Хто створив": string;
  "Хто закрив": string;
  "Темп, °C": number | "";
  "Вологість, %": number | "";
  Погода: string;
  Коментар: string;
  "Фото URL": string;
  ID: string;
};

export type TimelineExcelFieldSummary = {
  Поле: string;
  Культура: string;
  "Площа, га": number | "";
  Станцій: number;
  "Сума, ₴": number;
  "₴/га": number | "";
};

function typeLabel(type: UnifiedTimelineEventType): string {
  if (type === "equipment") return "Наряд";
  if (type === "inventory") return "ТМЦ";
  return "Скаутинг";
}

function statusLabel(status: string | null | undefined): string {
  if (status === "planned") return "Заплановано";
  if (status === "in_progress") return "В роботі";
  if (status === "completed") return "Виконано";
  return status?.trim() || "";
}

function categoryLabel(category: string | null | undefined): string {
  if (category === "zzr") return "ЗЗР";
  if (category === "fertilizer") return "Добрива";
  if (category === "harvest") return "Врожай";
  if (category === "seed") return "Насіння";
  if (category === "parts") return "Запчастини";
  return category?.trim() || "";
}

function weatherFields(ctx: WeatherContext | null | undefined) {
  if (!ctx) {
    return {
      "Темп, °C": "" as const,
      "Вологість, %": "" as const,
      Погода: "",
    };
  }
  return {
    "Темп, °C": Number.isFinite(ctx.temp) ? ctx.temp : ("" as const),
    "Вологість, %": Number.isFinite(ctx.humidity) ? ctx.humidity : ("" as const),
    Погода: String(ctx.condition ?? "").trim(),
  };
}

function emptyExtras() {
  return {
    Техніка: "",
    Знаряддя: "",
    Механізатор: "",
    "Площа факт, га": "" as const,
    "Паливо факт, л": "" as const,
    "Паливо план, л": "" as const,
    "Ставка, ₴/га": "" as const,
    "ЗП факт, ₴": "" as const,
    "ЗП план, ₴": "" as const,
    Матеріали: "",
    "Категорія ТМЦ": "",
    Кількість: "" as const,
    Одиниця: "",
    "Ціна, ₴": "" as const,
    "Хто створив": "",
    "Хто закрив": "",
  };
}

function baseRow(station: TimelineExcelStationInput): TimelineExcelRow {
  return {
    Поле: station.fieldName,
    Культура: station.cropName,
    "Площа поля, га":
      Number.isFinite(station.areaHa) && station.areaHa > 0
        ? station.areaHa
        : "",
    Дата: station.dateIso,
    Тип: typeLabel(station.type),
    Назва: station.title,
    Статус: statusLabel(station.operationStatus),
    Метрика: station.metric ?? "",
    "Сума, ₴":
      Number.isFinite(station.cost) && station.cost !== 0 ? station.cost : "",
    ...emptyExtras(),
    ...weatherFields(station.weatherContext),
    Коментар: station.notes ?? "",
    "Фото URL": station.imageUrl ?? "",
    ID: station.eventId,
  };
}

/**
 * Збирає рядки Excel для видимих станцій хронології
 * з повним збагаченням з field_operations / inventory_local_moves.
 */
export async function buildTimelineExcelPayload(
  stations: TimelineExcelStationInput[]
): Promise<
  | {
      ok: true;
      rows: TimelineExcelRow[];
      fieldSummary: TimelineExcelFieldSummary[];
    }
  | { ok: false; error: string }
> {
  try {
    if (stations.length === 0) {
      return { ok: true, rows: [], fieldSummary: [] };
    }

    const parsed = stations.map((s) => ({
      station: s,
      parsed: parseTimelineEventId(s.eventId) as ParsedTimelineEventId | null,
    }));

    const equipmentKeys = [
      ...new Set(
        parsed
          .filter((p) => p.parsed?.kind === "equipment")
          .map((p) => (p.parsed as { kind: "equipment"; clientKey: string }).clientKey)
      ),
    ];
    const inventoryIds = [
      ...new Set(
        parsed
          .filter((p) => p.parsed?.kind === "inventory")
          .map((p) => (p.parsed as { kind: "inventory"; moveId: string }).moveId)
      ),
    ];

    const supabase = createServiceSupabase();

    const opsByKey = new Map<
      string,
      {
        op: ReturnType<typeof mapOperationRow>;
        actorName: string;
        closedByName: string;
      }
    >();
    if (equipmentKeys.length > 0) {
      const { data, error } = await supabase
        .from("field_operations")
        .select("*")
        .in("client_key", equipmentKeys);
      if (error && error.code !== "PGRST205" && error.code !== "42P01") {
        throw new Error(error.message);
      }
      for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const op = mapOperationRow(record);
        opsByKey.set(op.id, {
          op,
          actorName: String(record.actor_name ?? "").trim(),
          closedByName: String(record.closed_by_name ?? "").trim(),
        });
      }
      const materialsMap = await fetchMaterialsByClientKeys(
        supabase,
        equipmentKeys
      );
      for (const [key, materials] of materialsMap) {
        const entry = opsByKey.get(key);
        if (entry) entry.op.materials = materials;
      }
    }

    type MoveEnrich = {
      note: string | null;
      qty: number;
      unit: string;
      category: string | null;
      unitPrice: number | null;
      actorName: string | null;
      buyerName: string | null;
      itemName: string;
    };
    const movesById = new Map<string, MoveEnrich>();
    if (inventoryIds.length > 0) {
      const { data, error } = await supabase
        .from("inventory_local_moves")
        .select(
          `
          id,
          qty,
          note,
          unit_price_uah,
          actor_name,
          buyer_name,
          inventory_items_cache ( name, custom_name, unit, category )
        `
        )
        .in("id", inventoryIds);
      if (error && error.code !== "PGRST205" && error.code !== "42P01") {
        throw new Error(error.message);
      }
      for (const row of data ?? []) {
        const cacheRaw = row.inventory_items_cache as
          | {
              name?: string | null;
              custom_name?: string | null;
              unit?: string | null;
              category?: string | null;
            }
          | {
              name?: string | null;
              custom_name?: string | null;
              unit?: string | null;
              category?: string | null;
            }[]
          | null;
        const cache = Array.isArray(cacheRaw) ? cacheRaw[0] : cacheRaw;
        movesById.set(String(row.id), {
          note: row.note != null ? String(row.note) : null,
          qty: Number(row.qty) || 0,
          unit: String(cache?.unit ?? "").trim(),
          category: cache?.category != null ? String(cache.category) : null,
          unitPrice:
            row.unit_price_uah != null &&
            Number.isFinite(Number(row.unit_price_uah))
              ? Number(row.unit_price_uah)
              : null,
          actorName:
            row.actor_name != null ? String(row.actor_name).trim() : null,
          buyerName:
            row.buyer_name != null ? String(row.buyer_name).trim() : null,
          itemName:
            String(cache?.custom_name ?? "").trim() ||
            String(cache?.name ?? "").trim() ||
            "",
        });
      }
    }

    const rows: TimelineExcelRow[] = parsed.map(({ station, parsed: id }) => {
      const row = baseRow(station);

      if (id?.kind === "equipment") {
        const entry = opsByKey.get(id.clientKey);
        if (entry) {
          const op = entry.op;
          row.Назва = op.type || row.Назва;
          row.Статус = statusLabel(op.status) || row.Статус;
          row.Техніка = op.machinery || "";
          row.Знаряддя = op.implement || "";
          row.Механізатор = op.mechanicName?.trim() || "";
          row["Площа факт, га"] =
            Number.isFinite(op.areaDone) && op.areaDone > 0 ? op.areaDone : "";
          row["Паливо факт, л"] =
            Number.isFinite(op.fuelUsed) && op.fuelUsed > 0 ? op.fuelUsed : "";
          row["Паливо план, л"] =
            op.fuelPlan != null &&
            Number.isFinite(op.fuelPlan) &&
            op.fuelPlan > 0
              ? op.fuelPlan
              : "";
          row["Ставка, ₴/га"] =
            op.wageRateUahPerHa != null &&
            Number.isFinite(op.wageRateUahPerHa)
              ? op.wageRateUahPerHa
              : "";
          row["ЗП факт, ₴"] =
            Number.isFinite(op.wage) && op.wage > 0 ? op.wage : "";
          row["ЗП план, ₴"] =
            op.wagePlan != null && Number.isFinite(op.wagePlan) && op.wagePlan > 0
              ? op.wagePlan
              : "";
          row.Матеріали = formatOperationMaterialsLine(op.materials) || "";
          row["Хто створив"] = entry.actorName;
          row["Хто закрив"] = entry.closedByName;
          row.Коментар = op.agronomistComment?.trim() || row.Коментар;
          if (row["Сума, ₴"] === "" && Number.isFinite(op.wage) && op.wage > 0) {
            row["Сума, ₴"] = op.wage;
          }
        }
      } else if (id?.kind === "inventory") {
        const move = movesById.get(id.moveId);
        if (move) {
          if (move.itemName) row.Назва = move.itemName;
          row["Категорія ТМЦ"] = categoryLabel(move.category);
          row.Кількість = move.qty > 0 ? move.qty : "";
          row.Одиниця = move.unit;
          row["Ціна, ₴"] = move.unitPrice ?? "";
          row["Хто створив"] = move.actorName ?? "";
          row.Коментар = move.note?.trim() || row.Коментар;
          if (move.buyerName && !row.Коментар) {
            row.Коментар = `Контрагент: ${move.buyerName}`;
          } else if (move.buyerName && row.Коментар) {
            row.Коментар = `${row.Коментар} · Контрагент: ${move.buyerName}`;
          }
        } else {
          row["Категорія ТМЦ"] = station.subtitle || "";
        }
      }

      return row;
    });

    const byField = new Map<
      string,
      {
        fieldName: string;
        cropName: string;
        areaHa: number;
        count: number;
        cost: number;
      }
    >();
    for (const station of stations) {
      const prev = byField.get(station.fieldId) ?? {
        fieldName: station.fieldName,
        cropName: station.cropName,
        areaHa: station.areaHa,
        count: 0,
        cost: 0,
      };
      prev.count += 1;
      prev.cost += Number.isFinite(station.cost) ? station.cost : 0;
      byField.set(station.fieldId, prev);
    }

    const fieldSummary: TimelineExcelFieldSummary[] = [...byField.values()]
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName, "uk"))
      .map((f) => ({
        Поле: f.fieldName,
        Культура: f.cropName,
        "Площа, га":
          Number.isFinite(f.areaHa) && f.areaHa > 0 ? f.areaHa : "",
        Станцій: f.count,
        "Сума, ₴": Math.round(f.cost * 100) / 100,
        "₴/га":
          f.areaHa > 0
            ? Math.round((f.cost / f.areaHa) * 100) / 100
            : "",
      }));

    return { ok: true, rows, fieldSummary };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося підготувати дані для Excel",
    };
  }
}

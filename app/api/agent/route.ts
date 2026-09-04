import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  convertToModelMessages,
  generateObject,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createLocalOutboundMove } from "@/app/admin/inventory/actions";
import { loadAgentInventoryStock } from "@/lib/agent-warehouse-stock";
import {
  buildInvoicePreview,
  executeWarehouseReceipt,
  rollbackWarehouseReceipt,
  INVOICE_CATEGORIES,
} from "@/lib/agent-warehouse-receipt";
import {
  buildServiceActPreview,
  deleteServiceActs,
  executeServiceActSave,
  SERVICE_ACT_CATEGORIES,
} from "@/lib/agent-service-act";
import { fetchLiveFieldEconomics } from "@/lib/field-analytics";
import {
  defaultWageRateUahPerHa,
  estimateWageFromRate,
  normalizeWorkTypeKey,
} from "@/lib/field-operation-wage";
import { upsertFieldOperationRow } from "@/lib/field-operations-db";
import { enqueueFieldOperationBasDraft } from "@/lib/bas-drafts/field-operation-waybill";
import { enqueueBasSyncQueue } from "@/lib/bas-sync-queue";
import { buildFieldTechCardMatrix } from "@/lib/field-tech-card";
import { logActivity } from "@/lib/activity-log";
import { resolveFieldCoordinates } from "@/lib/field-weather-context";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canAccessLevadius } from "@/lib/levadius-access";
import { actorCloseColumns, actorCreateColumns, getCurrentActor } from "@/lib/app-actor";
import {
  estimatePlanFuelLiters,
  estimatePlanWageUah,
  fuelLitersPerHa,
  FUEL_L_PER_HA,
  IMPLEMENT_PRESETS,
  OPERATION_TYPES,
  WAGE_UAH_PER_HA,
} from "@/lib/field-operation-norms";
import { enqueueFuelBasDraft } from "@/lib/fuel-bas-sync";
import { computeTotalCost, roundLiters, roundPrice } from "@/lib/fuel-wac";
import {
  evaluateFieldWeatherAdvisory,
  evaluateSprayingWeatherWindow,
  fetchPlanningWeather,
  fetchWeatherWithHourly,
} from "@/lib/weather";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  estimateMaterialQty,
  operationRequiresMaterial,
} from "@/lib/operation-material-categories";
import {
  OPERATION_DOCS_BUCKET,
  validateAttachmentFile,
} from "@/lib/operation-attachments";
import { calculateTechInField } from "@/lib/field-tech-history";
import { getCachedWialonUnitsFull } from "@/lib/wialon-live-cache";
import { getCachedWialonGeofences } from "@/lib/wialon-boot-cache";
import { hectaresFromFeature } from "@/lib/geo-area";
import {
  hasValidWialonPosition,
  parseWialonUnitTelemetry,
  type WialonUnit,
} from "@/lib/wialon";
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Flash only — без -pro. Thinking вимкнено через thinkingBudget: 0. */
const DEFAULT_MODEL = "gemini-3.7-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-3.6-flash"] as const;

/** Старі Flash, які Google вже не дає новим ключам — не підставляти навіть з env. */
const RETIRED_FLASH_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-flash-latest",
]);

/** Жорсткий ліміт історії для LLM: лише останні 6 повідомлень (system окремо). */
const MAX_LLM_HISTORY_MESSAGES = 6;

/** Вимкнення reasoning/thinking (дорогі output-токени). AI SDK: thinkingBudget ≡ budgetTokens з ТЗ. */
const GOOGLE_NO_THINKING = {
  thinkingConfig: {
    thinkingBudget: 0,
    includeThoughts: false,
  },
} as const;

function isProModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id.includes("-pro") ||
    id.endsWith("/pro") ||
    /(^|[^a-z])pro([^a-z]|$)/.test(id)
  );
}

function isRetiredFlashModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase().replace(/^models\//, "");
  return RETIRED_FLASH_MODELS.has(id);
}

function resolveModelCandidates(): string[] {
  const primary =
    process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || DEFAULT_MODEL;
  const fromEnv = (process.env.GOOGLE_GENERATIVE_AI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fallbacks = fromEnv.length > 0 ? fromEnv : [...DEFAULT_FALLBACK_MODELS];
  const unique = [...new Set([primary, ...fallbacks])].filter(Boolean);
  const flashOnly = unique.filter((id) => !isProModelId(id));
  const active = flashOnly.filter((id) => !isRetiredFlashModelId(id));
  if (active.length < flashOnly.length) {
    console.warn(
      `[LEVADIUS] Відхилено застарілі Flash: ${flashOnly
        .filter((id) => isRetiredFlashModelId(id))
        .join(", ")}`
    );
  }
  if (active.length === 0) {
    console.warn(
      "[LEVADIUS] Немає валідних Flash → fallback на 3.7 / 3.6"
    );
    return [DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS];
  }
  if (active.length < unique.length) {
    const dropped = unique.filter((id) => !active.includes(id));
    if (dropped.some((id) => isProModelId(id))) {
      console.warn(
        `[LEVADIUS] Відхилено -pro моделі: ${dropped
          .filter((id) => isProModelId(id))
          .join(", ")}`
      );
    }
  }
  return active;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function isRetiredModelApiError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("no longer available") ||
    message.includes("update your code to use") ||
    message.includes("interactions api")
  );
}

function isCapacityError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("high demand") ||
    message.includes("resource exhausted") ||
    message.includes("overloaded") ||
    message.includes("503") ||
    message.includes("429") ||
    /\bunavailable\b/.test(message) ||
    message.includes("model_not_found") ||
    (message.includes("model") && message.includes("not found"))
  );
}

/** 503 / retired model — пробуємо наступну з ланцюжка fallback. */
function isRetriableModelError(error: unknown): boolean {
  return isCapacityError(error) || isRetiredModelApiError(error);
}

function humanizeAgentError(error: unknown): string {
  if (isRetiredModelApiError(error)) {
    return "Модель Gemini застаріла в конфігу. Оновіть GOOGLE_GENERATIVE_AI_MODEL на gemini-3.7-flash.";
  }
  if (isCapacityError(error)) {
    return "Модель Google зараз перевантажена. Спробуй ще раз за кілька секунд.";
  }
  const message = errorText(error).trim();
  return message || "Помилка LEVADIUS";
}

const SYSTEM_PROMPT = `
Роль: автономний диспетчер агрогосподарства LEVADIUS. Українською. Без канцеляриту й фамільярності.

Відповіді: максимум конкретики — цифри, статуси, списки. Мінімум розмовного тексту.
Факти ЛИШЕ з Tools. BAS — тільки читання. Бракує даних — одне уточнення.
Не вигадуй техніку, водіїв, ТМЦ, результати дій. CHOICE лише з даних Tools.

Мутації з підтвердженням (завжди draft confirmed=false → confirmed=true):
deleteField, deleteWorkOrder, deleteServiceActs, closeWorkOrder,
writeOffInventoryToField, logFuelRefueling, rollbackWarehouseReceipt,
updateFieldDetails (name/area/crop/category), updateFieldPlannedBudget,
logMaintenanceCompleted. Не стверджуй успіх без success:true.

Tools:
getFieldsStatus, getWarehouseStock, getFleetAndImplements, getDriversList,
getFieldWeather, checkSprayingWeatherWindow, getFieldNdviStatus,
getFieldOperationsHistory, getDailyOperationsSummary, getFieldUnifiedTimeline,
getFieldCostAnalysis, getLandBankSummary, getFieldLiveTelemetry, focusFieldOnMap,
getFuelStorageBalance, logFuelRefueling, getFieldFuelEfficiency,
getEquipmentMaintenanceStatus, linkServiceActToEquipment, logMaintenanceCompleted,
updateInventoryItemPrice, calculateDriverEarnings, getFieldBudgetBurnRate,
queueDocumentToBasSync, getFieldTechCardMatrix, generateFieldExportReport,
syncFieldWialonGeofence, searchFieldsCatalog,
updateFieldDetails, updateFieldPlannedBudget, createField, deleteField,
analyzeAndSaveScoutingReport, createWorkOrderFromGpsVisit,
writeOffInventoryToField, registerWarehouseItem,
previewInvoiceReceipt, executeWarehouseReceipt, rollbackWarehouseReceipt,
previewServiceAct, executeServiceActSave, deleteServiceActs,
prepareWorkOrder, confirmWorkOrder, deleteWorkOrder, closeWorkOrder,
getOperationRates, setOperationRate,
logUnsupportedRequest, getUnhandledRequests.

Таблиці: farm_fields, equipment, implements, inventory_items_cache,
inventory_local_moves, warehouse_receipts, field_operations,
field_operation_materials, work_type_wage_rates, fuel_storages,
fuel_transactions, bas_sync_queue, accounting_acts, scouting_reports,
wialon_field_fuel_logs, field_ndvi_alerts, equipment_maintenance_logs.

Маршрутизація (викликай tool, потім короткий звіт):
• Поля/статус → getFieldsStatus | пошук ділянок → searchFieldsCatalog
• Земельний банк → getLandBankSummary | карта → focusFieldOnMap
• Погода → getFieldWeather | обприскування → checkSprayingWeatherWindow
• NDVI → getFieldNdviStatus | телеметрія → getFieldLiveTelemetry
• Історія/наряди → getFieldOperationsHistory | день → getDailyOperationsSummary
• Хронологія → getFieldUnifiedTimeline | собівартість → getFieldCostAnalysis
• Бюджет burn → getFieldBudgetBurnRate | техкарта → getFieldTechCardMatrix
• Паливо залишки → getFuelStorageBalance | л/га → getFieldFuelEfficiency
• Заправка → logFuelRefueling (confirm) | ТО → getEquipmentMaintenanceStatus
• Акт→техніка → linkServiceActToEquipment | ТО done → logMaintenanceCompleted
• Склад → getWarehouseStock | списання → writeOffInventoryToField (confirm)
• Ціна ТМЦ → updateInventoryItemPrice | ЗП → calculateDriverEarnings
• Тарифи → getOperationRates / setOperationRate
• Паспорт поля → updateFieldDetails (confirm для name/area/crop/category)
• Бюджет ₴/га → updateFieldPlannedBudget (confirm) | create/deleteField
• Скаутинг фото → analyzeAndSaveScoutingReport | GPS-наряд → createWorkOrderFromGpsVisit
• Накладна → previewInvoiceReceipt → executeWarehouseReceipt / rollback
• Акт послуг → previewServiceAct → executeServiceActSave / deleteServiceActs
• Наряд: слоти → getWarehouseStock/getFleetAndImplements/getDriversList → prepareWorkOrder → confirmWorkOrder
• Закрити наряд → closeWorkOrder (confirm) | BAS черга → queueDocumentToBasSync
• Експорт → generateFieldExportReport | Wialon зона → syncFieldWialonGeofence
• Невідома дія → logUnsupportedRequest, потім дослівно:
  «Повна халепа, такого я ще не вмію робити, але Назар навчить скоро!»
  Помилка існуючого tool ≠ «не вмію» — поясни і запропонуй повторити.
• Беклог → getUnhandledRequests

Наряди (slot filling):
Обовʼязково: поле, тип, дата, техніка, механізатор.
ЗЗР/посів/добрива — ще складська позиція (реальні CHOICE з getWarehouseStock).
Механіка (оранка/культивація/дискування) — ТМЦ не вимагай.
Знаряддя — підтягуй з implements де доречно.
Дата: сьогодні/завтра/післязавтра лише з календаря контексту (Kyiv). Час 08:00–18:00.
prepareWorkOrder лише коли всі слоти зібрані. Не вигадуй техніку/водіїв/ТМЦ.
Новий механізатор — прийми імʼя. Новий ТМЦ без залишку — НЕ registerWarehouseItem(0);
попроси накладну або кількість+ціну.

Документи: фото накладної → previewInvoiceReceipt; акт послуг → previewServiceAct;
фото посіву → analyzeAndSaveScoutingReport. Не стверджуй збереження без execute*/success.

Скасування чернетки наряду в чаті: [[ACTION:DISMISS_DRAFT]] (без deleteWorkOrder).
Видалення збереженого — deleteWorkOrder з workOrderId з історії.

Формат:
• **жирні** назви полів і ключові цифри. Без емодзі.
• Іконки лише [icon:wheat|fuel|warehouse|tractor|check|alert|mappin|calendar|filetext]
• Рядки: [row:mappin|Поле 11.2|78.9 га]
• Кнопки: [[CHOICE:…]] | [[ACTION:REPLY|Icon|…]] | [[ACTION:NAVIGATE|/path|Icon|Текст]]
• NAVIGATE лише за темою (макс. 1): /fuel /inventory /operations /equipment /accounting /?field=UUID
• Після фактів — одна коротка пропозиція наступного кроку.
• UI-картки (списання, наряд, акт, накладна, updateField) — НЕ дублюй їхні CHOICE.
`.trim();

const userContextSchema = z
  .object({
    pathname: z.string().trim().max(500).optional(),
    activeFieldId: z.string().trim().max(100).nullish(),
    userName: z.string().trim().max(200).optional(),
    userRole: z.string().trim().max(100).optional(),
    client: z.enum(["pwa", "drawer"]).optional(),
  })
  .optional();

const uiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(z.record(z.string(), z.unknown())).optional(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
  })
  .passthrough();

const requestSchema = z
  .object({
    id: z.string().optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    messages: z.array(uiMessageSchema).min(1).max(100).optional(),
    userContext: userContextSchema,
  })
  .refine(
    (value) => value.prompt || (value.messages && value.messages.length > 0),
    {
      message: "Передайте prompt або messages",
    }
  );

const categoryAliases: Record<string, string> = {
  "ззр": "zzr",
  "засоби захисту рослин": "zzr",
  "zzr": "zzr",
  "добрива": "fertilizer",
  "добриво": "fertilizer",
  "fertilizer": "fertilizer",
  "насіння": "seed",
  "насиння": "seed",
  "seed": "seed",
  "паливо": "fuel",
  "пальне": "fuel",
  "fuel": "fuel",
  "врожай": "harvest",
  "harvest": "harvest",
  "запчастини": "parts",
  "parts": "parts",
};

const categoryLabels: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  fuel: "Паливо",
  harvest: "Врожай",
  parts: "Запчастини",
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCategory(value?: string): string | null | undefined {
  if (!value?.trim()) return undefined;
  return categoryAliases[value.trim().toLocaleLowerCase("uk-UA")] ?? null;
}

function serializeToolCalls(steps: unknown): unknown[] {
  if (!Array.isArray(steps)) return [];

  return steps.flatMap((step) => {
    if (!step || typeof step !== "object" || !("toolCalls" in step)) return [];
    const calls = (step as { toolCalls?: unknown }).toolCalls;
    return Array.isArray(calls) ? calls : [];
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type AgentEquipmentRow = {
  id: string;
  name: string;
  type: string | null;
  code: string | null;
  wialon_id: number | null;
  current_motohours: number | null;
  next_service_motohours: number | null;
  maintenance_status: string | null;
  is_active: boolean | null;
};

type ResolveAgentEquipmentResult =
  | { ok: true; equipment: AgentEquipmentRow }
  | {
      ok: false;
      status: "not_found" | "ambiguous" | "error";
      error: string;
      candidates?: { id: string; name: string }[];
    };

async function resolveAgentEquipmentByLookup(
  supabase: SupabaseClient,
  lookupRaw: string,
  selectCols = "id, name, type, code, wialon_id, current_motohours, next_service_motohours, maintenance_status, is_active"
): Promise<ResolveAgentEquipmentResult> {
  const lookup = lookupRaw.trim();
  if (!lookup) {
    return {
      ok: false,
      status: "not_found",
      error: "Вкажи назву, код або ID техніки.",
    };
  }

  try {
    if (isUuid(lookup)) {
      const { data, error } = await supabase
        .from("equipment")
        .select(selectCols)
        .eq("id", lookup)
        .maybeSingle();
      if (error) {
        if (
          error.message?.includes("current_motohours") ||
          error.message?.includes("maintenance_status") ||
          error.code === "42703"
        ) {
          const fallback = await supabase
            .from("equipment")
            .select("id, name, type, code, wialon_id, is_active")
            .eq("id", lookup)
            .maybeSingle();
          if (fallback.data) {
            return {
              ok: true,
              equipment: {
                id: String(fallback.data.id),
                name: String(fallback.data.name ?? "Техніка"),
                type: fallback.data.type ? String(fallback.data.type) : null,
                code: fallback.data.code ? String(fallback.data.code) : null,
                wialon_id:
                  fallback.data.wialon_id != null &&
                  Number.isFinite(Number(fallback.data.wialon_id))
                    ? Number(fallback.data.wialon_id)
                    : null,
                current_motohours: null,
                next_service_motohours: null,
                maintenance_status: "ok",
                is_active:
                  fallback.data.is_active == null
                    ? true
                    : Boolean(fallback.data.is_active),
              },
            };
          }
        }
        return { ok: false, status: "error", error: error.message };
      }
      if (!data) {
        return {
          ok: false,
          status: "not_found",
          error: `Техніку з id ${lookup} не знайдено.`,
        };
      }
      const row = data as unknown as Record<string, unknown>;
      return {
        ok: true,
        equipment: {
          id: String(row.id),
          name: String(row.name ?? "Техніка"),
          type: row.type != null ? String(row.type) : null,
          code: row.code != null ? String(row.code) : null,
          wialon_id:
            row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
              ? Number(row.wialon_id)
              : null,
          current_motohours:
            row.current_motohours != null
              ? finiteNumber(row.current_motohours)
              : null,
          next_service_motohours:
            row.next_service_motohours != null
              ? finiteNumber(row.next_service_motohours)
              : null,
          maintenance_status:
            row.maintenance_status != null
              ? String(row.maintenance_status)
              : "ok",
          is_active: row.is_active == null ? true : Boolean(row.is_active),
        },
      };
    }

    const { data: rows, error } = await supabase
      .from("equipment")
      .select(selectCols)
      .or(
        `name.ilike.%${lookup}%,full_name.ilike.%${lookup}%,code.ilike.%${lookup}%`
      )
      .order("name")
      .limit(10);

    if (error) {
      if (
        error.message?.includes("current_motohours") ||
        error.message?.includes("maintenance_status") ||
        error.code === "42703"
      ) {
        const fallback = await supabase
          .from("equipment")
          .select("id, name, type, code, wialon_id, is_active")
          .or(
            `name.ilike.%${lookup}%,full_name.ilike.%${lookup}%,code.ilike.%${lookup}%`
          )
          .order("name")
          .limit(10);
        const list = fallback.data ?? [];
        if (list.length === 0) {
          return {
            ok: false,
            status: "not_found",
            error: `Техніку «${lookup}» не знайдено.`,
          };
        }
        const exact = list.find(
          (r) =>
            String(r.name ?? "").toLocaleLowerCase("uk-UA") ===
              lookup.toLocaleLowerCase("uk-UA") ||
            String(r.code ?? "").toLocaleLowerCase("uk-UA") ===
              lookup.toLocaleLowerCase("uk-UA")
        );
        const chosen = exact ?? (list.length === 1 ? list[0] : null);
        if (!chosen) {
          return {
            ok: false,
            status: "ambiguous",
            error: `Кілька одиниць техніки для «${lookup}». Уточни назву.`,
            candidates: list.map((r) => ({
              id: String(r.id),
              name: String(r.name ?? ""),
            })),
          };
        }
        return {
          ok: true,
          equipment: {
            id: String(chosen.id),
            name: String(chosen.name ?? "Техніка"),
            type: chosen.type ? String(chosen.type) : null,
            code: chosen.code ? String(chosen.code) : null,
            wialon_id:
              chosen.wialon_id != null &&
              Number.isFinite(Number(chosen.wialon_id))
                ? Number(chosen.wialon_id)
                : null,
            current_motohours: null,
            next_service_motohours: null,
            maintenance_status: "ok",
            is_active:
              chosen.is_active == null ? true : Boolean(chosen.is_active),
          },
        };
      }
      return { ok: false, status: "error", error: error.message };
    }

    const list = (rows ?? []) as unknown as Record<string, unknown>[];
    if (list.length === 0) {
      return {
        ok: false,
        status: "not_found",
        error: `Техніку «${lookup}» не знайдено.`,
      };
    }
    const exact = list.find((r) => {
      const name = String(r.name ?? "").toLocaleLowerCase("uk-UA");
      const code = String(r.code ?? "").toLocaleLowerCase("uk-UA");
      const needle = lookup.toLocaleLowerCase("uk-UA");
      return name === needle || code === needle;
    });
    const chosen = exact ?? (list.length === 1 ? list[0] : null);
    if (!chosen) {
      return {
        ok: false,
        status: "ambiguous",
        error: `Кілька одиниць техніки для «${lookup}». Уточни назву.`,
        candidates: list.map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ""),
        })),
      };
    }
    return {
      ok: true,
      equipment: {
        id: String(chosen.id),
        name: String(chosen.name ?? "Техніка"),
        type: chosen.type != null ? String(chosen.type) : null,
        code: chosen.code != null ? String(chosen.code) : null,
        wialon_id:
          chosen.wialon_id != null &&
          Number.isFinite(Number(chosen.wialon_id))
            ? Number(chosen.wialon_id)
            : null,
        current_motohours:
          chosen.current_motohours != null
            ? finiteNumber(chosen.current_motohours)
            : null,
        next_service_motohours:
          chosen.next_service_motohours != null
            ? finiteNumber(chosen.next_service_motohours)
            : null,
        maintenance_status:
          chosen.maintenance_status != null
            ? String(chosen.maintenance_status)
            : "ok",
        is_active:
          chosen.is_active == null ? true : Boolean(chosen.is_active),
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Невідома помилка пошуку техніки",
    };
  }
}

type AgentFieldRow = {
  id: string;
  name: string | null;
  canonical_name: string | null;
  crop: string | null;
  area_ha: number | null;
  season?: string | null;
  notes?: string | null;
  planned_budget_per_ha?: number | null;
  color?: string | null;
  is_field?: boolean | null;
  plot_category?: string | null;
  is_active?: boolean | null;
  wialon_zone_id?: string | null;
  geometry?: unknown;
  tract?: string | null;
  previous_crop?: string | null;
};

type ResolveAgentFieldResult =
  | { ok: true; field: AgentFieldRow; fieldName: string }
  | {
      ok: false;
      status: "needs_slots" | "field_not_found" | "ambiguous_field" | "error";
      error: string;
      candidates?: { id: string; name: string; areaHa?: number }[];
    };

function agentFieldDisplayName(field: AgentFieldRow): string {
  return (
    (field.canonical_name && field.canonical_name.trim()) ||
    field.name ||
    "Поле"
  );
}

async function resolveAgentFieldByLookup(
  supabase: SupabaseClient,
  lookupRaw: string,
  selectCols = "id, name, canonical_name, crop, area_ha, season",
  options?: { includeNonFields?: boolean; includeInactive?: boolean }
): Promise<ResolveAgentFieldResult> {
  const lookup = lookupRaw.trim();
  if (!lookup) {
    return {
      ok: false,
      status: "needs_slots",
      error: "Вкажи назву або ID поля.",
    };
  }

  let field: AgentFieldRow | null = null;
  const onlyFields = options?.includeNonFields !== true;
  const onlyActive = options?.includeInactive !== true;

  if (isUuid(lookup)) {
    let q = supabase
      .from("farm_fields")
      .select(selectCols)
      .eq("id", lookup);
    if (onlyFields) q = q.eq("is_field", true);
    if (onlyActive) q = q.neq("is_active", false);
    const { data, error } = await q.maybeSingle();
    if (error) {
      // is_active може ще не існувати
      if (
        error.message?.includes("is_active") ||
        error.code === "42703"
      ) {
        let q2 = supabase
          .from("farm_fields")
          .select(selectCols)
          .eq("id", lookup);
        if (onlyFields) q2 = q2.eq("is_field", true);
        const retry = await q2.maybeSingle();
        if (retry.error) {
          return {
            ok: false,
            status: "error",
            error: `Не вдалося знайти поле: ${retry.error.message}`,
          };
        }
        field = (retry.data as unknown as AgentFieldRow | null) ?? null;
      } else {
        return {
          ok: false,
          status: "error",
          error: `Не вдалося знайти поле: ${error.message}`,
        };
      }
    } else {
      field = (data as unknown as AgentFieldRow | null) ?? null;
    }
  }

  if (!field) {
    const safe = lookup.replaceAll(",", " ");
    let q = supabase
      .from("farm_fields")
      .select(selectCols)
      .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
      .order("name")
      .limit(5);
    if (onlyFields) q = q.eq("is_field", true);
    if (onlyActive) q = q.neq("is_active", false);
    let { data: matches, error } = await q;
    if (
      error &&
      (error.message?.includes("is_active") || error.code === "42703")
    ) {
      let q2 = supabase
        .from("farm_fields")
        .select(selectCols)
        .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
        .order("name")
        .limit(5);
      if (onlyFields) q2 = q2.eq("is_field", true);
      const retry = await q2;
      matches = retry.data;
      error = retry.error;
    }
    if (error) {
      return {
        ok: false,
        status: "error",
        error: `Не вдалося шукати поле: ${error.message}`,
      };
    }
    const rows = (matches ?? []) as unknown as AgentFieldRow[];
    if (rows.length === 0) {
      return {
        ok: false,
        status: "field_not_found",
        error: `Поле «${lookup}» не знайдено.`,
      };
    }
    const needle = lookup.toLocaleLowerCase("uk-UA");
    const exact = rows.find(
      (row) =>
        String(row.name ?? "").toLocaleLowerCase("uk-UA") === needle ||
        String(row.canonical_name ?? "").toLocaleLowerCase("uk-UA") === needle
    );
    if (rows.length > 1 && !exact) {
      return {
        ok: false,
        status: "ambiguous_field",
        error: `Знайдено кілька полів для «${lookup}». Уточни.`,
        candidates: rows.map((row) => ({
          id: row.id,
          name: agentFieldDisplayName(row),
          areaHa: finiteNumber(row.area_ha),
        })),
      };
    }
    field = exact ?? rows[0]!;
  }

  return {
    ok: true,
    field,
    fieldName: agentFieldDisplayName(field),
  };
}

function resolveHistoryDateRange(options: {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
}): { startDate: string | null; endDate: string | null; label: string | null } {
  const start = options.startDate?.trim().slice(0, 10) || null;
  const end = options.endDate?.trim().slice(0, 10) || null;
  if (start || end) {
    return {
      startDate: start,
      endDate: end,
      label:
        start && end
          ? `${start}…${end}`
          : start
            ? `з ${start}`
            : end
              ? `до ${end}`
              : null,
    };
  }

  const month = options.month;
  if (month != null && Number.isFinite(month) && month >= 1 && month <= 12) {
    const year =
      options.year && Number.isFinite(options.year)
        ? Math.trunc(options.year)
        : Number(DEFAULT_SEASON) || new Date().getFullYear();
    const mm = String(Math.trunc(month)).padStart(2, "0");
    const lastDay = new Date(year, Math.trunc(month), 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
    return {
      startDate,
      endDate,
      label: `${mm}.${year}`,
    };
  }

  return { startDate: null, endDate: null, label: null };
}

async function applyFieldDetailsUpdate(
  supabase: SupabaseClient,
  resolved: { field: AgentFieldRow; fieldName: string },
  patchInput: {
    name?: string;
    culture?: string;
    area?: number;
    notes?: string;
    color?: string;
    category?: "field" | "garden" | "base";
  }
) {
  const patch: Record<string, unknown> = {};
  if (patchInput.name?.trim()) {
    const nextName = patchInput.name.trim();
    // UI показує canonical_name ?? name — оновлюємо обидва
    patch.name = nextName;
    patch.canonical_name = nextName;
  }
  if (patchInput.culture?.trim()) {
    patch.crop = patchInput.culture.trim();
  }
  if (
    patchInput.area != null &&
    Number.isFinite(patchInput.area) &&
    patchInput.area > 0
  ) {
    patch.area_ha = round2(patchInput.area);
  }
  if (patchInput.notes != null) {
    patch.notes = patchInput.notes.trim();
  }
  if (patchInput.color?.trim()) {
    const hex = normalizeFieldColor(patchInput.color);
    if (hex) patch.color = hex;
  }
  if (patchInput.category) {
    patch.plot_category = patchInput.category;
    patch.is_field = patchInput.category === "field";
  }

  if (Object.keys(patch).length === 0) {
    return {
      success: false as const,
      status: "needs_slots" as const,
      error: "Немає валідних полів для оновлення.",
    };
  }

  const selectCols =
    "id, name, canonical_name, crop, area_ha, season, notes, color, is_field, plot_category";

  const { data, error } = await supabase
    .from("farm_fields")
    .update(patch)
    .eq("id", resolved.field.id)
    .select(selectCols)
    .single();

  if (error) {
    // Поступово знімаємо колонки, яких ще немає
    let retryPatch = { ...patch };
    let lastError = error;
    for (const col of ["plot_category", "notes", "color"] as const) {
      if (
        !(col in retryPatch) ||
        !(
          lastError.message?.includes(col) ||
          lastError.code === "42703"
        )
      ) {
        continue;
      }
      delete retryPatch[col];
      if (Object.keys(retryPatch).length === 0) {
        return {
          success: false as const,
          status: "error" as const,
          error: `Колонка ${col} ще відсутня. Застосуй міграції farm_fields.`,
        };
      }
      const retry = await supabase
        .from("farm_fields")
        .update(retryPatch)
        .eq("id", resolved.field.id)
        .select("id, name, canonical_name, crop, area_ha, season, is_field")
        .single();
      if (!retry.error && retry.data) {
        const row = retry.data as unknown as AgentFieldRow;
        const area = finiteNumber(row.area_ha);
        const name =
          (row.canonical_name && row.canonical_name.trim()) ||
          row.name ||
          resolved.fieldName;
        return {
          success: true as const,
          status: "updated" as const,
          fieldId: row.id,
          fieldName: name,
          updatedField: {
            id: row.id,
            name,
            area,
            crop: row.crop,
            color: typeof patch.color === "string" ? patch.color : null,
            category: patchInput.category ?? null,
            isField: row.is_field !== false,
          },
          warning: `Частина полів не збережена (немає колонки ${col}).`,
          openFieldPath: `/?field=${row.id}`,
        };
      }
      lastError = retry.error ?? lastError;
    }
    return {
      success: false as const,
      status: "error" as const,
      error: `Не вдалося оновити поле: ${lastError.message}`,
    };
  }

  const row = data as unknown as AgentFieldRow;
  const area = finiteNumber(row.area_ha);
  const name =
    (row.canonical_name && row.canonical_name.trim()) ||
    row.name ||
    resolved.fieldName;
  return {
    success: true as const,
    status: "updated" as const,
    fieldId: row.id,
    fieldName: name,
    updatedField: {
      id: row.id,
      name,
      area,
      crop: row.crop,
      color: row.color ?? null,
      category: (row.plot_category as string | null) ?? null,
      isField: row.is_field !== false,
    },
    openFieldPath: `/?field=${row.id}`,
  };
}

/** Placeholder-контур: крихітний полігон (реальний контур малюють на карті). */
const AGENT_FIELD_PLACEHOLDER_GEOMETRY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [30.52, 49.48],
      [30.52015, 49.48],
      [30.52015, 49.48015],
      [30.52, 49.48015],
      [30.52, 49.48],
    ],
  ],
};

function normalizeFieldColor(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(value)) {
    const h = value.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return null;
}

function plotCategoryFromInput(
  category: "field" | "garden" | "base" | undefined
): { plot_category: "field" | "garden" | "base"; is_field: boolean } {
  const plot_category = category ?? "field";
  return {
    plot_category,
    is_field: plot_category === "field",
  };
}

function categoryLabel(category: string): string {
  if (category === "garden") return "Городи";
  if (category === "base") return "База/склад";
  return "Товарне поле";
}

function toFieldPolygonFeature(
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

function unitLiveSnapshot(unit: WialonUnit) {
  const telemetry = parseWialonUnitTelemetry(unit);
  const speedKmh = Math.max(0, Math.round(Number(unit.pos?.s ?? 0)));
  const lat = Number(unit.pos?.y);
  const lng = Number(unit.pos?.x);
  return {
    wialonUnitId: unit.id,
    name: unit.nm,
    speedKmh,
    isMoving: speedKmh > 0,
    ignition: telemetry.ignition,
    fuelLiters:
      telemetry.fuelLiters != null ? round2(telemetry.fuelLiters) : null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    statusLabel:
      speedKmh > 0
        ? "У русі"
        : telemetry.ignition === true
          ? "Стоїть (запалювання увімкнено)"
          : "Стоїть",
  };
}

const WORK_ORDER_TYPES = [
  "Посів",
  "Оранка",
  "Культивація",
  "Дискування",
  "Внесення ЗЗР",
  "Внесення добрив",
  "Збирання",
] as const;

type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

/** Типи implements.type → підказка автопідбору знаряддя */
const IMPLEMENT_DB_TYPES_BY_OP: Record<WorkOrderType, string[]> = {
  Посів: ["seeder"],
  Оранка: ["plow"],
  Культивація: ["cultivator"],
  Дискування: ["harrow"],
  "Внесення ЗЗР": ["sprayer"],
  "Внесення добрив": ["spreader"],
  Збирання: ["header"],
};

function normalizeWorkOrderType(raw: string): WorkOrderType | null {
  const value = raw.trim().toLocaleLowerCase("uk-UA");
  if (!value) return null;
  if (value.includes("посів")) return "Посів";
  if (value.includes("оран")) return "Оранка";
  if (value.includes("культив")) return "Культивація";
  if (value.includes("диск")) return "Дискування";
  if (value.includes("ззр") || value.includes("захист")) return "Внесення ЗЗР";
  if (value.includes("добрив")) return "Внесення добрив";
  if (value.includes("збир") || value.includes("жнив")) return "Збирання";
  const exact = WORK_ORDER_TYPES.find(
    (item) => item.toLocaleLowerCase("uk-UA") === value
  );
  return exact ?? null;
}

function formatUkLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

function resolveWorkOrderDateInput(raw: string): {
  date: string;
  resolvedFrom?: string;
} | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Не вказано дату" };

  const today = todayKyivYmd();
  const lower = value.toLocaleLowerCase("uk-UA");

  if (
    lower === "сьогодні" ||
    lower === "сегодня" ||
    lower === "today"
  ) {
    return { date: today, resolvedFrom: value };
  }
  if (lower === "завтра" || lower === "tomorrow") {
    return { date: shiftKyivYmd(today, 1), resolvedFrom: value };
  }
  if (
    lower === "післязавтра" ||
    lower === "послезавтра" ||
    lower === "day after tomorrow"
  ) {
    return { date: shiftKyivYmd(today, 2), resolvedFrom: value };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: value };
  }

  return {
    error: `Некоректна дата «${value}». Передай YYYY-MM-DD або «сьогодні»/«завтра».`,
  };
}

function uiMessagesHaveFileAttachment(messages: unknown[]): boolean {
  return extractLastUserFileAttachments(messages).length > 0;
}

/** Усі файли з останнього user-повідомлення (скани актів/накладних). */
function extractLastUserFileAttachments(messages: unknown[]): Array<{
  fileName: string;
  mimeType: string;
  base64: string;
}> {
  const out: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: unknown }).role !== "user") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const row = part as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type : "";
      if (type !== "file" && type !== "image") continue;

      const mimeType =
        (typeof row.mediaType === "string" && row.mediaType) ||
        (typeof row.mimeType === "string" && row.mimeType) ||
        "image/jpeg";
      const fileName =
        (typeof row.filename === "string" && row.filename) ||
        (typeof row.name === "string" && row.name) ||
        (mimeType.includes("pdf") ? "document.pdf" : "document.jpg");

      let base64: string | null = null;
      const url = typeof row.url === "string" ? row.url : null;
      const data = typeof row.data === "string" ? row.data : null;

      if (url?.startsWith("data:")) {
        const comma = url.indexOf(",");
        if (comma >= 0) base64 = url.slice(comma + 1);
      } else if (data?.startsWith("data:")) {
        const comma = data.indexOf(",");
        if (comma >= 0) base64 = data.slice(comma + 1);
      } else if (data && data.length > 80) {
        base64 = data.replace(/\s+/g, "");
      }

      if (!base64) continue;
      out.push({ fileName, mimeType, base64 });
    }

    if (out.length > 0) return out;
  }
  return out;
}

function isHeavyMediaPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const row = part as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "file" || type === "image") return true;
  if (typeof row.data === "string" && row.data.length > 500) {
    // data:image… / base64 blobs
    if (
      row.data.startsWith("data:") ||
      (/^[A-Za-z0-9+/=\s]+$/.test(row.data.slice(0, 80)) &&
        row.data.length > 2_000)
    ) {
      return true;
    }
  }
  if (typeof row.url === "string" && row.url.startsWith("data:")) return true;
  return false;
}

function countHeavyItems(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.length;
}

function compactHeavyToolOutput(
  output: unknown,
  toolName: string
): unknown {
  if (!output || typeof output !== "object") return output;
  const row = output as Record<string, unknown>;

  // Великі списки складу / флоту / полів / історії → компактний статус
  const arrayKeys = [
    "stock",
    "inventory",
    "fuel",
    "fields",
    "selfPropelled",
    "implements",
    "drivers",
    "operations",
    "configured",
    "missing",
    "items",
    "services",
    "recent",
    "candidates",
    "equipmentCandidates",
  ] as const;

  let totalItems = 0;
  let hadHeavyArray = false;
  const compact: Record<string, unknown> = {
    success: true,
    status: "loaded",
  };

  for (const key of arrayKeys) {
    if (!(key in row)) continue;
    const n = countHeavyItems(row[key]);
    if (n >= 3 || (Array.isArray(row[key]) && JSON.stringify(row[key]).length > 400)) {
      hadHeavyArray = true;
      totalItems += n;
    }
  }

  // Також якщо весь output великий
  const raw = JSON.stringify(output);
  if (!hadHeavyArray && raw.length <= 500) {
    return output;
  }

  if (hadHeavyArray || raw.length > 500) {
    // Зберігаємо критичні скаляри для підтверджень
    for (const key of [
      "status",
      "success",
      "error",
      "receiptId",
      "actId",
      "actIds",
      "fieldId",
      "fieldName",
      "confirmChoice",
      "cancelChoice",
      "userHint",
      "warning",
      "message",
      "invoiceNumber",
      "supplier",
      "contractorName",
      "totalAmount",
      "deletedCount",
      "count",
      "fieldCount",
      "empty",
      "emptyHint",
    ] as const) {
      if (key in row && row[key] != null && typeof row[key] !== "object") {
        compact[key] = row[key];
      }
    }
    if (typeof row.status === "string") compact.status = row.status;
    compact.count =
      totalItems ||
      (typeof row.count === "number" ? row.count : undefined) ||
      (typeof row.fieldCount === "number" ? row.fieldCount : undefined) ||
      Math.max(0, Math.round(raw.length / 80));
    compact.tool = toolName;
    compact.note = "Повний список скорочено (історія діалогу).";
    return compact;
  }

  return output;
}

function slimHistoricToolPart(part: Record<string, unknown>): Record<string, unknown> {
  const next = { ...part };
  const toolName =
    typeof next.toolName === "string"
      ? next.toolName
      : typeof next.type === "string"
        ? next.type.replace(/^tool-/, "")
        : "tool";

  if ("output" in next && next.output != null) {
    next.output = compactHeavyToolOutput(next.output, toolName);
  }
  if ("input" in next && next.input != null) {
    const raw = JSON.stringify(next.input);
    if (raw.length > 300) {
      next.input = { success: true, status: "loaded", count: 1 };
    }
  }
  return next;
}

/**
 * Перед LLM: slice(-6) + без старих PDF/фото + компактні tool-result.
 * Останнє повідомлення лишається з вкладеннями (Vision).
 */
function sanitizeUiMessagesForLlm(messages: UIMessage[]): UIMessage[] {
  const trimmedMessages = messages.slice(-MAX_LLM_HISTORY_MESSAGES);
  const lastIndex = trimmedMessages.length - 1;

  return trimmedMessages.map((message, index) => {
    if (index === lastIndex) return message;

    const parts = Array.isArray(message.parts) ? message.parts : [];
    let strippedFiles = 0;
    const nextParts: UIMessage["parts"] = [];

    for (const part of parts) {
      if (isHeavyMediaPart(part)) {
        strippedFiles += 1;
        continue;
      }
      if (part && typeof part === "object") {
        const row = part as Record<string, unknown>;
        const type = typeof row.type === "string" ? row.type : "";
        if (type === "dynamic-tool" || type.startsWith("tool-")) {
          nextParts.push(
            slimHistoricToolPart(row) as UIMessage["parts"][number]
          );
          continue;
        }
      }
      nextParts.push(part);
    }

    if (strippedFiles > 0) {
      nextParts.unshift({
        type: "text",
        text: `[Раніше прикріплено файл(и): ${strippedFiles}. Вміст не передається повторно.]`,
      } as UIMessage["parts"][number]);
    }

    const cleaned = { ...message, parts: nextParts } as UIMessage & {
      experimental_attachments?: unknown;
    };
    if ("experimental_attachments" in cleaned) {
      delete cleaned.experimental_attachments;
    }
    return cleaned;
  });
}

const DOCUMENT_VISION_PROMPT = `
ВКЛАДЕННЯ (фото/PDF):
A) Накладна/чек ТМЦ → previewInvoiceReceipt
B) Акт послуг → previewServiceAct
C) Фото посіву/поля → analyzeAndSaveScoutingReport (fieldIdOrName або activeFieldId)
Не вигадуй рядків. Не стверджуй збереження без execute*/success (скаутинг: success=вже збережено).
`.trim();

function buildSystemPrompt(
  userContext?: {
    pathname?: string;
    activeFieldId?: string | null;
    userName?: string;
    userRole?: string;
  },
  options?: { hasInvoiceAttachment?: boolean }
): string {
  const today = todayKyivYmd();
  const tomorrow = shiftKyivYmd(today, 1);
  const dayAfter = shiftKyivYmd(today, 2);

  const contextBlock = [
    "Контекст:",
    `Сторінка: ${userContext?.pathname?.trim() || "—"}`,
    `activeFieldId: ${userContext?.activeFieldId?.trim() || "—"}`,
    userContext?.userName ? `Юзер: ${userContext.userName}` : null,
    userContext?.userRole ? `Роль: ${userContext.userRole}` : null,
    "activeFieldId — дефолтне поле, якщо не назване.",
    "",
    "Календар (Europe/Kyiv):",
    `Сьогодні: ${today}`,
    `Завтра: ${tomorrow}`,
    `Післязавтра: ${dayAfter}`,
    "«завтра»/«сьогодні»/«післязавтра» = лише ці дати.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const visionBlock = options?.hasInvoiceAttachment
    ? `\n\n${DOCUMENT_VISION_PROMPT}`
    : "";

  return `${SYSTEM_PROMPT}\n\n${contextBlock}${visionBlock}`;
}

function extractPromptText(messages: unknown[]): string {
  const lastUserMessage = messages
    .filter((m) => {
      if (!m || typeof m !== "object") return false;
      return (m as { role?: unknown }).role === "user";
    })
    .pop() as
    | {
        content?: unknown;
        parts?: unknown;
      }
    | undefined;

  if (!lastUserMessage) return "Запит без тексту";

  if (typeof lastUserMessage.content === "string") {
    const text = lastUserMessage.content.trim();
    return text || "Запит без тексту";
  }

  if (Array.isArray(lastUserMessage.content)) {
    const text = lastUserMessage.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ")
      .trim();
    return text || "Запит без тексту";
  }

  if (Array.isArray(lastUserMessage.parts)) {
    const text = lastUserMessage.parts
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text"
        ) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ")
      .trim();
    return text || "Запит без тексту";
  }

  return "Запит без тексту";
}

async function writeAgentLog(input: {
  userId: string;
  request: unknown;
  prompt: string;
  response: string | null;
  toolCalls: unknown[];
  finishReason: string | null;
  status: "completed" | "failed";
  model: string;
  error?: string | null;
}) {
  try {
    const supabase = createServiceSupabase();
    const promptText = input.prompt.trim() || "Запит без тексту";
    const { error } = await supabase.from("ai_agent_logs").insert({
      user_id: input.userId,
      prompt: promptText,
      input_request: input.request,
      output_response: input.response,
      tool_calls: input.toolCalls,
      model: input.model,
      finish_reason: input.finishReason,
      status: input.status,
      error: input.error ?? null,
    });

    if (error) {
      console.error("Помилка збереження логу LEVADIUS:", error.message);
    }
  } catch (error) {
    console.error(
      "Помилка збереження логу LEVADIUS:",
      error instanceof Error ? error.message : error
    );
  }
}

const SCOUTING_VISION_SCHEMA = z.object({
  cropPhase: z
    .string()
    .describe("Фаза культури"),
  visualState: z
    .string()
    .describe("Візуальний стан"),
  riskLevel: z
    .enum(["ok", "warning", "critical"])
    .describe("Рівень ризику"),
  diagnosis: z
    .string()
    .describe("Діагноз + порада"),
});

function sanitizeScoutingFileName(name: string): string {
  return name
    .replace(/[^\w.\-а-яА-ЯіІїЇєЄґҐ\s]/gu, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function resolveAgentImageBytes(input: {
  imageUrl?: string | null;
  attachments: Array<{ fileName: string; mimeType: string; base64: string }>;
}): Promise<
  | { ok: true; bytes: Buffer; mimeType: string; fileName: string }
  | { ok: false; error: string }
> {
  const fromUrl = input.imageUrl?.trim() || "";
  if (fromUrl) {
    if (fromUrl.startsWith("data:")) {
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(fromUrl);
      if (!match) {
        return { ok: false, error: "Некоректний data-URL зображення." };
      }
      const mimeType = match[1] || "image/jpeg";
      const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
      if (bytes.byteLength < 32) {
        return { ok: false, error: "Порожнє зображення." };
      }
      return {
        ok: true,
        bytes,
        mimeType,
        fileName: "scouting.jpg",
      };
    }
    if (/^https?:\/\//i.test(fromUrl)) {
      try {
        const res = await fetch(fromUrl);
        if (!res.ok) {
          return {
            ok: false,
            error: `Не вдалося завантажити фото (${res.status}).`,
          };
        }
        const mimeType =
          res.headers.get("content-type")?.split(";")[0]?.trim() ||
          "image/jpeg";
        const bytes = Buffer.from(await res.arrayBuffer());
        return {
          ok: true,
          bytes,
          mimeType,
          fileName: "scouting.jpg",
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Помилка завантаження фото за URL",
        };
      }
    }
    // сирий base64
    if (fromUrl.length > 80 && !fromUrl.includes(" ")) {
      const bytes = Buffer.from(fromUrl.replace(/\s+/g, ""), "base64");
      if (bytes.byteLength > 32) {
        return {
          ok: true,
          bytes,
          mimeType: "image/jpeg",
          fileName: "scouting.jpg",
        };
      }
    }
  }

  const imageAtt = input.attachments.find((a) =>
    (a.mimeType || "").startsWith("image/")
  );
  if (imageAtt?.base64) {
    return {
      ok: true,
      bytes: Buffer.from(imageAtt.base64.replace(/\s+/g, ""), "base64"),
      mimeType: imageAtt.mimeType || "image/jpeg",
      fileName: imageAtt.fileName || "scouting.jpg",
    };
  }

  return {
    ok: false,
    error:
      "Немає фото для аналізу. Додай зображення поля/рослини до повідомлення.",
  };
}

async function uploadAgentScoutingPhoto(
  supabase: SupabaseClient,
  fieldId: string,
  input: { fileName: string; mimeType: string; bytes: Buffer }
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const check = validateAttachmentFile({
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  if (!check.ok) return check;
  if (!input.mimeType.startsWith("image/")) {
    return { ok: false, error: "Дозволені лише зображення" };
  }

  const safeName = sanitizeScoutingFileName(input.fileName || "photo.jpg");
  const storagePath = `scouting/${fieldId}/${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from(OPERATION_DOCS_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });

  if (error) {
    return {
      ok: false,
      error:
        error.message.includes("Bucket not found") ||
        error.message.includes("not found")
          ? "Bucket operation-docs не створено. Виконай міграцію 039 у Supabase."
          : error.message,
    };
  }

  return { ok: true, storagePath };
}

function createAgentTools(options?: {
  activeFieldId?: string | null;
  userId?: string | null;
  userName?: string | null;
  google?: ReturnType<typeof createGoogleGenerativeAI>;
  modelId?: string;
  documentAttachment?: {
    fileName: string;
    mimeType: string;
    base64: string;
  } | null;
  documentAttachments?: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> | null;
}) {
  const supabase = createServiceSupabase();
  const defaultFieldId = options?.activeFieldId?.trim() || null;
  const actorUserId = options?.userId?.trim() || null;
  const actorName =
    options?.userName?.trim() || "Невідомий";
  const visionModelId = options?.modelId?.trim() || DEFAULT_MODEL;
  const googleAi = options?.google;
  const documentAttachments = (
    options?.documentAttachments?.length
      ? options.documentAttachments
      : options?.documentAttachment
        ? [options.documentAttachment]
        : []
  ).filter((d) => d?.base64);

  async function attachDocumentsToEntity(
    entityType: "inventory_move" | "fuel_transaction" | "accounting_act",
    entityId: string
  ) {
    if (documentAttachments.length === 0 || !entityId) return;
    try {
      const {
        countAttachments,
        uploadOperationAttachment,
        MAX_ATTACHMENTS_PER_ENTITY,
      } = await import("@/lib/operation-attachments");
      for (const doc of documentAttachments) {
        const existing = await countAttachments(entityType, entityId);
        if (existing >= MAX_ATTACHMENTS_PER_ENTITY) break;
        const bytes = Buffer.from(doc.base64, "base64");
        await uploadOperationAttachment({
          entityType,
          entityId,
          fileName: doc.fileName || "document.jpg",
          mimeType: doc.mimeType || "image/jpeg",
          bytes,
        });
      }
    } catch (err) {
      console.error(`[LEVADIUS] attach ${entityType}`, err);
    }
  }

  const unhandledCategories = [
    "fields",
    "equipment",
    "fuel",
    "warehouse",
    "finance",
    "accounting",
    "other",
  ] as const;

  const unhandledCategoryLabels: Record<
    (typeof unhandledCategories)[number],
    string
  > = {
    fields: "Поля",
    equipment: "Техніка",
    fuel: "Паливо",
    warehouse: "Склад",
    finance: "Фінанси",
    accounting: "Бухгалтерія",
    other: "Інше",
  };

  return {
    getFieldsStatus: tool({
      description: "Читає стан полів (площа, культура, остання операція).",
      inputSchema: z.object({
        crop: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Культура"),
      }),
      execute: async ({ crop }) => {
        let fieldsQuery = supabase
          .from("farm_fields")
          .select("id, name, canonical_name, area_ha, crop, season")
          .eq("is_field", true)
          .order("name")
          .limit(120);

        if (crop) {
          fieldsQuery = fieldsQuery.ilike("crop", `%${crop.trim()}%`);
        }

        const { data: fields, error: fieldsError } = await fieldsQuery;
        if (fieldsError) {
          throw new Error(`Не вдалося прочитати поля: ${fieldsError.message}`);
        }

        const fieldRows = fields ?? [];
        const fieldIds = fieldRows.map((field) => String(field.id));
        const latestByField = new Map<string, Record<string, unknown>>();

        if (fieldIds.length > 0) {
          const { data: operations, error: operationsError } = await supabase
            .from("field_operations")
            .select("field_id, work_type, status, occurred_at")
            .in("field_id", fieldIds)
            .order("occurred_at", { ascending: false })
            .limit(800);

          if (operationsError) {
            throw new Error(
              `Не вдалося прочитати операції полів: ${operationsError.message}`
            );
          }

          for (const operation of operations ?? []) {
            const fieldId = String(operation.field_id ?? "");
            if (fieldId && !latestByField.has(fieldId)) {
              latestByField.set(
                fieldId,
                operation as Record<string, unknown>
              );
            }
          }
        }

        const result = fieldRows.map((field) => {
          const latest = latestByField.get(String(field.id));
          const displayName =
            (typeof field.canonical_name === "string" &&
              field.canonical_name.trim()) ||
            String(field.name ?? "Поле");
          return {
            id: field.id,
            name: displayName,
            areaHa: finiteNumber(field.area_ha),
            crop: field.crop || "Не вказано",
            season: field.season,
            lastOp: latest
              ? {
                  type: latest.work_type,
                  status: latest.status,
                  date: latest.occurred_at,
                }
              : null,
          };
        });

        return {
          fieldCount: result.length,
          totalAreaHa: round2(
            result.reduce((sum, field) => sum + field.areaHa, 0)
          ),
          fields: result,
        };
      },
    }),

    getWarehouseStock: tool({
      description: "Читає залишки складу та палива.",
      inputSchema: z.object({
        category: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Категорія складу"),
        includeZero: z
          .boolean()
          .optional()
          .describe("Включати нульові"),
      }),
      execute: async ({ category, includeZero }) => {
        console.log("[TOOL: getWarehouseStock] Start fetching stock...", {
          category,
          includeZero,
        });

        try {
          const normalizedCategory = normalizeCategory(category);
          if (normalizedCategory === null) {
            return {
              stock: [],
              error: `Невідома категорія «${category}»`,
              supportedCategories: Object.values(categoryLabels),
            };
          }

          const includeFuel =
            normalizedCategory === undefined || normalizedCategory === "fuel";
          const inventoryCategory =
            normalizedCategory && normalizedCategory !== "fuel"
              ? normalizedCategory
              : undefined;
          const includeInventory = normalizedCategory !== "fuel";

          const fuelPromise = includeFuel
            ? supabase
                .from("fuel_storages")
                .select("id, name, type, capacity, current_volume")
                .order("name")
            : Promise.resolve({ data: [] as const, error: null });

          const [fuelResult, inventoryResult] = await Promise.all([
            fuelPromise,
            includeInventory
              ? loadAgentInventoryStock({
                  categoryKey: inventoryCategory,
                  includeZero: includeZero === true,
                  limit: 40,
                })
              : Promise.resolve({
                  items: [],
                  basOk: true,
                  dataQualityNote: "",
                } satisfies Awaited<
                  ReturnType<typeof loadAgentInventoryStock>
                >),
          ]);

          if (fuelResult.error) {
            console.error(
              "[TOOL: getWarehouseStock] Fuel query error:",
              fuelResult.error.message
            );
            return {
              stock: [],
              error: `Не вдалося прочитати паливні сховища: ${fuelResult.error.message}`,
            };
          }
          if ("error" in inventoryResult && inventoryResult.error) {
            console.error(
              "[TOOL: getWarehouseStock] Inventory error:",
              inventoryResult.error
            );
            return {
              stock: [],
              error: inventoryResult.error,
            };
          }

          const inventory = inventoryResult.items.map((item) => ({
            ref: item.ref,
            name: item.name,
            cat: item.category,
            unit: item.unit,
            qty: item.quantity,
          }));

          const fuel = (fuelResult.data ?? []).map((storage) => ({
            id: storage.id,
            name: storage.name,
            cat: categoryLabels.fuel,
            unit: "л",
            qty: finiteNumber(storage.current_volume),
          }));

          const stock = [...inventory, ...fuel];
          console.log(
            "[TOOL: getWarehouseStock] Success, items found:",
            stock.length,
            "basOk=",
            inventoryResult.basOk
          );

          return {
            stock,
            empty: stock.length === 0,
            emptyHint:
              stock.length === 0
                ? inventoryCategory
                  ? `Немає позицій «${categoryLabels[inventoryCategory]}» із залишком.`
                  : "Залишків не знайдено."
                : null,
          };
        } catch (error) {
          console.error(
            "[TOOL: getWarehouseStock] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            stock: [],
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання складу",
          };
        }
      },
    }),

    getFleetAndImplements: tool({
      description: "Читає техніку (equipment) і знаряддя (implements).",
      inputSchema: z.object({
        kind: z
          .enum(["all", "self_propelled", "implements"])
          .optional()
          .default("all")
          .describe("all|self_propelled|implements"),
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Пошук за назвою"),
      }),
      execute: async ({ kind, query }) => {
        const mode = kind ?? "all";
        console.log("[TOOL: getFleetAndImplements]", { mode, query });

        const typeLabels: Record<string, string> = {
          tractor: "Трактор",
          combine: "Комбайн",
          harvester: "Комбайн",
          sprayer: "Обприскувач",
          loader: "Навантажувач",
          truck: "Вантажівка",
          car: "Автомобіль",
          seeder: "Сівалка",
          plow: "Плуг",
          harrow: "Борона / диски",
          header: "Жатка",
          cultivator: "Культиватор",
          spreader: "Розкидач",
          compactor: "Коток",
          other: "Інше",
        };

        try {
          const q = query?.trim();
          const wantSelf = mode === "all" || mode === "self_propelled";
          const wantImpl = mode === "all" || mode === "implements";

          let equipmentQuery = supabase
            .from("equipment")
            .select("id, name, type, is_active, wialon_id")
            .order("name")
            .limit(80);
          if (q) equipmentQuery = equipmentQuery.ilike("name", `%${q}%`);

          let implementsQuery = supabase
            .from("implements")
            .select("id, name, type, working_width_m")
            .order("name")
            .limit(80);
          if (q) implementsQuery = implementsQuery.ilike("name", `%${q}%`);

          const [equipmentResult, implementsResult, activeOpsResult] =
            await Promise.all([
              wantSelf
                ? equipmentQuery
                : Promise.resolve({ data: [] as const, error: null }),
              wantImpl
                ? implementsQuery
                : Promise.resolve({ data: [] as const, error: null }),
              supabase
                .from("field_operations")
                .select("equipment_id, machinery, status")
                .in("status", ["planned", "in_progress"])
                .limit(500),
            ]);

          if (equipmentResult.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати техніку: ${equipmentResult.error.message}`,
              selfPropelled: [],
              implements: [],
            };
          }
          if (implementsResult.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати знаряддя: ${implementsResult.error.message}`,
              selfPropelled: [],
              implements: [],
            };
          }

          const busyEquipmentIds = new Set<string>();
          for (const op of activeOpsResult.data ?? []) {
            if (op.equipment_id) {
              busyEquipmentIds.add(String(op.equipment_id));
            }
          }

          const selfPropelled = (equipmentResult.data ?? [])
            .filter((row) => row.is_active !== false)
            .map((row) => {
              const id = String(row.id);
              const busy = busyEquipmentIds.has(id);
              const type = String(row.type ?? "other");
              return {
                id,
                name: String(row.name ?? "").trim() || "Техніка",
                type,
                typeLabel: typeLabels[type] ?? type,
                status: busy ? ("busy" as const) : ("available" as const),
              };
            });

          const implementsList = (implementsResult.data ?? []).map((row) => {
            const type = String(row.type ?? "other");
            return {
              id: String(row.id),
              name: String(row.name ?? "").trim() || "Знаряддя",
              type,
              typeLabel: typeLabels[type] ?? type,
              widthM: finiteNumber(row.working_width_m) || null,
            };
          });

          const empty =
            selfPropelled.length === 0 && implementsList.length === 0;

          return {
            status: "ok" as const,
            empty,
            emptyHint: empty
              ? "У довіднику немає техніки/знаряддя. Напиши назву вручну."
              : null,
            selfPropelled,
            implements: implementsList,
            counts: {
              self: selfPropelled.length,
              impl: implementsList.length,
              free: selfPropelled.filter((item) => item.status === "available")
                .length,
            },
          };
        } catch (error) {
          console.error(
            "[TOOL: getFleetAndImplements] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання техніки",
            selfPropelled: [],
            implements: [],
          };
        }
      },
    }),

    getDriversList: tool({
      description: "Читає список механізаторів.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Пошук за ПІБ"),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Ліміт результатів"),
      }),
      execute: async ({ query, limit }) => {
        const take = limit ?? 20;
        console.log("[TOOL: getDriversList]", { query, take });
        try {
          let opsQuery = supabase
            .from("field_operations")
            .select("mechanic_name")
            .not("mechanic_name", "is", null)
            .order("occurred_at", { ascending: false })
            .limit(2_000);

          if (query?.trim()) {
            opsQuery = opsQuery.ilike("mechanic_name", `%${query.trim()}%`);
          }

          const { data, error } = await opsQuery;
          if (error) {
            if (
              error.message?.includes("mechanic_name") ||
              error.code === "42703"
            ) {
              return {
                status: "ok" as const,
                drivers: [],
                empty: true,
                emptyHint:
                  "У довіднику поки немає зареєстрованих водіїв. Напиши імʼя вручну.",
              };
            }
            return {
              status: "error" as const,
              error: `Не вдалося прочитати механізаторів: ${error.message}`,
              drivers: [],
            };
          }

          const counts = new Map<string, { name: string; count: number }>();
          for (const row of data ?? []) {
            const name = String(row.mechanic_name ?? "").trim();
            if (!name) continue;
            const key = name.toLocaleLowerCase("uk-UA");
            const prev = counts.get(key);
            if (prev) prev.count += 1;
            else counts.set(key, { name, count: 1 });
          }

          const drivers = [...counts.values()]
            .sort(
              (a, b) =>
                b.count - a.count || a.name.localeCompare(b.name, "uk")
            )
            .slice(0, take)
            .map((item) => ({
              name: item.name,
              operationsCount: item.count,
            }));

          return {
            status: "ok" as const,
            drivers,
            empty: drivers.length === 0,
            emptyHint:
              drivers.length === 0
                ? "У довіднику поки немає зареєстрованих водіїв. Напиши імʼя вручну."
                : null,
          };
        } catch (error) {
          console.error(
            "[TOOL: getDriversList] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання механізаторів",
            drivers: [],
          };
        }
      },
    }),

    registerWarehouseItem: tool({
      description: "Реєструє нову позицію складу з початковим залишком > 0.",
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe("Назва матеріалу"),
        category: z
          .enum(["ЗЗР", "Добрива", "Насіння", "Паливо", "Інше"])
          .optional()
          .default("ЗЗР")
          .describe("Категорія"),
        unit: z
          .enum(["л", "кг", "т", "п.о.", "шт"])
          .optional()
          .default("л")
          .describe("Од. виміру"),
        initialStock: z
          .number()
          .finite()
          .positive()
          .describe("Початковий залишок >0"),
      }),
      execute: async ({ name, category, unit, initialStock }) => {
        const displayName = name.trim();
        const categoryUk = category ?? "ЗЗР";
        const unitValue = unit ?? "л";
        const stock = initialStock ?? 0;

        const categoryMap: Record<
          "ЗЗР" | "Добрива" | "Насіння" | "Паливо" | "Інше",
          "zzr" | "fertilizer" | "seed" | "parts"
        > = {
          ЗЗР: "zzr",
          Добрива: "fertilizer",
          Насіння: "seed",
          Паливо: "parts",
          Інше: "parts",
        };
        const categoryKey = categoryMap[categoryUk];

        console.log("[TOOL: registerWarehouseItem]", {
          displayName,
          categoryUk,
          unitValue,
          stock,
        });

        if (!(stock > 0)) {
          return {
            status: "needs_inbound" as const,
            success: false as const,
            error:
              "Не можна створити картку з нульовим залишком. Потрібні кількість і ціна або фото накладної.",
            itemName: displayName,
            category: categoryUk,
            hint: "Запропонуй [[CHOICE:📷 Прикріпити накладну]] або [[CHOICE:Ввести кількість вручну]].",
          };
        }

        try {
          const basRefKey = crypto.randomUUID();
          const payload: Record<string, unknown> = {
            bas_ref_key: basRefKey,
            name: displayName,
            category: categoryKey,
            unit: unitValue,
            planned_price_uah: 0,
            is_local: true,
            is_hidden: false,
            custom_name: null,
          };

          const { error: insertError } = await supabase
            .from("inventory_items_cache")
            .insert(payload);

          if (insertError) {
            if (insertError.message?.includes("is_local")) {
              const { is_local: _local, ...withoutLocal } = payload;
              const retry = await supabase
                .from("inventory_items_cache")
                .insert(withoutLocal);
              if (retry.error) {
                return {
                  status: "error" as const,
                  error: `Не вдалося створити позицію: ${retry.error.message}`,
                };
              }
            } else {
              return {
                status: "error" as const,
                error: `Не вдалося створити позицію: ${insertError.message}`,
              };
            }
          }

          let stockNote: string | null = null;
          if (stock > 0) {
            const { error: moveError } = await supabase
              .from("inventory_local_moves")
              .insert({
                item_ref_key: basRefKey,
                type: "inbound",
                qty: stock,
                date: new Date().toISOString(),
                status: "draft",
                season: String(new Date().getFullYear()),
                note: `Початковий залишок (LEVADIUS${actorName ? `, ${actorName}` : ""})`,
                unit_price_uah: 0,
              });
            if (moveError) {
              stockNote = `Картку створено, але початковий залишок не записано: ${moveError.message}`;
            }
          }

          return {
            status: "created" as const,
            id: basRefKey,
            warehouseItemId: basRefKey,
            name: displayName,
            category: categoryUk,
            categoryKey,
            unit: unitValue,
            initialStock: stock,
            isNew: true,
            isLocal: true,
            stockNote,
            nextStepHint:
              "Підстав warehouseItemId у prepareWorkOrder і продовжуй наряд.",
          };
        } catch (error) {
          console.error(
            "[TOOL: registerWarehouseItem] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка реєстрації позиції",
          };
        }
      },
    }),

    previewInvoiceReceipt: tool({
      description: "Готує превʼю прибуткової накладної ТМЦ.",
      inputSchema: z.object({
        supplierName: z.string().trim().min(1).describe("Постачальник"),
        supplierEdrpou: z
          .string()
          .trim()
          .optional()
          .describe("ЄДРПОУ"),
        invoiceNumber: z.string().trim().optional().describe("Номер накладної"),
        invoiceDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата YYYY-MM-DD"),
        totalAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Сума ₴"),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              category: z.enum(INVOICE_CATEGORIES),
              quantity: z.number().positive(),
              unit: z.string().trim().min(1),
              pricePerUnit: z.number().finite().nonnegative(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1)
          .describe("Рядки накладної"),
      }),
      execute: async (input) => {
        console.log("[TOOL: previewInvoiceReceipt]", {
          supplier: input.supplierName,
          lines: input.items.length,
        });
        try {
          return await buildInvoicePreview(input);
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка попереднього перегляду накладної",
          };
        }
      },
    }),

    executeWarehouseReceipt: tool({
      description: "Оприбутковує накладну на склад після підтвердження.",
      inputSchema: z.object({
        receiptId: z.string().trim().uuid().optional(),
        supplierName: z.string().trim().min(1),
        supplierEdrpou: z.string().trim().optional(),
        invoiceNumber: z.string().trim().optional(),
        invoiceDate: z.string().trim().optional(),
        totalAmount: z.number().finite().nonnegative().optional(),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              category: z.enum(INVOICE_CATEGORIES),
              quantity: z.number().positive(),
              unit: z.string().trim().min(1),
              pricePerUnit: z.number().finite().nonnegative(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1),
      }),
      execute: async (input) => {
        console.log("[TOOL: executeWarehouseReceipt]", {
          supplier: input.supplierName,
          lines: input.items.length,
        });
        try {
          return await executeWarehouseReceipt(input);
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка оприбуткування накладної",
          };
        }
      },
    }),

    rollbackWarehouseReceipt: tool({
      description: "Скасовує накладну зі сторно залишків (потрібне confirmed).",
      inputSchema: z.object({
        receiptId: z
          .string()
          .trim()
          .optional()
          .describe("UUID накладної"),
        invoiceNumber: z
          .string()
          .trim()
          .optional()
          .describe("Номер накладної"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async (input) => {
        console.log("[TOOL: rollbackWarehouseReceipt]", {
          receiptId: input.receiptId,
          invoiceNumber: input.invoiceNumber,
          confirmed: input.confirmed === true,
        });
        try {
          return await rollbackWarehouseReceipt({
            receiptId: input.receiptId,
            invoiceNumber: input.invoiceNumber,
            confirmed: input.confirmed === true,
          });
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка скасування накладної",
          };
        }
      },
    }),

    previewServiceAct: tool({
      description: "Готує превʼю акта виконаних послуг.",
      inputSchema: z.object({
        actNumber: z.string().trim().optional().describe("Номер акта"),
        actDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата YYYY-MM-DD"),
        contractorName: z
          .string()
          .trim()
          .min(1)
          .describe("Підрядник"),
        contractorEdrpou: z
          .string()
          .trim()
          .optional()
          .describe("ЄДРПОУ"),
        category: z
          .enum(SERVICE_ACT_CATEGORIES)
          .optional()
          .describe("Категорія"),
        totalAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Сума з ПДВ"),
        vatAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Сума ПДВ"),
        targetAssetHint: z
          .string()
          .trim()
          .optional()
          .describe("Підказка техніки"),
        equipmentId: z
          .string()
          .trim()
          .uuid()
          .optional()
          .describe("UUID техніки"),
        services: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              quantity: z.number().positive().optional(),
              unit: z.string().trim().optional(),
              pricePerUnit: z.number().finite().nonnegative().optional(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1)
          .describe("Рядки послуг"),
      }),
      execute: async (input) => {
        console.log("[TOOL: previewServiceAct]", {
          contractor: input.contractorName,
          lines: input.services.length,
        });
        try {
          return await buildServiceActPreview(input);
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка попереднього перегляду акта",
          };
        }
      },
    }),

    executeServiceActSave: tool({
      description: "Записує акт послуг у бухгалтерію.",
      inputSchema: z.object({
        previewId: z.string().trim().uuid().optional(),
        actNumber: z.string().trim().optional(),
        actDate: z.string().trim().optional(),
        contractorName: z.string().trim().min(1),
        contractorEdrpou: z.string().trim().optional(),
        category: z.enum(SERVICE_ACT_CATEGORIES).optional(),
        totalAmount: z.number().finite().nonnegative().optional(),
        vatAmount: z.number().finite().nonnegative().optional(),
        targetAssetHint: z.string().trim().optional(),
        equipmentId: z.string().trim().uuid().optional(),
        linkEquipment: z
          .boolean()
          .default(true)
          .describe("Привʼязати до техніки"),
        notes: z.string().trim().optional(),
        services: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              quantity: z.number().positive().optional(),
              unit: z.string().trim().optional(),
              pricePerUnit: z.number().finite().nonnegative().optional(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1),
      }),
      execute: async (input) => {
        console.log("[TOOL: executeServiceActSave]", {
          contractor: input.contractorName,
          linkEquipment: input.linkEquipment !== false,
        });
        try {
          const result = await executeServiceActSave({
            ...input,
            linkEquipment: input.linkEquipment !== false,
          });
          if (result.success) {
            await attachDocumentsToEntity("accounting_act", result.actId);
          }
          return result;
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка збереження акта",
          };
        }
      },
    }),

    deleteServiceActs: tool({
      description:
        "Видаляє акти виконаних послуг з Бухгалтерії (потрібне confirmed).",
      inputSchema: z.object({
        actIds: z
          .array(z.string().trim().uuid())
          .optional()
          .describe("UUID актів"),
        count: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .default(1)
          .describe("Скільки останніх актів"),
        contractorHint: z
          .string()
          .trim()
          .optional()
          .describe("Підказка контрагента"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async (input) => {
        console.log("[TOOL: deleteServiceActs]", {
          actIds: input.actIds?.length ?? 0,
          count: input.count ?? 1,
          contractorHint: input.contractorHint,
          confirmed: input.confirmed === true,
        });
        try {
          return await deleteServiceActs({
            actIds: input.actIds,
            count: input.count ?? 1,
            contractorHint: input.contractorHint,
            confirmed: input.confirmed === true,
          });
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка видалення актів",
          };
        }
      },
    }),

    writeOffInventoryToField: tool({
      description: "Списує ТМЦ зі складу на поле (потрібне confirmed).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
        category: z
          .enum(["ЗЗР", "Добрива", "Насіння", "Запчастини"])
          .describe("Категорія"),
        itemId: z
          .string()
          .trim()
          .min(1)
          .describe("ID або назва ТМЦ"),
        quantity: z
          .number()
          .positive()
          .describe("Кількість"),
        date: z
          .string()
          .trim()
          .optional()
          .describe("Дата YYYY-MM-DD"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        fieldIdOrName,
        category,
        itemId,
        quantity,
        date,
        confirmed,
      }) => {
        const categoryMap = {
          ЗЗР: "zzr",
          Добрива: "fertilizer",
          Насіння: "seed",
          Запчастини: "parts",
        } as const;
        const categoryKey = categoryMap[category];
        const lookupField = (
          fieldIdOrName?.trim() ||
          defaultFieldId ||
          ""
        ).trim();
        const moveDate = (date?.trim() || todayKyivYmd()).slice(0, 10);
        const isConfirmed = confirmed === true;
        const qty = Number(quantity);

        console.log("[TOOL: writeOffInventoryToField]", {
          lookupField,
          category,
          itemId,
          qty,
          moveDate,
          confirmed: isConfirmed,
        });

        try {
          if (!Number.isFinite(qty) || qty <= 0) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи кількість більше нуля.",
            };
          }

          const stock = await loadAgentInventoryStock({
            categoryKey,
            includeZero: true,
            limit: 200,
          });
          if (stock.error) {
            return {
              success: false as const,
              status: "error" as const,
              error: stock.error,
            };
          }

          const needle = itemId.trim().toLowerCase();
          const byRef = stock.items.find(
            (item) => item.ref.toLowerCase() === needle
          );
          const byNameExact = stock.items.filter(
            (item) => item.name.toLocaleLowerCase("uk-UA") === needle
          );
          const byNameFuzzy = stock.items.filter((item) =>
            item.name.toLocaleLowerCase("uk-UA").includes(needle)
          );
          const item =
            byRef ??
            (byNameExact.length === 1
              ? byNameExact[0]
              : byNameFuzzy.length === 1
                ? byNameFuzzy[0]
                : null);

          if (!item) {
            if (byNameExact.length > 1 || byNameFuzzy.length > 1) {
              const candidates = (byNameExact.length > 1
                ? byNameExact
                : byNameFuzzy
              ).slice(0, 5);
              return {
                success: false as const,
                status: "ambiguous_item" as const,
                error: `Знайдено кілька позицій для «${itemId}». Уточни.`,
                candidates: candidates.map((row) => ({
                  itemId: row.ref,
                  name: row.name,
                  quantity: row.quantity,
                  unit: row.unit,
                })),
              };
            }
            return {
              success: false as const,
              status: "item_not_found" as const,
              error: `Позицію «${itemId}» у категорії ${category} не знайдено на складі.`,
            };
          }

          if (qty > item.quantity && isConfirmed) {
            return {
              success: false as const,
              status: "insufficient_stock" as const,
              error: `Недостатньо на складі. Доступно: ${item.quantity} ${item.unit}`,
              itemName: item.name,
              available: item.quantity,
              unit: item.unit,
            };
          }

          const exceedsStock = qty > item.quantity;
          const fieldRequired = categoryKey !== "parts";
          let fieldId: string | null = null;
          let fieldName: string | null = null;

          if (fieldRequired || lookupField) {
            if (!lookupField) {
              return {
                success: false as const,
                status: "needs_slots" as const,
                error: "Вкажи поле для списання (або відкрий його на карті).",
                missing: ["поле"],
              };
            }
            const resolved = await resolveAgentFieldByLookup(
              supabase,
              lookupField
            );
            if (!resolved.ok) {
              return {
                success: false as const,
                status: resolved.status,
                error: resolved.error,
                candidates: resolved.candidates,
              };
            }
            fieldId = resolved.field.id;
            fieldName = resolved.fieldName;
          }

          if (!isConfirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId,
              fieldName: fieldName ?? "склад",
              itemId: item.ref,
              itemName: item.name,
              category,
              quantity: qty,
              unit: item.unit,
              date: moveDate,
              currentStock: item.quantity,
              projectedStock: round2(item.quantity - qty),
              exceedsStock,
              canConfirm: !exceedsStock,
              warning: exceedsStock
                ? `Недостатньо на складі: є ${item.quantity} ${item.unit}, запрошено ${qty} ${item.unit}.`
                : null,
              confirmChoice: `Підтвердити списання ${qty} ${item.unit} на ${fieldName ?? "склад"}`,
              cancelChoice: "Скасувати",
              userHint: `Списати ${qty} ${item.unit} «${item.name}» → ${fieldName ?? "склад"} (${moveDate})?`,
              pending: {
                fieldIdOrName: fieldId ?? lookupField,
                itemId: item.ref,
                category,
                quantity: qty,
                date: moveDate,
              },
              badge: "Списання ТМЦ на поле",
            };
          }

          const result = await createLocalOutboundMove({
            itemRefKey: item.ref,
            fieldId,
            qty,
            season: DEFAULT_SEASON,
            date: moveDate,
          });

          if (!result.ok) {
            return {
              success: false as const,
              status: "error" as const,
              error: result.error,
            };
          }

          const refreshed = await loadAgentInventoryStock({
            categoryKey,
            includeZero: true,
            limit: 200,
          });
          const after = refreshed.items.find(
            (row) => row.ref.toLowerCase() === item.ref.toLowerCase()
          );
          const newStockBalance =
            after?.quantity ?? round2(item.quantity - qty);

          return {
            success: true as const,
            status: "written_off" as const,
            moveId: result.id,
            fieldId,
            fieldName: fieldName ?? "склад",
            itemId: item.ref,
            itemName: item.name,
            category,
            quantity: qty,
            unit: item.unit,
            date: moveDate,
            newStockBalance,
            message: `Списано ${qty} ${item.unit} «${item.name}» → ${fieldName ?? "склад"}. Залишок: ${newStockBalance} ${item.unit}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: writeOffInventoryToField] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка списання",
          };
        }
      },
    }),

    prepareWorkOrder: tool({
      description: "Готує чернетку наряду на польові роботи.",
      inputSchema: z.object({
        fieldId: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        operationType: z
          .string()
          .trim()
          .min(1)
          .describe("Тип операції"),
        date: z
          .string()
          .trim()
          .min(1)
          .describe("Дата або сьогодні/завтра"),
        timeRange: z
          .object({
            start: z.string().trim().default("08:00"),
            end: z.string().trim().default("18:00"),
          })
          .optional()
          .describe("Інтервал HH:MM–HH:MM"),
        equipmentId: z
          .string()
          .trim()
          .min(1)
          .describe("Техніка ID/назва"),
        implementId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Знаряддя ID/назва"),
        implementIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Знаряддя ID/назва"),
        driverName: z
          .string()
          .trim()
          .min(1)
          .describe("ПІБ механізатора"),
        warehouseItemId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("ТМЦ ID/назва"),
        ratePerHa: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Норма або ₴/га"),
      }),
      execute: async (params) => {
        const {
          fieldId: fieldIdInput,
          operationType: operationTypeRaw,
          date: dateRaw,
          timeRange,
          equipmentId: equipmentInput,
          implementId: implementIdLegacy,
          implementIdOrName,
          driverName,
          warehouseItemId: warehouseInput,
          ratePerHa,
        } = params;
        const implementInput =
          implementIdOrName?.trim() || implementIdLegacy?.trim() || "";

        console.log("[TOOL: prepareWorkOrder] Preparing draft…", {
          fieldIdInput,
          operationTypeRaw,
          dateRaw,
          equipmentInput,
          implementInput,
          driverName,
          warehouseInput,
        });

        try {
          const dateResolved = resolveWorkOrderDateInput(dateRaw);
          if ("error" in dateResolved) {
            return {
              status: "error" as const,
              error: dateResolved.error,
            };
          }
          const date = dateResolved.date;
          const today = todayKyivYmd();
          const daysFromToday = (() => {
            const [ty, tm, td] = today.split("-").map(Number);
            const [dy, dm, dd] = date.split("-").map(Number);
            const t = Date.UTC(ty!, tm! - 1, td!);
            const d = Date.UTC(dy!, dm! - 1, dd!);
            return Math.round((d - t) / 86_400_000);
          })();
          // Захист від галюцинацій дати (напр. «завтра» → випадковий квітень)
          if (
            !dateResolved.resolvedFrom &&
            (daysFromToday < -3 || daysFromToday > 45)
          ) {
            return {
              status: "date_out_of_range" as const,
              error: `Дата ${date} виглядає підозріло відносно сьогодні (${today}). Уточни YYYY-MM-DD або передай «сьогодні»/«завтра».`,
              today,
              tomorrow: shiftKyivYmd(today, 1),
              receivedDate: date,
            };
          }

          const normalizedType = normalizeWorkOrderType(operationTypeRaw);
          if (!normalizedType) {
            return {
              status: "error" as const,
              error: `Невідомий тип операції «${operationTypeRaw}». Обери: ${WORK_ORDER_TYPES.join(", ")}.`,
            };
          }

          const needsMaterial = operationRequiresMaterial(normalizedType);
          const missing: string[] = [];
          if (!fieldIdInput.trim() && !defaultFieldId) missing.push("поле");
          if (!date.trim()) missing.push("дата");
          if (!equipmentInput.trim()) missing.push("техніка");
          if (!driverName.trim()) missing.push("механізатор");
          if (needsMaterial && !warehouseInput?.trim()) {
            missing.push("позиція складу (насіння/ЗЗР/добриво)");
          }
          if (missing.length > 0) {
            return {
              status: "needs_slots" as const,
              error: `Бракує обовʼязкових даних: ${missing.join(", ")}. Уточни в діалозі, не вигадуй.`,
              missing,
              hint: needsMaterial
                ? "Яку позицію зі складу списуємо під цю операцію?"
                : undefined,
            };
          }

          const lookup = fieldIdInput.trim() || defaultFieldId || "";
          type FieldRow = {
            id: string;
            name: string | null;
            canonical_name: string | null;
            area_ha: number | null;
            crop: string | null;
            season: string | null;
          };

          let field: FieldRow | null = null;

          if (isUuid(lookup)) {
            const { data, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("id", lookup)
              .eq("is_field", true)
              .maybeSingle();
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося знайти поле: ${error.message}`,
              };
            }
            field = (data as FieldRow | null) ?? null;
          }

          if (!field) {
            const { data: byName } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .ilike("name", lookup)
              .limit(5);
            field = ((byName ?? [])[0] as FieldRow | undefined) ?? null;
          }

          if (!field) {
            const { data: byCanonical } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .ilike("canonical_name", lookup)
              .limit(5);
            field = ((byCanonical ?? [])[0] as FieldRow | undefined) ?? null;
          }

          if (!field) {
            const safe = lookup.replaceAll(",", " ");
            const { data: fuzzy, error: fuzzyError } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
              .order("name")
              .limit(5);
            if (fuzzyError) {
              return {
                status: "error" as const,
                error: `Не вдалося шукати поле: ${fuzzyError.message}`,
              };
            }
            const matches = (fuzzy ?? []) as FieldRow[];
            if (matches.length === 0) {
              return {
                status: "field_not_found" as const,
                error: `Поле «${lookup}» не знайдено. Уточни назву.`,
              };
            }
            if (matches.length > 1) {
              return {
                status: "ambiguous_field" as const,
                error: `Знайдено кілька полів для «${lookup}». Уточни точніше.`,
                candidates: matches.map((item) => ({
                  id: item.id,
                  name:
                    (item.canonical_name && item.canonical_name.trim()) ||
                    item.name ||
                    "Поле",
                  areaHa: finiteNumber(item.area_ha),
                })),
              };
            }
            field = matches[0]!;
          }

          const areaHa = finiteNumber(field.area_ha);
          const fieldName =
            (field.canonical_name && field.canonical_name.trim()) ||
            field.name ||
            "Поле";
          const crop = (field.crop && String(field.crop).trim()) || "—";

          // Техніка
          let equipmentId: string | null = null;
          let equipmentName = equipmentInput.trim();
          let equipmentFound = false;
          if (isUuid(equipmentInput)) {
            const { data } = await supabase
              .from("equipment")
              .select("id, name")
              .eq("id", equipmentInput)
              .maybeSingle();
            if (data) {
              equipmentFound = true;
              equipmentId = String(data.id);
              equipmentName = String(data.name ?? equipmentName);
            }
          }
          if (!equipmentFound) {
            const { data: equipmentRows, error: equipmentError } =
              await supabase
                .from("equipment")
                .select("id, name")
                .ilike("name", `%${equipmentInput.trim()}%`)
                .order("name")
                .limit(8);
            if (equipmentError) {
              return {
                status: "error" as const,
                error: `Не вдалося перевірити техніку: ${equipmentError.message}`,
              };
            }
            const candidates = (equipmentRows ?? []).map((row) => ({
              id: String(row.id),
              name: String(row.name ?? ""),
            }));
            const exact = candidates.find(
              (row) =>
                row.name.toLocaleLowerCase("uk-UA") ===
                equipmentInput.trim().toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? candidates[0] ?? null;
            if (chosen) {
              equipmentFound = true;
              equipmentId = chosen.id;
              equipmentName = chosen.name;
            }
          }

          // Знаряддя (implements)
          let implementId: string | null = null;
          let implementName =
            implementInput || IMPLEMENT_PRESETS[normalizedType] || "";
          let implementWidthM: number | null = null;
          let implementFound = false;
          let implementAutoPicked = false;

          const resolveImplement = async (needleRaw: string) => {
            const needle = needleRaw.trim();
            if (!needle) return;
            if (isUuid(needle)) {
              const { data } = await supabase
                .from("implements")
                .select("id, name, working_width_m, type")
                .eq("id", needle)
                .maybeSingle();
              if (data) {
                implementId = String(data.id);
                implementName = String(data.name ?? implementName);
                implementWidthM = finiteNumber(data.working_width_m) || null;
                implementFound = true;
              }
              return;
            }
            const { data: implRows } = await supabase
              .from("implements")
              .select("id, name, working_width_m, type")
              .ilike("name", `%${needle}%`)
              .order("name")
              .limit(8);
            const rows = implRows ?? [];
            const exact = rows.find(
              (row) =>
                String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                needle.toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? rows[0];
            if (chosen) {
              implementId = String(chosen.id);
              implementName = String(chosen.name ?? implementName);
              implementWidthM = finiteNumber(chosen.working_width_m) || null;
              implementFound = true;
            } else {
              implementName = needle;
            }
          };

          if (implementInput) {
            await resolveImplement(implementInput);
          } else {
            // Автопідбір з довідника implements за типом операції / пресетом
            const preset = IMPLEMENT_PRESETS[normalizedType] || "";
            const typeHints = IMPLEMENT_DB_TYPES_BY_OP[normalizedType] ?? [];
            if (typeHints.length > 0) {
              const { data: byType } = await supabase
                .from("implements")
                .select("id, name, working_width_m, type")
                .in("type", typeHints)
                .order("name")
                .limit(5);
              const chosen = (byType ?? [])[0];
              if (chosen) {
                implementId = String(chosen.id);
                implementName = String(chosen.name ?? preset);
                implementWidthM = finiteNumber(chosen.working_width_m) || null;
                implementFound = true;
                implementAutoPicked = true;
              }
            }
            if (!implementFound && preset) {
              await resolveImplement(preset);
              if (implementFound) implementAutoPicked = true;
              else implementName = preset;
            }
          }

          const hitchLabel = implementName
            ? `${equipmentName} + ${implementName}`
            : equipmentName;

          // Складська позиція
          let warehouseItemId: string | null = null;
          let warehouseItemName: string | null = null;
          let warehouseItemUnit = "од.";
          let warehouseItemCategory = "";
          let materialQty: number | null = null;
          let isNewWarehouseItem = false;

          if (needsMaterial) {
            const wh = warehouseInput!.trim();
            type ItemRow = {
              bas_ref_key: string;
              name: string | null;
              custom_name: string | null;
              category: string | null;
              unit: string | null;
              is_local?: boolean | null;
            };
            let item: ItemRow | null = null;

            const { data: byKey } = await supabase
              .from("inventory_items_cache")
              .select(
                "bas_ref_key, name, custom_name, category, unit, is_local"
              )
              .eq("bas_ref_key", wh)
              .maybeSingle();
            item = (byKey as ItemRow | null) ?? null;

            if (!item) {
              const safe = wh.replaceAll(",", " ");
              const { data: byName } = await supabase
                .from("inventory_items_cache")
                .select(
                  "bas_ref_key, name, custom_name, category, unit, is_local"
                )
                .or(
                  `name.ilike.%${safe}%,custom_name.ilike.%${safe}%`
                )
                .limit(8);

              const rows = (byName ?? []) as ItemRow[];
              const exact = rows.find((row) => {
                const a = (row.custom_name || row.name || "")
                  .trim()
                  .toLocaleLowerCase("uk-UA");
                return a === wh.toLocaleLowerCase("uk-UA");
              });
              item = exact ?? rows[0] ?? null;
            }

            if (!item) {
              const suggestedCategory =
                normalizedType === "Посів"
                  ? "Насіння"
                  : normalizedType === "Внесення добрив"
                    ? "Добрива"
                    : "ЗЗР";
              return {
                status: "warehouse_item_not_found" as const,
                error: `Позицію складу «${wh}» не знайдено.`,
                suggestedName: wh,
                suggestedCategory,
                offerRegister: true,
                userHint: `Позиції «${wh}» ще немає в обліку складу. Щоб оприбуткувати її коректно, вкажи кількість і ціну або завантаж фото накладної (скріпка в полі вводу).`,
                suggestedChoices: [
                  "📷 Прикріпити накладну",
                  "Ввести кількість вручну",
                ],
              };
            }

            warehouseItemId = String(item.bas_ref_key);
            warehouseItemName =
              (item.custom_name && item.custom_name.trim()) ||
              item.name ||
              "ТМЦ";
            warehouseItemUnit = String(item.unit ?? "").trim() || "од.";
            warehouseItemCategory = String(item.category ?? "").trim();
            isNewWarehouseItem = item.is_local === true;
            materialQty =
              typeof ratePerHa === "number" && Number.isFinite(ratePerHa)
                ? Math.round(ratePerHa * areaHa * 100) / 100
                : estimateMaterialQty(normalizedType, areaHa, crop);
          }

          // Новий механізатор?
          const driverTrimmed = driverName.trim();
          let isNewDriver = true;
          {
            const { data: mechanicRows } = await supabase
              .from("field_operations")
              .select("mechanic_name")
              .ilike("mechanic_name", driverTrimmed)
              .limit(5);
            const found = (mechanicRows ?? []).some(
              (row) =>
                String(row.mechanic_name ?? "")
                  .trim()
                  .toLocaleLowerCase("uk-UA") ===
                driverTrimmed.toLocaleLowerCase("uk-UA")
            );
            isNewDriver = !found;
          }

          const wageRate =
            typeof ratePerHa === "number" &&
            Number.isFinite(ratePerHa) &&
            !needsMaterial
              ? ratePerHa
              : WAGE_UAH_PER_HA;
          const calculatedFuel = estimatePlanFuelLiters(
            normalizedType,
            areaHa
          );
          const calculatedSalary =
            typeof ratePerHa === "number" &&
            Number.isFinite(ratePerHa) &&
            !needsMaterial
              ? Math.max(0, Math.round(areaHa * ratePerHa))
              : estimatePlanWageUah(areaHa);

          const start = timeRange?.start?.trim() || "08:00";
          const end = timeRange?.end?.trim() || "18:00";
          const draftId = crypto.randomUUID();

          const formData = {
            fieldId: String(field.id),
            fieldKey: `farm:${field.id}`,
            fieldName,
            areaHa,
            crop,
            season: field.season,
            operationType: normalizedType,
            date,
            timeRange: { start, end },
            equipmentId,
            equipmentName,
            equipmentFound,
            implementId,
            implementName,
            implementWidthM,
            implementFound,
            implementAutoPicked,
            hitchLabel,
            driverName: driverTrimmed,
            isNewDriver,
            driverNote: isNewDriver
              ? `Зафіксував нового механізатора ${driverTrimmed}. Після збереження наряду він автоматично закріпиться в системі.`
              : null,
            warehouseItemId,
            warehouseItemName,
            warehouseItemUnit,
            warehouseItemCategory,
            isNewWarehouseItem,
            materialQty,
            ratePerHa:
              typeof ratePerHa === "number" && Number.isFinite(ratePerHa)
                ? ratePerHa
                : needsMaterial
                  ? null
                  : wageRate,
            calculatedFuel,
            calculatedSalary,
          };

          console.log("[TOOL: prepareWorkOrder] ready", {
            fieldId: formData.fieldId,
            operationType: formData.operationType,
            areaHa: formData.areaHa,
            isNewDriver,
            isNewWarehouseItem,
          });

          return {
            status: "ready" as const,
            success: true,
            workOrderId: draftId,
            draftId,
            formData,
            message:
              "Чернетку підготовано. Після підтвердження в картці наряд збережеться з цим workOrderId.",
            summary: `${normalizedType} на ${fieldName}: ${hitchLabel}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: prepareWorkOrder] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка підготовки наряду",
          };
        }
      },
    }),

    confirmWorkOrder: tool({
      description: "Зберігає наряд у хронологію після згоди.",
      inputSchema: z.object({
        workOrderId: z
          .string()
          .trim()
          .min(1)
          .describe("UUID наряду"),
        fieldId: z.string().trim().min(1).describe("UUID поля"),
        operationType: z.string().trim().min(1),
        date: z.string().trim().min(1).describe("YYYY-MM-DD"),
        equipmentName: z.string().trim().min(1),
        driverName: z.string().trim().min(1),
        crop: z.string().trim().optional(),
        implementName: z.string().trim().optional(),
        equipmentId: z.string().trim().optional(),
        implementId: z
          .string()
          .trim()
          .optional()
          .describe("UUID знаряддя"),
        areaHa: z.number().finite().nonnegative().optional(),
        fuelPlan: z.number().finite().nonnegative().optional(),
        wagePlan: z.number().finite().nonnegative().optional(),
        timeStart: z.string().trim().optional(),
      }),
      execute: async (input) => {
        const workOrderId = input.workOrderId.trim();
        let fieldId = input.fieldId.trim();
        const operationType = input.operationType.trim();
        const date = input.date.trim();
        const hhmm =
          input.timeStart && /^\d{2}:\d{2}$/.test(input.timeStart)
            ? input.timeStart
            : "08:00";
        const seasonYear = Number(date.slice(0, 4)) || new Date().getFullYear();
        const areaHa = input.areaHa ?? 0;

        console.log("[TOOL: confirmWorkOrder]", { workOrderId, fieldId });

        try {
          // fieldId може прийти як назва — резолвимо в UUID
          if (!isUuid(fieldId)) {
            const safe = fieldId.replaceAll(",", " ");
            const { data: fields } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name")
              .eq("is_field", true)
              .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
              .limit(5);
            const rows = fields ?? [];
            const exact = rows.find(
              (row) =>
                String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                  safe.toLocaleLowerCase("uk-UA") ||
                String(row.canonical_name ?? "")
                  .toLocaleLowerCase("uk-UA") === safe.toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? (rows.length === 1 ? rows[0] : null);
            if (!chosen) {
              return {
                success: false as const,
                error:
                  rows.length > 1
                    ? `Кілька полів для «${fieldId}». Передай точний fieldId з prepareWorkOrder.`
                    : `Поле «${fieldId}» не знайдено.`,
              };
            }
            fieldId = String(chosen.id);
          }

          const { data: field } = await supabase
            .from("farm_fields")
            .select("id, name, canonical_name")
            .eq("id", fieldId)
            .maybeSingle();
          if (!field) {
            return {
              success: false as const,
              error: `Поле з id ${fieldId} відсутнє в farm_fields.`,
            };
          }
          const fieldName =
            (field.canonical_name && String(field.canonical_name).trim()) ||
            (field.name && String(field.name).trim()) ||
            "Поле";
          // field_key — NOT NULL у field_operations (міграція 007)
          const fieldKey = `farm:${fieldId}`;

          const row: Record<string, unknown> = {
            client_key: workOrderId,
            field_key: fieldKey,
            field_id: fieldId,
            work_type: operationType,
            crop: input.crop?.trim() || "—",
            status: "planned",
            machinery: input.equipmentName.trim(),
            implement: input.implementName?.trim() || "",
            occurred_at: date,
            time_label: `${hhmm} – 18:00`,
            season_year: seasonYear,
            season: String(seasonYear),
            area_total: areaHa,
            area_plan: areaHa,
            area_fact: null,
            fuel_plan: input.fuelPlan ?? 0,
            fuel_fact: null,
            wage_plan: input.wagePlan ?? 0,
            wage_fact: null,
            mechanic_name: input.driverName.trim(),
            equipment_id:
              input.equipmentId && isUuid(input.equipmentId)
                ? input.equipmentId
                : null,
            implement_id:
              input.implementId && isUuid(input.implementId)
                ? input.implementId
                : null,
            export_status: "none",
            updated_at: new Date().toISOString(),
          };
          if (actorUserId) row.actor_id = actorUserId;
          if (actorName) row.actor_name = actorName;

          let { data, error } = await supabase
            .from("field_operations")
            .upsert(row, { onConflict: "client_key" })
            .select("id, client_key, work_type, field_key, field_id")
            .maybeSingle();

          if (
            error &&
            (error.message?.includes("actor_") ||
              error.message?.includes("season_year") ||
              error.message?.includes("export_status") ||
              error.message?.includes("implement_id"))
          ) {
            const retryRow = { ...row };
            if (error.message.includes("actor_")) {
              delete retryRow.actor_id;
              delete retryRow.actor_name;
            }
            if (error.message.includes("season_year")) {
              delete retryRow.season_year;
            }
            if (error.message.includes("export_status")) {
              delete retryRow.export_status;
            }
            if (error.message.includes("implement_id")) {
              delete retryRow.implement_id;
            }
            const retry = await supabase
              .from("field_operations")
              .upsert(retryRow, { onConflict: "client_key" })
              .select("id, client_key, work_type, field_key, field_id")
              .maybeSingle();
            data = retry.data;
            error = retry.error;
          }

          if (error) {
            console.error("[TOOL: confirmWorkOrder] upsert failed:", error.message);
            return {
              success: false as const,
              error: error.message,
              hint: "Перевір field_key/field_id. Не викликай logUnsupportedRequest — це технічна помилка збереження.",
            };
          }

          const savedId = String(data?.client_key ?? workOrderId);
          const summary = `${operationType} на ${fieldName}`;
          return {
            success: true as const,
            workOrderId: savedId,
            dbId: data?.id ? String(data.id) : null,
            fieldKey,
            fieldId,
            message: "Наряд успішно створено",
            summary,
            operationType,
            fieldName,
          };
        } catch (error) {
          return {
            success: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка збереження наряду",
          };
        }
      },
    }),

    deleteWorkOrder: tool({
      description: "Видаляє наряд (потрібне підтвердження).",
      inputSchema: z.object({
        workOrderId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("UUID наряду"),
        fieldName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва поля"),
        reason: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Причина"),
        confirmed: z
          .boolean()
          .optional()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({ workOrderId, fieldName, reason, confirmed }) => {
        const isConfirmed = confirmed === true;
        const hasExplicitId = Boolean(workOrderId?.trim());
        console.log("[TOOL: deleteWorkOrder]", {
          workOrderId,
          fieldName,
          reason,
          isConfirmed,
          hasExplicitId,
        });

        const statusLabels: Record<string, string> = {
          planned: "Заплановано",
          in_progress: "В роботі",
          completed: "Завершено",
          cancelled: "Скасовано",
        };

        type OpRow = {
          id: string;
          client_key: string;
          field_id: string | null;
          work_type: string | null;
          crop: string | null;
          status: string | null;
          machinery: string | null;
          mechanic_name: string | null;
          occurred_at: string | null;
          created_at: string | null;
        };

        const opSelect =
          "id, client_key, field_id, work_type, crop, status, machinery, mechanic_name, occurred_at, created_at";

        const mapOp = async (op: OpRow) => {
          let fieldLabel = "Поле";
          if (op.field_id) {
            const { data: field } = await supabase
              .from("farm_fields")
              .select("name, canonical_name")
              .eq("id", op.field_id)
              .maybeSingle();
            fieldLabel =
              (field?.canonical_name && String(field.canonical_name).trim()) ||
              (field?.name && String(field.name).trim()) ||
              "Поле";
          }
          const date =
            String(op.occurred_at ?? "").slice(0, 10) ||
            String(op.created_at ?? "").slice(0, 10) ||
            "—";
          return {
            workOrderId: String(op.client_key || op.id),
            dbId: String(op.id),
            clientKey: String(op.client_key),
            fieldId: op.field_id,
            fieldName: fieldLabel,
            operationType: String(op.work_type ?? "Операція"),
            crop: String(op.crop ?? "—"),
            date,
            machinery: String(op.machinery ?? "").trim() || "—",
            mechanicName: String(op.mechanic_name ?? "").trim() || null,
            statusLabel:
              statusLabels[String(op.status ?? "planned")] ??
              String(op.status ?? ""),
            opStatus: String(op.status ?? "planned"),
          };
        };

        try {
          let op: OpRow | null = null;
          let resolvedVia: "id" | "field" | "actor" = "id";

          if (workOrderId?.trim()) {
            const key = workOrderId.trim();
            if (isUuid(key)) {
              const byId = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("id", key)
                .maybeSingle();
              op = (byId.data as OpRow | null) ?? null;
            }
            if (!op) {
              const byClient = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("client_key", key)
                .maybeSingle();
              op = (byClient.data as OpRow | null) ?? null;
            }
            if (!op) {
              return {
                success: false as const,
                status: "not_found" as const,
                error: `Наряд «${key}» не знайдено.`,
              };
            }
            resolvedVia = "id";
          } else if (fieldName?.trim() || defaultFieldId) {
            resolvedVia = "field";
            let fieldId = defaultFieldId;
            const lookup = fieldName?.trim();
            if (lookup) {
              if (isUuid(lookup)) fieldId = lookup;
              else {
                const safe = lookup.replaceAll(",", " ");
                const { data: fields } = await supabase
                  .from("farm_fields")
                  .select("id, name, canonical_name")
                  .eq("is_field", true)
                  .or(
                    `name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`
                  )
                  .limit(5);
                const rows = fields ?? [];
                if (rows.length === 0) {
                  return {
                    success: false as const,
                    status: "field_not_found" as const,
                    error: `Поле «${lookup}» не знайдено.`,
                  };
                }
                const exact = rows.find(
                  (row) =>
                    String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                      lookup.toLocaleLowerCase("uk-UA") ||
                    String(row.canonical_name ?? "")
                      .toLocaleLowerCase("uk-UA") ===
                      lookup.toLocaleLowerCase("uk-UA")
                );
                if (rows.length > 1 && !exact) {
                  return {
                    success: false as const,
                    status: "ambiguous_field" as const,
                    error: `Знайдено кілька полів для «${lookup}». Уточни.`,
                    candidates: rows.map((row) => ({
                      id: row.id,
                      name:
                        (row.canonical_name &&
                          String(row.canonical_name).trim()) ||
                        String(row.name ?? "Поле"),
                    })),
                  };
                }
                fieldId = String((exact ?? rows[0]!).id);
              }
            }
            if (!fieldId) {
              return {
                success: false as const,
                status: "needs_slots" as const,
                error: "Вкажи workOrderId або назву поля.",
              };
            }
            const { data: latest, error: latestError } = await supabase
              .from("field_operations")
              .select(opSelect)
              .eq("field_id", fieldId)
              .neq("status", "cancelled")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestError) {
              return {
                success: false as const,
                status: "error" as const,
                error: latestError.message,
              };
            }
            op = (latest as OpRow | null) ?? null;
          } else if (actorUserId) {
            resolvedVia = "actor";
            const { data: latest, error: latestError } = await supabase
              .from("field_operations")
              .select(opSelect)
              .eq("actor_id", actorUserId)
              .neq("status", "cancelled")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestError) {
              // колонки actor_id може не бути — fallback без фільтра
              const fallback = await supabase
                .from("field_operations")
                .select(opSelect)
                .neq("status", "cancelled")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              op = (fallback.data as OpRow | null) ?? null;
            } else {
              op = (latest as OpRow | null) ?? null;
            }
          } else {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error:
                "Немає workOrderId в історії. Уточни поле або ID наряду.",
            };
          }

          if (!op) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: "Збережений наряд для видалення не знайдено.",
            };
          }

          const details = await mapOp(op);

          // Явний ID з історії — видаляємо одразу. Інакше — підтвердження.
          if (!hasExplicitId && !isConfirmed) {
            return {
              ...details,
              success: false as const,
              status: "requires_confirmation" as const,
              confirmChoice: "Так, видалити наряд назавжди",
              cancelChoice: "Ні, залишити як є",
              userHint: `Ви дійсно хочете видалити наряд ${details.operationType} від ${details.date} по полю ${details.fieldName}?`,
              resolvedVia,
            };
          }

          const { data: deleted, error: deleteError } = await supabase
            .from("field_operations")
            .delete()
            .eq("id", details.dbId)
            .select("id, client_key, work_type, field_id")
            .maybeSingle();

          if (deleteError) {
            const byClient = await supabase
              .from("field_operations")
              .delete()
              .eq("client_key", details.clientKey)
              .select("id, client_key, work_type, field_id")
              .maybeSingle();
            if (byClient.error) {
              return {
                success: false as const,
                status: "error" as const,
                error: byClient.error.message,
              };
            }
            return {
              success: true as const,
              status: "deleted" as const,
              workOrderId: details.workOrderId,
              deletedItem: byClient.data,
              operationType: details.operationType,
              fieldName: details.fieldName,
              reason: reason ?? null,
              message: `Видалив щойно створений наряд ${details.operationType} з бази Хронології ✓`,
            };
          }

          return {
            success: true as const,
            status: "deleted" as const,
            workOrderId: details.workOrderId,
            deletedItem: deleted,
            operationType: details.operationType,
            fieldName: details.fieldName,
            reason: reason ?? null,
            message: `Видалив щойно створений наряд ${details.operationType} з бази Хронології ✓`,
          };
        } catch (error) {
          console.error(
            "[TOOL: deleteWorkOrder] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка видалення наряду",
          };
        }
      },
    }),

    closeWorkOrder: tool({
      description:
        "Закриває наряд і фіксує факт (площа, паливо). Потрібне підтвердження.",
      inputSchema: z.object({
        workOrderId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("UUID або client_key"),
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        factArea: z
          .number()
          .positive()
          .describe("Факт га"),
        fuelUsed: z
          .number()
          .nonnegative()
          .optional()
          .describe("Факт л пального"),
        notes: z
          .string()
          .trim()
          .optional()
          .describe("Нотатка"),
        confirmed: z
          .boolean()
          .optional()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        workOrderId,
        fieldIdOrName,
        factArea,
        fuelUsed,
        notes,
        confirmed,
      }) => {
        const isConfirmed = confirmed === true;
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: closeWorkOrder]", {
          workOrderId,
          lookup,
          factArea,
          fuelUsed,
          isConfirmed,
        });

        const OPEN_STATUSES = ["in_progress", "planned", "assigned"] as const;
        const opSelect = `
          id, client_key, field_id, field_key, work_type, crop, status,
          occurred_at, machinery, implement, mechanic_name, equipment_id,
          area_plan, area_fact, fuel_plan, fuel_fact, wage_plan, wage_fact,
          time_label, season_year, season, area_total
        `;

        type CloseOpRow = {
          id: string;
          client_key: string | null;
          field_id: string | null;
          field_key: string | null;
          work_type: string | null;
          crop: string | null;
          status: string | null;
          occurred_at: string | null;
          machinery: string | null;
          implement: string | null;
          mechanic_name: string | null;
          equipment_id: string | null;
          area_plan: number | null;
          area_fact: number | null;
          fuel_plan: number | null;
          fuel_fact: number | null;
          wage_plan: number | null;
          wage_fact: number | null;
          time_label: string | null;
          season_year: number | null;
          season: string | null;
          area_total: number | null;
        };

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }
          const { field, fieldName } = resolved;
          const fieldKey = `farm:${field.id}`;

          let op: CloseOpRow | null = null;

          if (workOrderId?.trim()) {
            const key = workOrderId.trim();
            if (isUuid(key)) {
              const byId = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("id", key)
                .maybeSingle();
              if (byId.data) op = byId.data as CloseOpRow;
            }
            if (!op) {
              const byClient = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("client_key", key)
                .maybeSingle();
              if (byClient.data) op = byClient.data as CloseOpRow;
            }
            if (!op) {
              return {
                status: "not_found" as const,
                error: `Наряд «${key}» не знайдено.`,
              };
            }
            const opField = op.field_id ? String(op.field_id) : null;
            if (opField && opField !== field.id) {
              return {
                status: "error" as const,
                error: "Цей наряд належить іншому полю.",
                workOrderId: String(op.client_key || op.id),
                fieldId: opField,
              };
            }
          } else {
            // Спочатку in_progress / assigned, потім planned
            const activeRes = await supabase
              .from("field_operations")
              .select(opSelect)
              .in("status", ["in_progress", "assigned"])
              .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
              .order("occurred_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (activeRes.data) {
              op = activeRes.data as CloseOpRow;
            } else {
              const plannedRes = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("status", "planned")
                .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
                .order("occurred_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (plannedRes.data) op = plannedRes.data as CloseOpRow;
            }
            if (!op) {
              return {
                status: "not_found" as const,
                error: `На полі «${fieldName}» немає відкритого наряду (planned / in_progress).`,
                fieldId: field.id,
                fieldName,
              };
            }
          }

          const opStatus = String(op.status ?? "planned");
          if (!OPEN_STATUSES.includes(opStatus as (typeof OPEN_STATUSES)[number])) {
            return {
              status: "error" as const,
              error: `Наряд уже в статусі «${opStatus}» — закрити можна лише planned / in_progress.`,
              workOrderId: String(op.client_key || op.id),
            };
          }

          const workType = String(op.work_type ?? "Операція");
          const plannedArea = finiteNumber(op.area_plan);
          const fuelPlan = finiteNumber(op.fuel_plan);
          const clientKey = String(op.client_key || op.id);
          const confirmChoice = "Підтвердити закриття наряду";
          const cancelChoice = "Скасувати";

          if (!isConfirmed) {
            return {
              status: "requires_confirmation" as const,
              success: false as const,
              workOrderId: clientKey,
              dbId: String(op.id),
              fieldId: field.id,
              fieldName,
              operationType: workType,
              currentStatus: opStatus,
              plannedArea: plannedArea || null,
              factArea,
              fuelPlan: fuelPlan || null,
              fuelUsed: fuelUsed ?? null,
              notes: notes?.trim() || null,
              confirmChoice,
              cancelChoice,
              userHint: `Закрити наряд на ${workType} (Поле ${fieldName}) з фактичною площею ${factArea} га${
                fuelUsed != null ? ` та пальним ${fuelUsed} л` : ""
              }?`,
            };
          }

          const actor = await getCurrentActor();
          const crop =
            String(op.crop ?? "").trim() ||
            String(field.crop ?? "").trim() ||
            "—";
          const closedAt = new Date().toISOString();

          const row: Record<string, unknown> = {
            client_key: clientKey,
            field_id: field.id,
            field_key: op.field_key || fieldKey,
            work_type: workType,
            crop,
            status: "completed",
            export_status: "pending",
            area_plan: plannedArea || null,
            area_fact: factArea,
            fuel_plan: fuelPlan || null,
            fuel_fact: fuelUsed ?? null,
            wage_plan: finiteNumber(op.wage_plan) || null,
            wage_fact: finiteNumber(op.wage_fact) || null,
            agronomist_comment: notes?.trim() || null,
            closed_at: closedAt,
            updated_at: closedAt,
            machinery: op.machinery,
            implement: op.implement,
            mechanic_name: op.mechanic_name,
            occurred_at: op.occurred_at
              ? String(op.occurred_at).slice(0, 10)
              : todayKyivYmd(),
            time_label: op.time_label,
            area_total: finiteNumber(op.area_total) || factArea,
            ...actorCloseColumns(actor),
          };
          if (op.equipment_id) row.equipment_id = op.equipment_id;
          if (typeof op.season_year === "number") {
            row.season_year = op.season_year;
            row.season = String(op.season_year);
          } else if (op.season) {
            row.season = op.season;
          }

          const result = await upsertFieldOperationRow(supabase, row);
          if (!result.ok) {
            return {
              success: false as const,
              status: "error" as const,
              error: result.error,
            };
          }

          const operationId = String(op.id);
          void enqueueFieldOperationBasDraft(operationId).catch((e) =>
            console.error("[bas-drafts] waybill (agent close)", e)
          );
          void logActivity({
            actor,
            action: "close",
            entityType: "field_operation",
            entityId: operationId,
            summary: `${actor.label} закрив наряд «${workType} · ${crop}» (LEVADIUS)`,
            meta: { areaFact: factArea, fuelUsed: fuelUsed ?? null, fieldId: field.id },
          });

          return {
            success: true as const,
            status: "closed" as const,
            workOrderId: clientKey,
            dbId: operationId,
            fieldId: field.id,
            fieldName,
            operationType: workType,
            factArea,
            fuelUsed: fuelUsed ?? null,
            notes: notes?.trim() || null,
            closedAt,
            openFieldPath: `/?field=${field.id}`,
            message: `Закрив наряд «${workType}» на полі «${fieldName}»: факт **${factArea} га**${
              fuelUsed != null ? `, паливо **${fuelUsed} л**` : ""
            }.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: closeWorkOrder] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка закриття наряду",
          };
        }
      },
    }),

    getFieldWeather: tool({
      description: "Читає погоду по полю.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: getFieldWeather]", { lookup });

        if (!lookup) {
          return {
            status: "needs_slots" as const,
            error: "Вкажи назву або ID поля.",
          };
        }

        try {
          type FieldRow = {
            id: string;
            name: string | null;
            canonical_name: string | null;
            crop: string | null;
            area_ha: number | null;
          };

          let field: FieldRow | null = null;

          if (isUuid(lookup)) {
            const { data, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, crop, area_ha")
              .eq("id", lookup)
              .eq("is_field", true)
              .maybeSingle();
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося знайти поле: ${error.message}`,
              };
            }
            field = (data as FieldRow | null) ?? null;
          }

          if (!field) {
            const safe = lookup.replaceAll(",", " ");
            const { data: matches, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, crop, area_ha")
              .eq("is_field", true)
              .or(
                `name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`
              )
              .order("name")
              .limit(5);
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося шукати поле: ${error.message}`,
              };
            }
            const rows = (matches ?? []) as FieldRow[];
            if (rows.length === 0) {
              return {
                status: "field_not_found" as const,
                error: `Поле «${lookup}» не знайдено.`,
              };
            }
            const exact = rows.find(
              (row) =>
                String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                  lookup.toLocaleLowerCase("uk-UA") ||
                String(row.canonical_name ?? "")
                  .toLocaleLowerCase("uk-UA") ===
                  lookup.toLocaleLowerCase("uk-UA")
            );
            if (rows.length > 1 && !exact) {
              return {
                status: "ambiguous_field" as const,
                error: `Знайдено кілька полів для «${lookup}». Уточни.`,
                candidates: rows.map((row) => ({
                  id: row.id,
                  name:
                    (row.canonical_name && row.canonical_name.trim()) ||
                    row.name ||
                    "Поле",
                })),
              };
            }
            field = exact ?? rows[0]!;
          }

          const fieldName =
            (field.canonical_name && field.canonical_name.trim()) ||
            field.name ||
            "Поле";
          const crop = (field.crop && String(field.crop).trim()) || null;

          const coords = await resolveFieldCoordinates(supabase, field.id);
          if (!coords) {
            return {
              status: "no_geometry" as const,
              error: `У поля «${fieldName}» немає геометрії для погоди.`,
              fieldId: field.id,
              fieldName,
            };
          }

          const { current, hourly } = await fetchWeatherWithHourly(
            coords.latitude,
            coords.longitude
          );
          const advisory = evaluateFieldWeatherAdvisory(current, {
            crop: crop ?? undefined,
            hourly,
          });

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            crop,
            areaHa: finiteNumber(field.area_ha),
            atmosphere: {
              tempC: current.tempC,
              humidityPercent: current.humidityPercent,
              windMs: current.windMs,
              condition: current.condition,
            },
            soil: {
              tempC18cm: current.soilTempC,
              moisturePercent3to9cm: current.soilMoisturePercent,
            },
            advisory: {
              tone: advisory.tone,
              title: advisory.title,
              detail: advisory.detail ?? null,
            },
            hourly: hourly.slice(0, 4).map((hour) => ({
              time: hour.time,
              tempC: hour.tempC,
              precipMm: hour.precipitationMm,
              precipProb: hour.precipProbability,
            })),
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldWeather] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка отримання погоди",
          };
        }
      },
    }),

    checkSprayingWeatherWindow: tool({
      description:
        "Оцінює погодинне вікно для обприскування ЗЗР (вітер, температура, опади).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: checkSprayingWeatherWindow]", { lookup });

        try {
          if (!lookup) {
            return {
              status: "needs_slots" as const,
              error: "Вкажи поле для оцінки вікна обприскування.",
            };
          }

          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const coords = await resolveFieldCoordinates(supabase, field.id);
          if (!coords) {
            return {
              status: "no_geometry" as const,
              error: `У поля «${fieldName}» немає геометрії для погоди.`,
              fieldId: field.id,
              fieldName,
            };
          }

          const { hourly } = await fetchPlanningWeather(
            coords.latitude,
            coords.longitude
          );
          const window = evaluateSprayingWeatherWindow(hourly, {
            hoursAhead: 24,
          });

          const compactHours = window.next24h.map((slot) => ({
            time: slot.hourLabel,
            period: slot.period,
            tempC: slot.tempC,
            windMs: slot.windMs,
            windGustMs: slot.windGustMs,
            precipMm: slot.precipMm,
            precipProb: slot.precipProb,
            dryHoursAfter: slot.dryHoursAfter,
            verdict: slot.verdict,
            reasons: slot.reasons,
          }));

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            crop: field.crop ?? null,
            rules: {
              windOptimalMs: "2–4",
              windCriticalMs: ">5–6",
              tempOptimalC: "12–22",
              tempStopC: ">25",
              dryHoursAfterMin: "4–6",
            },
            advice: window.advice,
            optimalCount: window.optimalCount,
            blockedCount: window.blockedCount,
            goodWindows: window.goodWindows,
            next24h: compactHours,
          };
        } catch (error) {
          console.error(
            "[TOOL: checkSprayingWeatherWindow] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка вікна обприскування",
          };
        }
      },
    }),

    getFieldNdviStatus: tool({
      description:
        "Контроль вегетації / NDVI-тривоги з field_ndvi_alerts (супутник).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || "").trim();
        console.log("[TOOL: getFieldNdviStatus]", { lookup });

        try {
          type NdviRow = {
            id: string;
            field_id: string;
            drop_percent: number | string | null;
            zone_note: string | null;
            detected_at: string | null;
            is_active?: boolean | null;
            farm_fields?:
              | {
                  id: string;
                  name: string | null;
                  canonical_name?: string | null;
                  crop: string | null;
                  area_ha: number | null;
                }
              | {
                  id: string;
                  name: string | null;
                  canonical_name?: string | null;
                  crop: string | null;
                  area_ha: number | null;
                }[]
              | null;
          };

          const mapStatus = (drop: number): "critical" | "warning" | "watch" => {
            if (drop >= 20) return "critical";
            if (drop >= 12) return "warning";
            return "watch";
          };

          const unwrapField = (row: NdviRow) => {
            const raw = row.farm_fields;
            return Array.isArray(raw) ? raw[0] : raw;
          };

          const toFieldItem = (row: NdviRow) => {
            const field = unwrapField(row);
            const drop = finiteNumber(row.drop_percent);
            const name =
              (field?.canonical_name && String(field.canonical_name).trim()) ||
              (field?.name && String(field.name).trim()) ||
              "Поле";
            const zone =
              typeof row.zone_note === "string" && row.zone_note.trim()
                ? row.zone_note.trim()
                : null;
            const status = mapStatus(drop);
            return {
              fieldId: String(row.field_id),
              name,
              crop: (field?.crop && String(field.crop).trim()) || null,
              areaHa: field?.area_ha != null ? finiteNumber(field.area_ha) : null,
              /** Абсолютного NDVI у БД немає — лише відносне просідання між прольотами */
              ndvi: null as number | null,
              ndviChangePercent: -round2(drop),
              dropPercent: round2(drop),
              status,
              issue: zone
                ? `Просідання біомаси ${round2(drop)}% (${zone})`
                : `Просідання біомаси ${round2(drop)}% за останні прольоти`,
              zoneNote: zone,
              detectedAt: row.detected_at
                ? String(row.detected_at)
                : null,
              alertId: String(row.id),
            };
          };

          if (lookup) {
            const resolved = await resolveAgentFieldByLookup(supabase, lookup);
            if (!resolved.ok) {
              return {
                status: resolved.status,
                error: resolved.error,
                candidates: resolved.candidates,
                alertsCount: 0,
                fields: [],
              };
            }

            const { field, fieldName } = resolved;
            const { data, error } = await supabase
              .from("field_ndvi_alerts")
              .select(
                "id, field_id, drop_percent, zone_note, detected_at, is_active, farm_fields ( id, name, canonical_name, crop, area_ha )"
              )
              .eq("field_id", field.id)
              .eq("is_active", true)
              .order("detected_at", { ascending: false })
              .limit(5);

            if (error) {
              if (
                error.code === "PGRST205" ||
                error.code === "42P01" ||
                error.message?.includes("field_ndvi_alerts")
              ) {
                return {
                  status: "unavailable" as const,
                  error:
                    "Таблиця field_ndvi_alerts відсутня. Потрібна міграція 045.",
                  alertsCount: 0,
                  fields: [],
                };
              }
              return {
                status: "error" as const,
                error: error.message,
                alertsCount: 0,
                fields: [],
              };
            }

            const rows = (data ?? []) as NdviRow[];
            if (rows.length === 0) {
              return {
                status: "ok" as const,
                alertsCount: 0,
                fieldId: field.id,
                fieldName,
                fields: [
                  {
                    fieldId: field.id,
                    name: fieldName,
                    crop: field.crop ?? null,
                    areaHa: finiteNumber(field.area_ha),
                    ndvi: null,
                    ndviChangePercent: null,
                    dropPercent: null,
                    status: "ok" as const,
                    issue: null,
                    zoneNote: null,
                    detectedAt: null,
                    alertId: null,
                  },
                ],
              };
            }

            // Два останні прольоти / тривоги для динаміки
            const mapped = rows.map(toFieldItem);
            const latest = mapped[0]!;
            const previous = mapped[1];
            const changeVsPrev =
              previous != null
                ? round2(latest.dropPercent - previous.dropPercent)
                : latest.ndviChangePercent;

            return {
              status: "ok" as const,
              alertsCount: mapped.length,
              fieldId: field.id,
              fieldName,
              fields: [
                {
                  ...latest,
                  ndviChangePercent: changeVsPrev,
                  issue:
                    previous != null
                      ? `${latest.issue}; порівняно з попередньою тривогою Δ drop ${changeVsPrev > 0 ? "+" : ""}${changeVsPrev} п.п.`
                      : latest.issue,
                },
              ],
              recentAlerts: mapped.slice(0, 2),
            };
          }

          const { data, error } = await supabase
            .from("field_ndvi_alerts")
            .select(
              "id, field_id, drop_percent, zone_note, detected_at, is_active, farm_fields ( id, name, canonical_name, crop, area_ha )"
            )
            .eq("is_active", true)
            .order("detected_at", { ascending: false })
            .limit(40);

          if (error) {
            if (
              error.code === "PGRST205" ||
              error.code === "42P01" ||
              error.message?.includes("field_ndvi_alerts")
            ) {
              return {
                status: "unavailable" as const,
                error:
                  "Таблиця field_ndvi_alerts відсутня. Потрібна міграція 045.",
                alertsCount: 0,
                fields: [],
              };
            }
            return {
              status: "error" as const,
              error: error.message,
              alertsCount: 0,
              fields: [],
            };
          }

          // Одна найсвіжіша тривога на поле
          const byField = new Map<string, ReturnType<typeof toFieldItem>>();
          for (const row of (data ?? []) as NdviRow[]) {
            const item = toFieldItem(row);
            if (!byField.has(item.fieldId)) byField.set(item.fieldId, item);
          }
          const fields = Array.from(byField.values()).sort(
            (a, b) => (b.dropPercent ?? 0) - (a.dropPercent ?? 0)
          );

          return {
            status: "ok" as const,
            alertsCount: fields.length,
            fields,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldNdviStatus] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка NDVI",
            alertsCount: 0,
            fields: [],
          };
        }
      },
    }),

    getFieldOperationsHistory: tool({
      description:
        "Читає роботи по полю: активні, заплановані та/або виконані (за status).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        status: z
          .enum(["all", "active", "completed", "planned"])
          .optional()
          .default("all")
          .describe("all|active|planned|completed"),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата від YYYY-MM-DD"),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата до YYYY-MM-DD"),
        month: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Місяць 1–12"),
        operationType: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Тип робіт"),
      }),
      execute: async ({
        fieldIdOrName,
        status: statusFilter = "all",
        startDate,
        endDate,
        month,
        operationType,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: getFieldOperationsHistory]", {
          lookup,
          statusFilter,
          startDate,
          endDate,
          month,
          operationType,
        });

        const opSelect = `
          id,
          client_key,
          work_type,
          crop,
          status,
          occurred_at,
          machinery,
          implement,
          mechanic_name,
          equipment_id,
          area_fact,
          area_plan,
          fuel_fact,
          fuel_plan
        `;

        type HistRow = {
          id: string;
          client_key: string | null;
          work_type: string | null;
          crop: string | null;
          status: string | null;
          occurred_at: string | null;
          machinery: string | null;
          implement: string | null;
          mechanic_name: string | null;
          equipment_id: string | null;
          area_fact: number | null;
          area_plan: number | null;
          fuel_fact: number | null;
          fuel_plan: number | null;
        };

        const mapShort = (row: HistRow) => ({
          id: String(row.client_key || row.id),
          work_type: String(row.work_type ?? "Операція"),
          status: String(row.status ?? "planned"),
          planned_area: finiteNumber(row.area_plan) || null,
          fact_area: finiteNumber(row.area_fact) || null,
          date: row.occurred_at
            ? String(row.occurred_at).slice(0, 10)
            : null,
          machine_id: row.equipment_id ? String(row.equipment_id) : null,
          driver_id: row.mechanic_name
            ? String(row.mechanic_name).trim() || null
            : null,
          machinery: row.machinery ? String(row.machinery) : null,
          mechanic_name: row.mechanic_name
            ? String(row.mechanic_name).trim() || null
            : null,
        });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const range = resolveHistoryDateRange({
            startDate,
            endDate,
            month,
            year: Number(field.season) || Number(DEFAULT_SEASON) || undefined,
          });
          const fieldKey = `farm:${field.id}`;
          const typeFilter = operationType?.trim();

          const applyCommonFilters = <
            T extends {
              gte: (c: string, v: string) => T;
              lte: (c: string, v: string) => T;
              ilike: (c: string, v: string) => T;
            },
          >(
            query: T,
            withDates: boolean
          ) => {
            let q = query;
            if (withDates) {
              if (range.startDate) q = q.gte("occurred_at", range.startDate);
              if (range.endDate) q = q.lte("occurred_at", range.endDate);
            }
            if (typeFilter) q = q.ilike("work_type", `%${typeFilter}%`);
            return q;
          };

          if (statusFilter === "all") {
            const openQuery = applyCommonFilters(
              supabase
                .from("field_operations")
                .select(opSelect)
                .in("status", ["in_progress", "assigned", "planned"])
                .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
                .order("occurred_at", { ascending: false })
                .limit(40),
              false
            );
            const doneQuery = applyCommonFilters(
              supabase
                .from("field_operations")
                .select(opSelect)
                .eq("status", "completed")
                .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
                .order("occurred_at", { ascending: false })
                .limit(5),
              true
            );

            const [openRes, doneRes] = await Promise.all([openQuery, doneQuery]);
            if (openRes.error) {
              return {
                status: "error" as const,
                error: `Не вдалося прочитати наряди: ${openRes.error.message}`,
              };
            }
            if (doneRes.error) {
              return {
                status: "error" as const,
                error: `Не вдалося прочитати історію: ${doneRes.error.message}`,
              };
            }

            const openRows = (openRes.data ?? []) as HistRow[];
            const active = openRows
              .filter((r) => {
                const s = String(r.status ?? "");
                return s === "in_progress" || s === "assigned";
              })
              .map(mapShort);
            const planned = openRows
              .filter((r) => String(r.status ?? "") === "planned")
              .map(mapShort);
            const recent_completed = ((doneRes.data ?? []) as HistRow[]).map(
              mapShort
            );

            return {
              status: "ok" as const,
              fieldId: field.id,
              fieldName,
              filter: "all",
              dateRange: {
                start: range.startDate,
                end: range.endDate,
                label: range.label,
              },
              active,
              planned,
              recent_completed,
              counts: {
                active: active.length,
                planned: planned.length,
                recent_completed: recent_completed.length,
              },
            };
          }

          const statuses =
            statusFilter === "active"
              ? ["in_progress", "assigned"]
              : statusFilter === "planned"
                ? ["planned"]
                : ["completed"];

          let query = supabase
            .from("field_operations")
            .select(opSelect)
            .in("status", statuses)
            .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
            .order("occurred_at", { ascending: false })
            .limit(statusFilter === "completed" ? 40 : 40);

          query = applyCommonFilters(query, statusFilter === "completed");

          const { data: ops, error: opsError } = await query;
          if (opsError) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати історію: ${opsError.message}`,
            };
          }

          const rows = (ops ?? []) as HistRow[];

          // Для completed лишаємо збагачення ТМЦ (як раніше)
          if (statusFilter === "completed") {
            const clientKeys = rows
              .map((row) => String(row.client_key ?? "").trim())
              .filter(Boolean);

            const materialsByKey = new Map<
              string,
              {
                name: string;
                category: string | null;
                unit: string | null;
                qty: number;
              }[]
            >();

            if (clientKeys.length > 0) {
              const { data: materials } = await supabase
                .from("field_operation_materials")
                .select(
                  "operation_client_key, item_name, category, unit, qty"
                )
                .in("operation_client_key", clientKeys);

              for (const mat of materials ?? []) {
                const key = String(mat.operation_client_key ?? "");
                if (!key) continue;
                const list = materialsByKey.get(key) ?? [];
                list.push({
                  name: String(mat.item_name ?? "ТМЦ"),
                  category:
                    typeof mat.category === "string" ? mat.category : null,
                  unit: typeof mat.unit === "string" ? mat.unit : null,
                  qty: finiteNumber(mat.qty),
                });
                materialsByKey.set(key, list);
              }
            }

            const operations = rows.map((row) => {
              const key = String(row.client_key ?? "");
              const mats = materialsByKey.get(key) ?? [];
              const short = mapShort(row);
              return {
                ...short,
                machinery: row.machinery || null,
                implement: row.implement || null,
                mechanic: row.mechanic_name || null,
                areaHa:
                  finiteNumber(row.area_fact) || finiteNumber(row.area_plan),
                fuelL:
                  finiteNumber(row.fuel_fact) || finiteNumber(row.fuel_plan),
                materials: mats.map((m) => ({
                  name: m.name,
                  qty: m.qty,
                  unit: m.unit,
                })),
              };
            });

            return {
              status: "ok" as const,
              fieldId: field.id,
              fieldName,
              filter: statusFilter,
              dateRange: {
                start: range.startDate,
                end: range.endDate,
                label: range.label,
              },
              count: operations.length,
              operations,
            };
          }

          const operations = rows.map(mapShort);
          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            filter: statusFilter,
            count: operations.length,
            operations,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldOperationsHistory] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка історії поля",
          };
        }
      },
    }),

    getDailyOperationsSummary: tool({
      description:
        "Диспетчерське зведення дня: роботи за добу, оброблено га, в роботі / завершено / заплановано, паливо Wialon.",
      inputSchema: z.object({
        date: z
          .string()
          .trim()
          .optional()
          .describe("Дата YYYY-MM-DD"),
        filterStatus: z
          .enum(["all", "active", "completed", "planned"])
          .optional()
          .default("all")
          .describe("all|active|completed|planned"),
      }),
      execute: async ({ date: dateRaw, filterStatus = "all" }) => {
        const today = todayKyivYmd();
        let date = today;
        if (dateRaw?.trim()) {
          const resolved = resolveWorkOrderDateInput(dateRaw.trim());
          if ("error" in resolved) {
            return { status: "error" as const, error: resolved.error };
          }
          date = resolved.date;
        }
        const tomorrow = shiftKyivYmd(date, 1);
        const upcomingEnd = shiftKyivYmd(date, 7);

        console.log("[TOOL: getDailyOperationsSummary]", {
          date,
          filterStatus,
        });

        type DayOpRow = {
          id: string;
          client_key: string | null;
          field_id: string | null;
          field_key: string | null;
          work_type: string | null;
          crop: string | null;
          status: string | null;
          occurred_at: string | null;
          machinery: string | null;
          implement: string | null;
          implement_id?: string | null;
          mechanic_name: string | null;
          equipment_id: string | null;
          area_fact: number | null;
          area_plan: number | null;
          fuel_fact: number | null;
          fuel_plan: number | null;
          time_label: string | null;
        };

        try {
          const opSelectBase = `
            id, client_key, field_id, field_key, work_type, crop, status,
            occurred_at, machinery, implement, mechanic_name,
            equipment_id, area_fact, area_plan, fuel_fact, fuel_plan, time_label
          `;
          const opSelectWithImpl = `${opSelectBase.trim()}, implement_id`;

          // Зріз за добу + заплановані на найближчі дні (для plannedCount)
          const fetchDaySlice = async (selectCols: string) => {
            const dayQuery = supabase
              .from("field_operations")
              .select(selectCols)
              .neq("status", "cancelled")
              .gte("occurred_at", date)
              .lte("occurred_at", `${date}T23:59:59.999Z`)
              .order("occurred_at", { ascending: true })
              .limit(200);

            const upcomingPlannedQuery = supabase
              .from("field_operations")
              .select(selectCols)
              .eq("status", "planned")
              .gte("occurred_at", tomorrow)
              .lte("occurred_at", `${upcomingEnd}T23:59:59.999Z`)
              .order("occurred_at", { ascending: true })
              .limit(80);

            return Promise.all([dayQuery, upcomingPlannedQuery]);
          };

          let [dayRes, upcomingRes] = await fetchDaySlice(opSelectWithImpl);

          // Якщо колонка implement_id ще не застосована — повтор без неї
          if (
            dayRes.error?.message?.includes("implement_id") ||
            upcomingRes.error?.message?.includes("implement_id")
          ) {
            [dayRes, upcomingRes] = await fetchDaySlice(opSelectBase);
          }

          const fuelRes = await supabase
            .from("wialon_equipment_day_stats")
            .select(
              "equipment_id, fuel_consumed, fuel_filled, fuel_delta, distance_km, work_hours"
            )
            .eq("date", date);

          if (dayRes.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати наряди: ${dayRes.error.message}`,
            };
          }

          const dayRows = (dayRes.data ?? []) as unknown as DayOpRow[];
          const upcomingRows = (upcomingRes.data ?? []) as unknown as DayOpRow[];

          const inProgress = dayRows.filter(
            (r) => String(r.status ?? "") === "in_progress"
          );
          const completed = dayRows.filter(
            (r) => String(r.status ?? "") === "completed"
          );
          const plannedToday = dayRows.filter(
            (r) => String(r.status ?? "") === "planned"
          );
          // «Заплановано» для планірки = сьогодні + найближчі дні
          const plannedAll = [...plannedToday, ...upcomingRows];

          const totalFactArea = round2(
            completed.reduce(
              (sum, r) => sum + (finiteNumber(r.area_fact) || 0),
              0
            )
          );

          let listRows: DayOpRow[] = dayRows;
          if (filterStatus === "active") listRows = inProgress;
          else if (filterStatus === "completed") listRows = completed;
          else if (filterStatus === "planned") listRows = plannedAll;
          else {
            // all: день + upcoming planned (без дублів)
            const seen = new Set(dayRows.map((r) => String(r.id)));
            listRows = [
              ...dayRows,
              ...upcomingRows.filter((r) => !seen.has(String(r.id))),
            ];
          }

          const fieldIds = [
            ...new Set(
              listRows
                .map((r) => (r.field_id ? String(r.field_id) : ""))
                .filter(Boolean)
            ),
          ];
          const equipmentIds = [
            ...new Set(
              listRows
                .map((r) => (r.equipment_id ? String(r.equipment_id) : ""))
                .filter(Boolean)
            ),
          ];
          const implementIds = [
            ...new Set(
              listRows
                .map((r) => (r.implement_id ? String(r.implement_id) : ""))
                .filter(Boolean)
            ),
          ];

          const [fieldsRes, equipmentRes, implementsRes] = await Promise.all([
            fieldIds.length > 0
              ? supabase
                  .from("farm_fields")
                  .select("id, name, canonical_name")
                  .in("id", fieldIds)
              : Promise.resolve({ data: [] as const, error: null }),
            equipmentIds.length > 0
              ? supabase
                  .from("equipment")
                  .select("id, name, type")
                  .in("id", equipmentIds)
              : Promise.resolve({ data: [] as const, error: null }),
            implementIds.length > 0
              ? supabase
                  .from("implements")
                  .select("id, name, type, working_width_m")
                  .in("id", implementIds)
              : Promise.resolve({ data: [] as const, error: null }),
          ]);

          const fieldNameById = new Map<string, string>();
          for (const f of fieldsRes.data ?? []) {
            const name =
              (f.canonical_name && String(f.canonical_name).trim()) ||
              (f.name && String(f.name).trim()) ||
              "Поле";
            fieldNameById.set(String(f.id), name);
          }
          const equipmentNameById = new Map<string, string>();
          for (const e of equipmentRes.data ?? []) {
            equipmentNameById.set(
              String(e.id),
              String(e.name ?? "").trim() || "Техніка"
            );
          }
          const implementById = new Map<
            string,
            { name: string; type: string | null; widthM: number | null }
          >();
          for (const impl of implementsRes.data ?? []) {
            implementById.set(String(impl.id), {
              name: String(impl.name ?? "").trim() || "Знаряддя",
              type: impl.type ? String(impl.type) : null,
              widthM: finiteNumber(impl.working_width_m) || null,
            });
          }

          const fuelByEquipment = new Map<
            string,
            {
              fuelConsumedL: number | null;
              fuelFilledL: number;
              fuelDeltaL: number | null;
              distanceKm: number;
              workHours: number;
            }
          >();
          let totalFuelConsumedL = 0;
          let fuelStatsAvailable = false;
          for (const row of fuelRes.data ?? []) {
            fuelStatsAvailable = true;
            const eqId = String(row.equipment_id ?? "");
            if (!eqId) continue;
            const consumed = finiteNumber(row.fuel_consumed);
            const filled = finiteNumber(row.fuel_filled);
            const delta =
              row.fuel_delta != null ? finiteNumber(row.fuel_delta) : null;
            fuelByEquipment.set(eqId, {
              fuelConsumedL: consumed > 0 ? consumed : null,
              fuelFilledL: filled,
              fuelDeltaL: delta,
              distanceKm: finiteNumber(row.distance_km),
              workHours: finiteNumber(row.work_hours),
            });
            if (consumed > 0) totalFuelConsumedL += consumed;
          }
          totalFuelConsumedL = round2(totalFuelConsumedL);

          const operations = listRows.map((row) => {
            const status = String(row.status ?? "planned");
            const fieldId = row.field_id ? String(row.field_id) : null;
            const equipmentId = row.equipment_id
              ? String(row.equipment_id)
              : null;
            const implementId = row.implement_id
              ? String(row.implement_id)
              : null;
            const fieldName = fieldId
              ? fieldNameById.get(fieldId) || null
              : null;
            const equipmentName =
              (equipmentId && equipmentNameById.get(equipmentId)) ||
              (row.machinery ? String(row.machinery).trim() : null) ||
              null;
            const implMeta = implementId
              ? implementById.get(implementId)
              : null;
            const implementName =
              implMeta?.name ||
              (row.implement ? String(row.implement).trim() : null) ||
              null;
            const hitchLabel =
              equipmentName && implementName
                ? `${equipmentName} + ${implementName}`
                : equipmentName || implementName || null;
            const driverName = row.mechanic_name
              ? String(row.mechanic_name).trim() || null
              : null;
            const factArea = finiteNumber(row.area_fact) || null;
            const planArea = finiteNumber(row.area_plan) || null;
            const fuelDay = equipmentId
              ? fuelByEquipment.get(equipmentId) || null
              : null;

            return {
              id: String(row.client_key || row.id),
              dbId: String(row.id),
              date: row.occurred_at
                ? String(row.occurred_at).slice(0, 10)
                : date,
              status,
              workType: String(row.work_type ?? "Операція"),
              fieldId,
              fieldName,
              equipmentId,
              equipmentName,
              implementId,
              implementName,
              hitchLabel,
              driverName,
              planAreaHa: planArea,
              factAreaHa: factArea,
              timeLabel: row.time_label ? String(row.time_label) : null,
              fuelPlanL: finiteNumber(row.fuel_plan) || null,
              fuelFactL: finiteNumber(row.fuel_fact) || null,
              wialonFuelConsumedL: fuelDay?.fuelConsumedL ?? null,
            };
          });

          return {
            status: "ok" as const,
            date,
            filterStatus,
            totalFactArea,
            inProgressCount: inProgress.length,
            completedCount: completed.length,
            plannedCount: plannedAll.length,
            plannedTodayCount: plannedToday.length,
            plannedUpcomingCount: upcomingRows.length,
            totalFuelConsumedL: fuelStatsAvailable
              ? totalFuelConsumedL
              : null,
            fuelStatsAvailable,
            counts: {
              dayTotal: dayRows.length,
              inProgress: inProgress.length,
              completed: completed.length,
              planned: plannedAll.length,
              listed: operations.length,
            },
            operations,
            message: `Зведення на ${date}: оброблено ${totalFactArea} га, в роботі ${inProgress.length}, завершено ${completed.length}, заплановано ${plannedAll.length}.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: getDailyOperationsSummary] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка зведення дня",
          };
        }
      },
    }),

    getFuelStorageBalance: tool({
      description:
        "Залишки пального на АЗС / стаціонарних ємностях / бензовозах (fuel_storages).",
      inputSchema: z.object({
        storageIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Ємність ID/назва"),
      }),
      execute: async ({ storageIdOrName }) => {
        const lookup = storageIdOrName?.trim() || "";
        console.log("[TOOL: getFuelStorageBalance]", { lookup });

        try {
          let query = supabase
            .from("fuel_storages")
            .select("id, name, capacity, current_volume, type, price_per_liter")
            .order("name")
            .limit(80);

          if (lookup) {
            if (isUuid(lookup)) {
              query = query.eq("id", lookup);
            } else {
              query = query.ilike("name", `%${lookup}%`);
            }
          }

          const { data, error } = await query;
          if (error) {
            return {
              status: "error" as const,
              error: error.message,
              totalVolume: 0,
              storages: [],
            };
          }

          const rows = data ?? [];
          if (lookup && rows.length === 0) {
            return {
              status: "not_found" as const,
              error: `Ємність «${lookup}» не знайдена.`,
              totalVolume: 0,
              storages: [],
            };
          }

          const storages = rows.map((row) => {
            const capacity = finiteNumber(row.capacity);
            const currentVolume = finiteNumber(row.current_volume);
            const percentFilled =
              capacity > 0
                ? round2(Math.min(100, Math.max(0, (currentVolume / capacity) * 100)))
                : 0;
            const storageType = String(row.type ?? "stationary");
            return {
              id: String(row.id),
              name: String(row.name ?? "Ємність"),
              currentVolume: round2(currentVolume),
              capacity: round2(capacity),
              percentFilled,
              fuelType: "ДП",
              storageType,
              pricePerLiter: round2(finiteNumber(row.price_per_liter)),
            };
          });

          const totalVolume = round2(
            storages.reduce((sum, s) => sum + s.currentVolume, 0)
          );
          const totalCapacity = round2(
            storages.reduce((sum, s) => sum + s.capacity, 0)
          );

          return {
            status: "ok" as const,
            totalVolume,
            totalCapacity,
            count: storages.length,
            storages,
            message:
              storages.length === 0
                ? "Ємностей пального в системі немає."
                : `Разом ${totalVolume} л ДП у ${storages.length} ємност${
                    storages.length === 1 ? "і" : "ях"
                  }.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFuelStorageBalance] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка залишків пального",
            totalVolume: 0,
            storages: [],
          };
        }
      },
    }),

    logFuelRefueling: tool({
      description:
        "Фіксує заправку техніки з ємності (списання з fuel_storages). Потрібне confirmed.",
      inputSchema: z.object({
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Техніка ID/назва"),
        storageIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Ємність ID/назва"),
        liters: z
          .number()
          .positive()
          .describe("Літри"),
        driverIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Водій ID/ПІБ"),
        confirmed: z
          .boolean()
          .optional()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        equipmentIdOrName,
        storageIdOrName,
        liters,
        driverIdOrName,
        confirmed,
      }) => {
        const isConfirmed = confirmed === true;
        const amount = roundLiters(Number(liters));
        const confirmChoice = "Підтвердити заправку";
        const cancelChoice = "Скасувати";

        console.log("[TOOL: logFuelRefueling]", {
          equipmentIdOrName,
          storageIdOrName,
          amount,
          driverIdOrName,
          isConfirmed,
        });

        try {
          if (!Number.isFinite(amount) || amount <= 0) {
            return {
              success: false as const,
              status: "error" as const,
              error: "Кількість літрів має бути більше 0.",
            };
          }

          // ── Техніка ──────────────────────────────────────────────
          const eqLookup = equipmentIdOrName.trim();
          let equipment: {
            id: string;
            name: string;
            wialon_id: number | null;
          } | null = null;

          if (isUuid(eqLookup)) {
            const { data } = await supabase
              .from("equipment")
              .select("id, name, wialon_id")
              .eq("id", eqLookup)
              .maybeSingle();
            if (data) {
              equipment = {
                id: String(data.id),
                name: String(data.name ?? "Техніка"),
                wialon_id:
                  data.wialon_id != null && Number.isFinite(Number(data.wialon_id))
                    ? Number(data.wialon_id)
                    : null,
              };
            }
          } else {
            const { data: rows } = await supabase
              .from("equipment")
              .select("id, name, wialon_id")
              .ilike("name", `%${eqLookup}%`)
              .order("name")
              .limit(8);
            const list = rows ?? [];
            const exact = list.find(
              (r) =>
                String(r.name ?? "").toLocaleLowerCase("uk-UA") ===
                eqLookup.toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? (list.length === 1 ? list[0] : null);
            if (!chosen && list.length > 1) {
              return {
                success: false as const,
                status: "ambiguous" as const,
                error: `Кілька одиниць техніки для «${eqLookup}». Уточни назву.`,
                candidates: list.map((r) => ({
                  id: String(r.id),
                  name: String(r.name ?? ""),
                })),
              };
            }
            if (chosen) {
              equipment = {
                id: String(chosen.id),
                name: String(chosen.name ?? "Техніка"),
                wialon_id:
                  chosen.wialon_id != null &&
                  Number.isFinite(Number(chosen.wialon_id))
                    ? Number(chosen.wialon_id)
                    : null,
              };
            }
          }

          if (!equipment) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: `Техніку «${eqLookup}» не знайдено в equipment.`,
            };
          }

          // ── Ємність ──────────────────────────────────────────────
          const stLookup = storageIdOrName.trim();
          let storage: {
            id: string;
            name: string;
            current_volume: number;
            capacity: number;
            price_per_liter: number;
          } | null = null;

          if (isUuid(stLookup)) {
            const { data } = await supabase
              .from("fuel_storages")
              .select("id, name, current_volume, capacity, price_per_liter")
              .eq("id", stLookup)
              .maybeSingle();
            if (data) {
              storage = {
                id: String(data.id),
                name: String(data.name ?? "Ємність"),
                current_volume: finiteNumber(data.current_volume),
                capacity: finiteNumber(data.capacity),
                price_per_liter: finiteNumber(data.price_per_liter),
              };
            }
          } else {
            const { data: rows } = await supabase
              .from("fuel_storages")
              .select("id, name, current_volume, capacity, price_per_liter")
              .ilike("name", `%${stLookup}%`)
              .order("name")
              .limit(8);
            const list = rows ?? [];
            const exact = list.find(
              (r) =>
                String(r.name ?? "").toLocaleLowerCase("uk-UA") ===
                stLookup.toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? (list.length === 1 ? list[0] : null);
            if (!chosen && list.length > 1) {
              return {
                success: false as const,
                status: "ambiguous" as const,
                error: `Кілька ємностей для «${stLookup}». Уточни назву.`,
                candidates: list.map((r) => ({
                  id: String(r.id),
                  name: String(r.name ?? ""),
                  currentVolume: finiteNumber(r.current_volume),
                })),
              };
            }
            if (chosen) {
              storage = {
                id: String(chosen.id),
                name: String(chosen.name ?? "Ємність"),
                current_volume: finiteNumber(chosen.current_volume),
                capacity: finiteNumber(chosen.capacity),
                price_per_liter: finiteNumber(chosen.price_per_liter),
              };
            }
          }

          if (!storage) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: `Ємність «${stLookup}» не знайдена в fuel_storages.`,
            };
          }

          const volumeBefore = roundLiters(storage.current_volume);
          const volumeAfter = roundLiters(volumeBefore - amount);
          const insufficient = volumeAfter < -0.001;
          const driverName = driverIdOrName?.trim() || null;
          const donorPrice = roundPrice(storage.price_per_liter);
          const totalCost = computeTotalCost(amount, donorPrice);

          if (insufficient) {
            return {
              success: false as const,
              status: "insufficient_fuel" as const,
              error: `Недостатньо пального в «${storage.name}»: є ${volumeBefore} л, потрібно ${amount} л.`,
              equipmentId: equipment.id,
              equipmentName: equipment.name,
              storageId: storage.id,
              storageName: storage.name,
              liters: amount,
              volumeBefore,
              volumeAfter: volumeBefore,
              shortageL: round2(amount - volumeBefore),
            };
          }

          if (!isConfirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              badge: "Заправка техніки",
              equipmentId: equipment.id,
              equipmentName: equipment.name,
              storageId: storage.id,
              storageName: storage.name,
              liters: amount,
              driverName,
              volumeBefore,
              volumeAfter,
              pricePerLiter: donorPrice,
              totalCost,
              fuelType: "ДП",
              confirmChoice,
              cancelChoice,
              canConfirm: true,
              userHint: `Заправити ${equipment.name} на ${amount} л з «${storage.name}»? Залишок: ${volumeBefore} → ${volumeAfter} л.`,
              clientEvent: "fuel-updated",
            };
          }

          // ── Підтверджено: списати + транзакція ───────────────────
          const { error: updateError } = await supabase
            .from("fuel_storages")
            .update({ current_volume: Math.max(0, volumeAfter) })
            .eq("id", storage.id);

          if (updateError) {
            return {
              success: false as const,
              status: "error" as const,
              error: `Не вдалося оновити ємність: ${updateError.message}`,
            };
          }

          const actor = await getCurrentActor();
          const insertPayload: Record<string, unknown> = {
            // У схемі: outbound = заправка / видача на техніку (не «dispense»)
            transaction_type: "outbound",
            from_storage_id: storage.id,
            to_storage_id: null,
            equipment_id: equipment.id,
            wialon_unit_id: equipment.wialon_id,
            amount_liters: amount,
            operator_name: driverName || actorName || null,
            transaction_date: new Date().toISOString(),
            wialon_verified: false,
            wialon_variance: 0,
            price_per_liter: donorPrice,
            total_cost: totalCost,
            sync_status: "pending_1c",
            ...actorCreateColumns(actor),
          };
          if (actorUserId) insertPayload.actor_id = actorUserId;
          if (actorName) insertPayload.actor_name = actorName;

          let { data: tx, error: txError } = await supabase
            .from("fuel_transactions")
            .insert(insertPayload)
            .select("id, transaction_type, amount_liters, from_storage_id, equipment_id")
            .maybeSingle();

          if (txError) {
            const retryPayload = { ...insertPayload };
            for (const col of [
              "equipment_id",
              "actor_id",
              "actor_name",
              "sync_status",
              "price_per_liter",
              "total_cost",
              "wialon_variance",
            ] as const) {
              if (
                txError.message?.includes(col) ||
                txError.code === "42703"
              ) {
                delete retryPayload[col];
              }
            }
            const retry = await supabase
              .from("fuel_transactions")
              .insert(retryPayload)
              .select(
                "id, transaction_type, amount_liters, from_storage_id, equipment_id"
              )
              .maybeSingle();
            tx = retry.data;
            txError = retry.error;
          }

          if (txError || !tx) {
            // rollback volume
            try {
              await supabase
                .from("fuel_storages")
                .update({ current_volume: volumeBefore })
                .eq("id", storage.id);
            } catch {
              /* best-effort */
            }
            return {
              success: false as const,
              status: "error" as const,
              error: txError?.message || "Не вдалося записати fuel_transactions",
              hint: "Не викликай logUnsupportedRequest — технічна помилка збереження.",
            };
          }

          const txId = String(tx.id);
          void enqueueFuelBasDraft({
            transactionId: txId,
            transactionType: "outbound",
            amountLiters: amount,
            pricePerLiter: donorPrice,
            totalCost,
            fromStorageId: storage.id,
            toStorageId: null,
          }).catch((e) =>
            console.error("[bas-drafts] agent fuel outbound", e)
          );

          void logActivity({
            actor,
            action: "create",
            entityType: "fuel_transaction",
            entityId: txId,
            summary: `Заправка ${equipment.name}: ${amount} л з «${storage.name}»`,
            meta: {
              equipmentId: equipment.id,
              storageId: storage.id,
              liters: amount,
              driverName,
            },
          }).catch(() => undefined);

          void attachDocumentsToEntity("fuel_transaction", txId);

          return {
            success: true as const,
            status: "refueled" as const,
            transactionId: txId,
            transactionType: "outbound",
            equipmentId: equipment.id,
            equipmentName: equipment.name,
            storageId: storage.id,
            storageName: storage.name,
            liters: amount,
            driverName,
            volumeBefore,
            volumeAfter: Math.max(0, volumeAfter),
            pricePerLiter: donorPrice,
            totalCost,
            fuelType: "ДП",
            clientEvent: "fuel-updated",
            message: `Заправив ${equipment.name} на ${amount} л з «${storage.name}». Залишок у ємності: ${Math.max(0, volumeAfter)} л.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: logFuelRefueling] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка заправки",
          };
        }
      },
    }),

    getFieldFuelEfficiency: tool({
      description:
        "Аналіз витрати пального на гектар по полю (л/га факт vs норма).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        workType: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Тип операції"),
      }),
      execute: async ({ fieldIdOrName, workType }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const typeFilter = workType?.trim() || "";
        console.log("[TOOL: getFieldFuelEfficiency]", { lookup, typeFilter });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const fieldKey = `farm:${field.id}`;
          const normalizedHint = typeFilter
            ? normalizeWorkOrderType(typeFilter) || typeFilter
            : null;

          let opsQuery = supabase
            .from("field_operations")
            .select(
              "id, client_key, work_type, status, area_fact, area_plan, fuel_fact, fuel_plan, occurred_at, machinery"
            )
            .eq("status", "completed")
            .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
            .order("occurred_at", { ascending: false })
            .limit(80);

          if (normalizedHint) {
            opsQuery = opsQuery.ilike("work_type", `%${normalizedHint}%`);
          } else if (typeFilter) {
            opsQuery = opsQuery.ilike("work_type", `%${typeFilter}%`);
          }

          const [opsRes, wialonRes] = await Promise.all([
            opsQuery,
            supabase
              .from("wialon_field_fuel_logs")
              .select("date, fuel_consumed, equipment_id, work_hours")
              .eq("field_id", field.id)
              .gt("fuel_consumed", 0)
              .order("date", { ascending: false })
              .limit(60),
          ]);

          if (opsRes.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати наряди: ${opsRes.error.message}`,
            };
          }

          const ops = opsRes.data ?? [];
          type OpEff = {
            id: string;
            workType: string;
            date: string | null;
            factAreaHa: number;
            fuelFactL: number;
            litersPerHa: number | null;
            normLPerHa: number;
            machinery: string | null;
            status: "ok" | "warning" | "alert" | "no_data";
          };

          const operations: OpEff[] = [];
          let totalFuelL = 0;
          let totalAreaHa = 0;

          for (const row of ops) {
            const factArea = finiteNumber(row.area_fact);
            const fuelFact = finiteNumber(row.fuel_fact);
            if (factArea <= 0 && fuelFact <= 0) continue;
            const wt = String(row.work_type ?? "Операція");
            const norm = fuelLitersPerHa(
              normalizeWorkOrderType(wt) || wt
            );
            const lph =
              factArea > 0 && fuelFact > 0
                ? round2(fuelFact / factArea)
                : null;
            let status: OpEff["status"] = "no_data";
            if (lph != null) {
              if (lph > norm * 1.5) status = "alert";
              else if (lph > norm * 1.25) status = "warning";
              else status = "ok";
            }
            if (fuelFact > 0) totalFuelL += fuelFact;
            if (factArea > 0) totalAreaHa += factArea;
            operations.push({
              id: String(row.client_key || row.id),
              workType: wt,
              date: row.occurred_at
                ? String(row.occurred_at).slice(0, 10)
                : null,
              factAreaHa: round2(factArea),
              fuelFactL: round2(fuelFact),
              litersPerHa: lph,
              normLPerHa: norm,
              machinery: row.machinery ? String(row.machinery) : null,
              status,
            });
          }

          const wialonFuelL = round2(
            (wialonRes.data ?? []).reduce(
              (sum, r) => sum + (finiteNumber(r.fuel_consumed) || 0),
              0
            )
          );
          const wialonAvailable =
            !wialonRes.error && (wialonRes.data?.length ?? 0) > 0;

          // Якщо в нарядах немає fuel_fact — спробуємо оцінити через Wialon + сумарну площу
          let source: "field_operations" | "wialon_field_fuel_logs" | "mixed" =
            "field_operations";
          if (totalFuelL <= 0 && wialonFuelL > 0) {
            totalFuelL = wialonFuelL;
            source = "wialon_field_fuel_logs";
            if (totalAreaHa <= 0) {
              totalAreaHa = finiteNumber(field.area_ha);
            }
          } else if (totalFuelL > 0 && wialonFuelL > 0) {
            source = "mixed";
          }

          totalFuelL = round2(totalFuelL);
          totalAreaHa = round2(totalAreaHa);
          const litersPerHa =
            totalAreaHa > 0 && totalFuelL > 0
              ? round2(totalFuelL / totalAreaHa)
              : null;

          const primaryWorkType =
            normalizedHint ||
            (operations.length === 1 ? operations[0].workType : null);
          const normLPerHa = primaryWorkType
            ? fuelLitersPerHa(
                normalizeWorkOrderType(primaryWorkType) || primaryWorkType
              )
            : operations.length > 0
              ? round2(
                  operations.reduce((s, o) => s + o.normLPerHa, 0) /
                    operations.length
                )
              : 5;

          let status: "ok" | "warning" | "alert" | "no_data" = "no_data";
          let deltaPct: number | null = null;
          if (litersPerHa != null && normLPerHa > 0) {
            deltaPct = round2(
              ((litersPerHa - normLPerHa) / normLPerHa) * 100
            );
            if (litersPerHa > normLPerHa * 1.5) status = "alert";
            else if (litersPerHa > normLPerHa * 1.25) status = "warning";
            else status = "ok";
          }

          if (operations.length === 0 && litersPerHa == null) {
            return {
              status: "ok" as const,
              fieldId: field.id,
              fieldName,
              workType: primaryWorkType,
              litersPerHa: null,
              totalFuelL: wialonFuelL || 0,
              totalAreaHa: finiteNumber(field.area_ha) || 0,
              normLPerHa,
              efficiencyStatus: "no_data" as const,
              source,
              wialonFuelL: wialonAvailable ? wialonFuelL : null,
              operations: [],
              message: `Немає даних витрати пального по полю «${fieldName}»${
                typeFilter ? ` для «${typeFilter}»` : ""
              }.`,
            };
          }

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            workType: primaryWorkType,
            litersPerHa,
            totalFuelL,
            totalAreaHa,
            normLPerHa,
            deltaPct,
            efficiencyStatus: status,
            warning:
              status === "alert"
                ? `Витрата аномально висока: ${litersPerHa} л/га при нормі ~${normLPerHa} л/га (+${deltaPct}%).`
                : status === "warning"
                  ? `Витрата вища за норму: ${litersPerHa} л/га vs ~${normLPerHa} л/га (+${deltaPct}%).`
                  : null,
            source,
            wialonFuelL: wialonAvailable ? wialonFuelL : null,
            operationsCount: operations.length,
            operations,
            normsReference: FUEL_L_PER_HA,
            message:
              litersPerHa != null
                ? `На «${fieldName}»: ${litersPerHa} л/га (норма ~${normLPerHa}).`
                : `На «${fieldName}» є операції, але бракує пари fuel_fact + area_fact.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldFuelEfficiency] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка аналізу л/га",
          };
        }
      },
    }),

    getEquipmentMaintenanceStatus: tool({
      description:
        "Контроль ТО та напрацювання техніки (мотогодини, залишок до сервісу).",
      inputSchema: z.object({
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Техніка ID/назва"),
      }),
      execute: async ({ equipmentIdOrName }) => {
        const lookup = equipmentIdOrName?.trim() || "";
        console.log("[TOOL: getEquipmentMaintenanceStatus]", { lookup });

        const SERVICE_DUE_HOURS = 25;
        const selectCols =
          "id, name, type, code, wialon_id, current_motohours, next_service_motohours, maintenance_status, is_active";

        type EqRow = {
          id: string;
          name: string | null;
          type: string | null;
          code: string | null;
          wialon_id: number | null;
          current_motohours: number | null;
          next_service_motohours: number | null;
          maintenance_status: string | null;
          is_active: boolean | null;
        };

        try {
          let rows: EqRow[] = [];

          if (lookup) {
            const resolved = await resolveAgentEquipmentByLookup(
              supabase,
              lookup,
              selectCols
            );
            if (!resolved.ok) {
              return {
                status: resolved.status,
                error: resolved.error,
                candidates: resolved.candidates,
                countDue: 0,
                machines: [],
              };
            }
            rows = [
              {
                id: resolved.equipment.id,
                name: resolved.equipment.name,
                type: resolved.equipment.type,
                code: resolved.equipment.code,
                wialon_id: resolved.equipment.wialon_id,
                current_motohours: resolved.equipment.current_motohours,
                next_service_motohours:
                  resolved.equipment.next_service_motohours,
                maintenance_status: resolved.equipment.maintenance_status,
                is_active: resolved.equipment.is_active,
              },
            ];
          } else {
            const { data, error } = await supabase
              .from("equipment")
              .select(selectCols)
              .neq("is_active", false)
              .order("name")
              .limit(120);

            if (error) {
              if (
                error.message?.includes("current_motohours") ||
                error.message?.includes("maintenance_status") ||
                error.code === "42703"
              ) {
                return {
                  status: "error" as const,
                  error:
                    "Колонки ТО відсутні. Виконай міграцію 070_equipment_maintenance.sql.",
                  countDue: 0,
                  machines: [],
                };
              }
              return {
                status: "error" as const,
                error: error.message,
                countDue: 0,
                machines: [],
              };
            }
            rows = (data ?? []) as EqRow[];
          }

          // Wialon: оновити current_motohours з live engineHours
          let wialonById = new Map<number, number>();
          try {
            const live = await getCachedWialonUnitsFull();
            for (const unit of live.units ?? []) {
              const telemetry = parseWialonUnitTelemetry(unit);
              const uid = Number(unit.id);
              if (
                Number.isFinite(uid) &&
                telemetry.engineHours != null &&
                Number.isFinite(telemetry.engineHours) &&
                telemetry.engineHours >= 0
              ) {
                wialonById.set(uid, round2(telemetry.engineHours));
              }
            }
          } catch (err) {
            console.warn(
              "[TOOL: getEquipmentMaintenanceStatus] Wialon skip:",
              err instanceof Error ? err.message : err
            );
          }

          const machines: Array<{
            id: string;
            name: string;
            type: string | null;
            code: string | null;
            currentHours: number | null;
            nextServiceHours: number | null;
            hoursLeft: number | null;
            isOverdue: boolean;
            status: "ok" | "service_due";
            wialonSynced: boolean;
          }> = [];

          for (const row of rows) {
            const wialonId =
              row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
                ? Number(row.wialon_id)
                : null;
            let current =
              row.current_motohours != null
                ? finiteNumber(row.current_motohours)
                : null;
            let wialonSynced = false;
            if (wialonId != null && wialonById.has(wialonId)) {
              const liveHours = wialonById.get(wialonId)!;
              current = liveHours;
              wialonSynced = true;
              // Persist best-effort (не блокуємо відповідь)
              void supabase
                .from("equipment")
                .update({
                  current_motohours: liveHours,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", row.id)
                .then(({ error: upErr }) => {
                  if (upErr) {
                    console.warn(
                      "[TOOL: getEquipmentMaintenanceStatus] persist mh:",
                      upErr.message
                    );
                  }
                });
            }

            const next =
              row.next_service_motohours != null
                ? finiteNumber(row.next_service_motohours)
                : null;
            const hoursLeft =
              current != null && next != null ? round2(next - current) : null;
            const isOverdue = hoursLeft != null && hoursLeft < 0;
            const serviceDue =
              hoursLeft != null && hoursLeft <= SERVICE_DUE_HOURS;
            const status: "ok" | "service_due" = serviceDue
              ? "service_due"
              : "ok";

            if (status === "service_due" && row.maintenance_status !== "service_due") {
              void supabase
                .from("equipment")
                .update({ maintenance_status: "service_due" })
                .eq("id", row.id);
            } else if (
              status === "ok" &&
              row.maintenance_status === "service_due" &&
              hoursLeft != null &&
              hoursLeft > SERVICE_DUE_HOURS
            ) {
              void supabase
                .from("equipment")
                .update({ maintenance_status: "ok" })
                .eq("id", row.id);
            }

            machines.push({
              id: String(row.id),
              name: String(row.name ?? "Техніка"),
              type: row.type ? String(row.type) : null,
              code: row.code ? String(row.code) : null,
              currentHours: current != null ? round2(current) : null,
              nextServiceHours: next != null ? round2(next) : null,
              hoursLeft,
              isOverdue,
              status,
              wialonSynced,
            });
          }

          // Без фільтра lookup — показати лише ті, що потребують ТО (або всі з даними next)
          let listed = machines;
          if (!lookup) {
            listed = machines.filter((m) => m.status === "service_due");
            // Якщо ніхто не due, але є машини з next_service — покажемо топ близьких
            if (listed.length === 0) {
              listed = machines
                .filter((m) => m.hoursLeft != null)
                .sort(
                  (a, b) => (a.hoursLeft ?? 9999) - (b.hoursLeft ?? 9999)
                )
                .slice(0, 15);
            }
          }

          const countDue = machines.filter((m) => m.status === "service_due")
            .length;

          return {
            status: "ok" as const,
            countDue,
            serviceDueThresholdHours: SERVICE_DUE_HOURS,
            machines: listed.map((m) => ({
              name: m.name,
              id: m.id,
              type: m.type,
              code: m.code,
              currentHours: m.currentHours,
              nextServiceHours: m.nextServiceHours,
              hoursLeft: m.hoursLeft,
              isOverdue: m.isOverdue,
              status: m.status,
              wialonSynced: m.wialonSynced,
            })),
            message:
              countDue > 0
                ? `${countDue} од. техніки потребують ТО (≤ ${SERVICE_DUE_HOURS} мотогодин або прострочено).`
                : lookup
                  ? `По «${lookup}»: ТО не термінове.`
                  : "Немає техніки з критичним залишком до ТО.",
          };
        } catch (error) {
          console.error(
            "[TOOL: getEquipmentMaintenanceStatus] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка статусу ТО",
            countDue: 0,
            machines: [],
          };
        }
      },
    }),

    linkServiceActToEquipment: tool({
      description:
        "Привʼязує акт послуг/ремонту (accounting_acts) до техніки.",
      inputSchema: z.object({
        actId: z
          .string()
          .trim()
          .min(1)
          .describe("UUID акта або latest"),
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Техніка ID/назва"),
      }),
      execute: async ({ actId: actIdRaw, equipmentIdOrName }) => {
        const actHint = actIdRaw.trim();
        console.log("[TOOL: linkServiceActToEquipment]", {
          actHint,
          equipmentIdOrName,
        });

        try {
          const resolvedEq = await resolveAgentEquipmentByLookup(
            supabase,
            equipmentIdOrName
          );
          if (!resolvedEq.ok) {
            return {
              success: false as const,
              status: resolvedEq.status,
              error: resolvedEq.error,
              candidates: resolvedEq.candidates,
            };
          }
          const equipment = resolvedEq.equipment;
          const seasonId = normalizeSeason(DEFAULT_SEASON);
          const seasonYear = Number(seasonId) || new Date().getFullYear();

          type ActLinkRow = {
            id: string;
            act_number: string | null;
            act_date: string | null;
            contractor_name: string | null;
            total_amount: number | null;
            category: string | null;
            equipment_id: string | null;
            status: string | null;
          };

          let act: ActLinkRow | null = null;

          const lowerHint = actHint.toLocaleLowerCase("uk-UA");
          const isLatest =
            lowerHint === "останній" ||
            lowerHint === "останній акт" ||
            lowerHint === "latest" ||
            lowerHint === "last";

          if (isLatest || !isUuid(actHint)) {
            if (!isLatest && !isUuid(actHint)) {
              // спроба як номер акта
              const { data: byNumber } = await supabase
                .from("accounting_acts")
                .select(
                  "id, act_number, act_date, contractor_name, total_amount, category, equipment_id, status"
                )
                .neq("status", "cancelled")
                .ilike("act_number", `%${actHint}%`)
                .order("act_date", { ascending: false })
                .limit(5);
              const list = (byNumber ?? []) as unknown as ActLinkRow[];
              if (list.length === 1) {
                act = list[0];
              } else if (list.length > 1) {
                return {
                  success: false as const,
                  status: "ambiguous" as const,
                  error: `Кілька актів для «${actHint}». Передай точний actId.`,
                  candidates: list.map((a) => ({
                    id: String(a.id),
                    actNumber: a.act_number,
                    date: a.act_date,
                    amount: finiteNumber(a.total_amount),
                  })),
                };
              }
            }
            if (!act) {
              const { data: latest } = await supabase
                .from("accounting_acts")
                .select(
                  "id, act_number, act_date, contractor_name, total_amount, category, equipment_id, status"
                )
                .neq("status", "cancelled")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (latest) act = latest as unknown as ActLinkRow;
            }
          } else {
            const { data } = await supabase
              .from("accounting_acts")
              .select(
                "id, act_number, act_date, contractor_name, total_amount, category, equipment_id, status"
              )
              .eq("id", actHint)
              .maybeSingle();
            if (data) act = data as unknown as ActLinkRow;
          }

          if (!act) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: `Акт «${actHint}» не знайдено в accounting_acts.`,
            };
          }

          if (String(act.status ?? "") === "cancelled") {
            return {
              success: false as const,
              status: "error" as const,
              error: "Не можна привʼязати скасований акт.",
              actId: String(act.id),
            };
          }

          const { error: updError } = await supabase
            .from("accounting_acts")
            .update({
              equipment_id: equipment.id,
              equipment_name_hint: equipment.name,
            })
            .eq("id", act.id);

          if (updError) {
            return {
              success: false as const,
              status: "error" as const,
              error: updError.message,
            };
          }

          const amount = finiteNumber(act.total_amount);
          // Синхронізуємо / створюємо рядок у equipment_expenses
          const { data: existingExp } = await supabase
            .from("equipment_expenses")
            .select("id")
            .eq("accounting_act_id", act.id)
            .maybeSingle();

          if (existingExp?.id) {
            await supabase
              .from("equipment_expenses")
              .update({
                equipment_id: equipment.id,
                amount_uah: amount,
                expense_date: act.act_date,
                category: act.category,
              })
              .eq("id", existingExp.id);
          } else if (amount > 0) {
            await supabase.from("equipment_expenses").insert({
              equipment_id: equipment.id,
              amount_uah: amount,
              expense_date: act.act_date,
              category: act.category,
              description: [
                act.contractor_name,
                act.act_number ? `акт №${act.act_number}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
              accounting_act_id: act.id,
              source: "levadius",
            });
          }

          const seasonStart = `${seasonYear}-01-01`;
          const seasonEnd = `${seasonYear}-12-31`;
          const { data: seasonActs } = await supabase
            .from("accounting_acts")
            .select("total_amount")
            .eq("equipment_id", equipment.id)
            .neq("status", "cancelled")
            .gte("act_date", seasonStart)
            .lte("act_date", seasonEnd);

          const seasonRepairCostUah = round2(
            (seasonActs ?? []).reduce(
              (sum, row) => sum + (finiteNumber(row.total_amount) || 0),
              0
            )
          );

          return {
            success: true as const,
            status: "linked" as const,
            actId: String(act.id),
            actNumber: act.act_number ? String(act.act_number) : null,
            actDate: act.act_date ? String(act.act_date) : null,
            actAmountUah: amount,
            equipmentId: equipment.id,
            equipmentName: equipment.name,
            season: seasonId,
            seasonRepairCostUah,
            clientEvent: "accounting-updated",
            message: `Акт${
              act.act_number ? ` №${act.act_number}` : ""
            } привʼязано до «${equipment.name}». Витрати на машину за сезон ${seasonId}: ${seasonRepairCostUah.toLocaleString("uk-UA")} ₴.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: linkServiceActToEquipment] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка привʼязки акта",
          };
        }
      },
    }),

    logMaintenanceCompleted: tool({
      description:
        "Фіксує проходження ТО: оновлює next_service_motohours і пише журнал.",
      inputSchema: z.object({
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Техніка ID/назва"),
        serviceType: z
          .string()
          .trim()
          .min(1)
          .describe("Тип ТО/сервісу"),
        serviceIntervalHours: z
          .number()
          .positive()
          .optional()
          .default(250)
          .describe("Інтервал мотогодин"),
        confirmed: z
          .boolean()
          .optional()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        equipmentIdOrName,
        serviceType,
        serviceIntervalHours = 250,
        confirmed,
      }) => {
        const isConfirmed = confirmed === true;
        const interval = round2(Number(serviceIntervalHours) || 250);
        const confirmChoice = "Підтвердити ТО";
        const cancelChoice = "Скасувати";

        console.log("[TOOL: logMaintenanceCompleted]", {
          equipmentIdOrName,
          serviceType,
          interval,
          isConfirmed,
        });

        try {
          const resolved = await resolveAgentEquipmentByLookup(
            supabase,
            equipmentIdOrName
          );
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }
          const equipment = resolved.equipment;

          // Підтягнути live мотогодини з Wialon якщо є
          let currentHours =
            equipment.current_motohours != null
              ? finiteNumber(equipment.current_motohours)
              : 0;
          let wialonSynced = false;
          if (equipment.wialon_id != null) {
            try {
              const live = await getCachedWialonUnitsFull();
              const unit = (live.units ?? []).find(
                (u) => Number(u.id) === equipment.wialon_id
              );
              if (unit) {
                const telemetry = parseWialonUnitTelemetry(unit);
                if (
                  telemetry.engineHours != null &&
                  Number.isFinite(telemetry.engineHours)
                ) {
                  currentHours = round2(telemetry.engineHours);
                  wialonSynced = true;
                }
              }
            } catch {
              /* optional */
            }
          }

          const nextServiceHours = round2(currentHours + interval);
          const serviceLabel = serviceType.trim();

          if (!isConfirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              badge: "Фіксація ТО",
              equipmentId: equipment.id,
              equipmentName: equipment.name,
              serviceType: serviceLabel,
              serviceIntervalHours: interval,
              currentHours: round2(currentHours),
              nextServiceHours,
              wialonSynced,
              confirmChoice,
              cancelChoice,
              canConfirm: true,
              userHint: `Зафіксувати «${serviceLabel}» на «${equipment.name}»? Зараз ${round2(currentHours)} м/г → наступне ТО на ${nextServiceHours} м/г.`,
            };
          }

          const { error: updError } = await supabase
            .from("equipment")
            .update({
              current_motohours: round2(currentHours),
              next_service_motohours: nextServiceHours,
              maintenance_status: "ok",
              updated_at: new Date().toISOString(),
            })
            .eq("id", equipment.id);

          if (updError) {
            if (
              updError.message?.includes("current_motohours") ||
              updError.message?.includes("maintenance_status") ||
              updError.code === "42703"
            ) {
              return {
                success: false as const,
                status: "error" as const,
                error:
                  "Колонки ТО відсутні. Виконай міграцію 070_equipment_maintenance.sql.",
              };
            }
            return {
              success: false as const,
              status: "error" as const,
              error: updError.message,
            };
          }

          const actor = await getCurrentActor();
          const { data: logRow, error: logError } = await supabase
            .from("equipment_maintenance_logs")
            .insert({
              equipment_id: equipment.id,
              service_type: serviceLabel,
              service_interval_hours: interval,
              motohours_at_service: round2(currentHours),
              next_service_motohours: nextServiceHours,
              actor_id: actor.id || actorUserId || null,
              actor_name: actor.label || actorName || null,
            })
            .select("id")
            .maybeSingle();

          if (logError) {
            if (
              logError.message?.includes("equipment_maintenance_logs") ||
              logError.code === "42P01" ||
              logError.code === "PGRST205"
            ) {
              return {
                success: true as const,
                status: "completed" as const,
                equipmentId: equipment.id,
                equipmentName: equipment.name,
                serviceType: serviceLabel,
                currentHours: round2(currentHours),
                nextServiceHours,
                logId: null,
                warning:
                  "ТО оновлено на техніці, але журнал відсутній (міграція 070).",
                clientEvent: "equipment-updated",
                message: `ТО «${serviceLabel}» на «${equipment.name}» зафіксовано. Наступне: ${nextServiceHours} м/г.`,
              };
            }
            return {
              success: false as const,
              status: "error" as const,
              error: logError.message,
            };
          }

          void logActivity({
            actor,
            action: "update",
            entityType: "equipment",
            entityId: equipment.id,
            summary: `ТО «${serviceLabel}» на «${equipment.name}» → next ${nextServiceHours} м/г`,
            meta: {
              serviceType: serviceLabel,
              interval,
              currentHours,
              nextServiceHours,
            },
          }).catch(() => undefined);

          return {
            success: true as const,
            status: "completed" as const,
            equipmentId: equipment.id,
            equipmentName: equipment.name,
            serviceType: serviceLabel,
            serviceIntervalHours: interval,
            currentHours: round2(currentHours),
            nextServiceHours,
            maintenanceStatus: "ok",
            logId: logRow?.id ? String(logRow.id) : null,
            wialonSynced,
            clientEvent: "equipment-updated",
            message: `ТО «${serviceLabel}» на «${equipment.name}» зафіксовано. Зараз ${round2(currentHours)} м/г, наступне ТО на ${nextServiceHours} м/г.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: logMaintenanceCompleted] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка фіксації ТО",
          };
        }
      },
    }),

    getFieldCostAnalysis: tool({
      description: "Рахує собівартість поля за сезон.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        season: z
          .number()
          .int()
          .default(2026)
          .describe("Сезон (рік)"),
      }),
      execute: async ({ fieldIdOrName, season }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const seasonId = normalizeSeason(season ?? 2026);
        console.log("[TOOL: getFieldCostAnalysis]", { lookup, seasonId });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const economics = await fetchLiveFieldEconomics(field.id, seasonId);

          const fuelUah = economics.fuelCostUah;
          const materialsUah = round2(
            economics.categoriesBreakdown.zzr.costUah +
              economics.categoriesBreakdown.fertilizer.costUah +
              economics.categoriesBreakdown.seed.costUah
          );
          const laborUah = economics.totalSalaryUah;
          const totalUah = economics.totalSpentUah;
          const areaHa = economics.areaHa || finiteNumber(field.area_ha);
          const costPerHa =
            areaHa > 0 ? round2(totalUah / areaHa) : null;

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            season: seasonId,
            areaHa,
            totalSpentUah: totalUah,
            costPerHaUah: costPerHa,
            breakdown: {
              fuelUah,
              materialsUah,
              laborUah,
              materials: {
                zzr: economics.categoriesBreakdown.zzr.costUah,
                fertilizer: economics.categoriesBreakdown.fertilizer.costUah,
                seed: economics.categoriesBreakdown.seed.costUah,
              },
            },
            budget: {
              plannedPerHa: economics.plannedBudgetPerHa,
              usedPercent: economics.budgetUsedPercentage,
            },
            unpricedMaterials: (economics.unpricedMaterials ?? []).map(
              (item) => ({
                name: item.name,
                quantity: item.totalQty,
                unit: item.unit,
                category: item.category,
                basRefKey: item.basRefKey,
              })
            ),
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldCostAnalysis] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка собівартості",
          };
        }
      },
    }),

    updateInventoryItemPrice: tool({
      description:
        "Встановлює/оновлює ціну матеріалу в inventory_items_cache (planned_price_uah).",
      inputSchema: z.object({
        itemIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("ТМЦ ID/назва"),
        pricePerUnit: z
          .number()
          .positive()
          .describe("Ціна ₴/од."),
      }),
      execute: async ({ itemIdOrName, pricePerUnit }) => {
        const lookup = itemIdOrName.trim();
        const price = round2(Number(pricePerUnit));
        console.log("[TOOL: updateInventoryItemPrice]", { lookup, price });

        try {
          if (!Number.isFinite(price) || price <= 0) {
            return {
              success: false as const,
              status: "error" as const,
              error: "Ціна має бути більше 0.",
            };
          }

          type CacheItem = {
            bas_ref_key: string;
            name: string;
            custom_name: string | null;
            unit: string | null;
            category: string | null;
            planned_price_uah: number | null;
            unit_cost: number | null;
          };

          let item: CacheItem | null = null;

          const selectCols =
            "bas_ref_key, name, custom_name, unit, category, planned_price_uah, unit_cost";

          if (isUuid(lookup) || lookup.length >= 20) {
            const { data } = await supabase
              .from("inventory_items_cache")
              .select(selectCols)
              .eq("bas_ref_key", lookup.toLowerCase())
              .maybeSingle();
            if (data) item = data as unknown as CacheItem;
          }

          if (!item) {
            const { data: rows } = await supabase
              .from("inventory_items_cache")
              .select(selectCols)
              .or(
                `name.ilike.%${lookup}%,custom_name.ilike.%${lookup}%`
              )
              .order("name")
              .limit(10);
            const list = (rows ?? []) as unknown as CacheItem[];
            const needle = lookup.toLocaleLowerCase("uk-UA");
            const exact = list.find((r) => {
              const name = String(r.name ?? "").toLocaleLowerCase("uk-UA");
              const custom = String(r.custom_name ?? "").toLocaleLowerCase(
                "uk-UA"
              );
              return name === needle || custom === needle;
            });
            const chosen = exact ?? (list.length === 1 ? list[0] : null);
            if (!chosen && list.length > 1) {
              return {
                success: false as const,
                status: "ambiguous" as const,
                error: `Кілька позицій для «${lookup}». Уточни назву.`,
                candidates: list.map((r) => ({
                  id: String(r.bas_ref_key),
                  name:
                    (r.custom_name && String(r.custom_name).trim()) ||
                    String(r.name ?? ""),
                  unit: r.unit ? String(r.unit) : null,
                  currentPrice:
                    finiteNumber(r.planned_price_uah) ||
                    finiteNumber(r.unit_cost) ||
                    null,
                })),
              };
            }
            if (chosen) item = chosen;
          }

          if (!item) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: `Матеріал «${lookup}» не знайдено в inventory_items_cache.`,
            };
          }

          const basRefKey = String(item.bas_ref_key).toLowerCase();
          const itemName =
            (item.custom_name && String(item.custom_name).trim()) ||
            String(item.name ?? "ТМЦ");
          const oldPrice =
            finiteNumber(item.planned_price_uah) ||
            finiteNumber(item.unit_cost) ||
            0;
          const unit = item.unit ? String(item.unit) : "од.";
          const seasonId = normalizeSeason(DEFAULT_SEASON);

          const { error: updError } = await supabase
            .from("inventory_items_cache")
            .update({
              planned_price_uah: price,
              updated_at: new Date().toISOString(),
            })
            .eq("bas_ref_key", basRefKey);

          if (updError) {
            if (updError.message?.includes("planned_price_uah")) {
              return {
                success: false as const,
                status: "error" as const,
                error:
                  "Колонка planned_price_uah відсутня. Потрібна міграція 016.",
              };
            }
            return {
              success: false as const,
              status: "error" as const,
              error: updError.message,
            };
          }

          // Історичні списання без ціни на поля за сезон → поля, де перерахується собівартість
          // (ціна береться з кешу; field_operation_materials окремої ціни не має)
          const { data: moves } = await supabase
            .from("inventory_local_moves")
            .select("id, field_id, qty, season, type")
            .eq("item_ref_key", basRefKey)
            .eq("season", seasonId)
            .not("field_id", "is", null)
            .limit(500);

          const fieldIds = [
            ...new Set(
              (moves ?? [])
                .map((m) => (m.field_id ? String(m.field_id) : ""))
                .filter(Boolean)
            ),
          ];

          // Матеріали в нарядах цього сезону (для звіту впливу)
          const { data: matRows } = await supabase
            .from("field_operation_materials")
            .select("operation_client_key, qty, item_name")
            .eq("inventory_bas_ref_key", basRefKey)
            .limit(500);

          const materialsTouched = (matRows ?? []).length;
          const movesTouched = (moves ?? []).length;
          const estimatedCostDeltaUah = round2(
            (moves ?? []).reduce((sum, m) => {
              const qty = finiteNumber(m.qty);
              // раніше без ціни → тепер qty * price
              return sum + qty * price;
            }, 0)
          );

          return {
            success: true as const,
            status: "updated" as const,
            itemId: basRefKey,
            itemName,
            unit,
            oldPrice: oldPrice > 0 ? round2(oldPrice) : null,
            newPrice: price,
            season: seasonId,
            updatedMoves: movesTouched,
            materialsLinked: materialsTouched,
            fieldsAffected: fieldIds,
            estimatedSeasonCostUah: estimatedCostDeltaUah,
            clientEvents: ["warehouse-updated", "field-updated"],
            message: `Ціну «${itemName}» оновлено: ${price.toLocaleString("uk-UA")} ₴/${unit}.${
              movesTouched > 0
                ? ` Собівартість ${fieldIds.length} пол${
                    fieldIds.length === 1 ? "я" : "ів"
                  } за сезон ${seasonId} перерахується.`
                : ""
            }`,
          };
        } catch (error) {
          console.error(
            "[TOOL: updateInventoryItemPrice] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка оновлення ціни",
          };
        }
      },
    }),

    calculateDriverEarnings: tool({
      description:
        "Зведення виробітку та нарахованої ЗП механізаторів за період.",
      inputSchema: z.object({
        driverIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Водій ID/ПІБ"),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата від YYYY-MM-DD"),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата до YYYY-MM-DD"),
      }),
      execute: async ({ driverIdOrName, startDate, endDate }) => {
        const today = todayKyivYmd();
        // За замовчуванням — поточний тиждень (пн–сьогодні, Europe/Kyiv)
        let start = startDate?.trim() || "";
        let end = endDate?.trim() || "";
        if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
          const r = resolveWorkOrderDateInput(start);
          if ("error" in r) {
            return { status: "error" as const, error: r.error };
          }
          start = r.date;
        }
        if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
          const r = resolveWorkOrderDateInput(end);
          if ("error" in r) {
            return { status: "error" as const, error: r.error };
          }
          end = r.date;
        }
        if (!start || !end) {
          const [y, m, d] = today.split("-").map(Number);
          const probe = new Date(Date.UTC(y!, m! - 1, d!, 12));
          const wdName = new Intl.DateTimeFormat("en-US", {
            timeZone: "Europe/Kyiv",
            weekday: "short",
          }).format(probe);
          const mon0 = [
            "Mon",
            "Tue",
            "Wed",
            "Thu",
            "Fri",
            "Sat",
            "Sun",
          ].indexOf(wdName);
          const offset = mon0 >= 0 ? mon0 : 0;
          if (!start) start = shiftKyivYmd(today, -offset);
          if (!end) end = today;
        }

        const driverLookup = driverIdOrName?.trim() || "";
        console.log("[TOOL: calculateDriverEarnings]", {
          driverLookup,
          start,
          end,
        });

        try {
          const [{ data: rateRows }, opsQuery] = await Promise.all([
            supabase
              .from("work_type_wage_rates")
              .select("work_type, rate_uah_per_ha"),
            (() => {
              let q = supabase
                .from("field_operations")
                .select(
                  `
                  id, client_key, work_type, status, mechanic_name,
                  area_fact, area_plan, wage_fact, wage_plan, wage_rate_uah_per_ha,
                  occurred_at, field_id, field_key
                `
                )
                .eq("status", "completed")
                .gte("occurred_at", start)
                .lte("occurred_at", `${end}T23:59:59.999Z`)
                .order("occurred_at", { ascending: false })
                .limit(2000);
              if (driverLookup) {
                q = q.ilike("mechanic_name", `%${driverLookup}%`);
              }
              return q;
            })(),
          ]);

          if (opsQuery.error) {
            return {
              status: "error" as const,
              error: opsQuery.error.message,
            };
          }

          const rateByType = new Map<string, number>();
          for (const row of rateRows ?? []) {
            const key = normalizeWorkTypeKey(String(row.work_type ?? ""));
            if (!key) continue;
            const rate = Number(row.rate_uah_per_ha);
            if (Number.isFinite(rate) && rate > 0) rateByType.set(key, rate);
          }

          type DriverAgg = {
            driverName: string;
            totalAreaHa: number;
            shiftsCount: number;
            earnedUah: number;
            operations: Array<{
              id: string;
              date: string | null;
              workType: string;
              areaHa: number;
              ratePerHa: number;
              earnedUah: number;
              rateSource: "wage_fact" | "op_rate" | "catalog" | "default";
            }>;
          };

          const byDriver = new Map<string, DriverAgg>();
          let missingRateOps = 0;

          for (const row of opsQuery.data ?? []) {
            const name = String(row.mechanic_name ?? "").trim() || "Без ПІБ";
            if (
              driverLookup &&
              !name
                .toLocaleLowerCase("uk-UA")
                .includes(driverLookup.toLocaleLowerCase("uk-UA"))
            ) {
              continue;
            }

            const workType = String(row.work_type ?? "Операція");
            const areaHa =
              finiteNumber(row.area_fact) || finiteNumber(row.area_plan) || 0;
            const wageFact = finiteNumber(row.wage_fact);
            const wagePlan = finiteNumber(row.wage_plan);
            const opRate = finiteNumber(row.wage_rate_uah_per_ha);
            const catalogKey = normalizeWorkTypeKey(workType);
            const catalogRate = rateByType.get(catalogKey) ?? 0;

            let earned = 0;
            let ratePerHa = 0;
            let rateSource: DriverAgg["operations"][number]["rateSource"] =
              "default";

            if (wageFact > 0) {
              earned = wageFact;
              ratePerHa = areaHa > 0 ? round2(wageFact / areaHa) : 0;
              rateSource = "wage_fact";
            } else if (opRate > 0 && areaHa > 0) {
              ratePerHa = opRate;
              earned = estimateWageFromRate(opRate, areaHa);
              rateSource = "op_rate";
            } else if (catalogRate > 0 && areaHa > 0) {
              ratePerHa = catalogRate;
              earned = estimateWageFromRate(catalogRate, areaHa);
              rateSource = "catalog";
            } else if (wagePlan > 0) {
              earned = wagePlan;
              ratePerHa = areaHa > 0 ? round2(wagePlan / areaHa) : 0;
              rateSource = "default";
            } else if (areaHa > 0) {
              ratePerHa = defaultWageRateUahPerHa(workType);
              earned = estimateWageFromRate(ratePerHa, areaHa);
              rateSource = "default";
              missingRateOps += 1;
            }

            const key = name.toLocaleLowerCase("uk-UA");
            const agg = byDriver.get(key) ?? {
              driverName: name,
              totalAreaHa: 0,
              shiftsCount: 0,
              earnedUah: 0,
              operations: [],
            };
            agg.totalAreaHa = round2(agg.totalAreaHa + areaHa);
            agg.shiftsCount += 1;
            agg.earnedUah = round2(agg.earnedUah + earned);
            agg.operations.push({
              id: String(row.client_key || row.id),
              date: row.occurred_at
                ? String(row.occurred_at).slice(0, 10)
                : null,
              workType,
              areaHa: round2(areaHa),
              ratePerHa: round2(ratePerHa),
              earnedUah: round2(earned),
              rateSource,
            });
            byDriver.set(key, agg);
          }

          const drivers = [...byDriver.values()].sort(
            (a, b) => b.earnedUah - a.earnedUah
          );

          if (driverLookup && drivers.length === 0) {
            return {
              status: "not_found" as const,
              error: `Немає закритих нарядів для «${driverLookup}» за ${start}…${end}.`,
              startDate: start,
              endDate: end,
              drivers: [],
            };
          }

          const totalEarnedUah = round2(
            drivers.reduce((s, d) => s + d.earnedUah, 0)
          );
          const totalAreaHa = round2(
            drivers.reduce((s, d) => s + d.totalAreaHa, 0)
          );
          const totalShifts = drivers.reduce((s, d) => s + d.shiftsCount, 0);

          return {
            status: "ok" as const,
            startDate: start,
            endDate: end,
            driverFilter: driverLookup || null,
            driversCount: drivers.length,
            totalAreaHa,
            totalShifts,
            totalEarnedUah,
            missingRateOps,
            drivers: drivers.map((d) => ({
              driverName: d.driverName,
              totalAreaHa: d.totalAreaHa,
              shiftsCount: d.shiftsCount,
              earnedUah: d.earnedUah,
              operations: d.operations.slice(0, 20),
            })),
            message:
              drivers.length === 0
                ? `За ${start}…${end} немає закритих нарядів.`
                : `Нараховано ${totalEarnedUah.toLocaleString("uk-UA")} ₴ за ${totalAreaHa} га (${totalShifts} змін, ${drivers.length} мех.).`,
          };
        } catch (error) {
          console.error(
            "[TOOL: calculateDriverEarnings] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка нарахувань",
          };
        }
      },
    }),

    getFieldBudgetBurnRate: tool({
      description:
        "План vs факт витрат поля: burn rate бюджету (ТМЦ + паливо + ЗП).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const seasonId = normalizeSeason(DEFAULT_SEASON);
        console.log("[TOOL: getFieldBudgetBurnRate]", { lookup, seasonId });

        try {
          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season, planned_budget_per_ha"
          );
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const economics = await fetchLiveFieldEconomics(field.id, seasonId);

          const areaHa =
            economics.areaHa || finiteNumber(field.area_ha) || 0;
          const plannedPerHa =
            economics.plannedBudgetPerHa ??
            (field.planned_budget_per_ha != null
              ? finiteNumber(field.planned_budget_per_ha)
              : null);
          const totalPlannedBudget =
            plannedPerHa != null && plannedPerHa > 0 && areaHa > 0
              ? round2(areaHa * plannedPerHa)
              : economics.totalPlannedBudget;

          const materialsUah = round2(
            economics.categoriesBreakdown.zzr.costUah +
              economics.categoriesBreakdown.fertilizer.costUah +
              economics.categoriesBreakdown.seed.costUah
          );
          const fuelUah = economics.fuelCostUah;
          const salaryUah = economics.totalSalaryUah;
          const actualTotal = economics.totalSpentUah;

          const burnPercent =
            totalPlannedBudget != null && totalPlannedBudget > 0
              ? round2((actualTotal / totalPlannedBudget) * 100)
              : null;

          let burnStatus: "ok" | "near_limit" | "over_budget" | "no_plan" =
            "no_plan";
          let burnStatusLabel = "Бюджет не заданий";
          if (burnPercent != null) {
            if (burnPercent > 100) {
              burnStatus = "over_budget";
              burnStatusLabel = "Перевитрата";
            } else if (burnPercent >= 85) {
              burnStatus = "near_limit";
              burnStatusLabel = "На межі";
            } else {
              burnStatus = "ok";
              burnStatusLabel = "В нормі";
            }
          }

          const remainingUah =
            totalPlannedBudget != null
              ? round2(totalPlannedBudget - actualTotal)
              : null;

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            season: seasonId,
            areaHa: round2(areaHa),
            plannedBudgetPerHa: plannedPerHa,
            totalPlannedBudget,
            actualTotal,
            burnPercent,
            burnStatus,
            burnStatusLabel,
            remainingUah,
            breakdown: {
              materialsUah,
              fuelUah,
              salaryUah,
              fuelLiters: economics.totalFuelUsed,
              dieselPriceUah: economics.dieselPriceUah,
              materials: {
                zzr: economics.categoriesBreakdown.zzr.costUah,
                fertilizer: economics.categoriesBreakdown.fertilizer.costUah,
                seed: economics.categoriesBreakdown.seed.costUah,
              },
            },
            unpricedMaterials: (economics.unpricedMaterials ?? []).map(
              (item) => ({
                name: item.name,
                quantity: item.totalQty,
                unit: item.unit,
                category: item.category,
              })
            ),
            message:
              burnPercent == null
                ? `На «${fieldName}» факт ${actualTotal.toLocaleString("uk-UA")} ₴, але плановий бюджет не заданий.`
                : `«${fieldName}»: ${burnPercent}% бюджету (${actualTotal.toLocaleString("uk-UA")} / ${totalPlannedBudget!.toLocaleString("uk-UA")} ₴) — ${burnStatusLabel}.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldBudgetBurnRate] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка burn rate",
          };
        }
      },
    }),

    queueDocumentToBasSync: tool({
      description:
        "Ставить закритий наряд / списання ТМЦ / заправку в чергу імпорту BAS (bas_sync_queue).",
      inputSchema: z.object({
        documentType: z
          .enum(["work_order", "inventory_write_off", "fuel_dispense"])
          .describe("Тип документа BAS"),
        entityId: z
          .string()
          .trim()
          .min(1)
          .describe("UUID документа"),
        notes: z
          .string()
          .trim()
          .optional()
          .describe("Коментар"),
      }),
      execute: async ({ documentType, entityId, notes }) => {
        const id = entityId.trim();
        console.log("[TOOL: queueDocumentToBasSync]", {
          documentType,
          id,
          notes,
        });

        try {
          let payload: Record<string, unknown> = {
            documentType,
            entityId: id,
            queuedAt: new Date().toISOString(),
          };
          let sourceDbId = id;

          if (documentType === "work_order") {
            let opQuery = supabase
              .from("field_operations")
              .select(
                `
                id, client_key, work_type, crop, status, area_fact, fuel_fact,
                wage_fact, occurred_at, machinery, implement, mechanic_name,
                equipment_id, field_id, field_key, export_status,
                farm_fields ( id, name, canonical_name, bas_ref_key, crop )
              `
              );
            if (isUuid(id)) {
              opQuery = opQuery.or(`id.eq.${id},client_key.eq.${id}`);
            } else {
              opQuery = opQuery.eq("client_key", id);
            }
            const { data: op, error } = await opQuery.maybeSingle();
            if (error || !op) {
              return {
                success: false as const,
                status: "not_found" as const,
                error: `Наряд «${id}» не знайдено.`,
              };
            }
            if (String(op.status) !== "completed") {
              return {
                success: false as const,
                status: "error" as const,
                error: `У чергу BAS можна ставити лише закриті наряди (зараз: ${op.status}).`,
                workOrderId: String(op.client_key || op.id),
              };
            }
            sourceDbId = String(op.id);
            const field = Array.isArray(op.farm_fields)
              ? op.farm_fields[0]
              : op.farm_fields;
            payload = {
              ...payload,
              sourceTable: "field_operations",
              dbId: sourceDbId,
              clientKey: op.client_key,
              workType: op.work_type,
              crop: op.crop || (field as { crop?: string } | null)?.crop || null,
              areaFact: op.area_fact,
              fuelFact: op.fuel_fact,
              wageFact: op.wage_fact,
              occurredAt: op.occurred_at,
              machinery: op.machinery,
              implement: op.implement,
              mechanicName: op.mechanic_name,
              fieldId: op.field_id,
              fieldBasRefKey: field
                ? (field as { bas_ref_key?: string }).bas_ref_key || null
                : null,
              fieldName: field
                ? (field as { canonical_name?: string }).canonical_name ||
                  (field as { name?: string }).name ||
                  null
                : null,
              pipeline: "field_operation_waybill",
              basDocument: "Document_ИНАГРО_ПутевойЛистТрактористаМашиниста",
            };

            await supabase
              .from("field_operations")
              .update({ export_status: "pending" })
              .eq("id", sourceDbId);

            // Спроба живої чернетки — лише якщо BAS_DRAFT_POST_ENABLED
            void enqueueFieldOperationBasDraft(sourceDbId).catch((e) =>
              console.error("[queueDocumentToBasSync] waybill", e)
            );
          } else if (documentType === "inventory_write_off") {
            if (!isUuid(id)) {
              return {
                success: false as const,
                status: "error" as const,
                error: "Для списання ТМЦ потрібен UUID inventory_local_moves.id",
              };
            }
            const { data: move, error } = await supabase
              .from("inventory_local_moves")
              .select(
                `
                id, item_ref_key, qty, date, type, status, field_id, season, note,
                inventory_items_cache (
                  name, custom_name, unit, category, bas_ref_key, planned_price_uah
                ),
                farm_fields ( id, name, canonical_name, bas_ref_key, crop )
              `
              )
              .eq("id", id)
              .maybeSingle();
            if (error || !move) {
              return {
                success: false as const,
                status: "not_found" as const,
                error: `Списання «${id}» не знайдено.`,
              };
            }
            sourceDbId = String(move.id);
            const cache = Array.isArray(move.inventory_items_cache)
              ? move.inventory_items_cache[0]
              : move.inventory_items_cache;
            const field = Array.isArray(move.farm_fields)
              ? move.farm_fields[0]
              : move.farm_fields;
            payload = {
              ...payload,
              sourceTable: "inventory_local_moves",
              dbId: sourceDbId,
              itemRefKey: move.item_ref_key,
              itemName: cache
                ? (cache as { custom_name?: string }).custom_name ||
                  (cache as { name?: string }).name
                : null,
              qty: move.qty,
              unit: cache ? (cache as { unit?: string }).unit : null,
              category: cache ? (cache as { category?: string }).category : null,
              date: move.date,
              fieldId: move.field_id,
              fieldBasRefKey: field
                ? (field as { bas_ref_key?: string }).bas_ref_key || null
                : null,
              fieldName: field
                ? (field as { canonical_name?: string }).canonical_name ||
                  (field as { name?: string }).name
                : null,
              crop: field ? (field as { crop?: string }).crop : null,
              season: move.season,
              pipeline: "inventory_outbound_lzk",
              basDocument: "Document_ИНАГРО_ЛимитноЗаборнаяКарта",
            };

            await supabase
              .from("inventory_local_moves")
              .update({ status: "sent_to_1c" })
              .eq("id", sourceDbId)
              .then(({ error: stErr }) => {
                if (stErr) {
                  console.warn(
                    "[queueDocumentToBasSync] move status:",
                    stErr.message
                  );
                }
              });
          } else {
            // fuel_dispense
            if (!isUuid(id)) {
              return {
                success: false as const,
                status: "error" as const,
                error: "Для заправки потрібен UUID fuel_transactions.id",
              };
            }
            const { data: tx, error } = await supabase
              .from("fuel_transactions")
              .select(
                `
                id, transaction_type, amount_liters, transaction_date,
                from_storage_id, equipment_id, operator_name, sync_status,
                fuel_storages!fuel_transactions_from_storage_id_fkey (
                  id, name, bas_ref_key
                ),
                equipment:equipment_id ( id, name, bas_ref_key )
              `
              )
              .eq("id", id)
              .maybeSingle();
            if (error || !tx) {
              // fallback без join імен
              const simple = await supabase
                .from("fuel_transactions")
                .select(
                  "id, transaction_type, amount_liters, transaction_date, from_storage_id, equipment_id, operator_name, sync_status"
                )
                .eq("id", id)
                .maybeSingle();
              if (simple.error || !simple.data) {
                return {
                  success: false as const,
                  status: "not_found" as const,
                  error: `Заправку «${id}» не знайдено.`,
                };
              }
              const t = simple.data;
              if (String(t.transaction_type) !== "outbound") {
                return {
                  success: false as const,
                  status: "error" as const,
                  error: `Очікується outbound (заправка), зараз: ${t.transaction_type}`,
                };
              }
              sourceDbId = String(t.id);
              payload = {
                ...payload,
                sourceTable: "fuel_transactions",
                dbId: sourceDbId,
                amountLiters: t.amount_liters,
                transactionDate: t.transaction_date,
                fromStorageId: t.from_storage_id,
                equipmentId: t.equipment_id,
                operatorName: t.operator_name,
                pipeline: "fuel_outbound_refuel",
                basDocument: "Document_ИНАГРО_ПередачаТоплива",
              };
            } else {
              if (String(tx.transaction_type) !== "outbound") {
                return {
                  success: false as const,
                  status: "error" as const,
                  error: `Очікується outbound (заправка), зараз: ${tx.transaction_type}`,
                };
              }
              sourceDbId = String(tx.id);
              const storage = Array.isArray(tx.fuel_storages)
                ? tx.fuel_storages[0]
                : tx.fuel_storages;
              const equipment = Array.isArray(tx.equipment)
                ? tx.equipment[0]
                : tx.equipment;
              payload = {
                ...payload,
                sourceTable: "fuel_transactions",
                dbId: sourceDbId,
                amountLiters: tx.amount_liters,
                transactionDate: tx.transaction_date,
                fromStorageId: tx.from_storage_id,
                storageName: storage
                  ? (storage as { name?: string }).name
                  : null,
                storageBasRefKey: storage
                  ? (storage as { bas_ref_key?: string }).bas_ref_key
                  : null,
                equipmentId: tx.equipment_id,
                equipmentName: equipment
                  ? (equipment as { name?: string }).name
                  : null,
                equipmentBasRefKey: equipment
                  ? (equipment as { bas_ref_key?: string }).bas_ref_key
                  : null,
                operatorName: tx.operator_name,
                pipeline: "fuel_outbound_refuel",
                basDocument: "Document_ИНАГРО_ПередачаТоплива",
              };
            }

            await supabase
              .from("fuel_transactions")
              .update({ sync_status: "pending_1c" })
              .eq("id", sourceDbId);
          }

          if (notes?.trim()) payload.accountantNotes = notes.trim();

          const queued = await enqueueBasSyncQueue({
            documentType,
            sourceId: sourceDbId,
            payload,
            notes: notes?.trim() || null,
            actorId: actorUserId,
            actorName,
          });

          if (!queued.ok) {
            return {
              success: false as const,
              status: "error" as const,
              error: queued.error,
            };
          }

          return {
            success: true as const,
            syncId: queued.syncId,
            status: "queued" as const,
            documentType,
            entityId: sourceDbId,
            alreadyQueued: queued.alreadyQueued === true,
            payloadSummary: {
              pipeline: payload.pipeline,
              basDocument: payload.basDocument,
              fieldName: payload.fieldName ?? null,
              itemName: payload.itemName ?? null,
              equipmentName: payload.equipmentName ?? null,
            },
            message: queued.message,
          };
        } catch (error) {
          console.error(
            "[TOOL: queueDocumentToBasSync] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка черги BAS",
          };
        }
      },
    }),

    getFieldTechCardMatrix: tool({
      description:
        "Технологічна матриця («метро») етапів поля за культурою та фактом робіт.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: getFieldTechCardMatrix]", { lookup });

        try {
          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season"
          );
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const fieldKey = `farm:${field.id}`;
          const seasonId = normalizeSeason(field.season || DEFAULT_SEASON);
          const seasonYear = Number(seasonId) || new Date().getFullYear();
          const seasonStart = `${seasonYear}-01-01`;
          const seasonEnd = `${seasonYear}-12-31`;

          const { data: ops, error: opsError } = await supabase
            .from("field_operations")
            .select(
              "id, client_key, work_type, status, occurred_at, area_fact, area_plan"
            )
            .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
            .gte("occurred_at", seasonStart)
            .lte("occurred_at", `${seasonEnd}T23:59:59.999Z`)
            .neq("status", "cancelled")
            .order("occurred_at", { ascending: true })
            .limit(200);

          if (opsError) {
            return {
              status: "error" as const,
              error: opsError.message,
            };
          }

          const matrix = buildFieldTechCardMatrix({
            crop: field.crop ? String(field.crop) : null,
            operations: (ops ?? []).map((op) => ({
              id: String(op.client_key || op.id),
              workType: String(op.work_type ?? ""),
              status: String(op.status ?? "planned"),
              date: op.occurred_at
                ? String(op.occurred_at).slice(0, 10)
                : null,
              areaHa:
                finiteNumber(op.area_fact) ||
                finiteNumber(op.area_plan) ||
                null,
            })),
          });

          const current = matrix.stages.find((s) => s.status === "current");
          const nextUpcoming = matrix.stages.find(
            (s) => s.status === "upcoming"
          );

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            crop: matrix.crop,
            season: seasonId,
            progressPercent: matrix.progressPercent,
            currentStage: matrix.currentStage,
            chainLabel: matrix.chainLabel,
            stages: matrix.stages,
            hint: current
              ? `Зараз: етап ${current.stage} — ${current.shortTitle}.${
                  nextUpcoming
                    ? ` Далі: ${nextUpcoming.shortTitle}.`
                    : ""
                }`
              : "Усі етапи техкарти пройдені або ще немає робіт.",
            message: `Техкарта «${fieldName}» (${matrix.crop}): ${matrix.chainLabel}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldTechCardMatrix] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка техкарти",
          };
        }
      },
    }),

    generateFieldExportReport: tool({
      description:
        "Готує CSV-експорт історії поля за сезон (наряди, ТМЦ, паливо).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        season: z
          .number()
          .int()
          .optional()
          .default(2026)
          .describe("Сезон"),
      }),
      execute: async ({ fieldIdOrName, season }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const seasonId = normalizeSeason(season ?? 2026);
        console.log("[TOOL: generateFieldExportReport]", {
          lookup,
          seasonId,
        });

        try {
          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season"
          );
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const fieldKey = `farm:${field.id}`;
          const seasonYear = Number(seasonId) || 2026;
          const seasonStart = `${seasonYear}-01-01`;
          const seasonEnd = `${seasonYear}-12-31`;

          const [opsRes, movesRes, fuelRes] = await Promise.all([
            supabase
              .from("field_operations")
              .select("id", { count: "exact", head: true })
              .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
              .gte("occurred_at", seasonStart)
              .lte("occurred_at", `${seasonEnd}T23:59:59.999Z`)
              .neq("status", "cancelled"),
            supabase
              .from("inventory_local_moves")
              .select("id", { count: "exact", head: true })
              .eq("field_id", field.id)
              .eq("season", seasonId),
            supabase
              .from("wialon_field_fuel_logs")
              .select("id", { count: "exact", head: true })
              .eq("field_id", field.id)
              .gte("date", seasonStart)
              .lte("date", seasonEnd),
          ]);

          const opsCount = opsRes.count ?? 0;
          const movesCount = movesRes.count ?? 0;
          const fuelCount = fuelRes.count ?? 0;
          const rowsCount = opsCount + movesCount + fuelCount;
          const downloadUrl = `/api/export/field?id=${encodeURIComponent(field.id)}&season=${encodeURIComponent(seasonId)}`;

          return {
            status: "ok" as const,
            success: true as const,
            fieldId: field.id,
            fieldName,
            season: seasonId,
            crop: field.crop ? String(field.crop) : null,
            areaHa: finiteNumber(field.area_ha) || null,
            rowsCount,
            breakdown: {
              operations: opsCount,
              materials: movesCount,
              fuelLogs: fuelCount,
            },
            downloadUrl,
            previewSummary: `«${fieldName}» · сезон ${seasonId}: ${opsCount} нарядів, ${movesCount} списань ТМЦ, ${fuelCount} записів палива Wialon (${rowsCount} рядків CSV).`,
            message: `Звіт готовий: ${downloadUrl}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: generateFieldExportReport] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            success: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка експорту",
          };
        }
      },
    }),

    syncFieldWialonGeofence: tool({
      description:
        "Звʼязує поле з геозоною Wialon (ручний ID або авто-пошук за назвою). Створення зон у Wialon вимкнено.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        wialonGeofenceId: z
          .string()
          .trim()
          .optional()
          .describe("ID геозони Wialon"),
        autoCreateInWialon: z
          .boolean()
          .default(false)
          .describe("Авто-лінк за назвою"),
      }),
      execute: async ({
        fieldIdOrName,
        wialonGeofenceId,
        autoCreateInWialon,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const manualZoneId = wialonGeofenceId?.trim() || "";
        const autoLink = autoCreateInWialon === true;
        console.log("[TOOL: syncFieldWialonGeofence]", {
          lookup,
          manualZoneId: manualZoneId || null,
          autoLink,
        });

        const normalizeZoneNeedle = (value: string) =>
          value
            .toLocaleLowerCase("uk-UA")
            .replace(/\s+/g, " ")
            .trim();

        try {
          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, geometry, wialon_zone_id",
            { includeNonFields: true }
          );
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const existingZoneId =
            typeof field.wialon_zone_id === "string"
              ? field.wialon_zone_id.trim()
              : "";

          let targetZoneId = manualZoneId;
          let matchedZoneName: string | null = null;
          let zoneFeature: Feature<Polygon | MultiPolygon> | null = null;

          const loadGeofences = async () => {
            try {
              return await getCachedWialonGeofences();
            } catch (err) {
              console.error(
                "[TOOL: syncFieldWialonGeofence] Wialon geofences:",
                err instanceof Error ? err.message : err
              );
              return null;
            }
          };

          if (!targetZoneId && autoLink) {
            const geofences = await loadGeofences();
            if (!geofences) {
              return {
                success: false as const,
                status: "wialon_unavailable" as const,
                error:
                  "Не вдалося прочитати геозони Wialon. Спробуй пізніше або вкажи wialonGeofenceId.",
                fieldId: field.id,
                fieldName,
              };
            }

            const needles = [
              fieldName,
              field.name,
              field.canonical_name,
            ]
              .filter(
                (v): v is string => typeof v === "string" && v.trim().length > 0
              )
              .map((v) => normalizeZoneNeedle(v));

            const exact = geofences.features.filter((f) => {
              const n = normalizeZoneNeedle(f.properties?.name ?? "");
              return needles.some((needle) => n === needle);
            });
            const fuzzy =
              exact.length > 0
                ? exact
                : geofences.features.filter((f) => {
                    const n = normalizeZoneNeedle(f.properties?.name ?? "");
                    return needles.some(
                      (needle) =>
                        needle.length >= 3 &&
                        (n.includes(needle) || needle.includes(n))
                    );
                  });

            if (fuzzy.length === 0) {
              return {
                success: false as const,
                status: "wialon_readonly" as const,
                error:
                  `Геозону «${fieldName}» у Wialon не знайдено. Створення нових зон вимкнено (API read-only). Створи контур у Wialon і передай wialonGeofenceId, або звʼяжи вручну в паспорті поля.`,
                fieldId: field.id,
                fieldName,
                hint: "autoCreateInWialon лише авто-привʼязує існуючу зону за назвою.",
              };
            }
            if (fuzzy.length > 1) {
              return {
                success: false as const,
                status: "ambiguous_geofence" as const,
                error: `Знайдено кілька геозон для «${fieldName}». Уточни wialonGeofenceId.`,
                fieldId: field.id,
                fieldName,
                candidates: fuzzy.slice(0, 8).map((f) => ({
                  wialonGeofenceId: String(f.properties?.id ?? f.id ?? ""),
                  name: f.properties?.name ?? "Геозона",
                  areaHa: hectaresFromFeature(f),
                })),
              };
            }

            const match = fuzzy[0]!;
            targetZoneId = String(match.properties?.id ?? match.id ?? "");
            matchedZoneName = match.properties?.name ?? null;
            zoneFeature = match;
          }

          if (!targetZoneId && existingZoneId) {
            // Оновити контур з уже привʼязаної зони
            targetZoneId = existingZoneId;
          }

          if (!targetZoneId) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error:
                "Вкажи wialonGeofenceId або autoCreateInWialon=true (авто-пошук існуючої зони за назвою).",
              fieldId: field.id,
              fieldName,
              currentWialonGeofenceId: existingZoneId || null,
            };
          }

          if (!zoneFeature) {
            const geofences = await loadGeofences();
            const found = geofences?.features.find(
              (f) =>
                String(f.properties?.id ?? f.id ?? "") === targetZoneId ||
                String(f.properties?.wialon_id ?? "") === targetZoneId
            );
            if (found) {
              zoneFeature = found;
              matchedZoneName = found.properties?.name ?? matchedZoneName;
              targetZoneId = String(
                found.properties?.id ?? found.id ?? targetZoneId
              );
            } else if (manualZoneId) {
              return {
                success: false as const,
                status: "zone_not_found" as const,
                error: `Геозону «${manualZoneId}» у Wialon не знайдено.`,
                fieldId: field.id,
                fieldName,
              };
            }
          }

          // Чи зона вже зайнята іншим полем
          const { data: occupied } = await supabase
            .from("farm_fields")
            .select("id, name, canonical_name")
            .eq("wialon_zone_id", targetZoneId)
            .neq("id", field.id)
            .limit(1)
            .maybeSingle();

          if (occupied) {
            const occupiedName =
              (occupied.canonical_name &&
                String(occupied.canonical_name).trim()) ||
              String(occupied.name ?? "інше поле");
            return {
              success: false as const,
              status: "zone_occupied" as const,
              error: `Геозона вже привʼязана до «${occupiedName}».`,
              fieldId: field.id,
              fieldName,
              wialonGeofenceId: targetZoneId,
              occupiedBy: {
                id: occupied.id,
                name: occupiedName,
              },
            };
          }

          const patch: Record<string, unknown> = {
            wialon_zone_id: targetZoneId,
          };
          if (zoneFeature?.geometry) {
            patch.geometry = zoneFeature.geometry;
            const areaHa = hectaresFromFeature(zoneFeature);
            if (areaHa > 0) patch.area_ha = areaHa;
          }

          const { data: updated, error: updateError } = await supabase
            .from("farm_fields")
            .update(patch)
            .eq("id", field.id)
            .select(
              "id, name, canonical_name, crop, area_ha, wialon_zone_id"
            )
            .single();

          if (updateError) {
            return {
              success: false as const,
              status: "error" as const,
              error: updateError.message,
              fieldId: field.id,
              fieldName,
            };
          }

          const syncedName =
            (updated?.canonical_name &&
              String(updated.canonical_name).trim()) ||
            String(updated?.name ?? fieldName);
          const syncedZoneId = String(
            updated?.wialon_zone_id ?? targetZoneId
          ).trim();

          return {
            success: true as const,
            status: "synced" as const,
            fieldId: field.id,
            fieldName: syncedName,
            wialonGeofenceId: syncedZoneId,
            wialonGeofenceName: matchedZoneName,
            areaHa: finiteNumber(updated?.area_ha) || null,
            geometryPulled: Boolean(zoneFeature?.geometry),
            mode: manualZoneId
              ? ("manual_link" as const)
              : autoLink
                ? ("auto_match" as const)
                : ("refresh_existing" as const),
            message: matchedZoneName
              ? `Поле «${syncedName}» синхронізовано з геозоною «${matchedZoneName}» (${syncedZoneId}).`
              : `Поле «${syncedName}» привʼязано до геозони ${syncedZoneId}.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: syncFieldWialonGeofence] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка синхронізації геозони",
          };
        }
      },
    }),

    searchFieldsCatalog: tool({
      description:
        "Розширений пошук ділянок: назва, урочище, сорт, площа, попередник, категорія.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .optional()
          .describe("Пошукове слово"),
        minArea: z
          .number()
          .optional()
          .describe("Мін. площа га"),
        maxArea: z
          .number()
          .optional()
          .describe("Макс. площа га"),
        previousCrop: z
          .string()
          .trim()
          .optional()
          .describe("Культура-попередник"),
        category: z
          .enum(["all", "field", "garden", "base"])
          .default("all")
          .describe("all|field|garden|base"),
      }),
      execute: async ({
        query,
        minArea,
        maxArea,
        previousCrop,
        category,
      }) => {
        const q = query?.trim() || "";
        const prev = previousCrop?.trim() || "";
        const cat = category ?? "all";
        const minHa =
          minArea != null && Number.isFinite(minArea) ? Number(minArea) : null;
        const maxHa =
          maxArea != null && Number.isFinite(maxArea) ? Number(maxArea) : null;

        console.log("[TOOL: searchFieldsCatalog]", {
          q: q || null,
          minHa,
          maxHa,
          prev: prev || null,
          cat,
        });

        const escapeIlike = (value: string) =>
          value.replaceAll(",", " ").replaceAll("%", "").replaceAll("_", "");

        try {
          const selectFull =
            "id, name, canonical_name, crop, area_ha, tract, notes, previous_crop, plot_category, is_active, is_field";
          const selectFallback =
            "id, name, canonical_name, crop, area_ha, tract, notes, is_field";

          let rows: Array<Record<string, unknown>> | null = null;
          let error: { message: string; code?: string } | null = null;

          const runQuery = async (selectCols: string) => {
            let qb = supabase
              .from("farm_fields")
              .select(selectCols)
              .neq("is_active", false)
              .order("name", { ascending: true })
              .limit(80);

            if (cat !== "all") {
              qb = qb.eq("plot_category", cat);
            }
            if (minHa != null) qb = qb.gte("area_ha", minHa);
            if (maxHa != null) qb = qb.lte("area_ha", maxHa);

            if (q) {
              const safe = escapeIlike(q);
              qb = qb.or(
                [
                  `name.ilike.%${safe}%`,
                  `canonical_name.ilike.%${safe}%`,
                  `tract.ilike.%${safe}%`,
                  `notes.ilike.%${safe}%`,
                  `crop.ilike.%${safe}%`,
                  `previous_crop.ilike.%${safe}%`,
                ].join(",")
              );
            }

            if (prev) {
              const safePrev = escapeIlike(prev);
              qb = qb.or(
                [
                  `previous_crop.ilike.%${safePrev}%`,
                  `notes.ilike.%${safePrev}%`,
                ].join(",")
              );
            }

            return qb;
          };

          {
            const res = await runQuery(selectFull);
            rows = (res.data as Array<Record<string, unknown>> | null) ?? null;
            error = res.error;
          }

          if (
            error &&
            (error.message?.includes("previous_crop") ||
              error.message?.includes("plot_category") ||
              error.message?.includes("is_active") ||
              error.message?.includes("notes") ||
              error.code === "42703")
          ) {
            let qb = supabase
              .from("farm_fields")
              .select(selectFallback)
              .order("name", { ascending: true })
              .limit(80);
            if (minHa != null) qb = qb.gte("area_ha", minHa);
            if (maxHa != null) qb = qb.lte("area_ha", maxHa);
            if (cat === "field") qb = qb.eq("is_field", true);
            else if (cat === "base") qb = qb.eq("is_field", false);
            if (q) {
              const safe = escapeIlike(q);
              qb = qb.or(
                [
                  `name.ilike.%${safe}%`,
                  `canonical_name.ilike.%${safe}%`,
                  `tract.ilike.%${safe}%`,
                  `notes.ilike.%${safe}%`,
                  `crop.ilike.%${safe}%`,
                ].join(",")
              );
            }
            if (prev) {
              const safePrev = escapeIlike(prev);
              qb = qb.or(
                [`notes.ilike.%${safePrev}%`, `crop.ilike.%${safePrev}%`].join(
                  ","
                )
              );
            }
            const retry = await qb;
            rows =
              (retry.data as Array<Record<string, unknown>> | null) ?? null;
            error = retry.error;
          }

          if (error) {
            return {
              status: "error" as const,
              error: error.message,
              fields: [] as const,
            };
          }

          const fields = (rows ?? []).map((row) => {
            const name =
              (typeof row.canonical_name === "string" &&
                row.canonical_name.trim()) ||
              (typeof row.name === "string" && row.name.trim()) ||
              "Поле";
            const plotCat =
              (typeof row.plot_category === "string" &&
                row.plot_category.trim()) ||
              (row.is_field === false ? "base" : "field");
            const active = row.is_active !== false;
            return {
              id: String(row.id),
              name,
              area: round2(finiteNumber(row.area_ha)),
              crop:
                (typeof row.crop === "string" && row.crop.trim()) || null,
              previousCrop:
                (typeof row.previous_crop === "string" &&
                  row.previous_crop.trim()) ||
                null,
              tractName:
                (typeof row.tract === "string" && row.tract.trim()) || null,
              status: active
                ? categoryLabel(plotCat)
                : "Архів",
              category: plotCat,
            };
          });

          return {
            status: "ok" as const,
            count: fields.length,
            filters: {
              query: q || null,
              minArea: minHa,
              maxArea: maxHa,
              previousCrop: prev || null,
              category: cat,
            },
            fields,
            message:
              fields.length === 0
                ? "Нічого не знайдено за цими фільтрами."
                : `Знайдено ${fields.length} ділянок.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: searchFieldsCatalog] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка пошуку ділянок",
            fields: [] as const,
          };
        }
      },
    }),

    getFieldUnifiedTimeline: tool({
      description:
        "Повна хронологія поля: роботи, ТМЦ, GPS/паливо Wialon, скаутинг.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        limit: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe("Ліміт подій"),
      }),
      execute: async ({ fieldIdOrName, limit: limitRaw }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const limit = Math.min(
          Math.max(Number(limitRaw) || 10, 1),
          50
        );
        console.log("[TOOL: getFieldUnifiedTimeline]", { lookup, limit });

        type TimelineEventType =
          | "operation"
          | "material"
          | "gps_fuel"
          | "scouting";

        type TimelineEvent = {
          date: string;
          eventType: TimelineEventType;
          title: string;
          details: string;
          summary: string;
        };

        const eventDateMs = (date: string) => {
          const t = Date.parse(date);
          return Number.isFinite(t) ? t : 0;
        };

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const fieldKey = `farm:${field.id}`;
          const fetchCap = Math.min(Math.max(limit * 3, 30), 80);

          const [opsRes, movesRes, fuelRes, scoutRes] = await Promise.all([
            supabase
              .from("field_operations")
              .select(
                "id, work_type, status, area_fact, area_plan, occurred_at, created_at, machinery, mechanic_name"
              )
              .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
              .neq("status", "cancelled")
              .order("occurred_at", { ascending: false })
              .limit(fetchCap),
            supabase
              .from("inventory_local_moves")
              .select(
                `
                id,
                date,
                qty,
                status,
                inventory_items_cache (
                  name,
                  custom_name,
                  unit
                )
              `
              )
              .eq("type", "outbound")
              .eq("field_id", field.id)
              .order("date", { ascending: false })
              .limit(fetchCap),
            supabase
              .from("wialon_field_fuel_logs")
              .select(
                `
                id,
                date,
                fuel_consumed,
                equipment (
                  id,
                  name
                )
              `
              )
              .eq("field_id", field.id)
              .gt("fuel_consumed", 0)
              .order("date", { ascending: false })
              .limit(fetchCap),
            supabase
              .from("scouting_reports")
              .select("id, date, notes, image_url, status")
              .eq("field_id", field.id)
              .order("date", { ascending: false })
              .limit(fetchCap),
          ]);

          const events: TimelineEvent[] = [];

          if (!opsRes.error) {
            for (const row of opsRes.data ?? []) {
              const workType = String(row.work_type ?? "Робота").trim() || "Робота";
              const status = String(row.status ?? "").trim() || "—";
              const area =
                finiteNumber(row.area_fact) || finiteNumber(row.area_plan);
              const dateRaw =
                (typeof row.occurred_at === "string" && row.occurred_at) ||
                (typeof row.created_at === "string" && row.created_at) ||
                "";
              const date = dateRaw.slice(0, 10);
              if (!date) continue;
              const machine =
                typeof row.machinery === "string" && row.machinery.trim()
                  ? row.machinery.trim()
                  : null;
              const mechanic =
                typeof row.mechanic_name === "string" &&
                row.mechanic_name.trim()
                  ? row.mechanic_name.trim()
                  : null;
              const detailsParts = [
                `статус: ${status}`,
                area > 0 ? `${round2(area)} га` : null,
                machine ? `техніка: ${machine}` : null,
                mechanic ? `механізатор: ${mechanic}` : null,
              ].filter(Boolean);
              events.push({
                date,
                eventType: "operation",
                title: workType,
                details: detailsParts.join(" · "),
                summary: `${workType}${area > 0 ? ` · ${round2(area)} га` : ""} · ${status}`,
              });
            }
          } else {
            console.warn(
              "[TOOL: getFieldUnifiedTimeline] field_operations:",
              opsRes.error.message
            );
          }

          if (!movesRes.error) {
            for (const row of movesRes.data ?? []) {
              const status = String(
                (row as { status?: string | null }).status ?? ""
              ).toLowerCase();
              if (status === "cancelled" || status === "void") continue;
              const date = String(row.date ?? "").slice(0, 10);
              if (!date) continue;
              const cacheRaw = (row as { inventory_items_cache?: unknown })
                .inventory_items_cache;
              const cache = Array.isArray(cacheRaw)
                ? (cacheRaw[0] as Record<string, unknown> | undefined)
                : (cacheRaw as Record<string, unknown> | null | undefined);
              const name =
                (typeof cache?.custom_name === "string" &&
                  cache.custom_name.trim()) ||
                (typeof cache?.name === "string" && cache.name.trim()) ||
                "ТМЦ";
              const unit =
                typeof cache?.unit === "string" && cache.unit.trim()
                  ? cache.unit.trim()
                  : "од.";
              const qty = finiteNumber(row.qty);
              events.push({
                date,
                eventType: "material",
                title: name,
                details: `списання · ${round2(qty)} ${unit}`,
                summary: `${name}: ${round2(qty)} ${unit}`,
              });
            }
          } else {
            console.warn(
              "[TOOL: getFieldUnifiedTimeline] inventory_local_moves:",
              movesRes.error.message
            );
          }

          if (!fuelRes.error) {
            for (const row of fuelRes.data ?? []) {
              const date = String(row.date ?? "").slice(0, 10);
              if (!date) continue;
              const liters = finiteNumber(row.fuel_consumed);
              if (liters <= 0) continue;
              const eqRaw = (row as { equipment?: unknown }).equipment;
              const eq = Array.isArray(eqRaw)
                ? (eqRaw[0] as { name?: string | null } | undefined)
                : (eqRaw as { name?: string | null } | null | undefined);
              const equipmentName =
                (eq?.name && String(eq.name).trim()) || "Техніка";
              events.push({
                date,
                eventType: "gps_fuel",
                title: equipmentName,
                details: `GPS/Wialon · ${round2(liters)} л на полі`,
                summary: `${equipmentName}: ${round2(liters)} л`,
              });
            }
          } else if (
            !fuelRes.error.message?.includes("wialon_field_fuel_logs") &&
            fuelRes.error.code !== "PGRST205" &&
            fuelRes.error.code !== "42P01"
          ) {
            console.warn(
              "[TOOL: getFieldUnifiedTimeline] wialon_field_fuel_logs:",
              fuelRes.error.message
            );
          }

          if (!scoutRes.error) {
            for (const row of scoutRes.data ?? []) {
              const date = String(row.date ?? "").slice(0, 10);
              if (!date) continue;
              const notes =
                typeof row.notes === "string" ? row.notes.trim() : "";
              const hasPhoto = Boolean(
                typeof row.image_url === "string" && row.image_url.trim()
              );
              const risk =
                typeof (row as { status?: string | null }).status === "string"
                  ? String((row as { status?: string }).status).trim()
                  : "";
              const shortNotes =
                notes.length > 140 ? `${notes.slice(0, 137)}…` : notes;
              const detailsParts = [
                risk ? `ризик: ${risk}` : null,
                shortNotes || "без нотаток",
                hasPhoto ? "є фото" : null,
              ].filter(Boolean);
              events.push({
                date,
                eventType: "scouting",
                title: "Огляд скаута",
                details: detailsParts.join(" · "),
                summary: shortNotes || "Огляд скаута",
              });
            }
          } else if (
            scoutRes.error.message?.includes("status") ||
            scoutRes.error.code === "42703"
          ) {
            const legacyScout = await supabase
              .from("scouting_reports")
              .select("id, date, notes, image_url")
              .eq("field_id", field.id)
              .order("date", { ascending: false })
              .limit(fetchCap);
            for (const row of legacyScout.data ?? []) {
              const date = String(row.date ?? "").slice(0, 10);
              if (!date) continue;
              const notes =
                typeof row.notes === "string" ? row.notes.trim() : "";
              const hasPhoto = Boolean(
                typeof row.image_url === "string" && row.image_url.trim()
              );
              const shortNotes =
                notes.length > 140 ? `${notes.slice(0, 137)}…` : notes;
              events.push({
                date,
                eventType: "scouting",
                title: "Огляд скаута",
                details: [shortNotes || "без нотаток", hasPhoto ? "є фото" : null]
                  .filter(Boolean)
                  .join(" · "),
                summary: shortNotes || "Огляд скаута",
              });
            }
          } else if (
            !scoutRes.error.message?.includes("scouting_reports") &&
            scoutRes.error.code !== "PGRST205" &&
            scoutRes.error.code !== "42P01"
          ) {
            console.warn(
              "[TOOL: getFieldUnifiedTimeline] scouting_reports:",
              scoutRes.error.message
            );
          }

          events.sort((a, b) => {
            const byDate = eventDateMs(b.date) - eventDateMs(a.date);
            if (byDate !== 0) return byDate;
            return a.eventType.localeCompare(b.eventType);
          });

          const timeline = events.slice(0, limit);

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            limit,
            totalMatched: events.length,
            timeline,
            badgeHints: {
              operation: "[icon:tractor] Робота",
              material: "[icon:warehouse] ТМЦ",
              gps_fuel: "[icon:fuel] Паливо/GPS",
              scouting: "[icon:filetext] Скаутинг",
            },
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldUnifiedTimeline] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка хронології поля",
          };
        }
      },
    }),

    getLandBankSummary: tool({
      description:
        "Агрегований земельний банк: загальна площа, категорії, культури.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[TOOL: getLandBankSummary]");
        try {
          let query = supabase
            .from("farm_fields")
            .select(
              "id, name, canonical_name, crop, area_ha, is_field, plot_category, is_active"
            )
            .neq("is_active", false);

          let data: Array<Record<string, unknown>> | null = null;
          let error: { message: string; code?: string } | null = null;

          {
            const res = await query;
            data = (res.data as Array<Record<string, unknown>> | null) ?? null;
            error = res.error;
          }
          if (
            error &&
            (error.message?.includes("is_active") ||
              error.message?.includes("plot_category") ||
              error.code === "42703")
          ) {
            const retry = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, crop, area_ha, is_field")
              .limit(5_000);
            data = (retry.data as Array<Record<string, unknown>> | null) ?? null;
            error = retry.error;
          }

          if (error) {
            return {
              status: "error" as const,
              error: error.message,
            };
          }

          const rows = data ?? [];

          let totalHa = 0;
          let fieldsHa = 0;
          let gardensHa = 0;
          let basesHa = 0;
          let fieldCount = 0;
          const byCrop = new Map<string, number>();

          for (const row of rows) {
            const area = finiteNumber(row.area_ha);
            if (area <= 0) continue;
            totalHa += area;
            fieldCount += 1;

            const category = (
              (typeof row.plot_category === "string" &&
                row.plot_category.trim()) ||
              (row.is_field === false ? "base" : "field")
            ).toLowerCase();

            if (category === "garden") gardensHa += area;
            else if (category === "base") basesHa += area;
            else {
              fieldsHa += area;
              const crop =
                (typeof row.crop === "string" && row.crop.trim()) ||
                "Без культури / пар";
              byCrop.set(crop, round2((byCrop.get(crop) ?? 0) + area));
            }
          }

          const cropBreakdown = Array.from(byCrop.entries())
            .map(([crop, areaHa]) => ({ crop, areaHa: round2(areaHa) }))
            .sort((a, b) => b.areaHa - a.areaHa);

          return {
            status: "ok" as const,
            totalAreaHa: round2(totalHa),
            plotCount: fieldCount,
            averageFieldHa:
              fieldCount > 0 ? round2(totalHa / fieldCount) : 0,
            byCategory: {
              fieldsHa: round2(fieldsHa),
              gardensHa: round2(gardensHa),
              basesHa: round2(basesHa),
            },
            byCrop: cropBreakdown,
            tableHint:
              "Покажи byCrop як [row:Культура|XXX га] і підсумок byCategory.",
          };
        } catch (error) {
          console.error(
            "[TOOL: getLandBankSummary] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка земельного банку",
          };
        }
      },
    }),

    getFieldLiveTelemetry: tool({
      description:
        "Хто зараз на полі / де техніка: live GPS Wialon (швидкість, запалювання, паливо).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Техніка ID/назва"),
      }),
      execute: async ({ fieldIdOrName, equipmentIdOrName }) => {
        const fieldLookup = (
          fieldIdOrName?.trim() ||
          (!equipmentIdOrName?.trim() ? defaultFieldId : "") ||
          ""
        ).trim();
        const equipmentLookup = equipmentIdOrName?.trim() || "";
        console.log("[TOOL: getFieldLiveTelemetry]", {
          fieldLookup,
          equipmentLookup,
        });

        try {
          if (!fieldLookup && !equipmentLookup) {
            return {
              status: "needs_slots" as const,
              error: "Вкажи поле або техніку (назву / ID).",
            };
          }

          let units: WialonUnit[] = [];
          let unitsFetchedAt: number | null = null;
          let unitsStale = false;
          try {
            const live = await getCachedWialonUnitsFull();
            units = live.units ?? [];
            unitsFetchedAt = live.fetchedAt;
            unitsStale = live.stale;
          } catch (err) {
            return {
              status: "error" as const,
              error:
                err instanceof Error
                  ? `Не вдалося отримати live GPS: ${err.message}`
                  : "Не вдалося отримати live GPS Wialon",
            };
          }

          // ── Режим: техніка ──────────────────────────────────────────
          if (equipmentLookup) {
            const { data: eqRows } = await supabase
              .from("equipment")
              .select("id, name, wialon_id, code")
              .limit(400);

            const needle = equipmentLookup.toLocaleLowerCase("uk-UA");
            const equipmentCandidates = (eqRows ?? []).filter((row) => {
              const name = String(row.name ?? "").toLocaleLowerCase("uk-UA");
              const code = String(row.code ?? "").toLocaleLowerCase("uk-UA");
              const id = String(row.id ?? "").toLowerCase();
              return (
                id === needle ||
                name === needle ||
                code === needle ||
                name.includes(needle) ||
                code.includes(needle)
              );
            });

            let matchedUnit: WialonUnit | null = null;
            let equipmentId: string | null = null;
            let equipmentName = equipmentLookup;

            if (isUuid(equipmentLookup)) {
              const row = (eqRows ?? []).find(
                (r) => String(r.id) === equipmentLookup
              );
              if (row) {
                equipmentId = String(row.id);
                equipmentName = String(row.name ?? equipmentLookup);
                const wid = Number(row.wialon_id);
                if (Number.isFinite(wid)) {
                  matchedUnit =
                    units.find((u) => Number(u.id) === wid) ?? null;
                }
              }
            }

            if (!matchedUnit && equipmentCandidates.length > 0) {
              const row = equipmentCandidates[0]!;
              equipmentId = String(row.id);
              equipmentName = String(row.name ?? equipmentLookup);
              const wid = Number(row.wialon_id);
              if (Number.isFinite(wid)) {
                matchedUnit =
                  units.find((u) => Number(u.id) === wid) ?? null;
              }
            }

            if (!matchedUnit) {
              const byNm = units.filter((u) =>
                String(u.nm ?? "")
                  .toLocaleLowerCase("uk-UA")
                  .includes(needle)
              );
              if (byNm.length === 1) matchedUnit = byNm[0]!;
              else if (byNm.length > 1) {
                return {
                  status: "ambiguous_equipment" as const,
                  error: `Знайдено кілька машин для «${equipmentLookup}». Уточни.`,
                  candidates: byNm.slice(0, 8).map((u) => ({
                    wialonUnitId: u.id,
                    name: u.nm,
                  })),
                };
              }
            }

            if (!matchedUnit || !hasValidWialonPosition(matchedUnit)) {
              return {
                status: "not_found" as const,
                error: `Немає актуальної GPS-позиції для «${equipmentLookup}».`,
                equipmentId,
                equipmentName,
              };
            }

            const snap = unitLiveSnapshot(matchedUnit);

            // Яке поле містить точку
            let currentField: {
              id: string;
              name: string;
              areaHa: number;
            } | null = null;
            const { data: fields } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, geometry, is_field")
              .eq("is_field", true)
              .limit(400);

            const lng = snap.lng;
            const lat = snap.lat;
            if (lng != null && lat != null && fields) {
              for (const row of fields) {
                const poly = toFieldPolygonFeature(row.geometry);
                if (!poly) continue;
                try {
                  if (booleanPointInPolygon(point([lng, lat]), poly)) {
                    currentField = {
                      id: String(row.id),
                      name:
                        (row.canonical_name &&
                          String(row.canonical_name).trim()) ||
                        String(row.name ?? "Поле"),
                      areaHa: finiteNumber(row.area_ha),
                    };
                    break;
                  }
                } catch {
                  /* skip bad geometry */
                }
              }
            }

            // Fallback: сьогоднішній fuel log на полі
            if (!currentField && equipmentId) {
              const today = todayKyivYmd();
              const { data: fuelLog } = await supabase
                .from("wialon_field_fuel_logs")
                .select(
                  "field_id, fuel_consumed, farm_fields ( id, name, canonical_name, area_ha )"
                )
                .eq("equipment_id", equipmentId)
                .eq("date", today)
                .gt("fuel_consumed", 0)
                .order("fuel_consumed", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fuelLog?.field_id) {
                const ff = Array.isArray(fuelLog.farm_fields)
                  ? fuelLog.farm_fields[0]
                  : fuelLog.farm_fields;
                currentField = {
                  id: String(fuelLog.field_id),
                  name:
                    (ff &&
                      ((ff as { canonical_name?: string }).canonical_name ||
                        (ff as { name?: string }).name)) ||
                    "Поле",
                  areaHa: finiteNumber(
                    ff ? (ff as { area_ha?: number }).area_ha : 0
                  ),
                };
              }
            }

            return {
              status: "ok" as const,
              mode: "equipment" as const,
              equipmentId,
              equipmentName: equipmentName || snap.name,
              telemetry: snap,
              currentField,
              unitsFetchedAt,
              unitsStale,
            };
          }

          // ── Режим: поле ─────────────────────────────────────────────
          const resolved = await resolveAgentFieldByLookup(
            supabase,
            fieldLookup,
            "id, name, canonical_name, crop, area_ha, geometry, season"
          );
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const { data: geoRow } = await supabase
            .from("farm_fields")
            .select("geometry")
            .eq("id", field.id)
            .maybeSingle();

          const geometry = geoRow?.geometry ?? null;
          const inside = calculateTechInField(
            { geometry: geometry as never },
            units
          );

          // Збагачення fuel/ignition
          const byWialonId = new Map(units.map((u) => [Number(u.id), u]));
          const machines = inside.map((entry) => {
            const unit = byWialonId.get(Number(entry.id));
            const snap = unit ? unitLiveSnapshot(unit) : null;
            return {
              wialonUnitId: Number(entry.id),
              name: entry.name,
              speedKmh: entry.speedKmh,
              isMoving: entry.isMoving,
              statusLabel: entry.statusLabel,
              ignition: snap?.ignition ?? null,
              fuelLiters: snap?.fuelLiters ?? null,
            };
          });

          // Fallback: якщо геометрії немає / порожньо — хто спалив ДРП сьогодні
          if (machines.length === 0) {
            const today = todayKyivYmd();
            const { data: fuelRows } = await supabase
              .from("wialon_field_fuel_logs")
              .select(
                `
                fuel_consumed,
                equipment_id,
                equipment ( id, name, wialon_id )
              `
              )
              .eq("field_id", field.id)
              .eq("date", today)
              .gt("fuel_consumed", 0)
              .order("fuel_consumed", { ascending: false })
              .limit(12);

            for (const row of fuelRows ?? []) {
              const eqRaw = (row as { equipment?: unknown }).equipment;
              const eq = Array.isArray(eqRaw) ? eqRaw[0] : eqRaw;
              const eqObj = eq as
                | { id?: string; name?: string; wialon_id?: number }
                | null
                | undefined;
              const wid = Number(eqObj?.wialon_id);
              const unit =
                Number.isFinite(wid) && wid > 0
                  ? byWialonId.get(wid)
                  : null;
              const snap = unit ? unitLiveSnapshot(unit) : null;
              machines.push({
                wialonUnitId: Number.isFinite(wid) ? wid : 0,
                name: (eqObj?.name && String(eqObj.name)) || "Техніка",
                speedKmh: snap?.speedKmh ?? 0,
                isMoving: snap?.isMoving ?? false,
                statusLabel: snap
                  ? snap.statusLabel
                  : `ДРП сьогодні ${round2(finiteNumber(row.fuel_consumed))} л (без live GPS у контурі)`,
                ignition: snap?.ignition ?? null,
                fuelLiters: snap?.fuelLiters ?? null,
              });
            }
          }

          return {
            status: "ok" as const,
            mode: "field" as const,
            fieldId: field.id,
            fieldName,
            areaHa: finiteNumber(field.area_ha),
            machineCount: machines.length,
            machines,
            unitsFetchedAt,
            unitsStale,
            emptyHint:
              machines.length === 0
                ? "Зараз у контурі поля немає техніки з валідним GPS."
                : null,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldLiveTelemetry] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка live-телеметрії",
          };
        }
      },
    }),

    focusFieldOnMap: tool({
      description:
        "Центрує карту на полі без перезавантаження (focus-field-map / ?field=).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: focusFieldOnMap]", { lookup });

        try {
          if (!lookup) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи назву або ID поля.",
            };
          }

          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season",
            { includeNonFields: true }
          );
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const openFieldPath = `/?field=${field.id}`;

          return {
            success: true as const,
            status: "focus" as const,
            fieldId: field.id,
            fieldName,
            openFieldPath,
            navigatePath: openFieldPath,
            focusEvent: "focus-field-map" as const,
            clientDirective: {
              type: "focus-field-map" as const,
              fieldId: field.id,
            },
            message: `Карта має сфокусуватися на полі «${fieldName}».`,
          };
        } catch (error) {
          console.error(
            "[TOOL: focusFieldOnMap] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка фокусу карти",
          };
        }
      },
    }),

    createField: tool({
      description: "Створює нове поле / город / базу в farm_fields.",
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .describe("Назва поля"),
        area: z.number().positive().describe("Площа га"),
        crop: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Культура"),
        category: z
          .enum(["field", "garden", "base"])
          .default("field")
          .describe("field|garden|base"),
        color: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("HEX колір"),
        notes: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Нотатки"),
      }),
      execute: async ({ name, area, crop, category, color, notes }) => {
        const fieldName = name.trim();
        const areaHa = round2(area);
        const cropValue = crop?.trim() || "—";
        const { plot_category, is_field } = plotCategoryFromInput(category);
        const colorValue = normalizeFieldColor(color) || "#276749";
        console.log("[TOOL: createField]", {
          fieldName,
          areaHa,
          cropValue,
          plot_category,
        });

        try {
          if (!fieldName || areaHa <= 0) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Потрібні назва і додатна площа (га).",
            };
          }

          const payload: Record<string, unknown> = {
            name: fieldName,
            canonical_name: fieldName,
            crop: cropValue,
            area_ha: areaHa,
            color: colorValue,
            geometry: AGENT_FIELD_PLACEHOLDER_GEOMETRY,
            is_field,
            plot_category,
            season: "2026",
            is_active: true,
            notes: notes?.trim() || null,
          };

          let { data, error } = await supabase
            .from("farm_fields")
            .insert(payload)
            .select(
              "id, name, canonical_name, crop, area_ha, color, is_field, plot_category"
            )
            .single();

          if (error) {
            const optionalCols = [
              "plot_category",
              "is_active",
              "notes",
              "canonical_name",
              "season",
            ] as const;
            let retryPayload: Record<string, unknown> = { ...payload };
            for (const col of optionalCols) {
              if (
                !(
                  error.message?.includes(col) ||
                  error.code === "42703"
                )
              ) {
                continue;
              }
              delete retryPayload[col];
              const retry = await supabase
                .from("farm_fields")
                .insert(retryPayload)
                .select("id, name, crop, area_ha, color, is_field")
                .single();
              data = retry.data as typeof data;
              error = retry.error;
              if (!error) break;
            }
          }

          if (error || !data) {
            return {
              success: false as const,
              status: "error" as const,
              error: error?.message ?? "Не вдалося створити поле",
            };
          }

          const row = data as {
            id: string;
            name: string | null;
            canonical_name?: string | null;
            crop: string | null;
            area_ha: number | null;
            color?: string | null;
            is_field?: boolean | null;
            plot_category?: string | null;
          };
          const createdName =
            (row.canonical_name && row.canonical_name.trim()) ||
            row.name ||
            fieldName;

          try {
            const actor = await getCurrentActor();
            await logActivity({
              actor,
              action: "create",
              entityType: "farm_field",
              entityId: row.id,
              summary: `${actor.label} створив ділянку «${createdName}» (${areaHa} га)`,
              meta: { category: plot_category, crop: cropValue },
            });
          } catch {
            /* non-fatal */
          }

          return {
            success: true as const,
            status: "created" as const,
            fieldId: row.id,
            name: createdName,
            area: finiteNumber(row.area_ha) || areaHa,
            crop: row.crop || cropValue,
            color: row.color || colorValue,
            category: plot_category,
            categoryLabel: categoryLabel(plot_category),
            openFieldPath: `/?field=${row.id}`,
            note: "Контур на карті — placeholder; намалюй реальний полігон у Карті полів.",
          };
        } catch (error) {
          console.error(
            "[TOOL: createField] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка створення поля",
          };
        }
      },
    }),

    deleteField: tool({
      description:
        "Безпечне видалення або архівація поля (з перевіркою історії робіт).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({ fieldIdOrName, confirmed = false }) => {
        const lookup = (fieldIdOrName?.trim() || "").trim();
        console.log("[TOOL: deleteField]", { lookup, confirmed });

        try {
          let resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, is_field, plot_category, is_active",
            { includeNonFields: true, includeInactive: true }
          );
          if (
            !resolved.ok &&
            resolved.status === "error" &&
            (resolved.error.includes("is_active") ||
              resolved.error.includes("plot_category") ||
              resolved.error.includes("42703"))
          ) {
            resolved = await resolveAgentFieldByLookup(
              supabase,
              lookup,
              "id, name, canonical_name, crop, area_ha, is_field",
              { includeNonFields: true, includeInactive: true }
            );
          }
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const areaHa = finiteNumber(field.area_ha);
          const fieldKey = `farm:${field.id}`;

          const [opsRes, movesRes] = await Promise.all([
            supabase
              .from("field_operations")
              .select("id", { count: "exact", head: true })
              .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`),
            supabase
              .from("inventory_local_moves")
              .select("id", { count: "exact", head: true })
              .eq("field_id", field.id),
          ]);

          const operationsCount = opsRes.count ?? 0;
          const movesCount = movesRes.count ?? 0;
          const hasHistory = operationsCount > 0 || movesCount > 0;
          const mode = hasHistory ? ("archive" as const) : ("delete" as const);

          if (!confirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId: field.id,
              fieldName,
              areaHa,
              operationsCount,
              movesCount,
              mode,
              warning: hasHistory
                ? `У поля є історія (${operationsCount} нарядів, ${movesCount} списань ТМЦ). Hard-delete заборонено — лише архів (is_active=false), щоб не зламати бухгалтерію.`
                : `Поле «${fieldName}» (${areaHa} га) без історії робіт — можна видалити повністю.`,
              confirmChoice: hasHistory
                ? `Так, архівувати поле ${fieldName}`
                : `Так, видалити поле ${fieldName}`,
              cancelChoice: "Скасувати",
              userHint: hasHistory
                ? `Архівувати «${fieldName}» (${areaHa} га)? Історія робіт збережеться.`
                : `Видалити «${fieldName}» (${areaHa} га) без можливості відновити?`,
              pending: { fieldIdOrName: field.id },
            };
          }

          if (mode === "archive") {
            const { error } = await supabase
              .from("farm_fields")
              .update({ is_active: false })
              .eq("id", field.id);

            if (error) {
              if (
                error.message?.includes("is_active") ||
                error.code === "42703"
              ) {
                return {
                  success: false as const,
                  status: "error" as const,
                  error:
                    "Колонка is_active відсутня. Застосуй міграцію 068 або видали поле без історії вручну.",
                };
              }
              return {
                success: false as const,
                status: "error" as const,
                error: error.message,
              };
            }

            return {
              success: true as const,
              status: "archived" as const,
              fieldId: field.id,
              name: fieldName,
              area: areaHa,
              crop: field.crop,
              mode: "archive" as const,
              message: `Поле «${fieldName}» архівовано (is_active=false). Історія робіт збережена.`,
            };
          }

          const { error: delError } = await supabase
            .from("farm_fields")
            .delete()
            .eq("id", field.id);

          if (delError) {
            return {
              success: false as const,
              status: "error" as const,
              error: delError.message,
            };
          }

          return {
            success: true as const,
            status: "deleted" as const,
            fieldId: field.id,
            name: fieldName,
            area: areaHa,
            crop: field.crop,
            mode: "delete" as const,
            message: `Поле «${fieldName}» видалено.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: deleteField] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка видалення поля",
          };
        }
      },
    }),

    updateFieldDetails: tool({
      description:
        "Оновлює назву/площу/культуру/колір/категорію поля (confirmed для критичних змін).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або UUID поля"),
        newName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Нова назва"),
        newCulture: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Нова культура"),
        newArea: z
          .number()
          .positive()
          .optional()
          .describe("Нова площа га"),
        color: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("HEX колір"),
        category: z
          .enum(["field", "garden", "base"])
          .optional()
          .describe("field|garden|base"),
        notes: z
          .string()
          .trim()
          .optional()
          .describe("Нотатки"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        fieldIdOrName,
        newName,
        newCulture,
        newArea,
        color,
        category,
        notes,
        confirmed,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const isConfirmed = confirmed === true;
        const nextColor = normalizeFieldColor(color);
        console.log("[TOOL: updateFieldDetails]", {
          lookup,
          newName,
          newCulture,
          newArea,
          color: nextColor,
          category,
          notes: notes != null,
          confirmed: isConfirmed,
        });

        try {
          if (
            !newName?.trim() &&
            !newCulture?.trim() &&
            newArea == null &&
            !nextColor &&
            !category &&
            (notes == null || notes === "")
          ) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error:
                "Вкажи що оновити: назву, культуру, площу, колір, категорію або примітки.",
            };
          }

          if (!lookup) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи назву або ID поля (або відкрий поле на карті).",
            };
          }

          let resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season, notes, color, is_field, plot_category",
            { includeNonFields: true }
          );
          if (
            !resolved.ok &&
            resolved.status === "error" &&
            (resolved.error.includes("notes") ||
              resolved.error.includes("plot_category") ||
              resolved.error.includes("42703"))
          ) {
            resolved = await resolveAgentFieldByLookup(supabase, lookup, undefined, {
              includeNonFields: true,
            });
          }
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const currentArea = finiteNumber(field.area_ha);
          const currentCrop = (field.crop && String(field.crop).trim()) || "";
          const currentName = fieldName;
          const currentColor =
            (field.color && String(field.color).trim()) || null;
          const currentCategory = (
            (field.plot_category && String(field.plot_category).trim()) ||
            (field.is_field === false ? "base" : "field")
          ) as "field" | "garden" | "base";

          const nextArea =
            newArea != null && Number.isFinite(newArea) && newArea > 0
              ? round2(newArea)
              : undefined;
          const nextCulture = newCulture?.trim() || undefined;
          const nextName = newName?.trim() || undefined;
          const nextCategory = category;

          const areaChanging =
            nextArea != null && Math.abs(nextArea - currentArea) > 0.0001;
          const cultureChanging =
            nextCulture != null &&
            nextCulture.toLocaleLowerCase("uk-UA") !==
              currentCrop.toLocaleLowerCase("uk-UA");
          const nameChanging =
            nextName != null &&
            nextName.toLocaleLowerCase("uk-UA") !==
              currentName.toLocaleLowerCase("uk-UA");
          const categoryChanging =
            nextCategory != null && nextCategory !== currentCategory;

          const needsConfirmation =
            nameChanging ||
            areaChanging ||
            cultureChanging ||
            categoryChanging;

          if (needsConfirmation && !isConfirmed) {
            const confirmTarget = nameChanging
              ? nextName!
              : areaChanging && nextArea != null
                ? `${nextArea} га`
                : categoryChanging && nextCategory
                  ? categoryLabel(nextCategory)
                  : (nextCulture ?? "");
            const userHint = nameChanging
              ? `Змінити назву поля з «${currentName}» на «${nextName}»?`
              : areaChanging
                ? `Поле ${currentName}: змінити площу з ${currentArea} га на ${nextArea} га`
                : categoryChanging
                  ? `Поле ${currentName}: змінити тип з «${categoryLabel(currentCategory)}» на «${categoryLabel(nextCategory!)}»?`
                  : `Поле ${currentName}: змінити культуру з «${currentCrop || "—"}» на «${nextCulture}»`;
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId: field.id,
              fieldName: currentName,
              current: {
                name: currentName,
                areaHa: currentArea,
                culture: currentCrop || null,
                color: currentColor,
                category: currentCategory,
              },
              changes: {
                name: nameChanging
                  ? { from: currentName, to: nextName! }
                  : null,
                area: areaChanging
                  ? { from: currentArea, to: nextArea! }
                  : null,
                culture: cultureChanging
                  ? { from: currentCrop || null, to: nextCulture! }
                  : null,
                category: categoryChanging
                  ? { from: currentCategory, to: nextCategory! }
                  : null,
                color:
                  nextColor && nextColor !== currentColor
                    ? { from: currentColor, to: nextColor }
                    : null,
              },
              pending: {
                newName: nextName ?? null,
                newCulture: nextCulture ?? null,
                newArea: nextArea ?? null,
                color: nextColor ?? null,
                category: nextCategory ?? null,
                notes: notes ?? null,
              },
              warning:
                areaChanging || cultureChanging
                  ? "Зміна площі або культури вплине на розрахунки норм палива, списання ТМЦ та ставки ЗП!"
                  : categoryChanging
                    ? "Зміна категорії вплине на земельний банк і відображення на карті."
                    : "Підтверди зміну назви перед записом у базу.",
              confirmChoice: nameChanging
                ? `Так, змінити назву на ${nextName}`
                : `Так, підтверджую зміну на ${confirmTarget}`,
              cancelChoice: "Скасувати",
              userHint,
            };
          }

          // notes/color-only без confirmation — ок; інакше сюди з confirmed=true
          return await applyFieldDetailsUpdate(supabase, resolved, {
            name: nextName,
            culture: nextCulture,
            area: nextArea,
            notes,
            color: nextColor ?? undefined,
            category: nextCategory,
          });
        } catch (error) {
          console.error(
            "[TOOL: updateFieldDetails] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка оновлення поля",
          };
        }
      },
    }),

    updateFieldPlannedBudget: tool({
      description:
        "Змінює плановий бюджет поля ₴/га (потрібне confirmed перед записом).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        plannedBudgetPerHa: z
          .number()
          .positive()
          .describe("Бюджет ₴/га"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Підтвердження"),
      }),
      execute: async ({
        fieldIdOrName,
        plannedBudgetPerHa,
        confirmed = false,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const rate = round2(Number(plannedBudgetPerHa));
        console.log("[TOOL: updateFieldPlannedBudget]", {
          lookup,
          rate,
          confirmed,
        });

        try {
          if (!Number.isFinite(rate) || rate <= 0) {
            return {
              success: false as const,
              status: "error" as const,
              error: "plannedBudgetPerHa має бути додатним числом.",
            };
          }

          const resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season, planned_budget_per_ha"
          );
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const areaHa = finiteNumber(field.area_ha);
          const totalPlannedUah =
            areaHa > 0 ? round2(areaHa * rate) : null;
          const currentPerHa = finiteNumber(field.planned_budget_per_ha);

          if (!confirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId: field.id,
              fieldName,
              areaHa,
              currentPlannedBudgetPerHa: currentPerHa > 0 ? currentPerHa : null,
              plannedBudgetPerHa: rate,
              totalPlannedBudgetUah: totalPlannedUah,
              confirmChoice: "Підтвердити бюджет",
              cancelChoice: "Скасувати",
              userHint: `Змінити плановий бюджет поля «${fieldName}» на ${rate} ₴/га${
                totalPlannedUah != null
                  ? ` (загалом ≈ ${totalPlannedUah} ₴ при ${areaHa} га)`
                  : ""
              }?`,
              pending: {
                fieldIdOrName: field.id,
                plannedBudgetPerHa: rate,
              },
            };
          }

          const { error } = await supabase
            .from("farm_fields")
            .update({ planned_budget_per_ha: rate })
            .eq("id", field.id);

          if (error) {
            if (
              error.message?.includes("planned_budget_per_ha") ||
              error.code === "42703"
            ) {
              return {
                success: false as const,
                status: "error" as const,
                error:
                  "Колонка planned_budget_per_ha ще не створена. Потрібна міграція 018.",
              };
            }
            return {
              success: false as const,
              status: "error" as const,
              error: error.message,
            };
          }

          return {
            success: true as const,
            status: "updated" as const,
            fieldId: field.id,
            fieldName,
            areaHa,
            plannedBudgetPerHa: rate,
            totalPlannedBudgetUah: totalPlannedUah,
            updatedField: {
              id: field.id,
              name: fieldName,
              area: areaHa,
              crop: field.crop ?? null,
              plannedBudgetPerHa: rate,
            },
            message: `Плановий бюджет поля «${fieldName}» оновлено: ${rate} ₴/га${
              totalPlannedUah != null ? ` (≈ ${totalPlannedUah} ₴)` : ""
            }.`,
          };
        } catch (error) {
          console.error(
            "[TOOL: updateFieldPlannedBudget] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка оновлення бюджету",
          };
        }
      },
    }),

    analyzeAndSaveScoutingReport: tool({
      description:
        "Vision-діагностика фото посіву/рослини та збереження scouting_reports.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        userComment: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Коментар"),
        imageUrl: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("URL/base64 фото"),
      }),
      execute: async ({ fieldIdOrName, userComment, imageUrl }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: analyzeAndSaveScoutingReport]", {
          lookup,
          hasComment: Boolean(userComment?.trim()),
          hasImageUrl: Boolean(imageUrl?.trim()),
          attachmentCount: documentAttachments.length,
        });

        try {
          if (!lookup) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи поле для скаутингу (назва або ID).",
            };
          }

          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const image = await resolveAgentImageBytes({
            imageUrl,
            attachments: documentAttachments,
          });
          if (!image.ok) {
            return {
              success: false as const,
              status: "needs_photo" as const,
              error: image.error,
            };
          }

          if (!googleAi) {
            return {
              success: false as const,
              status: "error" as const,
              error: "Vision-модель недоступна (GOOGLE_GENERATIVE_AI_API_KEY).",
            };
          }

          const fieldCrop =
            (field.crop && String(field.crop).trim()) || "невідома";
          const agronomistNote = userComment?.trim() || "";

          const vision = await generateObject({
            model: googleAi(visionModelId),
            schema: SCOUTING_VISION_SCHEMA,
            providerOptions: {
              google: GOOGLE_NO_THINKING,
            },
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      "Ти агроном-діспетчер LEVADIUS. Зроби експрес-діагностику фото посіву.",
                      `Поле: ${fieldName}. Очікувана культура в паспорті: ${fieldCrop}.`,
                      agronomistNote
                        ? `Коментар агронома: ${agronomistNote}`
                        : null,
                      "Оціни: культуру й фазу росту; візуальний стан (хлороз, антоціан,",
                      "бурʼяни, шкідники, хвороби); riskLevel ok|warning|critical;",
                      "diagnosis — максимум 2 чітких речення українською з рекомендацією.",
                      "Не вигадуй те, чого не видно на фото.",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  },
                  {
                    type: "image",
                    image: image.bytes,
                    mediaType: image.mimeType.startsWith("image/")
                      ? image.mimeType
                      : "image/jpeg",
                  },
                ],
              },
            ],
          });

          const ai = vision.object;
          const aiDiagnosis = [
            ai.cropPhase.trim(),
            ai.visualState.trim(),
            ai.diagnosis.trim(),
          ]
            .filter(Boolean)
            .join(". ")
            .replace(/\.\s*\./g, ".");

          const notes = agronomistNote
            ? `[Агроном]: ${agronomistNote}\n[ШІ LEVADIUS]: ${ai.diagnosis.trim() || aiDiagnosis}`
            : ai.diagnosis.trim() || aiDiagnosis;

          const uploaded = await uploadAgentScoutingPhoto(supabase, field.id, {
            fileName: image.fileName,
            mimeType: image.mimeType,
            bytes: image.bytes,
          });
          if (!uploaded.ok) {
            return {
              success: false as const,
              status: "error" as const,
              error: uploaded.error,
            };
          }

          const today = todayKyivYmd();
          const payload: Record<string, unknown> = {
            field_id: field.id,
            date: today,
            notes,
            image_url: uploaded.storagePath,
            status: ai.riskLevel,
          };

          let { data, error } = await supabase
            .from("scouting_reports")
            .insert(payload)
            .select("id")
            .single();

          if (
            error &&
            (error.message?.includes("status") || error.code === "42703")
          ) {
            const { status: _s, ...withoutStatus } = payload;
            const retry = await supabase
              .from("scouting_reports")
              .insert(withoutStatus)
              .select("id")
              .single();
            data = retry.data;
            error = retry.error;
          }

          if (error || !data) {
            return {
              success: false as const,
              status: "error" as const,
              error: error?.message ?? "Не вдалося зберегти звіт скаутингу",
            };
          }

          const reportId = String(data.id);
          try {
            const actor = await getCurrentActor();
            await logActivity({
              actor,
              action: "create",
              entityType: "scouting_report",
              entityId: reportId,
              summary: `${actor.label}: ШІ-скаутинг ${fieldName} (${ai.riskLevel})`,
              meta: {
                fieldId: field.id,
                riskLevel: ai.riskLevel,
                cropPhase: ai.cropPhase,
              },
            });
          } catch {
            /* non-fatal */
          }

          return {
            success: true as const,
            status: "saved" as const,
            fieldId: field.id,
            fieldName,
            cropPhase: ai.cropPhase,
            visualState: ai.visualState,
            riskLevel: ai.riskLevel,
            diagnosis: ai.diagnosis,
            reportId,
            photoUrl: uploaded.storagePath,
            date: today,
            riskBadge:
              ai.riskLevel === "critical"
                ? "Ризик"
                : ai.riskLevel === "warning"
                  ? "Увага"
                  : "Норма",
            cardHint:
              "[icon:wheat] Діагностика посіву — запис уже в таймлайні поля",
          };
        } catch (error) {
          console.error(
            "[TOOL: analyzeAndSaveScoutingReport] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка ШІ-скаутингу",
          };
        }
      },
    }),

    createWorkOrderFromGpsVisit: tool({
      description:
        "Чернетка наряду з GPS/ДРП візиту техніки на полі (Wialon).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або UUID поля"),
        equipmentIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Техніка ID/назва"),
        date: z
          .string()
          .trim()
          .default("")
          .describe("Дата YYYY-MM-DD"),
        workType: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Тип операції"),
      }),
      execute: async ({
        fieldIdOrName,
        equipmentIdOrName,
        date: dateRaw,
        workType: workTypeRaw,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const dateResolved = resolveWorkOrderDateInput(
          dateRaw?.trim() || "сьогодні"
        );
        if ("error" in dateResolved) {
          return {
            success: false as const,
            status: "error" as const,
            error: dateResolved.error,
          };
        }
        const date = dateResolved.date;
        console.log("[TOOL: createWorkOrderFromGpsVisit]", {
          lookup,
          date,
          equipmentIdOrName,
          workTypeRaw,
        });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const areaHa = finiteNumber(field.area_ha);
          const crop = (field.crop && String(field.crop).trim()) || "—";
          const seasonYear =
            Number(date.slice(0, 4)) ||
            Number(field.season) ||
            new Date().getFullYear();

          let fuelQuery = supabase
            .from("wialon_field_fuel_logs")
            .select(
              `
              id,
              date,
              fuel_consumed,
              equipment_id,
              equipment (
                id,
                name
              )
            `
            )
            .eq("field_id", field.id)
            .eq("date", date)
            .gt("fuel_consumed", 0)
            .order("fuel_consumed", { ascending: false })
            .limit(12);

          const { data: fuelRows, error: fuelError } = await fuelQuery;
          if (fuelError) {
            if (
              fuelError.code === "PGRST205" ||
              fuelError.code === "42P01" ||
              fuelError.message?.includes("wialon_field_fuel_logs")
            ) {
              return {
                success: false as const,
                status: "error" as const,
                error:
                  "Таблиця wialon_field_fuel_logs відсутня. Потрібна міграція 020.",
              };
            }
            return {
              success: false as const,
              status: "error" as const,
              error: fuelError.message,
            };
          }

          type FuelVisit = {
            equipmentId: string;
            equipmentName: string;
            fuelConsumedL: number;
          };

          const visits: FuelVisit[] = [];
          for (const row of fuelRows ?? []) {
            const eqRaw = (row as { equipment?: unknown }).equipment;
            const eq = Array.isArray(eqRaw)
              ? (eqRaw[0] as { id?: string; name?: string | null } | undefined)
              : (eqRaw as
                  | { id?: string; name?: string | null }
                  | null
                  | undefined);
            const equipmentId =
              (eq?.id && String(eq.id)) ||
              (row.equipment_id ? String(row.equipment_id) : "");
            if (!equipmentId) continue;
            visits.push({
              equipmentId,
              equipmentName:
                (eq?.name && String(eq.name).trim()) || "Техніка",
              fuelConsumedL: round2(finiteNumber(row.fuel_consumed)),
            });
          }

          if (visits.length === 0) {
            return {
              success: false as const,
              status: "no_gps_visit" as const,
              fieldId: field.id,
              fieldName,
              date,
              error: `За ${date} на полі «${fieldName}» немає зафіксованої витрати палива Wialon (ДРП у геозоні).`,
            };
          }

          let chosen = visits[0]!;
          const eqLookup = equipmentIdOrName?.trim() || "";
          if (eqLookup) {
            if (isUuid(eqLookup)) {
              const byId = visits.find((v) => v.equipmentId === eqLookup);
              if (byId) chosen = byId;
              else {
                return {
                  success: false as const,
                  status: "equipment_not_on_field" as const,
                  error: `Техніка ${eqLookup} не має GPS-палива на полі «${fieldName}» за ${date}.`,
                  candidates: visits.map((v) => ({
                    id: v.equipmentId,
                    name: v.equipmentName,
                    fuelConsumedL: v.fuelConsumedL,
                  })),
                };
              }
            } else {
              const needle = eqLookup.toLocaleLowerCase("uk-UA");
              const match =
                visits.find(
                  (v) =>
                    v.equipmentName.toLocaleLowerCase("uk-UA") === needle
                ) ||
                visits.find((v) =>
                  v.equipmentName.toLocaleLowerCase("uk-UA").includes(needle)
                );
              if (match) chosen = match;
              else {
                return {
                  success: false as const,
                  status: "equipment_not_on_field" as const,
                  error: `Техніку «${eqLookup}» не знайдено серед GPS-візитів на полі за ${date}.`,
                  candidates: visits.map((v) => ({
                    id: v.equipmentId,
                    name: v.equipmentName,
                    fuelConsumedL: v.fuelConsumedL,
                  })),
                };
              }
            }
          } else if (visits.length > 1) {
            // беремо найбільшу витрату, але повертаємо alternatives
          }

          let workHours: number | null = null;
          let hoursOnField: number | null = null;
          const { data: dayStats } = await supabase
            .from("wialon_equipment_day_stats")
            .select("work_hours, hours_on_field, fuel_consumed")
            .eq("equipment_id", chosen.equipmentId)
            .eq("date", date)
            .maybeSingle();
          if (dayStats) {
            workHours = finiteNumber(dayStats.work_hours) || null;
            hoursOnField = finiteNumber(dayStats.hours_on_field) || null;
          }

          if (!workTypeRaw?.trim()) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              fieldId: field.id,
              fieldName,
              date,
              equipmentId: chosen.equipmentId,
              equipmentName: chosen.equipmentName,
              fuelConsumedL: chosen.fuelConsumedL,
              workHours,
              hoursOnField,
              areaHa,
              missing: ["workType"],
              error:
                "Вкажи тип операції для наряду з GPS (Дискування, Культивація, Оранка…).",
              suggestedWorkTypes: [...WORK_ORDER_TYPES],
              hint: "Яка робота була на полі?",
            };
          }

          const normalizedType = normalizeWorkOrderType(workTypeRaw);
          if (!normalizedType) {
            return {
              success: false as const,
              status: "error" as const,
              error: `Невідомий тип операції «${workTypeRaw}». Обери: ${WORK_ORDER_TYPES.join(", ")}.`,
              suggestedWorkTypes: [...WORK_ORDER_TYPES],
            };
          }

          const coveredAreaHa = areaHa > 0 ? areaHa : 0;
          const calculatedFuel =
            chosen.fuelConsumedL > 0
              ? chosen.fuelConsumedL
              : estimatePlanFuelLiters(normalizedType, coveredAreaHa);
          const wageRate = WAGE_UAH_PER_HA;
          const calculatedSalary = estimatePlanWageUah(coveredAreaHa);

          let implementId: string | null = null;
          let implementName = IMPLEMENT_PRESETS[normalizedType] || "";
          let implementWidthM: number | null = null;
          let implementAutoPicked = false;
          const typeHints = IMPLEMENT_DB_TYPES_BY_OP[normalizedType] ?? [];
          if (typeHints.length > 0) {
            const { data: byType } = await supabase
              .from("implements")
              .select("id, name, working_width_m, type")
              .in("type", typeHints)
              .order("name")
              .limit(5);
            const chosenImpl = (byType ?? [])[0];
            if (chosenImpl) {
              implementId = String(chosenImpl.id);
              implementName = String(chosenImpl.name ?? implementName);
              implementWidthM =
                finiteNumber(chosenImpl.working_width_m) || null;
              implementAutoPicked = true;
            }
          }
          if (!implementId && implementName) {
            const { data: byName } = await supabase
              .from("implements")
              .select("id, name, working_width_m")
              .ilike("name", `%${implementName}%`)
              .order("name")
              .limit(3);
            const hit = (byName ?? [])[0];
            if (hit) {
              implementId = String(hit.id);
              implementName = String(hit.name ?? implementName);
              implementWidthM = finiteNumber(hit.working_width_m) || null;
              implementAutoPicked = true;
            }
          }
          const hitchLabel = implementName
            ? `${chosen.equipmentName} + ${implementName}`
            : chosen.equipmentName;

          const draftId = crypto.randomUUID();
          const wialonNote =
            "[Згенеровано на основі телеметрії Wialon]" +
            (hoursOnField != null && hoursOnField > 0
              ? ` · ${round2(hoursOnField)} год на полі`
              : workHours != null && workHours > 0
                ? ` · ${round2(workHours)} мотогодин`
                : "") +
            (chosen.fuelConsumedL > 0
              ? ` · ДРП ${round2(chosen.fuelConsumedL)} л`
              : "");

          const formData = {
            fieldId: field.id,
            fieldKey: `farm:${field.id}`,
            fieldName,
            areaHa: coveredAreaHa,
            crop,
            season: String(seasonYear),
            operationType: normalizedType,
            date,
            timeRange: { start: "08:00", end: "18:00" },
            equipmentId: chosen.equipmentId,
            equipmentName: chosen.equipmentName,
            equipmentFound: true,
            implementId,
            implementName,
            implementWidthM,
            implementFound: Boolean(implementId),
            implementAutoPicked,
            hitchLabel,
            driverName: "Телеметрія Wialon",
            isNewDriver: false,
            driverNote: null as string | null,
            warehouseItemId: null as string | null,
            warehouseItemName: null as string | null,
            warehouseItemUnit: null as string | null,
            warehouseItemCategory: null as string | null,
            isNewWarehouseItem: false,
            materialQty: null as number | null,
            ratePerHa: wageRate || null,
            calculatedFuel,
            calculatedSalary,
            agronomistComment: wialonNote,
            source: "wialon_gps" as const,
            telemetry: {
              fuelConsumedL: chosen.fuelConsumedL,
              workHours,
              hoursOnField,
              visitsCount: visits.length,
            },
          };

          return {
            success: true as const,
            status: "ready" as const,
            workOrderId: draftId,
            draftId,
            formData,
            message:
              "Чернетку з GPS підготовано. Після підтвердження в картці наряд збережеться.",
            summary: `${normalizedType} на ${fieldName}: ${hitchLabel} (Wialon)`,
            alternatives:
              visits.length > 1
                ? visits
                    .filter((v) => v.equipmentId !== chosen.equipmentId)
                    .map((v) => ({
                      equipmentId: v.equipmentId,
                      equipmentName: v.equipmentName,
                      fuelConsumedL: v.fuelConsumedL,
                    }))
                : [],
          };
        } catch (error) {
          console.error(
            "[TOOL: createWorkOrderFromGpsVisit] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка наряду з GPS",
          };
        }
      },
    }),

    getOperationRates: tool({
      description: "Читає тарифи операцій ₴/га.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[TOOL: getOperationRates]");
        try {
          const catalog = [
            ...new Set<string>([
              ...OPERATION_TYPES,
              ...WORK_ORDER_TYPES,
            ]),
          ];

          const [{ data: rateRows, error: ratesError }, { data: opTypes }] =
            await Promise.all([
              supabase
                .from("work_type_wage_rates")
                .select("work_type, rate_uah_per_ha, updated_at")
                .order("work_type"),
              supabase
                .from("field_operations")
                .select("work_type")
                .neq("status", "cancelled")
                .limit(2_000),
            ]);

          if (ratesError) {
            if (
              ratesError.message?.includes("work_type_wage_rates") ||
              ratesError.code === "42P01" ||
              ratesError.code === "42703"
            ) {
              return {
                status: "error" as const,
                error:
                  "Таблиця ставок відсутня. Потрібна міграція 058_field_op_mechanic_wage_rate.sql",
                configured: [],
                missing: catalog.map((operationType) => operationType),
              };
            }
            return {
              status: "error" as const,
              error: ratesError.message,
              configured: [],
              missing: [],
            };
          }

          const rateByType = new Map<string, number>();
          for (const row of rateRows ?? []) {
            const key = normalizeWorkTypeKey(String(row.work_type ?? ""));
            if (!key) continue;
            const rate = Number(row.rate_uah_per_ha);
            if (!Number.isFinite(rate)) continue;
            rateByType.set(key, Math.round(rate * 100) / 100);
          }

          const fromOps = new Set<string>();
          for (const row of opTypes ?? []) {
            const key = normalizeWorkTypeKey(String(row.work_type ?? ""));
            if (key) fromOps.add(key);
          }

          const allTypes = [
            ...new Set([...catalog, ...fromOps, ...rateByType.keys()]),
          ].sort((a, b) => a.localeCompare(b, "uk"));

          const configured: Array<{
            operationType: string;
            ratePerHa: number;
          }> = [];
          const missing: string[] = [];

          for (const operationType of allTypes) {
            const rate = rateByType.get(operationType);
            if (typeof rate === "number" && rate > 0) {
              configured.push({
                operationType,
                ratePerHa: rate,
              });
            } else {
              missing.push(operationType);
            }
          }

          return {
            status: "ok" as const,
            unit: "₴/га",
            configuredCount: configured.length,
            missingCount: missing.length,
            configured,
            missing: missing.slice(0, 40),
          };
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання тарифів",
            configured: [],
            missing: [],
          };
        }
      },
    }),

    setOperationRate: tool({
      description: "Записує тариф ₴/га для типу операції.",
      inputSchema: z.object({
        operationType: z
          .string()
          .trim()
          .min(1)
          .describe("Назва операції"),
        ratePerHa: z
          .number()
          .finite()
          .nonnegative()
          .describe("Ставка ₴/га"),
      }),
      execute: async ({ operationType, ratePerHa }) => {
        const normalized =
          normalizeWorkOrderType(operationType) ??
          normalizeWorkTypeKey(operationType);
        if (!normalized) {
          return {
            success: false as const,
            error: "Некоректна назва операції",
          };
        }
        const rate = Math.round(ratePerHa * 100) / 100;
        console.log("[TOOL: setOperationRate]", { normalized, rate });

        try {
          const { error } = await supabase.from("work_type_wage_rates").upsert(
            {
              work_type: normalized,
              rate_uah_per_ha: rate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "work_type" }
          );

          if (error) {
            if (
              error.message?.includes("work_type_wage_rates") ||
              error.code === "42P01"
            ) {
              return {
                success: false as const,
                error:
                  "Потрібна міграція 058 (work_type_wage_rates). Не викликай logUnsupportedRequest.",
              };
            }
            return { success: false as const, error: error.message };
          }

          return {
            success: true as const,
            operationType: normalized,
            ratePerHa: rate,
            message: `Ставку для «${normalized}» оновлено: ${rate} ₴/га`,
          };
        } catch (error) {
          return {
            success: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка збереження ставки",
          };
        }
      },
    }),

    logUnsupportedRequest: tool({
      description: "Логує непідтримуваний запит у беклог.",
      inputSchema: z.object({
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .describe("Текст запиту"),
        category: z
          .enum([
            "fields",
            "equipment",
            "fuel",
            "warehouse",
            "finance",
            "accounting",
            "other",
          ])
          .describe("Категорія беклогу"),
        reason: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .describe("Причина"),
      }),
      execute: async ({ prompt, category, reason }) => {
        console.log("[TOOL: logUnsupportedRequest]", {
          category,
          requestedBy: actorName,
        });
        try {
          const { data, error } = await supabase
            .from("ai_unhandled_requests")
            .insert({
              user_id: actorUserId,
              requested_by: actorName,
              prompt: prompt.trim(),
              category,
              reason: reason.trim(),
            })
            .select("id, created_at")
            .maybeSingle();

          if (error) {
            console.error(
              "[TOOL: logUnsupportedRequest] insert failed:",
              error.message
            );
            return {
              status: "error" as const,
              error: `Не вдалося записати в беклог: ${error.message}`,
              logged: false,
            };
          }

          return {
            status: "logged" as const,
            logged: true,
            id: data?.id ?? null,
            category,
            categoryLabel: unhandledCategoryLabels[category],
            requestedBy: actorName,
            createdAt: data?.created_at ?? null,
            userReplyHint:
              "Повна халепа, такого я ще не вмію робити, але Назар навчить скоро! Записав цей запит Назару в план прокачки.",
          };
        } catch (error) {
          console.error(
            "[TOOL: logUnsupportedRequest] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            logged: false,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка запису беклогу",
          };
        }
      },
    }),

    getUnhandledRequests: tool({
      description: "Читає беклог непідтримуваних запитів.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(10)
          .describe("Ліміт"),
      }),
      execute: async ({ limit }) => {
        const take = limit ?? 10;
        console.log("[TOOL: getUnhandledRequests]", { limit: take });
        try {
          const { data, error } = await supabase
            .from("ai_unhandled_requests")
            .select("id, prompt, category, reason, requested_by, created_at")
            .order("created_at", { ascending: false })
            .limit(take);

          if (error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати беклог: ${error.message}`,
              total: 0,
              recent: [],
            };
          }

          const rows = data ?? [];

          const { count: totalCount } = await supabase
            .from("ai_unhandled_requests")
            .select("id", { count: "exact", head: true });

          return {
            status: "ok" as const,
            total: totalCount ?? rows.length,
            recent: rows.map((row) => ({
              id: row.id,
              prompt: String(row.prompt ?? "").slice(0, 180),
              category: row.category,
              reason: String(row.reason ?? "").slice(0, 120),
              by: row.requested_by,
              at: row.created_at,
            })),
          };
        } catch (error) {
          console.error(
            "[TOOL: getUnhandledRequests] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання беклогу",
            total: 0,
            recent: [],
          };
        }
      },
    }),
  };
}

export async function POST(request: Request) {
  let rawRequest: unknown = null;
  let userId: string | null = null;

  try {
    const authSupabase = await createAuthServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Потрібна авторизація" },
        { status: 401 }
      );
    }
    userId = user.id;

    const actor = await getCurrentActor();
    if (!canAccessLevadius(actor)) {
      return NextResponse.json(
        { ok: false, error: "LEVADIUS поки доступний лише адміністратору" },
        { status: 403 }
      );
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "Не налаштовано GOOGLE_GENERATIVE_AI_API_KEY",
        },
        { status: 500 }
      );
    }

    rawRequest = await request.json();
    const parsed = requestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Некоректний запит",
          details: z.treeifyError(parsed.error),
        },
        { status: 400 }
      );
    }

    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    const uiMessages = (parsed.data.messages ?? [
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text", text: parsed.data.prompt as string }],
      },
    ]) as unknown as UIMessage[];

    const llmMessages = sanitizeUiMessagesForLlm(uiMessages);
    const modelMessages = await convertToModelMessages(llmMessages);
    const promptText = extractPromptText(uiMessages as unknown[]);
    const hasInvoiceAttachment = uiMessagesHaveFileAttachment(
      llmMessages as unknown[]
    );
    const modelCandidates = resolveModelCandidates();
    let activeModelIndex = 0;

    console.log(
      `[LEVADIUS] client=${parsed.data.userContext?.client ?? "?"} models=${modelCandidates.join(" → ")} (start: ${modelCandidates[0]}) attachment=${hasInvoiceAttachment} history=${uiMessages.length}→${llmMessages.length}`
    );

    // AI SDK 7: кілька tool-кроків для наряду (склад → флот → водії → draft)
    const result = streamText({
      model: google(modelCandidates[0]!),
      system: buildSystemPrompt(parsed.data.userContext, {
        hasInvoiceAttachment,
      }),
      messages: modelMessages,
      tools: createAgentTools({
        activeFieldId: parsed.data.userContext?.activeFieldId,
        userId,
        userName: parsed.data.userContext?.userName,
        google,
        modelId: modelCandidates[0],
        documentAttachments: extractLastUserFileAttachments(
          uiMessages as unknown[]
        ),
      }),
      providerOptions: {
        google: GOOGLE_NO_THINKING,
      },
      stopWhen: stepCountIs(8),
      maxRetries: 1,
      streamRetries: Math.max(modelCandidates.length - 1, 0),
      prepareStep: () => ({
        model: google(modelCandidates[activeModelIndex]!),
        providerOptions: {
          google: GOOGLE_NO_THINKING,
        },
      }),
      onError: ({ error }) => {
        console.error(
          `[LEVADIUS] streamText error (${modelCandidates[activeModelIndex]}):`,
          errorText(error)
        );

        if (
          isRetriableModelError(error) &&
          activeModelIndex < modelCandidates.length - 1
        ) {
          activeModelIndex += 1;
          console.warn(
            `[LEVADIUS] model retry → fallback ${modelCandidates[activeModelIndex]}`
          );
          return { retry: true };
        }
      },
      onFinish: async ({ text, steps, finishReason }) => {
        try {
          if (!userId) return;
          await writeAgentLog({
            userId,
            request: rawRequest,
            prompt: promptText,
            response: text,
            toolCalls: serializeToolCalls(steps),
            finishReason,
            status: "completed",
            model: modelCandidates[activeModelIndex]!,
          });
        } catch (logError) {
          console.error(
            "Помилка збереження логу LEVADIUS:",
            logError instanceof Error ? logError.message : logError
          );
        }
      },
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      onError: humanizeAgentError,
    });
  } catch (error) {
    const message = humanizeAgentError(error);

    if (userId) {
      try {
        const fallbackPrompt =
          extractPromptText(
            Array.isArray((rawRequest as { messages?: unknown })?.messages)
              ? ((rawRequest as { messages: unknown[] }).messages as unknown[])
              : []
          ) || "Запит без тексту";

        await writeAgentLog({
          userId,
          request: rawRequest,
          prompt: fallbackPrompt,
          response: null,
          toolCalls: [],
          finishReason: null,
          status: "failed",
          model: resolveModelCandidates()[0]!,
          error: message,
        });
      } catch (logError) {
        console.error(
          "Помилка збереження логу LEVADIUS:",
          logError instanceof Error ? logError.message : logError
        );
      }
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

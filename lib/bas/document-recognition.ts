/**
 * Розпізнавання довільних документів + маршрутизація чернеток у розділи.
 * Queue-Only: enqueueBasDraft без OData POST.
 */

import "server-only";

import { z } from "zod";

import {
  buildRecognizedDocumentOdataPayload,
  enqueueBasDraft,
  getBasDraftById,
  markBasDraftRouted,
  type BasDraftDocumentType,
} from "@/lib/bas/queue";
import { prepareOrCreateInventoryInbound } from "@/lib/agent-inventory-moves";
import { executeFuelPurchase, type FuelStorageRow } from "@/lib/agent-fuel-ops";
import { createServiceSupabase } from "@/lib/supabase/server";
import { todayKyivYmd } from "@/lib/kyiv-date";

export const DOCUMENT_VISION_SCHEMA = z.object({
  classification: z
    .enum([
      "goods_receipt",
      "service_act",
      "grain_receipt",
      "fuel_receipt",
      "uncertain",
    ])
    .describe("Клас документа"),
  basDocument: z.string().describe("Рекомендований Document_* BAS"),
  basSection: z.enum(["Товари", "Послуги", "Зерно", "Аванс", "Невідомо"]),
  basStandardLabel: z
    .string()
    .describe("Людська назва стандарту BAS українською"),
  counterparty: z.string().nullable(),
  docNumber: z.string().nullable(),
  docDate: z.string().nullable().describe("YYYY-MM-DD якщо видно"),
  totalAmountUah: z.number().nullable(),
  currency: z.string().nullable().default("UAH"),
  lines: z
    .array(
      z.object({
        name: z.string(),
        unit: z.string().nullable().optional(),
        qty: z.number().nullable().optional(),
        price: z.number().nullable().optional(),
        sum: z.number().nullable().optional(),
      })
    )
    .default([]),
  alternatives: z
    .array(z.string())
    .default([])
    .describe("Альтернативні типи, якщо uncertain"),
  confidence: z.number().min(0).max(1).optional(),
  summaryUk: z.string().describe("Короткий підсумок українською"),
});

export type DocumentVisionResult = z.infer<typeof DOCUMENT_VISION_SCHEMA>;

export function mapClassificationToQueueType(
  classification: DocumentVisionResult["classification"]
): BasDraftDocumentType {
  if (classification === "goods_receipt") return "inventory_inbound";
  if (classification === "service_act") return "service_receipt";
  if (classification === "grain_receipt") return "grain_receipt";
  if (classification === "fuel_receipt") return "fuel_advance";
  return "unknown_document";
}

export function defaultBasDocumentForClass(
  classification: DocumentVisionResult["classification"]
): {
  basDocument: string;
  basSection: DocumentVisionResult["basSection"];
  label: string;
} {
  if (classification === "goods_receipt") {
    return {
      basDocument: "Document_ПоступлениеТоваровУслуг",
      basSection: "Товари",
      label: "Товарна накладна (Поступление · Товари)",
    };
  }
  if (classification === "service_act") {
    return {
      basDocument: "Document_ПоступлениеТоваровУслуг",
      basSection: "Послуги",
      label: "Акт послуг / СТО (Поступление · Послуги)",
    };
  }
  if (classification === "grain_receipt") {
    return {
      basDocument: "Document_ОприходованиеСельхозпродукции",
      basSection: "Зерно",
      label: "Оприбуткування сільгосппродукції",
    };
  }
  if (classification === "fuel_receipt") {
    return {
      basDocument: "Document_АвансовыйОтчет",
      basSection: "Аванс",
      label: "Авансовий звіт / чек на пальне",
    };
  }
  return {
    basDocument: "Document_ПоступлениеТоваровУслуг",
    basSection: "Невідомо",
    label: "Потрібне уточнення типу",
  };
}

export async function persistRecognizedDocumentDraft(input: {
  vision: DocumentVisionResult;
  docHint?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}): Promise<
  | {
      ok: true;
      draftId: string;
      dryRun: boolean;
      status: string;
      queueType: BasDraftDocumentType;
      basStandardLabel: string;
      counterparty: string | null;
      docDate: string | null;
      totalAmountUah: number | null;
      lineCount: number;
      alternatives: string[];
      summaryUk: string;
      message: string;
    }
  | { ok: false; error: string }
> {
  const vision = input.vision;
  const defaults = defaultBasDocumentForClass(vision.classification);
  const basDocument = vision.basDocument?.trim() || defaults.basDocument;
  const basSection = vision.basSection || defaults.basSection;
  const basStandardLabel =
    vision.basStandardLabel?.trim() || defaults.label;

  const queueType = mapClassificationToQueueType(vision.classification);
  const entityId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const payload = buildRecognizedDocumentOdataPayload({
    classification: vision.classification,
    basDocument,
    basSection,
    counterparty: vision.counterparty,
    docNumber: vision.docNumber,
    docDate: vision.docDate,
    totalAmountUah: vision.totalAmountUah,
    lines: vision.lines,
    alternatives: vision.alternatives,
    docHint: input.docHint,
  });

  const queued = await enqueueBasDraft({
    documentType: queueType,
    entityId,
    payload,
    summary: vision.summaryUk,
    requireApproval: vision.classification === "uncertain",
    actorId: input.actorId,
    actorName: input.actorName,
  });

  if (!queued.ok) return queued;

  return {
    ok: true,
    draftId: queued.draftId,
    dryRun: queued.dryRun,
    status: queued.status,
    queueType,
    basStandardLabel,
    counterparty: vision.counterparty,
    docDate: vision.docDate,
    totalAmountUah: vision.totalAmountUah,
    lineCount: vision.lines.length,
    alternatives: vision.alternatives ?? [],
    summaryUk: vision.summaryUk,
    message: queued.message,
  };
}

export type DraftRouteSection =
  | "inventory"
  | "accounting"
  | "equipment"
  | "fuel";

function extractLines(payload: Record<string, unknown>) {
  const goods = Array.isArray(payload.Товары)
    ? (payload.Товары as Array<Record<string, unknown>>)
    : [];
  const services = Array.isArray(payload.Услуги)
    ? (payload.Услуги as Array<Record<string, unknown>>)
    : [];
  return goods.length > 0 ? goods : services;
}

export async function routeDraftToLocalSection(input: {
  draftId: string;
  targetSection: DraftRouteSection;
  sendToBasQueue?: boolean;
  actorId?: string | null;
  actorName?: string | null;
}): Promise<
  | {
      ok: true;
      draftId: string;
      targetSection: DraftRouteSection;
      localEntityId: string | null;
      clientEvents: string[];
      basQueued: boolean;
      message: string;
    }
  | { ok: false; error: string }
> {
  const draft = await getBasDraftById(input.draftId);
  if (!draft.ok) return draft;

  const meta = (draft.row.payload._meta as Record<string, unknown>) ?? {};
  const linesRaw = extractLines(draft.row.payload);
  const counterparty =
    (typeof draft.row.payload.КонтрагентНаименование === "string"
      ? draft.row.payload.КонтрагентНаименование
      : null) || "Контрагент";
  const docDate =
    typeof draft.row.payload.Date === "string"
      ? String(draft.row.payload.Date).slice(0, 10)
      : todayKyivYmd();

  let localEntityId: string | null = null;
  const clientEvents: string[] = [];
  const sendToBas = input.sendToBasQueue !== false;
  const supabase = createServiceSupabase();

  if (input.targetSection === "inventory") {
    const first = linesRaw[0];
    const name =
      (first &&
        String(first.НоменклатураНаименование ?? first.name ?? "").trim()) ||
      "ТМЦ з документа";
    const qty = Number(first?.Количество ?? first?.qty ?? 1) || 1;
    const price =
      Number(first?.Цена ?? first?.price ?? 0) ||
      (qty > 0 && Number(draft.row.payload.СуммаДокумента)
        ? Number(draft.row.payload.СуммаДокумента) / qty
        : 0) ||
      1;
    const unit =
      (first && String(first.ЕдиницаИзмерения ?? first.unit ?? "шт")) || "шт";

    const created = await prepareOrCreateInventoryInbound({
      itemIdOrName: name,
      quantity: qty,
      pricePerUnit: price,
      supplier: counterparty,
      notes: `Чернетка ${input.draftId}`,
      confirmed: true,
      unitHint: unit,
      categoryHint: "parts",
    });

    if (created.success !== true) {
      return {
        ok: false,
        error:
          typeof created.error === "string"
            ? created.error
            : "Не вдалося оприбуткувати на склад",
      };
    }
    localEntityId =
      typeof created.moveId === "string"
        ? created.moveId
        : typeof created.id === "string"
          ? created.id
          : input.draftId;
    clientEvents.push("warehouse-updated");

    if (sendToBas) {
      await enqueueBasDraft({
        documentType: "inventory_inbound",
        entityId: localEntityId,
        payload: {
          ...draft.row.payload,
          Posted: false,
          _meta: {
            ...meta,
            routedFromDraftId: input.draftId,
            moveId: localEntityId,
            basDocument: "Document_ПоступлениеТоваровУслуг",
          },
        },
        summary: `Прихід зі скану → ${name}`,
        actorId: input.actorId,
        actorName: input.actorName,
      });
    }
  } else if (input.targetSection === "accounting") {
    const services = linesRaw.map((line) => ({
      name: String(line.НоменклатураНаименование ?? line.name ?? "Послуга"),
      quantity: Number(line.Количество ?? line.qty ?? 1) || 1,
      unit: String(line.ЕдиницаИзмерения ?? line.unit ?? "послуга"),
      pricePerUnit: Number(line.Цена ?? line.price ?? 0) || 0,
    }));
    const list =
      services.length > 0
        ? services
        : [
            {
              name: "Послуга з документа",
              quantity: 1,
              unit: "послуга",
              pricePerUnit: Number(draft.row.payload.СуммаДокумента) || 0,
            },
          ];
    const total = list.reduce(
      (s, row) => s + row.quantity * row.pricePerUnit,
      0
    );

    const { data, error } = await supabase
      .from("accounting_acts")
      .insert({
        contractor_name: counterparty,
        act_date: docDate,
        act_number:
          typeof draft.row.payload.НомерВходящегоДокумента === "string"
            ? String(draft.row.payload.НомерВходящегоДокумента)
            : null,
        total_amount: Math.round(total * 100) / 100,
        status: "preview",
        category: "Сервіс техніки",
        notes: `Чернетка ${input.draftId}`,
        services: list,
        source: "levadius",
      })
      .select("id")
      .maybeSingle();

    if (error || !data?.id) {
      return {
        ok: false,
        error: error?.message || "Не записав акт у бухгалтерію",
      };
    }
    localEntityId = String(data.id);
    clientEvents.push("accounting-updated");

    if (sendToBas) {
      await enqueueBasDraft({
        documentType: "service_receipt",
        entityId: localEntityId,
        payload: {
          ...draft.row.payload,
          Posted: false,
          _meta: {
            ...meta,
            routedFromDraftId: input.draftId,
            actId: localEntityId,
            basDocument: "Document_ПоступлениеТоваровУслуг",
            basSection: "Послуги",
          },
        },
        summary: `Акт послуг · ${counterparty}`,
        actorId: input.actorId,
        actorName: input.actorName,
      });
    }
  } else if (input.targetSection === "equipment") {
    localEntityId = input.draftId;
    clientEvents.push("equipment-updated", "accounting-updated");
    if (sendToBas) {
      await enqueueBasDraft({
        documentType: "service_receipt",
        entityId: `${input.draftId}:equipment`,
        payload: {
          ...draft.row.payload,
          Posted: false,
          _meta: {
            ...meta,
            routedFromDraftId: input.draftId,
            basDocument: "Document_ПоступлениеТоваровУслуг",
            basSection: "Послуги",
            target: "equipment",
          },
        },
        summary: `Документ до техніки · ${counterparty}`,
        actorId: input.actorId,
        actorName: input.actorName,
      });
    }
  } else if (input.targetSection === "fuel") {
    const liters =
      Number(linesRaw[0]?.Количество) ||
      Number(linesRaw[0]?.qty) ||
      0;
    const price =
      Number(linesRaw[0]?.Цена) ||
      Number(linesRaw[0]?.price) ||
      (liters > 0 && Number(draft.row.payload.СуммаДокумента)
        ? Number(draft.row.payload.СуммаДокумента) / liters
        : 50);

    const { data: storage } = await supabase
      .from("fuel_storages")
      .select("id, name, type, capacity, current_volume, price_per_liter")
      .eq("type", "stationary")
      .order("name")
      .limit(1)
      .maybeSingle();

    if (storage?.id && liters > 0) {
      const storageRow: FuelStorageRow = {
        id: String(storage.id),
        name: String(storage.name),
        type: storage.type != null ? String(storage.type) : "stationary",
        capacity: Number(storage.capacity) || 0,
        current_volume: Number(storage.current_volume) || 0,
        price_per_liter: Number(storage.price_per_liter) || 0,
      };
      const purchase = await executeFuelPurchase({
        supabase,
        storage: storageRow,
        liters,
        pricePerLiter: price > 0 ? price : 50,
        supplier: counterparty,
        transactionDate: docDate,
      });
      if (purchase.ok) {
        localEntityId = purchase.transactionId;
        clientEvents.push("fuel-updated");
      } else {
        localEntityId = input.draftId;
        clientEvents.push("fuel-updated");
      }
    } else {
      localEntityId = input.draftId;
      clientEvents.push("fuel-updated");
    }

    if (sendToBas) {
      await enqueueBasDraft({
        documentType: "fuel_advance",
        entityId: localEntityId || input.draftId,
        payload: {
          ...draft.row.payload,
          Posted: false,
          _meta: {
            ...meta,
            routedFromDraftId: input.draftId,
            basDocument: "Document_АвансовыйОтчет",
          },
        },
        summary: `Чек/аванс ДП · ${counterparty}`,
        actorId: input.actorId,
        actorName: input.actorName,
      });
    }
  }

  await markBasDraftRouted({
    draftId: input.draftId,
    targetSection: input.targetSection,
    localEntityId,
    notes: `Маршрут → ${input.targetSection}`,
  });

  const sectionLabel =
    input.targetSection === "inventory"
      ? "Склад"
      : input.targetSection === "accounting"
        ? "Бухгалтерія"
        : input.targetSection === "equipment"
          ? "Техніка"
          : "Паливо";

  return {
    ok: true,
    draftId: input.draftId,
    targetSection: input.targetSection,
    localEntityId,
    clientEvents,
    basQueued: sendToBas,
    message: `Чернетку додано в bas_sync_queue · розділ «${sectionLabel}».`,
  };
}

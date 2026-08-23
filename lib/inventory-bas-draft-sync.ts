/**
 * Чернетки Лімітно-забірних карт у BAS (Document_ИНАГРО_ЛимитноЗаборнаяКарта).
 *
 * За замовчуванням DRY RUN: POST у 1С вимкнений (BAS_DRAFT_POST_ENABLED = false).
 * Проведені документи не чіпаємо — лише Posted: false.
 * Увімкнення реального POST — лише за явним підтвердженням (див. bas-readonly).
 */

import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Увімкни лише після явного підтвердження бухгалтерії / задачі.
 * true → реальний POST чернетки в OData (Posted: false).
 */
const BAS_DRAFT_POST_ENABLED = false;

export type LimitCardMaterialLine = {
  LineNumber: number;
  Номенклатура_Key: string;
  Количество: number;
  ПлощадьПоля?: number;
  Коэффициент?: number;
};

export type LimitCardDraftPayload = {
  Date: string;
  Posted: false;
  DeletionMark: false;
  Комментарий: string;
  /** Поле BAS (підрозділ), якщо є bas_ref_key у farm_fields */
  УдалитьПодразделение_Key?: string;
  Склад_Key?: string;
  Организация_Key?: string;
  Материалы: LimitCardMaterialLine[];
  /** Мета для логу / UI (не відправляється в 1С) */
  _meta: {
    groupKey: string;
    fieldId: string | null;
    fieldName: string;
    moveIds: string[];
    moveCount: number;
  };
};

export type SyncLocalMovesToBasResult = {
  dryRun: boolean;
  draftCount: number;
  moveCount: number;
  payloads: LimitCardDraftPayload[];
};

type DraftMoveRow = {
  id: string;
  item_ref_key: string;
  field_id: string | null;
  qty: number;
  date: string;
  farm_fields: {
    id: string;
    name: string;
    area_ha: number;
    bas_ref_key: string | null;
  } | null;
  inventory_items_cache: {
    bas_ref_key: string;
    name: string;
    category: string;
    unit: string | null;
  } | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} не задано в env`);
  return value;
}

function basicAuthHeader(): string {
  const token = Buffer.from(
    `${requiredEnv("BAS_USER")}:${requiredEnv("BAS_PASS")}`,
    "utf8"
  ).toString("base64");
  return `Basic ${token}`;
}

function odataBaseUrl(): string {
  return requiredEnv("BAS_ODATA_URL").replace(/\/+$/, "");
}

function toIsoDateTime(iso: string): string {
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return `${day}T00:00:00`;
  return new Date(iso).toISOString().slice(0, 19);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10) || "unknown-date";
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function buildPayloads(rows: DraftMoveRow[]): LimitCardDraftPayload[] {
  type Group = {
    key: string;
    fieldId: string | null;
    fieldName: string;
    fieldBasKey: string | null;
    areaHa: number;
    dateIso: string;
    moveIds: string[];
    lines: { itemKey: string; qty: number; name: string }[];
  };

  const groups = new Map<string, Group>();

  for (const row of rows) {
    const field = unwrapOne(row.farm_fields);
    const item = unwrapOne(row.inventory_items_cache);
    if (!item?.bas_ref_key) continue;

    const fieldId = field?.id ?? row.field_id;
    const dateDay = dayKey(row.date);
    const key = `${fieldId ?? "no-field"}|${dateDay}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        fieldId: fieldId ?? null,
        fieldName: field?.name ?? "Без поля",
        fieldBasKey: field?.bas_ref_key
          ? String(field.bas_ref_key).toLowerCase()
          : null,
        areaHa: Number(field?.area_ha) || 0,
        dateIso: toIsoDateTime(row.date),
        moveIds: [],
        lines: [],
      };
      groups.set(key, g);
    }

    g.moveIds.push(row.id);
    const itemKey = String(item.bas_ref_key).toLowerCase();
    const existing = g.lines.find((l) => l.itemKey === itemKey);
    const qty = Number(row.qty) || 0;
    if (existing) existing.qty += qty;
    else {
      g.lines.push({
        itemKey,
        qty,
        name: item.name,
      });
    }
  }

  const orgKey = process.env.BAS_ORGANIZATION_KEY?.trim().toLowerCase();
  const warehouseKey = process.env.BAS_DEFAULT_WAREHOUSE_KEY
    ?.trim()
    .toLowerCase();

  return [...groups.values()]
    .filter((g) => g.lines.length > 0)
    .map((g) => {
      const materials: LimitCardMaterialLine[] = g.lines.map((line, idx) => ({
        LineNumber: idx + 1,
        Номенклатура_Key: line.itemKey,
        Количество: Math.round(line.qty * 1000) / 1000,
        Коэффициент: 1,
        ...(g.areaHa > 0 ? { ПлощадьПоля: g.areaHa } : {}),
      }));

      const namesPreview = g.lines
        .slice(0, 3)
        .map((l) => l.name)
        .join(", ");

      const payload: LimitCardDraftPayload = {
        Date: g.dateIso,
        Posted: false,
        DeletionMark: false,
        Комментарий: [
          "AgroSystem · тіньовий склад (чернетка)",
          `Поле: ${g.fieldName}`,
          `Рухів: ${g.moveIds.length}`,
          namesPreview ? `ТМЦ: ${namesPreview}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        Материалы: materials,
        _meta: {
          groupKey: g.key,
          fieldId: g.fieldId,
          fieldName: g.fieldName,
          moveIds: g.moveIds,
          moveCount: g.moveIds.length,
        },
      };

      if (g.fieldBasKey) {
        payload.УдалитьПодразделение_Key = g.fieldBasKey;
      }
      if (orgKey) payload.Организация_Key = orgKey;
      if (warehouseKey) payload.Склад_Key = warehouseKey;

      return payload;
    });
}

/** Тіло для OData без службового _meta */
export function toODataBody(
  payload: LimitCardDraftPayload
): Record<string, unknown> {
  const { _meta: _ignored, ...body } = payload;
  return body;
}

/**
 * Реальний POST чернетки. Зараз викликається лише якщо BAS_DRAFT_POST_ENABLED.
 */
async function postBasLimitCardDraft(
  body: Record<string, unknown>
): Promise<{ ok: true; refKey?: string } | { ok: false; error: string }> {
  const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(
    "Document_ИНАГРО_ЛимитноЗаборнаяКарта"
  )}?$format=json`;

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let parsed: { Ref_Key?: string; "odata.error"?: { message?: { value?: string } | string } };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return {
        ok: false,
        error: `відповідь не JSON (HTTP ${response.status})`,
      };
    }

    if (!response.ok || parsed["odata.error"]) {
      const err = parsed["odata.error"]?.message;
      const msg =
        typeof err === "string"
          ? err
          : err && typeof err === "object"
            ? err.value
            : undefined;
      return {
        ok: false,
        error: `HTTP ${response.status}${msg ? ` — ${msg}` : ""}`,
      };
    }

    return { ok: true, refKey: parsed.Ref_Key };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "мережева помилка",
    };
  }
}

/**
 * Витягує draft-рухи, формує чернетки ЛЗК.
 * Dry-run: лише console.log JSON — статус sent_to_1c НЕ змінюємо ніколи тут
 * (інакше рухи зникають з /export до бухгалтера).
 * sent_to_1c — лише на /export після «Позначити як передані».
 */
export async function syncLocalMovesToBas(): Promise<SyncLocalMovesToBasResult> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select(
      `
      id,
      item_ref_key,
      field_id,
      qty,
      date,
      farm_fields (
        id,
        name,
        area_ha,
        bas_ref_key
      ),
      inventory_items_cache (
        bas_ref_key,
        name,
        category,
        unit
      )
    `
    )
    .eq("status", "draft")
    .eq("type", "outbound")
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`inventory_local_moves: ${error.message}`);
  }

  const rows: DraftMoveRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    item_ref_key: String(row.item_ref_key),
    field_id: (row.field_id as string | null) ?? null,
    qty: Number(row.qty) || 0,
    date: String(row.date),
    farm_fields: unwrapOne(
      row.farm_fields as
        | DraftMoveRow["farm_fields"]
        | DraftMoveRow["farm_fields"][]
    ),
    inventory_items_cache: unwrapOne(
      row.inventory_items_cache as
        | DraftMoveRow["inventory_items_cache"]
        | DraftMoveRow["inventory_items_cache"][]
    ),
  }));

  if (rows.length === 0) {
    return {
      dryRun: !BAS_DRAFT_POST_ENABLED,
      draftCount: 0,
      moveCount: 0,
      payloads: [],
    };
  }

  const payloads = buildPayloads(rows);
  const allMoveIds = payloads.flatMap((p) => p._meta.moveIds);

  for (const payload of payloads) {
    const odataBody = toODataBody(payload);
    console.log("DRY RUN PAYLOAD:", JSON.stringify(odataBody, null, 2));
    console.log("DRY RUN META:", payload._meta);

    if (BAS_DRAFT_POST_ENABLED) {
      // Реальний POST чернетки (Posted: false) — увімкнути лише свідомо.
      const result = await postBasLimitCardDraft(odataBody);
      if (!result.ok) {
        throw new Error(
          `BAS draft POST (${payload._meta.fieldName}): ${result.error}`
        );
      }
    } else {
      console.log("DRY RUN FAKE RESPONSE:", {
        Ref_Key: crypto.randomUUID(),
        Posted: false,
        Number: "DRY-RUN",
      });
    }
  }

  // Статус sent_to_1c НЕ змінюємо тут — лише через /export
  // («Позначити як передані» після завантаження Excel).
  // Навіть після майбутнього POST чернеток у 1С бухгалтерський контур
  // лишається на сторінці експорту.

  return {
    dryRun: !BAS_DRAFT_POST_ENABLED,
    draftCount: payloads.length,
    moveCount: allMoveIds.length,
    payloads,
  };
}

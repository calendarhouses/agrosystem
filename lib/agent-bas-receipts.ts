/**
 * LEVADIUS tools: статус / відправка / перевірка чернеток BAS по накладних.
 */

import {
  enqueueWarehouseReceiptBasDraft,
  type WarehouseReceiptBasDraftResult,
} from "@/lib/bas-drafts/inventory-inbound";
import {
  basHandoffLabel,
  describeBasHandoff,
  type BasHandoffStatus,
} from "@/lib/bas-drafts/statuses";
import { isBasDraftPipelineEnabled } from "@/lib/bas-drafts/config";
import { createServiceSupabase } from "@/lib/supabase/server";

const ENTITY = "Document_ПоступлениеТоваровУслуг";
const PIPELINE_ID = "inventory_inbound_receipt";

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

export type WarehouseReceiptBasStatusRow = {
  receiptId: string;
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  basHandoffStatus: string;
  basHandoffLabel: string;
  basDraftRefKey: string | null;
  basDraftError: string | null;
  pipelineLive: boolean;
};

export async function listWarehouseReceiptBasStatus(input?: {
  limit?: number;
  receiptId?: string | null;
  invoiceNumber?: string | null;
}): Promise<
  | {
      ok: true;
      pipelineLive: boolean;
      rows: WarehouseReceiptBasStatusRow[];
      hint: string;
    }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const pipelineLive = isBasDraftPipelineEnabled(PIPELINE_ID);
    let q = supabase
      .from("warehouse_receipts")
      .select(
        "id, supplier_name, invoice_number, invoice_date, total_amount, bas_handoff_status, bas_draft_ref_key, bas_draft_error, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(Math.min(50, Math.max(1, input?.limit ?? 15)));

    if (input?.receiptId?.trim()) {
      q = q.eq("id", input.receiptId.trim());
    }
    if (input?.invoiceNumber?.trim()) {
      q = q.ilike("invoice_number", input.invoiceNumber.trim());
    }

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("warehouse_receipts")
      ) {
        return {
          ok: true,
          pipelineLive,
          rows: [],
          hint: "Таблиця warehouse_receipts ще не готова (міграція 079).",
        };
      }
      return { ok: false, error: error.message };
    }

    const rows: WarehouseReceiptBasStatusRow[] = (data ?? []).map((row) => {
      const status = String(row.bas_handoff_status ?? "local_saved");
      return {
        receiptId: String(row.id),
        supplierName: String(row.supplier_name ?? ""),
        invoiceNumber:
          typeof row.invoice_number === "string" ? row.invoice_number : null,
        invoiceDate:
          typeof row.invoice_date === "string"
            ? String(row.invoice_date).slice(0, 10)
            : null,
        totalAmount:
          row.total_amount != null && Number.isFinite(Number(row.total_amount))
            ? Number(row.total_amount)
            : null,
        basHandoffStatus: status,
        basHandoffLabel: basHandoffLabel(status),
        basDraftRefKey:
          row.bas_draft_ref_key != null ? String(row.bas_draft_ref_key) : null,
        basDraftError:
          typeof row.bas_draft_error === "string" ? row.bas_draft_error : null,
        pipelineLive,
      };
    });

    return {
      ok: true,
      pipelineLive,
      rows,
      hint: pipelineLive
        ? "Pipeline inventory_inbound_receipt увімкнено — sendWarehouseReceiptBasDraft шле живу чернетку."
        : "Pipeline вимкнено (dry-run). Потрібні BAS_DRAFT_POST_ENABLED=true і BAS_DRAFT_PIPELINES_ENABLED=inventory_inbound_receipt.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Помилка списку накладних",
    };
  }
}

export async function sendWarehouseReceiptBasDraft(input: {
  receiptId?: string | null;
  invoiceNumber?: string | null;
  confirmed?: boolean;
}): Promise<
  | {
      ok: true;
      receiptId: string;
      handoffStatus: BasHandoffStatus;
      handoffLabel: string;
      dryRun: boolean;
      refKey?: string;
      linesInDraft?: number;
      linesSkippedLocal?: number;
      message: string;
      whereInBas: string;
    }
  | { ok: false; error: string; needsConfirm?: boolean }
> {
  if (input.confirmed !== true) {
    return {
      ok: false,
      needsConfirm: true,
      error:
        "Потрібне confirmed: true. Це створить/повторить непроведену чернетку Document_ПоступлениеТоваровУслуг у BAS.",
    };
  }

  const supabase = createServiceSupabase();
  let receiptId = input.receiptId?.trim() || "";

  if (!receiptId && input.invoiceNumber?.trim()) {
    const { data } = await supabase
      .from("warehouse_receipts")
      .select("id")
      .ilike("invoice_number", input.invoiceNumber.trim())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    receiptId = data?.id ? String(data.id) : "";
  }

  if (!receiptId) {
    return {
      ok: false,
      error: "Вкажи receiptId або invoiceNumber накладної.",
    };
  }

  const result: WarehouseReceiptBasDraftResult =
    await enqueueWarehouseReceiptBasDraft(receiptId);

  if (!result.ok && result.handoffStatus === "bas_draft_failed") {
    return {
      ok: false,
      error: result.error || "Помилка відправки чернетки в BAS",
    };
  }

  return {
    ok: true,
    receiptId,
    handoffStatus: result.handoffStatus,
    handoffLabel: basHandoffLabel(result.handoffStatus),
    dryRun: result.dryRun,
    refKey: result.refKey,
    linesInDraft: result.linesInDraft,
    linesSkippedLocal: result.linesSkippedLocal,
    message: describeBasHandoff(result.handoffStatus),
    whereInBas:
      result.handoffStatus === "bas_draft_posted"
        ? "BAS АГРО → Надходження товарів і послуг → непроведені (чернетки). Не шукай у проведених."
        : "Документ у BAS ще не створено — див. handoffStatus / pipeline.",
  };
}

export async function verifyWarehouseReceiptBasDraft(input: {
  receiptId?: string | null;
  refKey?: string | null;
}): Promise<
  | {
      ok: true;
      found: boolean;
      receiptId: string | null;
      refKey: string | null;
      number: string | null;
      date: string | null;
      posted: boolean | null;
      deletionMark: boolean | null;
      sum: number | null;
      comment: string | null;
      message: string;
    }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    let receiptId = input.receiptId?.trim() || null;
    let refKey = input.refKey?.trim().toLowerCase() || null;

    if (!refKey && receiptId) {
      const { data } = await supabase
        .from("warehouse_receipts")
        .select("bas_draft_ref_key")
        .eq("id", receiptId)
        .maybeSingle();
      refKey =
        data?.bas_draft_ref_key != null
          ? String(data.bas_draft_ref_key).toLowerCase()
          : null;
    }

    if (!refKey) {
      return {
        ok: false,
        error:
          "Немає bas_draft_ref_key. Спочатку sendWarehouseReceiptBasDraft або вкажи refKey.",
      };
    }

    const path = `${ENTITY}(guid'${refKey}')`;
    const url = `${odataBaseUrl()}/odata/standard.odata/${path}?$format=json&$select=Ref_Key,Number,Date,Posted,DeletionMark,СуммаДокумента,Комментарий`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
    const raw = await response.text();
    if (response.status === 404 || response.status === 204) {
      return {
        ok: true,
        found: false,
        receiptId,
        refKey,
        number: null,
        date: null,
        posted: null,
        deletionMark: null,
        sum: null,
        comment: null,
        message: "Документ з цим Ref_Key у BAS не знайдено (можливо видалено).",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `BAS OData HTTP ${response.status}: ${raw.slice(0, 300)}`,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "BAS повернув не JSON" };
    }

    const number =
      typeof payload.Number === "string" ? payload.Number : null;
    const date =
      typeof payload.Date === "string" ? String(payload.Date).slice(0, 10) : null;
    const posted =
      typeof payload.Posted === "boolean" ? payload.Posted : null;
    const deletionMark =
      typeof payload.DeletionMark === "boolean" ? payload.DeletionMark : null;
    const sum =
      payload.СуммаДокумента != null &&
      Number.isFinite(Number(payload.СуммаДокумента))
        ? Number(payload.СуммаДокумента)
        : null;
    const comment =
      typeof payload.Комментарий === "string" ? payload.Комментарий : null;

    return {
      ok: true,
      found: true,
      receiptId,
      refKey,
      number,
      date,
      posted,
      deletionMark,
      sum,
      comment,
      message:
        posted === false
          ? `Чернетка є в BAS (непроведена)${number ? ` №${number}` : ""}. Бухгалтер може провести її в 1С.`
          : posted === true
            ? `Документ уже проведений у BAS${number ? ` №${number}` : ""}.`
            : `Документ знайдено в BAS${number ? ` №${number}` : ""}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося перевірити документ у BAS",
    };
  }
}

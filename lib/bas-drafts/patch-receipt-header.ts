/**
 * PATCH непроведеної Поступление: підставити Контрагент + Склад.
 * Лише Posted: false. Catalog_* не змінюємо.
 */

import { basDefaultWarehouseKey } from "@/lib/bas-drafts/config";
import { resolveBasCounterpartyKey } from "@/lib/bas-drafts/counterparty";
import { createServiceSupabase } from "@/lib/supabase/server";

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

const EMPTY = "00000000-0000-0000-0000-000000000000";

function isEmptyGuid(raw: unknown): boolean {
  if (raw == null) return true;
  const s = String(raw).toLowerCase();
  return !s || s === EMPTY;
}

export async function patchWarehouseReceiptBasDraftHeader(
  receiptId: string
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const supabase = createServiceSupabase();
  const { data: receipt, error } = await supabase
    .from("warehouse_receipts")
    .select(
      "id, supplier_name, supplier_edrpou, invoice_number, bas_draft_ref_key"
    )
    .eq("id", receiptId)
    .maybeSingle();

  if (error || !receipt) {
    return { ok: false, error: "Накладну не знайдено" };
  }
  const refKey =
    receipt.bas_draft_ref_key != null
      ? String(receipt.bas_draft_ref_key).toLowerCase()
      : null;
  if (!refKey) {
    return {
      ok: false,
      error: "Ще немає Ref_Key у BAS — спочатку «Повторити BAS».",
    };
  }

  const entityPath = `Document_ПоступлениеТоваровУслуг(guid'${refKey}')`;
  const getUrl = `${odataBaseUrl()}/odata/standard.odata/${entityPath}?$format=json&$select=Ref_Key,Posted,DeletionMark,Контрагент_Key,Склад,Number`;
  const getRes = await fetch(getUrl, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
    },
  });
  const getRaw = await getRes.text();
  if (!getRes.ok) {
    return {
      ok: false,
      error: `Не знайдено документ у BAS (HTTP ${getRes.status})`,
    };
  }
  const doc = JSON.parse(getRaw) as {
    Posted?: boolean;
    DeletionMark?: boolean;
    Контрагент_Key?: string | null;
    Склад?: string | null;
    Number?: string | null;
  };
  if (doc.Posted === true) {
    return {
      ok: false,
      error: "Документ уже проведений у BAS — міняти шапку не можна.",
    };
  }
  if (doc.DeletionMark === true) {
    return { ok: false, error: "Документ позначено на видалення в BAS." };
  }

  const patch: Record<string, unknown> = {};
  const notes: string[] = [];

  if (isEmptyGuid(doc.Контрагент_Key)) {
    const cp = await resolveBasCounterpartyKey({
      edrpou:
        typeof receipt.supplier_edrpou === "string"
          ? receipt.supplier_edrpou
          : null,
      name:
        typeof receipt.supplier_name === "string"
          ? receipt.supplier_name
          : null,
    });
    if (cp.key) {
      patch.Контрагент_Key = cp.key;
      notes.push(`контрагент «${cp.matchedName || receipt.supplier_name}»`);
    } else {
      notes.push(`контрагент не знайдено (${cp.reason || "—"})`);
    }
  } else {
    notes.push("контрагент уже був");
  }

  const warehouse = basDefaultWarehouseKey();
  if (warehouse && isEmptyGuid(doc.Склад)) {
    patch.Склад = warehouse;
    patch.Склад_Type = "StandardODATA.Catalog_Склады";
    notes.push("склад з BAS_DEFAULT_WAREHOUSE_KEY");
  } else if (!isEmptyGuid(doc.Склад)) {
    notes.push("склад уже був");
  } else {
    notes.push("склад не заданий у env");
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: true,
      message: `Нічого міняти. ${notes.join("; ")}. У BAS №${doc.Number ?? "—"}.`,
    };
  }

  const patchUrl = `${odataBaseUrl()}/odata/standard.odata/${entityPath}?$format=json`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
      "IF-MATCH": "*",
    },
    body: JSON.stringify(patch),
  });
  const patchRaw = await patchRes.text();
  if (!patchRes.ok) {
    return {
      ok: false,
      error: `BAS PATCH HTTP ${patchRes.status}: ${patchRaw.slice(0, 300)}`,
    };
  }

  return {
    ok: true,
    message: `Оновлено чернетку BAS №${doc.Number ?? refKey.slice(0, 8)}: ${notes.join("; ")}. Відкрий у 1С непроведені Надходження.`,
  };
}

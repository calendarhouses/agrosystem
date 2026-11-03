/**
 * Спільний POST непроведеної чернетки в BAS OData.
 * Якщо isBasDraftPostEnabled() === false — dry-run (лог + fake Ref_Key), без мережі.
 */

import { isBasDraftPostEnabled } from "@/lib/bas-drafts/config";
import { sanitizeBasDocumentBody } from "@/lib/bas-drafts/odata-fields";

export type BasDraftPostResult =
  | {
      ok: true;
      dryRun: boolean;
      refKey: string;
      entitySet: string;
      /** Номер документа BAS (Number), якщо повернула OData */
      number?: string | null;
    }
  | {
      ok: false;
      dryRun: boolean;
      entitySet: string;
      error: string;
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

/**
 * POST Document_* з Posted: false.
 * Тіло може містити `_meta` — воно ніколи не йде в OData.
 * Рядки табличних частин санітизуються за $metadata allowlist.
 */
export async function postBasDocumentDraft(
  entitySet: string,
  body: Record<string, unknown>
): Promise<BasDraftPostResult> {
  const odataBody = sanitizeBasDocumentBody(entitySet, body);
  const posted = odataBody.Posted;
  if (posted !== false && posted !== undefined) {
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      entitySet,
      error: "Чернетка має мати Posted: false (проведення заборонено)",
    };
  }
  odataBody.Posted = false;
  if (odataBody.DeletionMark === undefined) {
    odataBody.DeletionMark = false;
  }

  const enabled = isBasDraftPostEnabled();

  if (!enabled) {
    const fakeKey = crypto.randomUUID();
    console.log("[bas-drafts] DRY RUN", entitySet, JSON.stringify(odataBody, null, 2));
    console.log("[bas-drafts] DRY RUN fake Ref_Key", fakeKey);
    return {
      ok: true,
      dryRun: true,
      refKey: fakeKey,
      entitySet,
    };
  }

  const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(
    entitySet
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
      body: JSON.stringify(odataBody),
    });

    const raw = await response.text();
    let parsed: {
      Ref_Key?: string;
      Number?: string | number | null;
      "odata.error"?: { message?: { value?: string } | string };
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return {
        ok: false,
        dryRun: false,
        entitySet,
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
        dryRun: false,
        entitySet,
        error: `HTTP ${response.status}${msg ? ` — ${msg}` : ""}`,
      };
    }

    if (!parsed.Ref_Key) {
      return {
        ok: false,
        dryRun: false,
        entitySet,
        error: "BAS не повернув Ref_Key",
      };
    }

    const numberRaw = parsed.Number;
    const number =
      numberRaw != null && String(numberRaw).trim()
        ? String(numberRaw).trim()
        : null;

    return {
      ok: true,
      dryRun: false,
      refKey: String(parsed.Ref_Key).toLowerCase(),
      entitySet,
      number,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun: false,
      entitySet,
      error: err instanceof Error ? err.message : "мережева помилка",
    };
  }
}

/**
 * PATCH існуючої непроведеної Document_* (оновлення рядків / шапки).
 * Не створює новий Ref_Key — захист від дублів у BAS.
 */
export async function patchBasDocumentDraft(
  entitySet: string,
  refKey: string,
  body: Record<string, unknown>
): Promise<BasDraftPostResult> {
  const guid = refKey.trim().toLowerCase();
  if (!guid) {
    return {
      ok: false,
      dryRun: !isBasDraftPostEnabled(),
      entitySet,
      error: "Немає Ref_Key для PATCH",
    };
  }

  const odataBody = sanitizeBasDocumentBody(entitySet, body);
  odataBody.Posted = false;
  if (odataBody.DeletionMark === undefined) {
    odataBody.DeletionMark = false;
  }
  // Ref_Key у тілі PATCH не передаємо
  delete odataBody.Ref_Key;

  const enabled = isBasDraftPostEnabled();
  if (!enabled) {
    console.log(
      "[bas-drafts] DRY RUN PATCH",
      entitySet,
      guid,
      JSON.stringify(odataBody, null, 2)
    );
    return {
      ok: true,
      dryRun: true,
      refKey: guid,
      entitySet,
    };
  }

  const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(
    entitySet
  )}(guid'${guid}')?$format=json`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
        "IF-MATCH": "*",
      },
      body: JSON.stringify(odataBody),
    });

    const raw = await response.text();
    if (!response.ok) {
      let msg = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as {
          "odata.error"?: { message?: { value?: string } | string };
        };
        const err = parsed["odata.error"]?.message;
        msg =
          typeof err === "string"
            ? err
            : err && typeof err === "object"
              ? String(err.value ?? msg)
              : msg;
      } catch {
        /* keep raw */
      }
      return {
        ok: false,
        dryRun: false,
        entitySet,
        error: `PATCH HTTP ${response.status}${msg ? ` — ${msg}` : ""}`,
      };
    }

    return {
      ok: true,
      dryRun: false,
      refKey: guid,
      entitySet,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun: false,
      entitySet,
      error: err instanceof Error ? err.message : "мережева помилка",
    };
  }
}

export function toIsoDateTime(iso: string): string {
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return `${day}T00:00:00`;
  return new Date(iso).toISOString().slice(0, 19);
}

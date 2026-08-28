/**
 * Спільний POST непроведеної чернетки в BAS OData.
 * Якщо isBasDraftPostEnabled() === false — dry-run (лог + fake Ref_Key), без мережі.
 */

import { isBasDraftPostEnabled } from "@/lib/bas-drafts/config";

export type BasDraftPostResult =
  | {
      ok: true;
      dryRun: boolean;
      refKey: string;
      entitySet: string;
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

function stripMeta(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next._meta;
  return next;
}

/**
 * POST Document_* з Posted: false.
 * Тіло може містити `_meta` — воно ніколи не йде в OData.
 */
export async function postBasDocumentDraft(
  entitySet: string,
  body: Record<string, unknown>
): Promise<BasDraftPostResult> {
  const odataBody = stripMeta(body);
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

    return {
      ok: true,
      dryRun: false,
      refKey: String(parsed.Ref_Key).toLowerCase(),
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

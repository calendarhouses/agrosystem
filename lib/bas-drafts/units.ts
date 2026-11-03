/**
 * Резолв одиниці виміру (л, кг, т, шт) → Ref_Key Catalog_КлассификаторЕдиницИзмерения.
 */

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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeUnitLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toLocaleLowerCase("uk-UA");
  if (!t) return "шт";
  if (/^(л|l|літр|литр)/i.test(t)) return "л";
  if (/^(кг|kg|кілограм)/i.test(t)) return "кг";
  if (/^(т|t|тон)/i.test(t)) return "т";
  if (/^(шт|pcs|штук)/i.test(t)) return "шт";
  return t.slice(0, 16);
}

const unitCache = new Map<string, string | null>();
let unitsLoaded = false;
const unitByLabel = new Map<string, string>();

async function loadAllUnits(): Promise<void> {
  if (unitsLoaded) return;
  try {
    const params = [
      "$format=json",
      "$top=500",
      `$select=${encodeURIComponent("Ref_Key,Description,Code,DeletionMark")}`,
      `$filter=${encodeURIComponent("DeletionMark eq false")}`,
    ];
    const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_КлассификаторЕдиницИзмерения?${params.join("&")}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      unitsLoaded = true;
      return;
    }
    const parsed = (await response.json()) as {
      value?: Array<{
        Ref_Key?: string;
        Description?: string | null;
        Code?: string | null;
      }>;
    };
    for (const row of parsed.value ?? []) {
      const key = row.Ref_Key ? String(row.Ref_Key).toLowerCase() : null;
      if (!key) continue;
      const labels = [
        normalizeUnitLabel(row.Code),
        normalizeUnitLabel(row.Description),
      ];
      for (const label of labels) {
        if (label && !unitByLabel.has(label)) unitByLabel.set(label, key);
      }
    }
  } catch (err) {
    console.warn("[bas-drafts] units load", err);
  }
  unitsLoaded = true;
}

export async function resolveBasUnitKey(
  unitLabel: string | null | undefined
): Promise<{ key: string | null; label: string }> {
  const label = normalizeUnitLabel(unitLabel);
  const envMap = process.env.BAS_UNIT_MAP?.trim() ?? "";
  if (envMap) {
    for (const part of envMap.split(",")) {
      const [u, key] = part.split(":").map((s) => s.trim());
      if (normalizeUnitLabel(u) === label && key) {
        return { key: key.toLowerCase(), label };
      }
    }
  }

  if (unitCache.has(label)) {
    return { key: unitCache.get(label) ?? null, label };
  }

  await loadAllUnits();
  let key = unitByLabel.get(label) ?? null;

  if (!key) {
    try {
      const filter = `DeletionMark eq false and (Code eq '${escapeODataString(label)}' or Description eq '${escapeODataString(label)}')`;
      const params = [
        "$format=json",
        "$top=5",
        `$select=${encodeURIComponent("Ref_Key,Description,Code")}`,
        `$filter=${encodeURIComponent(filter)}`,
      ];
      const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_КлассификаторЕдиницИзмерения?${params.join("&")}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: basicAuthHeader(),
          Accept: "application/json",
        },
      });
      if (response.ok) {
        const parsed = (await response.json()) as {
          value?: Array<{ Ref_Key?: string }>;
        };
        key = parsed.value?.[0]?.Ref_Key
          ? String(parsed.value[0].Ref_Key).toLowerCase()
          : null;
      }
    } catch {
      /* ignore */
    }
  }

  unitCache.set(label, key);
  return { key, label };
}

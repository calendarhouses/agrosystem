/**
 * Бухгалтерський рахунок BAS АГРО для рядків приходу / ЛЗК / Вимоги-накладної.
 * Карта кодів: 207 запчастини, 208/2081 насіння·добрива·ЗЗР, 203 паливо, 271 врожай.
 *
 * План рахунків через OData у цій базі часто не опублікований — тоді потрібні
 * BAS_ACCOUNT_MAP / BAS_ACCOUNT_*_KEY (GUID). Lookup за Code — best-effort.
 */

export type InventoryAccountCategory =
  | "parts"
  | "zzr"
  | "fertilizer"
  | "seed"
  | "fuel"
  | "harvest"
  | "other";

/** Стандартна карта рахунків BAS АГРО (коди для lookup / документації). */
export const DEFAULT_ACCOUNT_CODES: Record<
  InventoryAccountCategory,
  string[]
> = {
  parts: ["207"],
  zzr: ["2081", "208"],
  fertilizer: ["2081", "208"],
  seed: ["2081", "208"],
  fuel: ["203"],
  harvest: ["271", "26"],
  other: ["20"],
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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

const accountCache = new Map<string, string | null>();
let taxPurposeCache: string | null | undefined;

function normalizeCategory(
  category: string | null | undefined
): InventoryAccountCategory {
  const raw = String(category ?? "other").toLowerCase();
  if (raw === "parts") return "parts";
  if (raw === "zzr") return "zzr";
  if (raw === "fertilizer") return "fertilizer";
  if (raw === "seed") return "seed";
  if (raw === "fuel" || raw === "oil" || raw === "lubricant") return "fuel";
  if (raw === "harvest") return "harvest";
  return "other";
}

function accountKeyFromEnv(category: InventoryAccountCategory): string | null {
  const mapRaw = process.env.BAS_ACCOUNT_MAP?.trim() ?? "";
  if (mapRaw) {
    for (const part of mapRaw.split(",")) {
      const [cat, key] = part.split(":").map((s) => s.trim().toLowerCase());
      if (cat === category && key) return key;
      // aliases у map
      if (
        category === "fuel" &&
        (cat === "oil" || cat === "lubricant") &&
        key
      ) {
        return key;
      }
    }
  }

  const envByCat: Record<InventoryAccountCategory, string | undefined> = {
    parts: process.env.BAS_ACCOUNT_PARTS_KEY,
    zzr: process.env.BAS_ACCOUNT_ZZR_KEY,
    fertilizer: process.env.BAS_ACCOUNT_FERTILIZER_KEY,
    seed: process.env.BAS_ACCOUNT_SEED_KEY,
    fuel: process.env.BAS_ACCOUNT_FUEL_KEY,
    harvest: process.env.BAS_ACCOUNT_HARVEST_KEY,
    other: process.env.BAS_ACCOUNT_OTHER_KEY,
  };
  // спільний ключ 208 для агрохімії, якщо окремих немає
  if (
    (category === "zzr" ||
      category === "fertilizer" ||
      category === "seed") &&
    !envByCat[category]?.trim()
  ) {
    const shared = process.env.BAS_ACCOUNT_AGRO_KEY?.trim().toLowerCase();
    if (shared) return shared;
  }
  const single = envByCat[category]?.trim().toLowerCase();
  return single || null;
}

async function lookupAccountByCode(code: string): Promise<string | null> {
  const cached = accountCache.get(code);
  if (cached !== undefined) return cached;

  const catalogs = [
    "ChartOfAccounts_Хозрасчетный",
    "ChartOfAccounts_БухгалтерскийУчет",
    "ChartOfAccounts_Управленческий",
  ];

  for (const catalog of catalogs) {
    try {
      const filter = `DeletionMark eq false and Code eq '${escapeODataString(code)}'`;
      const params = [
        "$format=json",
        "$top=5",
        `$select=${encodeURIComponent("Ref_Key,Code,DeletionMark")}`,
        `$filter=${encodeURIComponent(filter)}`,
      ];
      const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(catalog)}?${params.join("&")}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: basicAuthHeader(),
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const parsed = (await response.json()) as {
        value?: Array<{ Ref_Key?: string }>;
      };
      const key = parsed.value?.[0]?.Ref_Key
        ? String(parsed.value[0].Ref_Key).toLowerCase()
        : null;
      if (key) {
        accountCache.set(code, key);
        return key;
      }
    } catch {
      /* try next catalog */
    }
  }

  accountCache.set(code, null);
  return null;
}

export async function resolveBasInventoryAccountKey(
  category: InventoryAccountCategory | string | null | undefined
): Promise<string | null> {
  const normalized = normalizeCategory(category);

  const fromEnv = accountKeyFromEnv(normalized);
  if (fromEnv) return fromEnv;

  for (const code of DEFAULT_ACCOUNT_CODES[normalized]) {
    const key = await lookupAccountByCode(code);
    if (key) return key;
  }
  return null;
}

/**
 * Податкове призначення «Опод. ПДВ» (або env BAS_TAX_PURPOSE_VAT_KEY).
 */
export async function resolveBasTaxPurposeVatKey(): Promise<string | null> {
  const fromEnv = process.env.BAS_TAX_PURPOSE_VAT_KEY?.trim().toLowerCase();
  if (fromEnv) return fromEnv;
  if (taxPurposeCache !== undefined) return taxPurposeCache;

  const catalogs = [
    "Catalog_НалоговыеНазначенияАктивовИЗатрат",
    "Catalog_НалоговыеНазначения",
  ];

  for (const catalog of catalogs) {
    try {
      const filter =
        "DeletionMark eq false and (substringof('Опод', Description) or substringof('опод', Description) or substringof('ПДВ', Description))";
      const params = [
        "$format=json",
        "$top=20",
        `$select=${encodeURIComponent("Ref_Key,Description,DeletionMark")}`,
        `$filter=${encodeURIComponent(filter)}`,
      ];
      const url = `${odataBaseUrl()}/odata/standard.odata/${encodeURIComponent(catalog)}?${params.join("&")}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: basicAuthHeader(),
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const parsed = (await response.json()) as {
        value?: Array<{ Ref_Key?: string; Description?: string | null }>;
      };
      const rows = parsed.value ?? [];
      const preferred =
        rows.find((r) => /опод\.?\s*пдв/i.test(String(r.Description ?? ""))) ??
        rows.find((r) => /опод/i.test(String(r.Description ?? ""))) ??
        rows[0];
      const key = preferred?.Ref_Key
        ? String(preferred.Ref_Key).toLowerCase()
        : null;
      if (key) {
        taxPurposeCache = key;
        return key;
      }
    } catch {
      /* next */
    }
  }

  taxPurposeCache = null;
  return null;
}

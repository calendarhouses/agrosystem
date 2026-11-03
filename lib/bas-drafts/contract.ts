/**
 * Основний договір контрагента (Catalog_ДоговорыКонтрагентов) для шапки Поступление.
 * Catalog_* не створюємо — лише GET.
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

type ContractRow = {
  Ref_Key?: string;
  Description?: string | null;
  DeletionMark?: boolean | null;
  Owner_Key?: string | null;
  Основной?: boolean | null;
};

/**
 * Шукає основний (або єдиний активний) договір контрагента.
 */
export async function resolveBasMainContractKey(
  counterpartyKey: string
): Promise<{ key: string | null; reason?: string; matchedName?: string }> {
  const owner = counterpartyKey.trim().toLowerCase();
  if (!owner) return { key: null, reason: "немає контрагента" };

  const envMap = process.env.BAS_CONTRACT_MAP?.trim() ?? "";
  if (envMap) {
    for (const part of envMap.split(",")) {
      const [cp, contract] = part.split(":").map((s) => s.trim().toLowerCase());
      if (cp && contract && cp === owner) {
        return { key: contract };
      }
    }
  }

  try {
    const filter = `DeletionMark eq false and Owner_Key eq guid'${escapeODataString(owner)}'`;
    const params = [
      "$format=json",
      "$top=30",
      `$select=${encodeURIComponent("Ref_Key,Description,DeletionMark,Owner_Key,Основной")}`,
      `$filter=${encodeURIComponent(filter)}`,
    ];
    const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_ДоговорыКонтрагентов?${params.join("&")}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      // Деякі бази не віддають поле Основной — retry без нього
      if (raw.includes("Основной") || response.status === 400) {
        return resolveBasMainContractKeyLegacy(owner);
      }
      return {
        key: null,
        reason: `Договори HTTP ${response.status}`,
      };
    }
    const parsed = JSON.parse(raw) as { value?: ContractRow[] };
    const rows = (parsed.value ?? []).filter((r) => r.DeletionMark !== true);
    if (rows.length === 0) {
      return { key: null, reason: "у контрагента немає активних договорів" };
    }
    const main = rows.find((r) => r.Основной === true) ?? rows[0];
    const key = main?.Ref_Key ? String(main.Ref_Key).toLowerCase() : null;
    if (!key) return { key: null, reason: "договір без Ref_Key" };
    return {
      key,
      matchedName: String(main?.Description ?? ""),
    };
  } catch (err) {
    return {
      key: null,
      reason:
        err instanceof Error
          ? `пошук договору: ${err.message}`
          : "пошук договору не вдався",
    };
  }
}

async function resolveBasMainContractKeyLegacy(
  owner: string
): Promise<{ key: string | null; reason?: string; matchedName?: string }> {
  try {
    const filter = `DeletionMark eq false and Owner_Key eq guid'${escapeODataString(owner)}'`;
    const params = [
      "$format=json",
      "$top=30",
      `$select=${encodeURIComponent("Ref_Key,Description,DeletionMark,Owner_Key")}`,
      `$filter=${encodeURIComponent(filter)}`,
    ];
    const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_ДоговорыКонтрагентов?${params.join("&")}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      return { key: null, reason: `Договори HTTP ${response.status}` };
    }
    const parsed = JSON.parse(raw) as { value?: ContractRow[] };
    const rows = (parsed.value ?? []).filter((r) => r.DeletionMark !== true);
    if (rows.length === 0) {
      return { key: null, reason: "у контрагента немає активних договорів" };
    }
    const main = rows[0];
    const key = main?.Ref_Key ? String(main.Ref_Key).toLowerCase() : null;
    if (!key) return { key: null, reason: "договір без Ref_Key" };
    return { key, matchedName: String(main?.Description ?? "") };
  } catch (err) {
    return {
      key: null,
      reason:
        err instanceof Error
          ? `пошук договору: ${err.message}`
          : "пошук договору не вдався",
    };
  }
}

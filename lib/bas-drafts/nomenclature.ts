/**
 * Живий пошук номенклатури в BAS (лише GET Catalog_Номенклатура).
 * Не створюємо позиції в 1С — лише підставляємо існуючий Ref_Key.
 */

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeCode(raw: string): string {
  return raw.trim().toLocaleLowerCase("uk-UA").replace(/[\s\-_/]/g, "");
}

function normalizeName(raw: string): string {
  return raw
    .toLocaleLowerCase("uk-UA")
    .replace(/["'«»„“`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchCore(name: string): string | null {
  const norm = normalizeName(name);
  if (norm.length >= 4) {
    // Беремо перші значущі слова (до ~40 символів) — substringof любить коротші рядки
    const words = norm.split(" ").filter((w) => w.length >= 3);
    if (words.length === 0) return norm.slice(0, 40);
    const joined = words.slice(0, 4).join(" ");
    return joined.slice(0, 40);
  }
  return null;
}

type BasNomRow = {
  Ref_Key?: string;
  Description?: string | null;
  Code?: string | null;
  Артикул?: string | null;
  DeletionMark?: boolean | null;
  IsFolder?: boolean | null;
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

async function fetchBasNomenclature(filter: string): Promise<BasNomRow[]> {
  const params = [
    "$format=json",
    "$top=25",
    `$select=${encodeURIComponent("Ref_Key,Description,Code,Артикул,DeletionMark,IsFolder")}`,
    `$filter=${encodeURIComponent(filter)}`,
  ];
  const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_Номенклатура?${params.join("&")}`;
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
    throw new Error(`Catalog_Номенклатура HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw) as { value?: BasNomRow[] };
  return (parsed.value ?? []).filter(
    (r) => r.DeletionMark !== true && r.IsFolder !== true
  );
}

function pickUnique(
  rows: BasNomRow[],
  name: string,
  code: string | null
): { key: string; name: string; code: string | null } | null {
  if (rows.length === 0) return null;

  if (code) {
    const want = normalizeCode(code);
    const byCode = rows.filter((r) => {
      const c = r.Code ? normalizeCode(String(r.Code)) : "";
      const a = r.Артикул ? normalizeCode(String(r.Артикул)) : "";
      return (c && c === want) || (a && a === want);
    });
    if (byCode.length === 1 && byCode[0]?.Ref_Key) {
      return {
        key: String(byCode[0].Ref_Key).toLowerCase(),
        name: String(byCode[0].Description ?? name),
        code: String(byCode[0].Code ?? byCode[0].Артикул ?? code),
      };
    }
  }

  const needle = normalizeName(name);
  const scored = rows
    .map((r) => {
      const desc = normalizeName(String(r.Description ?? ""));
      let score = 0;
      if (desc === needle) score = 100;
      else if (desc.includes(needle) || needle.includes(desc)) score = 75;
      else {
        const nw = new Set(needle.split(" ").filter((w) => w.length >= 3));
        const dw = desc.split(" ").filter((w) => w.length >= 3);
        let hit = 0;
        for (const w of dw) if (nw.has(w)) hit += 1;
        if (nw.size > 0 && hit / nw.size >= 0.7) score = 60;
      }
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const best = scored[0]!;
  const second = scored[1];
  if (second && second.score >= 60 && best.score - second.score < 15) {
    return null;
  }
  if (best.score < 60) return null;
  if (!best.r.Ref_Key) return null;
  return {
    key: String(best.r.Ref_Key).toLowerCase(),
    name: String(best.r.Description ?? name),
    code: best.r.Code != null ? String(best.r.Code) : null,
  };
}

/**
 * Шукає Ref_Key номенклатури в BAS за артикулом/кодом і назвою.
 */
export async function resolveBasNomenclatureKey(input: {
  name: string;
  code?: string | null;
  article?: string | null;
}): Promise<{ key: string | null; matchedName?: string; reason?: string }> {
  const name = (input.name ?? "").trim();
  const codeRaw =
    (input.article ?? "").trim() || (input.code ?? "").trim() || null;

  try {
    if (codeRaw) {
      const esc = escapeODataString(codeRaw);
      const byCode = await fetchBasNomenclature(
        `DeletionMark eq false and IsFolder eq false and (Code eq '${esc}' or Артикул eq '${esc}')`
      );
      const picked = pickUnique(byCode, name || codeRaw, codeRaw);
      if (picked) {
        return { key: picked.key, matchedName: picked.name };
      }
    }

    if (name.length >= 3) {
      const core = searchCore(name);
      if (core) {
        const byName = await fetchBasNomenclature(
          `DeletionMark eq false and IsFolder eq false and substringof('${escapeODataString(core)}', Description)`
        );
        const picked = pickUnique(byName, name, codeRaw);
        if (picked) {
          return { key: picked.key, matchedName: picked.name };
        }
        if (byName.length > 1) {
          return {
            key: null,
            reason: `кілька схожих у BAS за «${core}»`,
          };
        }
      }
    }
  } catch (err) {
    console.error("[bas-drafts] nomenclature live lookup", err);
    return {
      key: null,
      reason:
        err instanceof Error
          ? `пошук номенклатури: ${err.message}`
          : "пошук номенклатури не вдався",
    };
  }

  return {
    key: null,
    reason: "не знайдено в Catalog_Номенклатура BAS",
  };
}

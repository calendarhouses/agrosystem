/**
 * Резолв контрагента для чернеток BAS.
 * Порядок: наша таблиця → env map → живий пошук у Catalog_Контрагенты (ЄДРПОУ / назва).
 * Catalog_* не створюємо — лише читаємо і підставляємо Ref_Key.
 */

import { createServiceSupabase } from "@/lib/supabase/server";

function normalizeEdrpou(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Прибирає ТОВ/лапки — для порівняння назв. */
export function normalizePartyName(raw: string): string {
  return raw
    .toLocaleLowerCase("uk-UA")
    .replace(/["'«»„“`]/g, "")
    .replace(/\b(тов|тзов|тзбв|пп|фоп|ат|пт|кт|сфг|фг|компанія|компания)\b/gi, "")
    .replace(/[.,;:/\\|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Найдовше «ядро» назви для substringof (мін. 4 символи). */
function searchCore(name: string): string | null {
  const norm = normalizePartyName(name);
  if (norm.length >= 4) return norm.slice(0, 48);
  const parts = norm.split(" ").filter((p) => p.length >= 4);
  if (parts.length === 0) return null;
  return parts.sort((a, b) => b.length - a.length)[0] ?? null;
}

type BasCpRow = {
  Ref_Key?: string;
  Description?: string | null;
  КодПоЕДРПОУ?: string | null;
  DeletionMark?: boolean | null;
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

async function fetchBasCounterparties(
  filter: string
): Promise<BasCpRow[]> {
  const params = [
    "$format=json",
    "$top=20",
    `$select=${encodeURIComponent("Ref_Key,Description,КодПоЕДРПОУ,DeletionMark")}`,
    `$filter=${encodeURIComponent(filter)}`,
  ];
  const url = `${odataBaseUrl()}/odata/standard.odata/Catalog_Контрагенты?${params.join("&")}`;
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
    throw new Error(`Catalog_Контрагенты HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw) as { value?: BasCpRow[] };
  return (parsed.value ?? []).filter((r) => r.DeletionMark !== true);
}

/** Зберігаємо знайдений звʼязок у нашу БД — наступного разу без OData. */
async function rememberCounterparty(input: {
  basRefKey: string;
  name: string;
  edrpou: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    if (input.edrpou) {
      const { data: existing } = await supabase
        .from("bas_counterparties")
        .select("id")
        .eq("edrpou", input.edrpou)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from("bas_counterparties")
          .update({
            bas_ref_key: input.basRefKey.toLowerCase(),
            name: input.name,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        return;
      }
    }
    await supabase.from("bas_counterparties").insert({
      bas_ref_key: input.basRefKey.toLowerCase(),
      name: input.name,
      edrpou: input.edrpou,
      is_active: true,
    });
  } catch {
    // таблиця може ще не існувати — ігнор
  }
}

function pickUniqueByName(
  rows: BasCpRow[],
  name: string
): { key: string; name: string; edrpou: string | null } | null {
  const needle = normalizePartyName(name);
  if (!needle) return null;
  const scored = rows
    .map((r) => {
      const desc = String(r.Description ?? "");
      const norm = normalizePartyName(desc);
      let score = 0;
      if (norm === needle) score = 100;
      else if (norm.includes(needle) || needle.includes(norm)) score = 80;
      else score = 0;
      return { r, score, desc };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const best = scored[0]!;
  const second = scored[1];
  if (second && second.score === best.score && best.score < 100) {
    return null; // неоднозначно
  }
  const key = best.r.Ref_Key ? String(best.r.Ref_Key).toLowerCase() : null;
  if (!key) return null;
  return {
    key,
    name: best.desc,
    edrpou: normalizeEdrpou(best.r.КодПоЕДРПОУ) || null,
  };
}

export async function resolveBasCounterpartyKey(input: {
  edrpou?: string | null;
  name?: string | null;
}): Promise<{ key: string | null; reason?: string; matchedName?: string }> {
  const supabase = createServiceSupabase();
  const edrpou = normalizeEdrpou(input.edrpou);
  const name = (input.name ?? "").trim();

  // 1) Наша таблиця за ЄДРПОУ
  if (edrpou) {
    const { data } = await supabase
      .from("bas_counterparties")
      .select("bas_ref_key, name")
      .eq("is_active", true)
      .eq("edrpou", edrpou)
      .maybeSingle();
    if (data?.bas_ref_key) {
      return {
        key: String(data.bas_ref_key).toLowerCase(),
        matchedName: typeof data.name === "string" ? data.name : undefined,
      };
    }
  }

  // 2) Наша таблиця за назвою
  if (name.length >= 3) {
    const { data } = await supabase
      .from("bas_counterparties")
      .select("bas_ref_key, name")
      .eq("is_active", true)
      .ilike("name", `%${name.replaceAll(",", " ").replaceAll("%", "")}%`)
      .limit(8);
    const rows = data ?? [];
    if (rows.length === 1 && rows[0]?.bas_ref_key) {
      return {
        key: String(rows[0].bas_ref_key).toLowerCase(),
        matchedName: String(rows[0].name ?? ""),
      };
    }
    if (rows.length > 1) {
      const exact = rows.find(
        (r) => normalizePartyName(String(r.name ?? "")) === normalizePartyName(name)
      );
      if (exact?.bas_ref_key) {
        return {
          key: String(exact.bas_ref_key).toLowerCase(),
          matchedName: String(exact.name ?? ""),
        };
      }
    }
  }

  // 3) Env map
  const mapRaw = process.env.BAS_COUNTERPARTY_MAP?.trim() ?? "";
  if (edrpou && mapRaw) {
    for (const part of mapRaw.split(",")) {
      const [code, key] = part.split(":").map((s) => s.trim());
      if (code && key && normalizeEdrpou(code) === edrpou) {
        return { key: key.toLowerCase() };
      }
    }
  }

  // 4) Живий BAS: ЄДРПОУ
  try {
    if (edrpou) {
      const byCode = await fetchBasCounterparties(
        `DeletionMark eq false and КодПоЕДРПОУ eq '${escapeODataString(edrpou)}'`
      );
      if (byCode.length === 1 && byCode[0]?.Ref_Key) {
        const key = String(byCode[0].Ref_Key).toLowerCase();
        const matchedName = String(byCode[0].Description ?? name);
        await rememberCounterparty({
          basRefKey: key,
          name: matchedName,
          edrpou,
        });
        return { key, matchedName };
      }
      if (byCode.length > 1) {
        return { key: null, reason: "у BAS кілька контрагентів з цим ЄДРПОУ" };
      }
    }

    // 5) Живий BAS: назва
    if (name.length >= 3) {
      const core = searchCore(name);
      if (core) {
        const byName = await fetchBasCounterparties(
          `DeletionMark eq false and substringof('${escapeODataString(core)}', Description)`
        );
        const picked = pickUniqueByName(byName, name);
        if (picked) {
          await rememberCounterparty({
            basRefKey: picked.key,
            name: picked.name,
            edrpou: picked.edrpou || edrpou || null,
          });
          return { key: picked.key, matchedName: picked.name };
        }
        if (byName.length > 1) {
          return {
            key: null,
            reason: `у BAS кілька схожих контрагентів за «${core}»`,
          };
        }
      }
    }
  } catch (err) {
    console.error("[bas-drafts] counterparty live lookup", err);
    return {
      key: null,
      reason:
        err instanceof Error
          ? `пошук у BAS не вдався: ${err.message}`
          : "пошук у BAS не вдався",
    };
  }

  return { key: null, reason: "контрагента не знайдено в BAS за назвою/ЄДРПОУ" };
}

/**
 * Опційний мапінг контрагента для чернеток.
 * Без ключа документ усе одно можна слати — бухгалтер обере в BAS.
 */

import { createServiceSupabase } from "@/lib/supabase/server";

function normalizeEdrpou(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export async function resolveBasCounterpartyKey(input: {
  edrpou?: string | null;
  name?: string | null;
}): Promise<{ key: string | null; reason?: string }> {
  const supabase = createServiceSupabase();
  const edrpou = normalizeEdrpou(input.edrpou);
  if (edrpou) {
    const { data } = await supabase
      .from("bas_counterparties")
      .select("bas_ref_key")
      .eq("is_active", true)
      .eq("edrpou", edrpou)
      .maybeSingle();
    if (data?.bas_ref_key) {
      return { key: String(data.bas_ref_key).toLowerCase() };
    }
  }

  const name = (input.name ?? "").trim();
  if (name.length >= 3) {
    const { data } = await supabase
      .from("bas_counterparties")
      .select("bas_ref_key, name")
      .eq("is_active", true)
      .ilike("name", `%${name.replaceAll(",", " ")}%`)
      .limit(5);
    const rows = data ?? [];
    if (rows.length === 1 && rows[0]?.bas_ref_key) {
      return { key: String(rows[0].bas_ref_key).toLowerCase() };
    }
    if (rows.length > 1) {
      return { key: null, reason: "кілька контрагентів за назвою" };
    }
  }

  const mapRaw = process.env.BAS_COUNTERPARTY_MAP?.trim() ?? "";
  if (edrpou && mapRaw) {
    for (const part of mapRaw.split(",")) {
      const [code, key] = part.split(":").map((s) => s.trim());
      if (code && key && normalizeEdrpou(code) === edrpou) {
        return { key: key.toLowerCase() };
      }
    }
  }

  return { key: null, reason: "немає мапінгу контрагента" };
}

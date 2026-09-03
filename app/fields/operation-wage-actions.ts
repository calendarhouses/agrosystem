"use server";

import {
  defaultWageRateUahPerHa,
  normalizeWorkTypeKey,
} from "@/lib/field-operation-wage";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Підказки механізаторів за введеними літерами */
export async function suggestMechanics(
  query: string
): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  const q = query.trim();
  if (q.length < 1) return { ok: true, names: [] };

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("field_operations")
      .select("mechanic_name")
      .not("mechanic_name", "is", null)
      .ilike("mechanic_name", `%${q}%`)
      .order("mechanic_name")
      .limit(40);

    if (error) {
      if (
        error.message?.includes("mechanic_name") ||
        error.code === "42703"
      ) {
        return { ok: true, names: [] };
      }
      return { ok: false, error: error.message };
    }

    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of data ?? []) {
      const name = String(row.mechanic_name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= 12) break;
    }
    return { ok: true, names };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Помилка пошуку",
    };
  }
}

/** Ставка ₴/га для типу робіт (або дефолт) */
export async function getWorkTypeWageRate(
  workType: string
): Promise<
  | { ok: true; rateUahPerHa: number; fromMemory: boolean }
  | { ok: false; error: string }
> {
  const key = normalizeWorkTypeKey(workType);
  if (!key) {
    return {
      ok: true,
      rateUahPerHa: defaultWageRateUahPerHa(null),
      fromMemory: false,
    };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("work_type_wage_rates")
      .select("rate_uah_per_ha")
      .eq("work_type", key)
      .maybeSingle();

    if (error) {
      if (
        error.message?.includes("work_type_wage_rates") ||
        error.code === "42P01" ||
        error.code === "42703"
      ) {
        return {
          ok: true,
          rateUahPerHa: defaultWageRateUahPerHa(key),
          fromMemory: false,
        };
      }
      return { ok: false, error: error.message };
    }

    if (data?.rate_uah_per_ha != null) {
      const rate = Number(data.rate_uah_per_ha);
      if (Number.isFinite(rate) && rate >= 0) {
        return { ok: true, rateUahPerHa: rate, fromMemory: true };
      }
    }

    return {
      ok: true,
      rateUahPerHa: defaultWageRateUahPerHa(key),
      fromMemory: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Помилка ставки",
    };
  }
}

/** Зберегти / оновити ставку ₴/га за типом робіт */
export async function upsertWorkTypeWageRate(
  workType: string,
  rateUahPerHa: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = normalizeWorkTypeKey(workType);
  if (!key) return { ok: false, error: "Немає типу робіт" };
  if (!Number.isFinite(rateUahPerHa) || rateUahPerHa < 0) {
    return { ok: false, error: "Некоректна ставка" };
  }

  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase.from("work_type_wage_rates").upsert(
      {
        work_type: key,
        rate_uah_per_ha: Math.round(rateUahPerHa * 100) / 100,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "work_type" }
    );

    if (error) {
      if (
        error.message?.includes("work_type_wage_rates") ||
        error.code === "42P01"
      ) {
        return {
          ok: false,
          error:
            "Потрібна міграція 058 (ставки ЗП). Виконай supabase/migrations/058_field_op_mechanic_wage_rate.sql",
        };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Помилка збереження ставки",
    };
  }
}

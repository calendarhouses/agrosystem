"use server";

import { revalidatePath } from "next/cache";

import { getBasAllAssets, type BasMachinery } from "@/lib/bas-api";
import { createServiceSupabase } from "@/lib/supabase/server";

// BAS folder Ref_Keys
const FOLDER_TRANSPORT = "3a51fd42-bd15-11ed-af7f-d85ed32cff61";
const FOLDER_MACHINES = "50526397-bf5f-11ed-af7f-d85ed32cff61";

const EXCLUDE_RE =
  /mersedes|mercedes|lend\s*rover|land\s*rover|mitsubishi|pajero|камаз|прицеп/i;

// ── Equipment type classification ──────────────────────────────────

function classifyEquipmentType(name: string): string {
  const n = name.toLowerCase();
  if (/трактор|мтз|т-150|т-70|т150|белорус|беларус|case|тдз/i.test(n))
    return "tractor";
  if (/комбайн|new\s*holland/i.test(n)) return "combine";
  if (/оприскувач/i.test(n)) return "sprayer";
  if (/навантажувач/i.test(n)) return "loader";
  return "other";
}

function classifyImplementType(name: string): string {
  const n = name.toLowerCase();
  if (/сівалк|посівн|терасем|раміна|роміна/i.test(n)) return "seeder";
  if (/плуг/i.test(n)) return "plow";
  if (/борон/i.test(n)) return "harrow";
  if (/жниварк|жатк/i.test(n)) return "header";
  if (/культиватор/i.test(n)) return "cultivator";
  if (/розкидач|розсипач|добрив|мвд|мбц|амазон/i.test(n)) return "spreader";
  if (/оприскувач|вектор|бейсік/i.test(n)) return "sprayer";
  if (/компакт|компактор/i.test(n)) return "compactor";
  return "other";
}

// ── Sync from BAS ──────────────────────────────────────────────────

export type SyncResult = {
  equipment: { upserted: number; total: number };
  implements: { upserted: number; total: number };
};

export async function syncEquipmentFromBas(): Promise<
  { ok: true; data: SyncResult } | { ok: false; error: string }
> {
  try {
    const allAssets = await getBasAllAssets();

    const equipmentRows: BasMachinery[] = [];
    const implementRows: BasMachinery[] = [];

    for (const asset of allAssets) {
      if (asset.IsFolder || asset.DeletionMark) continue;
      const parentKey = asset.Parent_Key?.toLowerCase();
      const name = asset.Description?.trim() ?? "";

      if (parentKey === FOLDER_TRANSPORT.toLowerCase()) {
        if (EXCLUDE_RE.test(name)) continue;
        equipmentRows.push(asset);
      } else if (parentKey === FOLDER_MACHINES.toLowerCase()) {
        implementRows.push(asset);
      }
    }

    const supabase = createServiceSupabase();

    const eqRecords = equipmentRows.map((a) => ({
      bas_ref_key: a.Ref_Key.toLowerCase(),
      name: a.Description?.trim() ?? "Без назви",
      full_name: a.НаименованиеПолное?.trim() || null,
      code: a.Code?.trim() || null,
      type: classifyEquipmentType(a.Description ?? ""),
      updated_at: new Date().toISOString(),
    }));

    let eqUpserted = 0;
    if (eqRecords.length > 0) {
      const { error } = await supabase.from("equipment").upsert(eqRecords, {
        onConflict: "bas_ref_key",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`equipment upsert: ${error.message}`);
      eqUpserted = eqRecords.length;
    }

    const implRecords = implementRows.map((a) => ({
      bas_ref_key: a.Ref_Key.toLowerCase(),
      name: a.Description?.trim() ?? "Без назви",
      full_name: a.НаименованиеПолное?.trim() || null,
      code: a.Code?.trim() || null,
      type: classifyImplementType(a.Description ?? ""),
      updated_at: new Date().toISOString(),
    }));

    let implUpserted = 0;
    if (implRecords.length > 0) {
      const { error } = await supabase.from("implements").upsert(implRecords, {
        onConflict: "bas_ref_key",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`implements upsert: ${error.message}`);
      implUpserted = implRecords.length;
    }

    revalidatePath("/admin/equipment");
    return {
      ok: true,
      data: {
        equipment: { upserted: eqUpserted, total: eqRecords.length },
        implements: { upserted: implUpserted, total: implRecords.length },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Помилка синхронізації",
    };
  }
}

// ── Wialon auto-mapping ────────────────────────────────────────────

type WialonUnit = { id: number; nm: string };

const WIALON_EXCLUDE_RE = /бензовоз|kuhn|stronger/i;

async function fetchWialonUnits(): Promise<WialonUnit[]> {
  const token = process.env.WIALON_API_TOKEN?.trim();
  if (!token) throw new Error("WIALON_API_TOKEN не задано");

  const base = "https://hst-api.wialon.com/wialon/ajax.html";
  const loginRes = await fetch(
    `${base}?svc=token/login&params=${encodeURIComponent(JSON.stringify({ token }))}`,
    { cache: "no-store" }
  );
  const login = await loginRes.json();
  if (!login.eid) throw new Error("Wialon login failed");

  const params = {
    spec: {
      itemsType: "avl_unit",
      propName: "sys_name",
      propValueMask: "*",
      sortType: "sys_name",
      propType: "property",
    },
    force: 1,
    flags: 0x1,
    from: 0,
    to: 0,
  };
  const res = await fetch(
    `${base}?svc=core/search_items&params=${encodeURIComponent(JSON.stringify(params))}&sid=${login.eid}`,
    { cache: "no-store" }
  );
  const data = await res.json();
  return (data.items ?? []).map((u: { id: number; nm: string }) => ({
    id: u.id,
    nm: u.nm,
  }));
}

/**
 * Model-aware matching: extract a model "family + sub-model" signature.
 * e.g. "Case Magnum 340 11644 АІ" → "case magnum 340"
 *      'Трактор "Case IH Magnum 340" (2014)' → "case magnum 340"
 *      "МТЗ 892" → "мтз 892" / "белорусь 892"
 *      "Т150 34445 КА" → "т150" / "т-150"
 *      "NEW HOLLAND 9080" → "new holland"
 */
type ModelSignature = { family: string; model: string | null };

const MODEL_PATTERNS: Array<{
  re: RegExp;
  family: string;
  modelGroup?: number;
}> = [
  { re: /case\s*(?:ih\s*)?magnum\s*(\d{3})/i, family: "case magnum", modelGroup: 1 },
  { re: /new\s*holland/i, family: "new holland" },
  { re: /мтз[\s-]*(\d+)/i, family: "мтз", modelGroup: 1 },
  { re: /белорус[ьъ]?\s*[\s-]*(\d+)/i, family: "мтз", modelGroup: 1 },
  { re: /беларус\s*[\s-]*(\d+)/i, family: "мтз", modelGroup: 1 },
  { re: /т[\s-]?150/i, family: "т-150" },
  { re: /т[\s-]?70/i, family: "т-70" },
  { re: /тдз/i, family: "тдз" },
  { re: /оприскувач/i, family: "оприскувач" },
  { re: /навантажувач/i, family: "навантажувач" },
];

function extractModelSignature(name: string): ModelSignature | null {
  for (const p of MODEL_PATTERNS) {
    const m = name.match(p.re);
    if (m) {
      return {
        family: p.family,
        model: p.modelGroup && m[p.modelGroup] ? m[p.modelGroup] : null,
      };
    }
  }
  return null;
}

export type AutoMapResult = {
  matched: number;
  total: number;
  details: Array<{
    wialonId: number;
    wialonName: string;
    equipmentId: string;
    equipmentName: string;
  }>;
};

export async function autoMapWialon(): Promise<
  { ok: true; data: AutoMapResult } | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();

    const [units, { data: equipment, error: eqErr }] = await Promise.all([
      fetchWialonUnits(),
      supabase
        .from("equipment")
        .select("id,bas_ref_key,name,full_name,code,wialon_id")
        .order("name"),
    ]);
    if (eqErr) throw new Error(eqErr.message);
    if (!equipment) throw new Error("No equipment data");

    const relevantUnits = units.filter((u) => !WIALON_EXCLUDE_RE.test(u.nm));

    const takenWialonIds = new Set(
      equipment.filter((e) => e.wialon_id != null).map((e) => e.wialon_id!)
    );
    const takenEqIds = new Set(
      equipment.filter((e) => e.wialon_id != null).map((e) => e.id as string)
    );

    const matches: AutoMapResult["details"] = [];

    for (const unit of relevantUnits) {
      if (takenWialonIds.has(unit.id)) continue;

      const available = equipment.filter(
        (e) => !takenEqIds.has(e.id as string)
      );
      if (available.length === 0) break;

      const wSig = extractModelSignature(unit.nm);
      if (!wSig) continue;

      const familyMatches = available.filter((e) => {
        const eSig = extractModelSignature(e.name ?? "");
        if (!eSig) return false;
        if (eSig.family !== wSig.family) return false;
        if (wSig.model && eSig.model && wSig.model !== eSig.model) return false;
        return true;
      });

      if (familyMatches.length === 1) {
        const match = familyMatches[0];
        matches.push({
          wialonId: unit.id,
          wialonName: unit.nm,
          equipmentId: match.id as string,
          equipmentName: match.name as string,
        });
        takenWialonIds.add(unit.id);
        takenEqIds.add(match.id as string);
      }
    }

    for (const m of matches) {
      const { error } = await supabase
        .from("equipment")
        .update({
          wialon_id: m.wialonId,
          wialon_name: m.wialonName,
          has_tracker: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", m.equipmentId);
      if (error)
        console.error(`Failed to map ${m.wialonName}: ${error.message}`);
    }

    revalidatePath("/admin/equipment");
    return {
      ok: true,
      data: {
        matched: matches.length,
        total: relevantUnits.length,
        details: matches,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Помилка авто-маппінгу",
    };
  }
}

// ── Manual Wialon link ─────────────────────────────────────────────

export async function saveEquipmentWialon(input: {
  equipmentId: string;
  wialonId: number | null;
  wialonName: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createServiceSupabase();

    if (input.wialonId != null) {
      const { error: clearErr } = await supabase
        .from("equipment")
        .update({
          wialon_id: null,
          wialon_name: null,
          has_tracker: false,
          updated_at: new Date().toISOString(),
        })
        .eq("wialon_id", input.wialonId)
        .neq("id", input.equipmentId);
      if (clearErr) console.error("clear old mapping:", clearErr.message);
    }

    const { error } = await supabase
      .from("equipment")
      .update({
        wialon_id: input.wialonId,
        wialon_name: input.wialonName,
        has_tracker: input.wialonId != null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.equipmentId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/equipment");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти",
    };
  }
}

// ── Toggle active status ───────────────────────────────────────────

export async function toggleEquipmentActive(input: {
  equipmentId: string;
  isActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("equipment")
      .update({
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.equipmentId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/equipment");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Помилка",
    };
  }
}

// ── Fuel tank volume ───────────────────────────────────────────────

export async function saveEquipmentFuelTank(input: {
  equipmentId: string;
  fuelTankVolume: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createServiceSupabase();
    let volume: number | null = null;
    if (input.fuelTankVolume != null) {
      const n = Number(input.fuelTankVolume);
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: "Обʼєм бака має бути > 0 л" };
      }
      volume = Math.round(n * 100) / 100;
    }

    const { error } = await supabase
      .from("equipment")
      .update({
        fuel_tank_volume: volume,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.equipmentId);

    if (error) {
      if (error.message?.includes("fuel_tank_volume")) {
        return {
          ok: false,
          error: "Колонка fuel_tank_volume відсутня. Виконай міграцію 025.",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/admin/equipment");
    revalidatePath("/equipment");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти бак",
    };
  }
}

export async function saveImplementWorkingWidth(input: {
  implementId: string;
  workingWidthM: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const id = input.implementId?.trim();
    const width = Number(input.workingWidthM);
    if (!id) return { ok: false, error: "Немає ідентифікатора знаряддя" };
    if (!Number.isFinite(width) || width < 0 || width > 999) {
      return { ok: false, error: "Ширина має бути від 0 до 999 м" };
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("implements")
      .update({
        working_width_m: Math.round(width * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      if (error.message?.includes("working_width_m")) {
        return {
          ok: false,
          error: "Колонка working_width_m відсутня. Виконай міграцію 021.",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/admin/equipment");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося зберегти",
    };
  }
}

export type ImplementOption = {
  id: string;
  name: string;
  type: string;
  workingWidthM: number;
};

/** Список знарядь для форми наряду (з шириною захвату). */
export async function listImplementsForOps(): Promise<
  { ok: true; data: ImplementOption[] } | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("implements")
      .select("id, name, type, working_width_m")
      .order("name");

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("working_width_m")
      ) {
        const fallback = await supabase
          .from("implements")
          .select("id, name, type")
          .order("name");
        if (fallback.error) return { ok: false, error: fallback.error.message };
        return {
          ok: true,
          data: (fallback.data ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            type: String(row.type ?? "other"),
            workingWidthM: 0,
          })),
        };
      }
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        type: String(row.type ?? "other"),
        workingWidthM: Number(row.working_width_m) || 0,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Не вдалося завантажити знаряддя",
    };
  }
}

/** Ширина захвату знаряддя з довідника implements (за назвою). */
export async function resolveImplementWorkingWidth(
  implementName: string
): Promise<{ ok: true; widthM: number } | { ok: false; error: string }> {
  const name = implementName?.trim();
  if (!name) return { ok: false, error: "Немає назви знаряддя" };

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("implements")
      .select("working_width_m, name")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("working_width_m")
      ) {
        return { ok: true, widthM: 0 };
      }
      return { ok: false, error: error.message };
    }

    const widthM = Number(data?.working_width_m) || 0;
    if (widthM > 0) return { ok: true, widthM };

    const fuzzy = await supabase
      .from("implements")
      .select("working_width_m, name")
      .ilike("name", `%${name}%`)
      .gt("working_width_m", 0)
      .limit(1)
      .maybeSingle();

    if (fuzzy.error) return { ok: true, widthM: 0 };
    return { ok: true, widthM: Number(fuzzy.data?.working_width_m) || 0 };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося знайти ширину знаряддя",
    };
  }
}
